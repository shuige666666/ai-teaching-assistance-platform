import type { Course, SceneOutline } from "@/lib/domain/schemas";

export const QUIZ_PROMPT_VERSION = "scene-quiz.v1";
export const QUIZ_SYSTEM_PROMPT = `你是中文微课的测验设计师。只返回一个 JSON 对象，不要 Markdown、HTML、链接或代码围栏。
对象只能包含 type、title、content、narration、summary，type 必须为 quiz。
content 只能包含 questions，每题只能包含 type、prompt、options、correctOptionIndex、explanation；type 必须为 single_choice。
每场 1～3 题，每题 2～4 个不重复选项。options 只包含 label，正确答案用从 0 开始的 correctOptionIndex，不要生成任何 id。
narration 是 1500 字以内的中文引导语，summary 是 300 字以内的短摘要。不要生成 Action、状态、外部 URL 或额外字段。`;

export function buildQuizUserPrompt(course: Course, outline: SceneOutline, previousSummary?: string): string {
  const coursePlan = course.outlines.map((item) => `${item.order}.${item.type}:${item.title}`).join(" | ");
  return `教学主题：${course.topic}\n课程标题：${course.title}\n场景类型：quiz\n场景顺序：${outline.order}\n场景标题：${outline.title}\n教学目标：${outline.teachingObjective}\n关键点：${outline.keyPoints.join("；")}\n课程计划：${coursePlan}\n前页摘要：${previousSummary ?? "无，这是首个已生成场景"}`;
}
