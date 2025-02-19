"use client";
import { ApiPath, Alibaba, ALIBABA_BASE_URL } from "@/app/constant";
import { useAccessStore } from "@/app/store";
import { getClientConfig } from "@/app/config/client";
import {
  useAppConfig,
  useChatStore,
  ChatMessageTool,
  usePluginStore,
} from "@/app/store";
import { streamWithThink } from "@/app/utils/chat";
import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  SpeechOptions,
} from "../api";
import {
  getMessageTextContent,
  getMessageTextContentWithoutThinking,
  getTimeoutMSByModel,
} from "@/app/utils";
import { fetch } from "@/app/utils/stream";

export interface OpenAIListModelResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    root: string;
  }>;
}

interface MessageResponse {
  content: string | null;
  tool_calls: ChatMessageTool[];
  reasoning_content: string | null;
  search_results?: Array<{
    site_name: string;
    icon: string;
    index: number;
    title: string;
    url: string;
  }>;
  citations?: string[];
  search_response?: {
    search_results?: Array<{
      site_name: string;
      icon: string;
      index: number;
      title: string;
      url: string;
    }>;
    citations?: string[];
  };
}

interface RequestPayload {
  model: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  stream: boolean;
  temperature: number;
  top_p: number;
  enable_search?: boolean;
  search_options?: {
    search_strategy: "standard" | "pro";
    enable_citation: boolean;
    enable_source: boolean;
    forced_search: boolean;
  };
}

export class QwenApi implements LLMApi {
  path(path: string): string {
    const accessStore = useAccessStore.getState();

    let baseUrl = "";

    if (accessStore.useCustomConfig) {
      baseUrl = accessStore.alibabaUrl;
    }

    if (baseUrl.length === 0) {
      const isApp = !!getClientConfig()?.isApp;
      baseUrl = isApp ? ALIBABA_BASE_URL : ApiPath.Alibaba;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (!baseUrl.startsWith("http") && !baseUrl.startsWith(ApiPath.Alibaba)) {
      baseUrl = "https://" + baseUrl;
    }

    console.log("[Proxy Endpoint] ", baseUrl, path);

    return [baseUrl, path].join("/");
  }

  extractMessage(res: any): {
    content: string;
    search_response?: { search_results?: any[]; citations?: string[] };
  } {
    const message = res?.output?.choices?.at(0)?.message;
    let content = message?.content ?? "";
    const search_response = {
      search_results: message?.search_results,
      citations: message?.citations,
    };
    if (message?.search_results?.length) {
      content =
        content +
        ` [${Array.from(
          { length: message.search_results.length },
          (_, i) => i + 1,
        ).join("][")}]`;
    }
    return { content, search_response };
  }

  speech(_options: SpeechOptions): Promise<ArrayBuffer> {
    throw new Error("Method not implemented.");
  }

  async chat(options: ChatOptions) {
    const messages = options.messages.map((v) => ({
      role: v.role,
      content:
        v.role === "assistant"
          ? getMessageTextContentWithoutThinking(v)
          : getMessageTextContent(v),
    }));

    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
      },
    };

    const shouldStream = !!options.config.stream;
    const requestPayload = {
      model: modelConfig.model,
      messages,
      stream: shouldStream,
      temperature: modelConfig.temperature,
      top_p: modelConfig.top_p === 1 ? 0.99 : modelConfig.top_p,
      enable_search: modelConfig.enableSearch ?? true,
      search_options: {
        search_strategy: modelConfig.searchOptions?.searchStrategy ?? "pro",
        enable_citation: modelConfig.searchOptions?.enableCitation ?? true,
        enable_source: modelConfig.searchOptions?.enableSource ?? true,
        forced_search: modelConfig.searchOptions?.forcedSearch ?? true,
      },
    };

    // Search parameters are already included in the root level
    // No need for additional configuration since we set it above

    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const headers = {
        ...getHeaders(),
        "X-DashScope-SSE": shouldStream ? "enable" : "disable",
      };

      const chatPath = this.path(Alibaba.ChatPath);
      const chatPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers: headers,
      };

      // make a fetch request
      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        getTimeoutMSByModel(options.config.model),
      );

      if (shouldStream) {
        const [tools, funcs] = usePluginStore
          .getState()
          .getAsTools(
            useChatStore.getState().currentSession().mask?.plugin || [],
          );
        return streamWithThink(
          chatPath,
          requestPayload,
          headers,
          tools as any,
          funcs,
          controller,
          // parseSSE
          (text: string, runTools: ChatMessageTool[]) => {
            // console.log("parseSSE", text, runTools);
            const json = JSON.parse(text);
            const choices = json.output.choices as Array<{
              message: MessageResponse;
            }>;

            if (!choices?.length) return { isThinking: false, content: "" };

            const tool_calls = choices[0]?.message?.tool_calls;
            if (tool_calls?.length > 0) {
              const index = tool_calls[0]?.index;
              const id = tool_calls[0]?.id;
              const args = tool_calls[0]?.function?.arguments;
              if (id) {
                runTools.push({
                  id,
                  type: tool_calls[0]?.type,
                  function: {
                    name: tool_calls[0]?.function?.name as string,
                    arguments: args,
                  },
                });
              } else {
                // @ts-expect-error Dynamic property access for function arguments
                runTools[index]["function"]["arguments"] += args;
              }
            }

            const reasoning = choices[0]?.message?.reasoning_content;
            const content = choices[0]?.message?.content;
            const search_results = choices[0]?.message?.search_results;
            const citations = choices[0]?.message?.citations;

            // Skip if both content and reasoning_content are empty or null
            if (
              (!reasoning || reasoning.length === 0) &&
              (!content || content.length === 0)
            ) {
              return {
                isThinking: false,
                content: "",
                search_response: null,
              };
            }

            if (reasoning && reasoning.length > 0) {
              return {
                isThinking: true,
                content: reasoning,
                search_response: null,
              };
            } else if (content && content.length > 0) {
              return {
                isThinking: false,
                content: content,
                search_response: {
                  search_results,
                  citations,
                },
              };
            }

            return {
              isThinking: false,
              content: "",
              search_response: null,
            };
          },
          // processToolMessage, include tool_calls message and tool call results
          (
            requestPayload: RequestPayload,
            toolCallMessage: any,
            toolCallResult: any[],
          ) => {
            requestPayload?.messages?.splice(
              requestPayload?.messages?.length,
              0,
              toolCallMessage,
              ...toolCallResult,
            );
          },
          options,
        );
      } else {
        const res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        const resJson = await res.json();
        const { content } = this.extractMessage(resJson);
        options.onFinish(content, res);
      }
    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }
  async usage() {
    return {
      used: 0,
      total: 0,
    };
  }

  async models(): Promise<LLMModel[]> {
    return [];
  }
}
export { Alibaba };
