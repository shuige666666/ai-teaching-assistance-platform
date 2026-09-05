import type { CourseBrief, CourseBriefResolution } from "@/lib/domain/schemas";
import { createDefaultCourseBrief, readExplicitBriefOverrides } from "@/lib/domain/course-brief";
import { loadPromptTemplate } from "./loader";

/**
 * v2.4 移植 OpenMAIC requirements-to-outlines 模板（固定提交 59adbef0，MIT）的
 * "Special Element Design Guidelines"：大纲阶段用 [Chart]/[Table] 标记把可视化
 * 需求规划进 slide 页 keyPoints，随 keyPoints 透传给场景生成阶段执行。
 */
export const OUTLINE_PROMPT_VERSION = "outline.v2.4";

export const OUTLINE_SYSTEM_PROMPT = loadPromptTemplate("outline-generation-system");

/** 使用 JSON 数据边界传入原始描述、设置与默认值，避免描述文本伪装成 Prompt 指令。 */
export function buildOutlineUserPrompt(input: {
  topic: string;
  sceneCount: number;
  provisionalBrief: CourseBrief;
  provisionalResolution: CourseBriefResolution;
}): string {
  const explicit = readExplicitBriefOverrides(input.provisionalBrief, input.provisionalResolution);
  return [
    `课程描述 JSON：${JSON.stringify(input.topic)}`,
    `场景数量：${input.sceneCount}`,
    `显式设置 JSON：${JSON.stringify(explicit)}`,
    `默认 Brief JSON：${JSON.stringify(createDefaultCourseBrief(input.topic))}`,
    "请提取明确要求，在内部按固定优先级合并后设计递进大纲。不要回传合并后的 Brief。outlines 数量必须与场景数量完全相等，order 从 1 连续编号。",
  ].join("\n");
}
