import { z } from "zod";
import type { AgentAdapter, AgentModelEvent, AgentTurnInput } from "@/lib/agent/contracts";
import { AIAdapterError, type AIAdapterDiagnostics } from "./contracts";
import type { ProviderConfig } from "./config";

const StreamChunkSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string().nullish(),
    delta: z.object({
      content: z.string().nullish(),
      reasoning_content: z.string().nullish(),
      tool_calls: z.array(z.object({
        index: z.number().int().nonnegative(),
        id: z.string().optional(),
        function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional(),
      })).optional(),
    }),
  })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().nullish(), completion_tokens: z.number().int().nonnegative().nullish() }).nullish(),
});

function diagnostics(response: Response, responseKind: AIAdapterDiagnostics["responseKind"]): AIAdapterDiagnostics {
  return { providerStatus: response.status, responseKind, contentType: response.headers.get("content-type") ?? undefined };
}

function mapHttpError(response: Response): AIAdapterError {
  const options = { diagnostics: diagnostics(response, "http_error") };
  if (response.status === 401 || response.status === 403) return new AIAdapterError("AI_AUTH_FAILED", "模型服务认证失败，请检查当前 Provider 的 API Key", false, options);
  if ([408, 425, 429].includes(response.status)) return new AIAdapterError("AI_RATE_LIMITED", "模型服务暂时限流，请稍后重试", true, options);
  if (response.status >= 500) return new AIAdapterError("AI_UPSTREAM_ERROR", "模型服务暂时不可用", true, options);
  return new AIAdapterError("AI_UPSTREAM_ERROR", `模型服务拒绝了请求（HTTP ${response.status}）`, false, options);
}

function toProviderMessage(message: AgentTurnInput["messages"][number]) {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })) } : {}),
    };
  }
  if (message.role === "tool") return { role: "tool", content: message.content, tool_call_id: message.toolCallId };
  return message;
}

export class OpenAICompatibleAgentAdapter implements AgentAdapter {
  constructor(private readonly config: ProviderConfig, private readonly fetcher: typeof fetch = fetch) {}

  /** 流式调用兼容 Chat Completions 的工具协议，并统一正文、可见思考和工具参数增量。 */
  async *streamTurn(input: AgentTurnInput): AsyncIterable<AgentModelEvent> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: "system", content: input.systemPrompt }, ...input.messages.map(toProviderMessage)],
          tools: input.tools,
          tool_choice: "auto",
          temperature: 0.2,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new AIAdapterError("AI_TIMEOUT", "模型请求超时或被取消", true, { cause: error, automaticRetryable: false, diagnostics: { responseKind: "aborted" } });
      }
      throw new AIAdapterError("AI_UPSTREAM_ERROR", "无法连接模型服务", true, { cause: error, diagnostics: { responseKind: "network_error" } });
    }
    if (!response.ok) throw mapHttpError(response);
    if (!response.body) throw new AIAdapterError("AI_UPSTREAM_ERROR", "模型服务本次返回了空响应，请重试", true, { diagnostics: diagnostics(response, "empty_body") });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawEvent = false;
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        for (const line of frame.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let json: unknown;
          try { json = JSON.parse(data); } catch { continue; }
          const parsed = StreamChunkSchema.safeParse(json);
          if (!parsed.success) continue;
          sawEvent = true;
          const choice = parsed.data.choices[0];
          if (choice.delta.reasoning_content) yield { type: "reasoning_delta", text: choice.delta.reasoning_content };
          if (choice.delta.content) yield { type: "text_delta", text: choice.delta.content };
          for (const call of choice.delta.tool_calls ?? []) {
            yield { type: "tool_call_delta", index: call.index, id: call.id, name: call.function?.name, argumentsDelta: call.function?.arguments };
          }
          if (choice.finish_reason || parsed.data.usage) {
            yield {
              type: "finish",
              finishReason: choice.finish_reason ?? undefined,
              usage: parsed.data.usage ? { inputTokens: parsed.data.usage.prompt_tokens ?? undefined, outputTokens: parsed.data.usage.completion_tokens ?? undefined } : undefined,
            };
          }
        }
      }
      if (done) break;
    }
    if (!sawEvent) throw new AIAdapterError("AI_UPSTREAM_ERROR", "模型服务本次没有返回可用的流式事件，请重试", true, { diagnostics: diagnostics(response, "empty_content") });
  }
}
