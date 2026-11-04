import type { AgentContentBlock, AgentContextInfo, AgentMessage, AgentModelMessage, AgentToolBlock } from "./contracts";

const DEFAULT_MAX_TURNS = 12;
const DEFAULT_MAX_CHARACTERS = 120_000;

function toolResult(block: AgentToolBlock) {
  // 运行中的调用可能因为刷新或超时没有闭合，送回模型时明确标记为中断，不能伪装成已执行。
  const status = block.status === "running" ? "interrupted" : block.status;
  return JSON.stringify({ status, result: block.result ?? null });
}

/** 把一个持久化 assistant 消息转换成完整的 assistant/tool 消息组。 */
function assistantMessageGroups(content: { blocks: AgentContentBlock[] }): AgentModelMessage[][] {
  const turns = new Map<number, AgentContentBlock[]>();
  for (const block of content.blocks) {
    const group = turns.get(block.modelTurn) ?? [];
    group.push(block);
    turns.set(block.modelTurn, group);
  }
  return [...turns.values()].map((blocks) => {
    const text = blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
    const tools = blocks.filter((block): block is AgentToolBlock => block.type === "tool");
    // 只有思考的失败轮次没有可发送的助手消息，避免模型服务拒绝空内容。
    if (!text.trim() && tools.length === 0) return [];
    const output: AgentModelMessage[] = [{
      role: "assistant",
      content: text || null,
      ...(tools.length ? { toolCalls: tools.map((block) => ({
        id: block.callId,
        name: block.name,
        // 旧的 not_executed 块可能保存了 Provider 原始 JSON 字符串，不能再包一层 JSON 字符串。
        arguments: typeof block.arguments === "string" ? block.arguments : JSON.stringify(block.arguments),
      })) } : {}),
    }];
    for (const block of tools) output.push({ role: "tool", toolCallId: block.callId, content: toolResult(block) });
    return output;
  });
}

/** 按用户消息切分完整轮次，避免只保留 assistant/tool 链的一半。 */
function splitTurns(messages: AgentMessage[]) {
  const turns: AgentMessage[][] = [];
  let current: AgentMessage[] | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      current = [message];
      turns.push(current);
    } else if (current) current.push(message);
  }
  return turns;
}

function modelMessagesForTurn(turn: AgentMessage[]): AgentModelMessage[] {
  const output: AgentModelMessage[] = [];
  for (const message of turn) {
    if (message.role === "user" && "text" in message.content) output.push({ role: "user", content: message.content.text });
    else if (message.role === "assistant" && "blocks" in message.content) {
      for (const group of assistantMessageGroups(message.content)) output.push(...group);
    }
  }
  return output;
}

function estimate(messages: AgentModelMessage[]) {
  return JSON.stringify(messages).length;
}

/**
 * 在完整用户轮次边界上裁剪模型上下文，并返回可用于 UI 的裁剪信息。
 * 数据库历史不会被删除；这里仅决定本轮发送给 Provider 的窗口。
 */
export function buildAgentModelContext(messages: AgentMessage[], options: { maxTurns?: number; maxCharacters?: number } = {}): { messages: AgentModelMessage[]; info: AgentContextInfo } {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  const turns = splitTurns(messages);
  const selected: AgentModelMessage[][] = [];
  let usedCharacters = 0;
  for (let index = turns.length - 1; index >= 0 && selected.length < maxTurns; index -= 1) {
    const candidate = modelMessagesForTurn(turns[index]);
    if (candidate.length === 0) continue;
    const size = estimate(candidate);
    // 最新一轮必须保留；后续轮次在预算不足时整组舍弃，避免孤立 tool result。
    if (selected.length > 0 && usedCharacters + size > maxCharacters) break;
    selected.unshift(candidate);
    usedCharacters += size;
  }
  const modelMessages = selected.flat();
  return {
    messages: modelMessages,
    info: {
      omittedMessageCount: Math.max(0, turns.length - selected.length),
      includedTurnCount: selected.length,
      usedCharacters,
      maxCharacters,
    },
  };
}

/** 保留旧调用接口；maxMessages 作为兼容参数映射到完整轮次数。 */
export function buildAgentModelHistory(messages: AgentMessage[], maxMessages = 24): AgentModelMessage[] {
  return buildAgentModelContext(messages, { maxTurns: Math.max(1, Math.ceil(maxMessages / 2)) }).messages;
}
