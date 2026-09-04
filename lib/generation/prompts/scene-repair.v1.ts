import type { SceneIssue } from "../scene-schema";
import { loadPromptTemplate } from "./loader";

export const SCENE_REPAIR_SYSTEM_PROMPT = loadPromptTemplate("scene-repair-system");

export function buildSceneRepairPrompt(originalPrompt: string, rawOutput: string, issues: SceneIssue[]): string {
  const issueText = issues.slice(0, 12).map((issue) => `${issue.path || "root"}: ${issue.message}`).join("\n");
  return `修复对象：scene\n原任务：\n${originalPrompt}\n\n校验错误：\n${issueText}\n\n待修复输出（可能已截断）：\n${rawOutput.slice(0, 10_000)}`;
}
