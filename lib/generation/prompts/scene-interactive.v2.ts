import type { Course, SceneOutline } from "@/lib/domain/schemas";
import type { WidgetType } from "@/lib/interactive/widget-types";
import {
  getInteractiveImplementationExamples,
  getInteractiveLayoutTemplate,
} from "@/lib/interactive/layout-templates";
import { loadPromptTemplate } from "./loader";

// 裁剪自 OpenMAIC 固定提交的 diagram/simulation/game/code-content；来源与 MIT 许可见 THIRD_PARTY_NOTICES.md。
const COMMON = loadPromptTemplate("scene-interactive-common-rules");

const TYPE_PROMPTS: Record<WidgetType, string> = {
  diagram: loadPromptTemplate("scene-interactive-diagram-rules"),
  simulation: loadPromptTemplate("scene-interactive-simulation-rules"),
  game: loadPromptTemplate("scene-interactive-game-rules"),
  code: loadPromptTemplate("scene-interactive-code-rules"),
};

const CODE_HELP_REQUIREMENTS = loadPromptTemplate("scene-interactive-code-help-requirements");

/** 根据已确认的教学类型分流 Prompt，共享运行契约但不共享固定玩法。 */
export function buildInteractivePrompt(course: Course, outline: SceneOutline, previousSummary?: string) {
  if (!outline.widgetType) throw new Error("interactive outline missing widgetType");
  const withoutId = ({ id, ...item }: SceneOutline) => {
    void id;
    return item;
  };
  const layoutTemplate = getInteractiveLayoutTemplate(outline.widgetType);
  const implementationExamples = [
    getInteractiveImplementationExamples(outline.widgetType),
    outline.widgetType === "code" ? CODE_HELP_REQUIREMENTS : "",
  ].filter(Boolean).join("\n\n");
  return {
    version: outline.widgetType === "code" ? "scene-code.v2.4" : `scene-${outline.widgetType}.v2.3`,
    system: `${COMMON}\n\n本次 widgetType 必须为 ${outline.widgetType}。\n${TYPE_PROMPTS[outline.widgetType]}\n\n参考布局骨架（必须根据本场景改写，不能原样照抄）：\n${layoutTemplate}\n\n参考实现片段（按需采用并与真实状态绑定）：\n${implementationExamples}`,
    user: [
      `课程描述 JSON：${JSON.stringify(course.topic)}`,
      `CourseBrief JSON：${JSON.stringify(course.brief)}`,
      `完整课程大纲 JSON：${JSON.stringify(course.outlines.map(withoutId))}`,
      `当前 SceneOutline JSON：${JSON.stringify(withoutId(outline))}`,
      `前一场摘要 JSON：${JSON.stringify(previousSummary ?? "无")}`,
      "请围绕当前教学目标和 widgetOutline.designIdea 设计完整互动应用，不重复前面场景的玩法和内容。",
    ].join("\n"),
    maxOutputTokens: outline.widgetType === "code" || outline.widgetType === "game" ? 20_000 : 16_000,
  };
}
