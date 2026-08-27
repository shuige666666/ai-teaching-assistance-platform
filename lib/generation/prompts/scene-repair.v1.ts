import type { SceneIssue } from "../scene-schema";

export const SCENE_REPAIR_SYSTEM_PROMPT = `你负责修复不符合约束的课程场景 JSON。只返回修复后的完整 JSON 对象，不要 Markdown、代码围栏、链接或解释。只修复报错字段，不改变未报错的教学意图。
必须严格遵守以下字段，禁止同义字段和额外字段：
- slide paragraph 只能是 {"type":"paragraph","text":"..."}
- slide bullet_list 只能是 {"type":"bullet_list","items":["..."]}
- slide callout 只能包含 type、tone、title（可选）、text；tone 只能是 info、example、warning
- slide code 只能包含 type、language、code、caption（可选），不能包含 title；code 字段可以保留只读展示用的 HTML、JSX 或 TSX 源码
- 除 slide code.code 外，任何字段都不能包含 HTML 标签或外部 URL
- quiz option 只能是 {"label":"..."}，禁止使用 text、value 或 id
- quiz question 只能包含 type、prompt、options、correctOptionIndex、explanation`;

export function buildSceneRepairPrompt(originalPrompt: string, rawOutput: string, issues: SceneIssue[]): string {
  const issueText = issues.slice(0, 12).map((issue) => `${issue.path || "root"}: ${issue.message}`).join("\n");
  return `修复对象：scene\n原任务：\n${originalPrompt}\n\n校验错误：\n${issueText}\n\n待修复输出（可能已截断）：\n${rawOutput.slice(0, 10_000)}`;
}
