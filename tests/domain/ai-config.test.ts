import { describe, expect, it } from "vitest";
import { AIAdapterError } from "@/lib/ai/contracts";
import { resolveAIConfig } from "@/lib/ai/config";

describe("ProviderConfigResolver", () => {
  it("默认选择不访问网络的 mock 配置", () => {
    expect(resolveAIConfig({})).toMatchObject({ mode: "mock", provider: "mock", model: "mock-outline-v1" });
  });

  it.each([
    ["deepseek", "DEEPSEEK", "https://api.deepseek.com", "deepseek-v4-flash"],
    ["bailian", "BAILIAN", "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", "qwen-plus"],
  ] as const)("只解析当前启用的 %s 配置档", (provider, prefix, baseUrl, model) => {
    const config = resolveAIConfig({
      AI_MODE: "remote",
      AI_PROVIDER: provider,
      [`${prefix}_API_KEY`]: "server-secret",
      [`${prefix}_BASE_URL`]: baseUrl,
      [`${prefix}_MODEL`]: model,
    });
    expect(config).toMatchObject({ mode: "remote", provider, baseUrl, model });
  });

  it("remote 缺少当前 Provider 密钥时快速失败", () => {
    expect(() => resolveAIConfig({ AI_MODE: "remote", AI_PROVIDER: "deepseek", DEEPSEEK_BASE_URL: "https://api.deepseek.com", DEEPSEEK_MODEL: "model" }))
      .toThrowError(AIAdapterError);
  });
});
