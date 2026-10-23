import sanitizeHtml from "sanitize-html";
import type { Scene } from "@/lib/domain/schemas";
import { extractInteractiveAuthorHtml } from "@/lib/interactive/html-policy";

/** 提取可读正文，忽略富文本样式，避免纯排版变化导致摘要失效。 */
function plainText(value: string): string {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/gu, " ").trim();
}

/** 提取实际教学内容；不把坐标、颜色、元素 ID 等视觉属性作为知识变化。 */
function contentText(scene: Scene): string {
  if (scene.type === "slide") return scene.content.canvas.elements.flatMap((element) => {
    if (element.type === "text") return [plainText(element.content)];
    if (element.type === "code") return [element.lines.map((line) => line.content).join("\n")];
    if (element.type === "chart") return [JSON.stringify(element.data)];
    if (element.type === "table") return [JSON.stringify(element.rows)];
    return [];
  }).join("；");
  if (scene.type === "quiz") return JSON.stringify(scene.content.questions.map((question) => ({
    prompt: question.prompt, options: question.options.map((option) => option.label),
    answers: question.options.filter((option) => question.correctOptionIds.includes(option.id)).map((option) => option.label),
    explanation: question.explanation,
  })));
  return JSON.stringify(scene.content.fallback);
}

/** 用当前内容的显式摘录更新旧摘要，不额外调用模型或冒充完整语义总结。 */
export function refreshPatchedSceneSummary(original: Scene, candidate: Scene): string {
  const before = contentText(original);
  const after = contentText(candidate);
  const narration = (scene: Scene) => scene.actions.flatMap((action) => action.type === "speech" ? [action.text] : []).join("；");
  const speechChanged = narration(original) !== narration(candidate);
  const htmlChanged = original.type === "interactive" && candidate.type === "interactive"
    && extractInteractiveAuthorHtml(original.content.html) !== extractInteractiveAuthorHtml(candidate.content.html);
  if (before === after && !speechChanged && !htmlChanged) return original.summary;
  // HTML 修改可能改变互动规则；不能沿用可能已经过期的 fallback 或讲稿推断其含义。
  if (htmlChanged) return "互动源码已修订，旧摘要已失效；请读取当前页面源码确认教学内容，不要根据原摘要推断玩法或知识点。";
  const excerpt = before !== after ? after : narration(candidate);
  return excerpt.trim() ? `修订后内容摘录：${excerpt}`.slice(0, 300) : "本页教学内容已修订，旧摘要已失效，请以当前页面内容为准。";
}
