import { z } from "zod";
import type { AIAdapter, AIAdapterDiagnostics, GenerateTextInput, GenerateTextResult } from "./contracts";
import { AIAdapterError } from "./contracts";
import type { ProviderConfig } from "./config";

const CompletionSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    finish_reason: z.string().nullish(),
    message: z.object({ content: z.string().nullable() }),
  })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().nullish(), completion_tokens: z.number().int().nonnegative().nullish() }).nullish(),
});

function responseDiagnostics(response: Response, responseKind: AIAdapterDiagnostics["responseKind"], responseBytes?: number): AIAdapterDiagnostics {
  return {
    providerStatus: response.status,
    responseKind,
    contentType: response.headers.get("content-type") ?? undefined,
    responseBytes,
  };
}

function mapHttpError(response: Response): AIAdapterError {
  const options = { diagnostics: responseDiagnostics(response, "http_error") };
  if (response.status === 401 || response.status === 403) return new AIAdapterError("AI_AUTH_FAILED", "模型服务认证失败，请检查当前 Provider 的 API Key", false, options);
  if ([408, 425, 429].includes(response.status)) return new AIAdapterError("AI_RATE_LIMITED", "模型服务暂时限流，请稍后重试", true, options);
  if (response.status >= 500) return new AIAdapterError("AI_UPSTREAM_ERROR", "模型服务暂时不可用", true, options);
  return new AIAdapterError("AI_UPSTREAM_ERROR", `模型服务拒绝了请求（HTTP ${response.status}）`, false, options);
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
        throw new AIAdapterError("AI_TIMEOUT", "模型请求超时或被取消", true, {
          cause: error,
          automaticRetryable: false,
          diagnostics: { responseKind: "aborted" },
        });
      }
      throw new AIAdapterError("AI_UPSTREAM_ERROR", "无法连接模型服务", true, {
        cause: error,
        diagnostics: { responseKind: "network_error" },
      });
    }
    if (!response.ok) throw mapHttpError(response);

    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      throw new AIAdapterError("AI_UPSTREAM_ERROR", "无法读取模型服务响应，请重试", true, {
        cause: error,
        diagnostics: responseDiagnostics(response, "response_read_error"),
      });
    }

    // 只记录字节数和类型，不将原始响应带入异常或日志。
    const responseBytes = new TextEncoder().encode(body).byteLength;
    if (!body.trim()) {
      throw new AIAdapterError("AI_UPSTREAM_ERROR", "模型服务本次返回了空响应，请重试", true, {
        diagnostics: responseDiagnostics(response, "empty_body", responseBytes),
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch (error) {
      throw new AIAdapterError("AI_UPSTREAM_ERROR", "模型服务本次返回了非 JSON 响应，请重试", true, {
        cause: error,
        diagnostics: responseDiagnostics(response, "invalid_json", responseBytes),
      });
    }

    const parsed = CompletionSchema.safeParse(json);
    if (!parsed.success) {
      throw new AIAdapterError("AI_UPSTREAM_ERROR", "模型服务本次返回了不兼容的响应结构，请重试", true, {
        cause: parsed.error,
        diagnostics: responseDiagnostics(response, "invalid_envelope", responseBytes),
      });
    }

    const choice = parsed.data.choices[0];
    if (!choice.message.content?.trim()) {
      throw new AIAdapterError("AI_UPSTREAM_ERROR", "模型服务本次没有返回可用内容，请重试", true, {
        diagnostics: {
          ...responseDiagnostics(response, "empty_content", responseBytes),
          finishReason: choice.finish_reason ?? undefined,
        },
      });
    }

    return {
      text: choice.message.content,
      provider: this.config.provider,
      model: parsed.data.model || this.config.model,
      finishReason: choice.finish_reason ?? undefined,
      usage: parsed.data.usage ? {
        inputTokens: parsed.data.usage.prompt_tokens ?? undefined,
        outputTokens: parsed.data.usage.completion_tokens ?? undefined,
      } : undefined,
    };
  }
}
