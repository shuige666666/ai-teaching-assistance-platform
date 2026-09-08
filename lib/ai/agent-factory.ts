import type { AgentAdapter } from "@/lib/agent/contracts";
import { resolveAIConfig } from "./config";
import { MockAgentAdapter } from "./mock-agent-adapter";
import { OpenAICompatibleAgentAdapter } from "./openai-compatible-agent-adapter";

/** 复用现有 Provider 配置创建独立 Agent 适配器，不改变大纲和场景生成接口。 */
export function createAgentAdapter(environment: NodeJS.ProcessEnv = process.env): { adapter: AgentAdapter; timeoutMs: number } {
  const config = resolveAIConfig(environment);
  const configured = Number(environment.AI_AGENT_TIMEOUT_MS ?? 300_000);
  const timeoutMs = Number.isInteger(configured) && configured >= 10_000 && configured <= 300_000 ? configured : 300_000;
  return config.mode === "mock"
    ? { adapter: new MockAgentAdapter(), timeoutMs }
    : { adapter: new OpenAICompatibleAgentAdapter(config), timeoutMs };
}

