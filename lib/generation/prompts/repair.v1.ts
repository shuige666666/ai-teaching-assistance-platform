import type { OutlineIssue } from "../outline-schema";
import { loadPromptTemplate } from "./loader";

export const REPAIR_SYSTEM_PROMPT = loadPromptTemplate("outline-repair-system");

export function buildRepairUserPrompt(originalPrompt: string, rawOutput: string, issues: OutlineIssue[]): string {
  const issueText = issues.slice(0, 12).map((issue) => `${issue.path || "root"}: ${issue.message}`).join("\n");
  return `原任务：\n${originalPrompt}\n\n校验错误：\n${issueText}\n\n待修复输出（可能已截断）：\n${rawOutput.slice(0, 8_000)}`;
}
