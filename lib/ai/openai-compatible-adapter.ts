import { z } from "zod";
import type { AIAdapter, GenerateTextInput, GenerateTextResult } from "./contracts";
import { AIAdapterError } from "./contracts";
import type { ProviderConfig } from "./config";

const CompletionSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    finish_reason: z.string().nullish(),
    message: z.object({ content: z.string().nullable() }),
  })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().optional(), completion_tokens: z.number().int().nonnegative().optional() }).optional(),
});

function mapHttpError(status: number): AIAdapterError {
  if (status === 401 || status === 403) return new AIAdapterError("AI_AUTH_FAILED", "模型服务认证失败，请检查当前 Provider 的 API Key", false);
  if (status === 408 || status === 429) return new AIAdapterError("AI_RATE_LIMITED", "模型服务暂时限流，请稍后重试", true);
  if (status >= 500) return new AIAdapterError("AI_UPSTREAM_ERROR", "模型服务暂时不可用", true);
  return new AIAdapterError("AI_UPSTREAM_ERROR", `模型服务拒绝了请求（HTTP ${status}）`, false);
}

export class OpenAICompatibleAdapter implements AIAdapter {
  constructor(private readonly config: ProviderConfig, private readonly fetcher: typeof fetch = fetch) {}

  /** 调用服务端配置的 OpenAI-compatible Chat Completions，并把响应缩减为统一结果。 */
  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: input.systemPrompt },
            { role: "user", content: input.userPrompt },
          ],
          max_tokens: input.maxOutputTokens,
          temperature: 0.2,
          stream: false,
          response_format: { type: "json_object" },
        }),
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new AIAdapterError("AI_TIMEOUT", "模型请求超时或被取消", true, { cause: error });
      }
      throw new AIAdapterError("AI_UPSTREAM_ERROR", "无法连接模型服务", true, { cause: error });
    }
    if (!response.ok) throw mapHttpError(response.status);
    try {
      const parsed = CompletionSchema.parse(await response.json());
      const choice = parsed.choices[0];
      if (!choice.message.content?.trim()) throw new Error("empty content");
      return {
        text: choice.message.content,
        provider: this.config.provider,
        model: parsed.model || this.config.model,
        finishReason: choice.finish_reason ?? undefined,
        usage: parsed.usage ? { inputTokens: parsed.usage.prompt_tokens, outputTokens: parsed.usage.completion_tokens } : undefined,
      };
    } catch (error) {
      throw new AIAdapterError("AI_UPSTREAM_ERROR", "模型服务返回了无法识别的响应", false, { cause: error });
    }
  }
}
