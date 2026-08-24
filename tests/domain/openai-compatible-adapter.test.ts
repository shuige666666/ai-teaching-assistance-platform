import { describe, expect, it } from "vitest";
import { OpenAICompatibleAdapter } from "@/lib/ai/openai-compatible-adapter";

describe("OpenAICompatibleAdapter", () => {
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
    const adapter = new OpenAICompatibleAdapter({ mode: "remote", provider: "deepseek", apiKey: "secret", baseUrl: "https://api.example.com/v1", model: "configured-model", timeoutMs: 90_000, sceneTimeoutMs: 120_000 }, fetcher);
    const result = await adapter.generateText({ requestId: "req", stage: "outline", systemPrompt: "system", userPrompt: "user", signal: new AbortController().signal, maxOutputTokens: 1000 });
    expect(capturedUrl).toBe("https://api.example.com/v1/chat/completions");
    expect(JSON.parse(String(capturedOptions?.body))).toMatchObject({ model: "configured-model", response_format: { type: "json_object" }, stream: false });
    expect(result).toMatchObject({ provider: "deepseek", model: "remote-model-version", usage: { inputTokens: 12, outputTokens: 5 } });
  });
});
