import type { AgentMessage, AgentModelMessage, AgentToolBlock } from "./contracts";

function toolResult(block: AgentToolBlock) {
  return JSON.stringify({ status: block.status, result: block.result ?? null });
}

/** 从持久化 UI 块重建标准 assistant/tool 消息，保持 tool_call_id 配对。 */
export function buildAgentModelHistory(messages: AgentMessage[], maxMessages = 24): AgentModelMessage[] {
  const selected = messages.slice(-maxMessages);
  // 历史从完整 user turn 开始，避免把孤立 assistant/tool 链发给 Provider。
  while (selected.length && selected[0].role !== "user") selected.shift();
  const output: AgentModelMessage[] = [];
  for (const message of selected) {
    if (message.role === "user" && "text" in message.content) {
      output.push({ role: "user", content: message.content.text });
      continue;
    }
    if (message.role !== "assistant" || !("blocks" in message.content)) continue;
    const turns = new Map<number, typeof message.content.blocks>();
    for (const block of message.content.blocks) {
      const group = turns.get(block.modelTurn) ?? [];
      group.push(block);
      turns.set(block.modelTurn, group);
    }
    for (const blocks of turns.values()) {
      const text = blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
      const tools = blocks.filter((block): block is AgentToolBlock => block.type === "tool");
      output.push({
        role: "assistant",
        content: text || null,
        ...(tools.length ? { toolCalls: tools.map((block) => ({ id: block.callId, name: block.name, arguments: JSON.stringify(block.arguments) })) } : {}),
      });
      for (const block of tools) output.push({ role: "tool", toolCallId: block.callId, content: toolResult(block) });
    }
  }
  return output;
}
