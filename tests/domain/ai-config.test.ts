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

  it("不会因为未启用 Provider 的空配置而阻塞当前档位", () => {
    expect(resolveAIConfig({
      AI_MODE: "remote",
      AI_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "server-secret",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com",
      DEEPSEEK_MODEL: "configured-model",
      BAILIAN_API_KEY: "",
    })).toMatchObject({ provider: "deepseek", model: "configured-model" });
  });

  it.each([
    [{ AI_MODE: "remote", AI_PROVIDER: "unknown" }, "AI_PROVIDER"],
    [{ AI_MODE: "remote", AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "secret", DEEPSEEK_BASE_URL: "http://example.com", DEEPSEEK_MODEL: "model" }, "BASE_URL"],
    [{ AI_MODE: "mock", AI_OUTLINE_TIMEOUT_MS: "999" }, "TIMEOUT"],
  ])("拒绝无效配置 %#", (environment, expectedMessage) => {
    expect(() => resolveAIConfig(environment)).toThrowError(expectedMessage);
  });
});
