import type { AgentAdapter } from "@/lib/agent/contracts";
import type { AIAdapter } from "./contracts";
import { resolveAIConfig } from "./config";
import { MockAIAdapter } from "./mock-adapter";
import { MockAgentAdapter } from "./mock-agent-adapter";
import { OpenAICompatibleAdapter } from "./openai-compatible-adapter";
import { OpenAICompatibleAgentAdapter } from "./openai-compatible-agent-adapter";

/** 复用现有 Provider 配置创建独立 Agent 适配器，不改变大纲和场景生成接口。 */
export function createAgentAdapter(environment: NodeJS.ProcessEnv = process.env): { adapter: AgentAdapter; generationAdapter: AIAdapter; timeoutMs: number; sceneTimeoutMs: number } {
  const config = resolveAIConfig(environment);
  const configured = Number(environment.AI_AGENT_TIMEOUT_MS ?? 300_000);
  const timeoutMs = Number.isInteger(configured) && configured >= 10_000 && configured <= 300_000 ? configured : 300_000;
  return config.mode === "mock"
    ? { adapter: new MockAgentAdapter(), generationAdapter: new MockAIAdapter(), timeoutMs, sceneTimeoutMs: config.sceneTimeoutMs }
    : { adapter: new OpenAICompatibleAgentAdapter(config), generationAdapter: new OpenAICompatibleAdapter(config), timeoutMs, sceneTimeoutMs: config.sceneTimeoutMs };
}

