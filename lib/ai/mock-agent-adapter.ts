import { randomUUID } from "node:crypto";
import type { AgentAdapter, AgentModelEvent, AgentTurnInput } from "@/lib/agent/contracts";

export type MockAgentTurn = { reasoning?: string; text?: string; toolCalls?: Array<{ id?: string; name: string; arguments: unknown }> };

export class MockAgentAdapter implements AgentAdapter {
  private index = 0;
  constructor(private readonly turns?: MockAgentTurn[]) {}

  /** 按测试脚本输出与真实 Provider 相同的归一化事件。 */
  async *streamTurn(input: AgentTurnInput): AsyncIterable<AgentModelEvent> {
    void input;
    const scripted = this.turns?.[Math.min(this.index++, this.turns.length - 1)];
    const lastMessage = input.messages.at(-1);
    const turn = scripted ?? (lastMessage?.role === "tool"
      ? { text: "已完成课堂读取；页面数量与标题以工具返回的当前结果为准。" }
      : { reasoning: "先读取当前课堂页面清单，再基于真实工具结果回答。", toolCalls: [{ name: "list_scenes", arguments: {} }] });
    if (turn.reasoning) yield { type: "reasoning_delta", text: turn.reasoning };
    if (turn.text) yield { type: "text_delta", text: turn.text };
    for (const [index, call] of (turn.toolCalls ?? []).entries()) {
      yield { type: "tool_call_delta", index, id: call.id ?? randomUUID(), name: call.name, argumentsDelta: JSON.stringify(call.arguments) };
    }
    yield { type: "finish", finishReason: turn.toolCalls?.length ? "tool_calls" : "stop" };
  }
}
