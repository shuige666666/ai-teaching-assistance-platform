import type { Course, SceneOutline } from "@/lib/domain/schemas";

export const SLIDE_PROMPT_VERSION = "scene-slide.v1";
export const SLIDE_SYSTEM_PROMPT = `你是中文微课的内容设计师。只返回一个 JSON 对象，不要 Markdown、HTML、链接或代码围栏。
对象只能包含 type、title、content、narration、summary，type 必须为 slide。
content 只能包含 subtitle 和 1～5 个 blocks；block 只能是 paragraph、bullet_list、callout、code，不能包含 id。
paragraph 使用 text；bullet_list 使用 2～6 项 items；callout 使用 tone、可选 title 和 text；code 使用 language、code、可选 caption。
narration 是 1500 字以内的中文讲解稿，summary 是 300 字以内供下一场景使用的短摘要。不要生成 Action、状态、外部 URL 或可执行 HTML。`;

export function buildSlideUserPrompt(course: Course, outline: SceneOutline, previousSummary?: string): string {
  const coursePlan = course.outlines.map((item) => `${item.order}.${item.type}:${item.title}`).join(" | ");
  return `教学主题：${course.topic}\n课程标题：${course.title}\n场景类型：slide\n场景顺序：${outline.order}\n场景标题：${outline.title}\n教学目标：${outline.teachingObjective}\n关键点：${outline.keyPoints.join("；")}\n课程计划：${coursePlan}\n前页摘要：${previousSummary ?? "无，这是首个已生成场景"}`;
}
