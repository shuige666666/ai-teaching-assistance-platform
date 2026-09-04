import type { Course, SceneOutline } from "@/lib/domain/schemas";
import { loadPromptTemplate } from "./loader";

export const QUIZ_PROMPT_VERSION = "scene-quiz.v2";
export const QUIZ_SYSTEM_PROMPT = loadPromptTemplate("scene-quiz-generation-system");

export function buildQuizUserPrompt(course: Course, outline: SceneOutline, previousSummary?: string): string {
  const coursePlan = course.outlines.map((item) => `${item.order}.${item.type}:${item.title}`).join(" | ");
  return `教学主题：${course.topic}\n课程标题：${course.title}\n场景类型：quiz\n场景顺序：${outline.order}\n场景标题：${outline.title}\n教学目标：${outline.teachingObjective}\n关键点：${outline.keyPoints.join("；")}\n课程计划：${coursePlan}\n前页摘要：${previousSummary ?? "无，这是首个已生成场景"}`;
}
