import type { SceneIssue } from "../scene-schema";

export const SCENE_REPAIR_SYSTEM_PROMPT = `你负责修复不符合约束的课程场景 JSON。只返回修复后的完整 JSON 对象，不要 Markdown、代码围栏、链接或解释。只修复报错字段，不改变未报错的教学意图。
即使校验错误只涉及一个字段，也必须重新输出可独立解析的完整对象；禁止只返回缺失字段、content 或 elements。待修复输出如果被长度截断，应依据原任务重新生成更精简的完整对象，不要续写残片。
必须严格遵守以下字段，禁止同义字段和额外字段：
- slide 顶层只能包含 type、content、narration、summary；content 只能包含 background、elements
- slide element 只能是 text、shape、line、code，不能包含 id；至少保留一个 textType=title 的画布内标题
- text.content 只允许有限排版 HTML；code.lines 是只读源码字符串数组，可以保留 HTML、JSX 或 TSX 源码
- slide 不允许图片、视频、图表、LaTeX、外部 URL、React 组件或可执行页面
- quiz option 只能是 {"label":"..."}，禁止使用 text、value 或 id
- quiz question 只能包含 type、prompt、options、correctOptionIndex、explanation
slide 完整骨架必须是 {"type":"slide","content":{"background":{"type":"solid","color":"#ffffff"},"elements":[]},"narration":"完整讲解稿","summary":"短摘要"}`;

export function buildSceneRepairPrompt(originalPrompt: string, rawOutput: string, issues: SceneIssue[]): string {
  const issueText = issues.slice(0, 12).map((issue) => `${issue.path || "root"}: ${issue.message}`).join("\n");
  return `修复对象：scene\n原任务：\n${originalPrompt}\n\n校验错误：\n${issueText}\n\n待修复输出（可能已截断）：\n${rawOutput.slice(0, 10_000)}`;
}
