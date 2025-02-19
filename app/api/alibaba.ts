import { getServerSideConfig } from "@/app/config/server";
import { ModelProvider, ServiceProvider } from "@/app/constant";
import { prettyObject } from "@/app/utils/format";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/api/auth";
import { isModelNotavailableInServer } from "@/app/utils/model";
import { SearchOptions } from "@/app/client/api";

interface AlibabaRequestBody {
  model?: string;
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

  // alibaba use base url or just remove the path
  const baseUrl =
    serverConfig.alibabaUrl ||
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

  if (!baseUrl.startsWith("http")) {
    baseUrl = `https://${baseUrl}`;
  }

  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }
  console.log("[Base Url]", baseUrl);

  const timeoutId = setTimeout(
    () => {
      controller.abort();
    },
    10 * 60 * 1000,
  );
  const fetchOptions: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      Authorization: req.headers.get("Authorization") ?? "",
      "X-DashScope-SSE": req.headers.get("X-DashScope-SSE") ?? "disable",
    },
    method: req.method,
    body: req.body,
    redirect: "manual",
    // @ts-expect-error Fetch API duplex option
    duplex: "half",
    signal: controller.signal,
  };

  // Handle request body and search parameters
  if (req.body) {
    try {
      const clonedBody = await req.text();
      const jsonBody = JSON.parse(clonedBody) as AlibabaRequestBody;

      // Add search parameters if enabled
      if (
        jsonBody.modelConfig?.enableSearch ||
        serverConfig.alibabaEnableSearch
      ) {
        const strategy = (jsonBody.modelConfig?.searchOptions?.searchStrategy ||
          serverConfig.alibabaSearchStrategy ||
          "standard") as "standard" | "pro";
        jsonBody.search_options = {
          enable_source:
            jsonBody.modelConfig?.searchOptions?.enableSource ||
            serverConfig.alibabaEnableSource ||
            false,
          enable_citation:
            jsonBody.modelConfig?.searchOptions?.enableCitation ||
            serverConfig.alibabaEnableCitation ||
            false,
          search_strategy: strategy,
          forced_search:
            jsonBody.modelConfig?.searchOptions?.forcedSearch ||
            serverConfig.alibabaForcedSearch ||
            false,
        };
      }

      // #1815 try to refuse some request to some models
      if (serverConfig.customModels) {
        if (
          isModelNotavailableInServer(
            serverConfig.customModels,
            jsonBody?.model as string,
            ServiceProvider.Alibaba as string,
          )
        ) {
          return NextResponse.json(
            {
              error: true,
              message: `you are not allowed to use ${jsonBody?.model} model`,
            },
            {
              status: 403,
            },
          );
        }
      }

      // Update request body with modified JSON
      fetchOptions.body = JSON.stringify(jsonBody);
    } catch (e) {
      console.error(`[Alibaba] request processing`, e);
      return NextResponse.json(
        { error: true, message: "Failed to process request body" },
        { status: 400 },
      );
    }
  }
  try {
    const res = await fetch(fetchUrl, fetchOptions);

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
