import { getServerSideConfig } from "@/app/config/server";
import { ModelProvider } from "@/app/constant";
import { prettyObject } from "@/app/utils/format";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/api/auth";
import { SearchOptions } from "@/app/client/api";

interface AlibabaRequestBody {
  model?: string;
  messages?: Array<{
    role: string;
    content: string;
  }>;
  modelConfig?: {
    enableSearch?: boolean;
    searchOptions?: {
      enableSource?: boolean;
      enableCitation?: boolean;
      searchStrategy?: string;
      forcedSearch?: boolean;
    };
  };
  search_options?: SearchOptions;
}

const serverConfig = getServerSideConfig();

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  console.log("[Alibaba Route] params ", params);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const authResult = auth(req, ModelProvider.Qwen);
  if (authResult.error) {
    return NextResponse.json(authResult, {
      status: 401,
    });
  }

  try {
    const response = await request(req);
    return response;
  } catch (e) {
    console.error("[Alibaba] ", e);
    return NextResponse.json(prettyObject(e));
  }
}

async function request(req: NextRequest) {
  const controller = new AbortController();

  // Use the DashScope API endpoint
  const baseUrl =
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation";
  console.log("[Base Url]", baseUrl);

  // Transform request body to match DashScope API format
  let requestBody = null;
  if (req.body) {
    try {
      const clonedBody = await req.text();
      const jsonBody = JSON.parse(clonedBody) as AlibabaRequestBody;

      requestBody = {
        model: "qwen-max",
        input: {
          messages: [
            {
              role: "user",
              content: jsonBody.messages?.[0]?.content || "Hello",
            },
          ],
        },
        parameters: {
          result_format: "message",
          incremental_output: false,
          temperature: 0.7,
          top_p: 0.99,
          enable_search: true,
          search_options: {
            search_strategy: "pro",
            enable_citation: true,
            enable_source: true,
            forced_search: true,
          },
        },
      };
    } catch (e) {
      console.error("[Alibaba] request processing", e);
      return NextResponse.json(
        { error: true, message: "Failed to process request body" },
        { status: 400 },
      );
    }
  }

  const timeoutId = setTimeout(
    () => {
      controller.abort();
    },
    10 * 60 * 1000,
  );

  // Configure fetch options with request body
  const fetchOptions: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      Authorization: req.headers.get("Authorization") ?? "",
      "X-DashScope-SSE": req.headers.get("X-DashScope-SSE") ?? "disable",
    },
    method: req.method,
    body: requestBody ? JSON.stringify(requestBody) : undefined,
    redirect: "manual",
    // @ts-expect-error Fetch API duplex option
    duplex: "half",
    signal: controller.signal,
  };

  // Transform request body to match DashScope API format
  if (req.body) {
    try {
      const clonedBody = await req.text();
      const jsonBody = JSON.parse(clonedBody) as AlibabaRequestBody;

      const requestBody = {
        model: "qwen-max",
        input: {
          messages: [
            {
              role: "user",
              content: jsonBody.messages?.[0]?.content || "",
            },
          ],
        },
        parameters: {
          result_format: "message",
          incremental_output: false,
          temperature: 0.7,
          top_p: 0.99,
          enable_search: true,
          search_options: {
            search_strategy: "pro",
            enable_citation: true,
            enable_source: true,
            forced_search: true,
          },
        },
      };

      // Update request body with DashScope format
      fetchOptions.body = JSON.stringify(requestBody);
    } catch (e) {
      console.error(`[Alibaba] request processing`, e);
      return NextResponse.json(
        { error: true, message: "Failed to process request body" },
        { status: 400 },
      );
    }
  }
  try {
    const res = await fetch(baseUrl, fetchOptions);

    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    // to disable nginx buffering
    newHeaders.set("X-Accel-Buffering", "no");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } catch (e) {
    console.error(`[Alibaba] fetch error:`, e);
    return NextResponse.json(
      { error: true, message: "Failed to fetch from Alibaba API" },
      { status: 500 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
