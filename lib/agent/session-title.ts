import type { AgentMessage } from "./contracts";

export const DEFAULT_AGENT_SESSION_TITLE = "新对话";

/** 从首条用户消息生成可辨认的短标题，避免历史会话全部显示同一个课程名。 */
export function summarizeAgentSessionTitle(text: string, maxLength = 36) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return DEFAULT_AGENT_SESSION_TITLE;
  const firstSentence = normalized.split(/[。！？!?；;\n]/, 1)[0]?.trim() || normalized;
  const characters = Array.from(firstSentence);
  return characters.length > maxLength
    ? `${characters.slice(0, maxLength).join("")}…`
    : firstSentence;
}

/** 找到会话中最早的用户文本，供自动命名和历史标题补齐使用。 */
export function firstUserMessageText(messages: readonly AgentMessage[]) {
  const first = messages.find((message) => message.role === "user" && "text" in message.content);
  return first && "text" in first.content ? first.content.text : undefined;
}

/** 识别旧版本创建的占位标题；用户手动命名后的标题不会被自动覆盖。 */
export function isDefaultAgentSessionTitle(title: string, courseTitle?: string) {
  return title === DEFAULT_AGENT_SESSION_TITLE
    || (courseTitle !== undefined && title === `${courseTitle} · 课程修订`)
    || (courseTitle === undefined && title.endsWith(" · 课程修订"));
}
