import { describe, expect, it } from "vitest";
import { OpenAICompatibleAdapter } from "@/lib/ai/openai-compatible-adapter";

const config = {
  mode: "remote" as const,
  provider: "deepseek" as const,
  apiKey: "secret",
  baseUrl: "https://api.example.com/v1",
  model: "configured-model",
  timeoutMs: 90_000,
  sceneTimeoutMs: 120_000,
};

function input(signal = new AbortController().signal) {
  return { requestId: "req", stage: "outline" as const, systemPrompt: "system", userPrompt: "user", signal, maxOutputTokens: 1000 };
}

describe("OpenAICompatibleAdapter", () => {
  it("互动原始 HTML 请求不发送 JSON mode，其他参数保留", async () => {
    let body: Record<string, unknown> = {};
    const adapter = new OpenAICompatibleAdapter(config, async (_url, options) => {
      body = JSON.parse(String(options?.body));
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "<!doctype html><html></html>" } }] }));
    });
    await adapter.generateText({ ...input(), stage: "scene", outputFormat: "text" });
    expect(body).not.toHaveProperty("response_format");
    expect(body).toMatchObject({ thinking: { type: "disabled" }, max_tokens: 1000 });
  });

  it("向服务端配置的 chat/completions 发送 JSON mode 请求并缩减响应", async () => {
    let capturedUrl = "";
    let capturedOptions: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, options) => {
      capturedUrl = String(input);
      capturedOptions = options;
      return new Response(JSON.stringify({
        model: "remote-model-version",
        choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }],
        usage: { prompt_tokens: 12, completion_tokens: 5 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const adapter = new OpenAICompatibleAdapter(config, fetcher);
    const result = await adapter.generateText(input());
    expect(capturedUrl).toBe("https://api.example.com/v1/chat/completions");
    expect(JSON.parse(String(capturedOptions?.body))).toMatchObject({ model: "configured-model", response_format: { type: "json_object" }, stream: false });
    expect(JSON.parse(String(capturedOptions?.body))).not.toHaveProperty("thinking");
    expect(result).toMatchObject({ provider: "deepseek", model: "remote-model-version", usage: { inputTokens: 12, outputTokens: 5 } });
  });

  it("仅 DeepSeek 首轮场景生成关闭思考模式", async () => {
    let requestBody: Record<string, unknown> = {};
    const adapter = new OpenAICompatibleAdapter(config, async (_input, options) => {
      requestBody = JSON.parse(String(options?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }] }), { status: 200 });
    });
    await adapter.generateText({ ...input(), stage: "scene" });
    expect(requestBody).toMatchObject({ thinking: { type: "disabled" } });
  });

  it("不向非 DeepSeek Provider 发送专有 thinking 参数", async () => {
    let requestBody: Record<string, unknown> = {};
    const adapter = new OpenAICompatibleAdapter({ ...config, provider: "bailian" }, async (_input, options) => {
      requestBody = JSON.parse(String(options?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }] }), { status: 200 });
    });
    await adapter.generateText(input());
    expect(requestBody).not.toHaveProperty("thinking");
  });

  it.each([
    ["", "empty_body"],
    ["gateway returned plain text", "invalid_json"],
    [JSON.stringify({ model: "remote-model", result: "missing choices" }), "invalid_envelope"],
    [JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "  " } }] }), "empty_content"],
  ])("将 2xx 不可用响应 %s 分类为可重试错误", async (body, responseKind) => {
    const adapter = new OpenAICompatibleAdapter(config, async () => new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(adapter.generateText(input())).rejects.toMatchObject({
      code: "AI_UPSTREAM_ERROR",
      retryable: true,
      diagnostics: {
        providerStatus: 200,
        responseKind,
        contentType: "application/json",
        responseBytes: new TextEncoder().encode(body).byteLength,
      },
    });
  });

  it.each([
    [401, "AI_AUTH_FAILED", false],
    [403, "AI_AUTH_FAILED", false],
    [422, "AI_UPSTREAM_ERROR", false],
    [429, "AI_RATE_LIMITED", true],
    [502, "AI_UPSTREAM_ERROR", true],
  ])("按 HTTP %i 映射错误分类", async (status, code, retryable) => {
    const adapter = new OpenAICompatibleAdapter(config, async () => new Response(null, { status }));
    await expect(adapter.generateText(input())).rejects.toMatchObject({
      code,
      retryable,
      diagnostics: { providerStatus: status, responseKind: "http_error" },
    });
  });

  it("用户取消时立即返回不可继续重试的取消诊断", async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = new OpenAICompatibleAdapter(config, async () => {
      throw new DOMException("aborted", "AbortError");
    });

    await expect(adapter.generateText(input(controller.signal))).rejects.toMatchObject({
      code: "AI_TIMEOUT",
      retryable: true,
      automaticRetryable: false,
      diagnostics: { responseKind: "aborted" },
    });
  });
});
