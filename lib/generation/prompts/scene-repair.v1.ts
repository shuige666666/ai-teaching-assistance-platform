import type { SceneIssue } from "../scene-schema";

export const SCENE_REPAIR_SYSTEM_PROMPT = `你负责修复不符合约束的课程场景 JSON。只返回修复后的完整 JSON 对象，不要 Markdown、HTML、链接或解释。只修复报错字段，不改变未报错的教学意图。`;

export function buildSceneRepairPrompt(originalPrompt: string, rawOutput: string, issues: SceneIssue[]): string {
  const issueText = issues.slice(0, 12).map((issue) => `${issue.path || "root"}: ${issue.message}`).join("\n");
  return `修复对象：scene\n原任务：\n${originalPrompt}\n\n校验错误：\n${issueText}\n\n待修复输出（可能已截断）：\n${rawOutput.slice(0, 10_000)}`;
}
