import type { OutlineIssue } from "../outline-schema";

export const REPAIR_SYSTEM_PROMPT = `你负责修复一份不符合约束的课程大纲 JSON。只返回修复后的完整 JSON 对象，不要 Markdown 或解释。只修复报错字段和格式，不改变其他教学意图。`;

export function buildRepairUserPrompt(originalPrompt: string, rawOutput: string, issues: OutlineIssue[]): string {
  const issueText = issues.slice(0, 12).map((issue) => `${issue.path || "root"}: ${issue.message}`).join("\n");
  return `原任务：\n${originalPrompt}\n\n校验错误：\n${issueText}\n\n待修复输出（可能已截断）：\n${rawOutput.slice(0, 8_000)}`;
}
