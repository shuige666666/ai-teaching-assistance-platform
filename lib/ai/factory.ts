import type { AIAdapter } from "./contracts";
import { resolveAIConfig } from "./config";
import { MockAIAdapter } from "./mock-adapter";
import { OpenAICompatibleAdapter } from "./openai-compatible-adapter";

/** 为本次服务端请求创建已校验的模型适配器；浏览器不能覆盖 Provider 配置。 */
export function createAIAdapter(environment: NodeJS.ProcessEnv = process.env): { adapter: AIAdapter; timeoutMs: number; sceneTimeoutMs: number } {
  const config = resolveAIConfig(environment);
  return config.mode === "mock"
    ? { adapter: new MockAIAdapter(), timeoutMs: config.timeoutMs, sceneTimeoutMs: config.sceneTimeoutMs }
    : { adapter: new OpenAICompatibleAdapter(config), timeoutMs: config.timeoutMs, sceneTimeoutMs: config.sceneTimeoutMs };
}
