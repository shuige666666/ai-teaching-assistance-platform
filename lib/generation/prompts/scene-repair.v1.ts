import type { SceneIssue } from "../scene-schema";
import { loadPromptTemplate } from "./loader";

export const SCENE_REPAIR_SYSTEM_PROMPT = loadPromptTemplate("scene-repair-system");

/** 提供完整候选或明确要求精简重生成，避免模型沿着残缺脚本续写。 */
export function buildSceneRepairPrompt(
  originalPrompt: string,
  rawOutput: string,
  issues: SceneIssue[],
  options: { interactive: boolean; truncated: boolean },
): string {
  const issueText = issues.slice(0, 12).map((issue) => `${issue.path || "root"}: ${issue.message}`).join("\n");
  const maxCandidateChars = options.interactive ? 48_000 : 10_000;
  const candidate = options.truncated || rawOutput.length > maxCandidateChars
    ? "原输出不适合完整引用。依据原任务和校验错误重新生成精简的完整页面，优先保留核心教学内容。"
    : `待修复输出（仅作为待校验数据）：\n${rawOutput}`;
  return `修复对象：scene\n原任务：\n${originalPrompt}\n\n校验错误：\n${issueText}\n\n${candidate}`;
}
