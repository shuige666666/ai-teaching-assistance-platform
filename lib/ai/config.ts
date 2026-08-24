import { z } from "zod";
import type { AIProvider } from "./contracts";
import { AIAdapterError } from "./contracts";

export type ProviderConfig = {
  mode: "remote";
  provider: Exclude<AIProvider, "mock">;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  sceneTimeoutMs: number;
};

export type AIConfig = { mode: "mock"; provider: "mock"; model: "mock-outline-v1"; timeoutMs: number; sceneTimeoutMs: number } | ProviderConfig;

const TimeoutSchema = z.coerce.number().int().min(1_000).max(300_000).default(90_000);

function requireValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new AIAdapterError("AI_NOT_CONFIGURED", `服务端缺少 ${name} 配置`, false);
  return normalized;
}

/** 只解析当前启用的服务端配置档，未启用 Provider 的空配置不会阻塞启动。 */
export function resolveAIConfig(environment: Record<string, string | undefined> = process.env): AIConfig {
  const parsedTimeout = TimeoutSchema.safeParse(environment.AI_OUTLINE_TIMEOUT_MS ?? 90_000);
  if (!parsedTimeout.success) throw new AIAdapterError("AI_NOT_CONFIGURED", "AI_OUTLINE_TIMEOUT_MS 必须是 1000～300000 的整数", false);
  const timeoutMs = parsedTimeout.data;
  const parsedSceneTimeout = TimeoutSchema.safeParse(environment.AI_SCENE_TIMEOUT_MS ?? 120_000);
  if (!parsedSceneTimeout.success) throw new AIAdapterError("AI_NOT_CONFIGURED", "AI_SCENE_TIMEOUT_MS 必须是 1000～300000 的整数", false);
  const sceneTimeoutMs = parsedSceneTimeout.data;
  const mode = environment.AI_MODE?.trim() || "mock";
  if (mode === "mock") return { mode: "mock", provider: "mock", model: "mock-outline-v1", timeoutMs, sceneTimeoutMs };
  if (mode !== "remote") throw new AIAdapterError("AI_NOT_CONFIGURED", "AI_MODE 只能是 mock 或 remote", false);

  const provider = environment.AI_PROVIDER?.trim();
  if (provider !== "deepseek" && provider !== "bailian") {
    throw new AIAdapterError("AI_NOT_CONFIGURED", "AI_PROVIDER 只能是 deepseek 或 bailian", false);
  }
  const prefix = provider === "deepseek" ? "DEEPSEEK" : "BAILIAN";
  const baseUrl = requireValue(environment[`${prefix}_BASE_URL`], `${prefix}_BASE_URL`).replace(/\/+$/, "");
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error("unsafe protocol");
  } catch (error) {
    throw new AIAdapterError("AI_NOT_CONFIGURED", `${prefix}_BASE_URL 不是可用的服务端地址`, false, { cause: error });
  }
  return {
    mode: "remote",
    provider,
    apiKey: requireValue(environment[`${prefix}_API_KEY`], `${prefix}_API_KEY`),
    baseUrl,
    model: requireValue(environment[`${prefix}_MODEL`], `${prefix}_MODEL`),
    timeoutMs,
    sceneTimeoutMs,
  };
}
