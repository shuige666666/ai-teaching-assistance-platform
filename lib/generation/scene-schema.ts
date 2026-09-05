import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SceneSchema, type GenerationMetadata, type Scene, type SceneOutline } from "@/lib/domain/schemas";
import { InvalidInteractiveHtmlError, postProcessInteractiveHtml } from "@/lib/interactive/html-policy";
import { WidgetTypeSchema } from "@/lib/interactive/widget-types";
import { parseModelJson } from "./parse-json";
import {
  assembleSlide,
  InvalidGeneratedSlideError,
  normalizeGeneratedSlideScene,
  type NormalizedSlideSceneOutput,
} from "@/lib/slides/normalize-slide";
import { resolveCourseTheme } from "@/lib/slides/theme-presets";

const QuizQuestionModelSchema = z.object({
  type: z.enum(["single_choice", "multiple_choice"]),
  prompt: z.string().trim().min(1).max(300),
  options: z.array(z.object({ label: z.string().trim().min(1).max(180) }).strict()).min(2).max(4),
  correctOptionIndexes: z.array(z.number().int().nonnegative()).min(1).max(4),
  explanation: z.string().trim().min(1).max(500),
}).strict();
const QuizSceneModelSchema = z.object({
  type: z.literal("quiz"),
  title: z.string().trim().min(1).max(80),
  content: z.object({ questions: z.array(QuizQuestionModelSchema).min(1).max(3) }).strict(),
  narration: z.string().trim().min(1).max(1_500),
  summary: z.string().trim().min(1).max(300),
}).strict();

const InteractiveSceneModelSchema = z.object({
  type: z.literal("interactive"),
  content: z.object({
    type: z.literal("interactive"),
    widgetType: WidgetTypeSchema,
    runtimeContractVersion: z.literal(1),
    html: z.string().min(1),
    fallback: z.object({
      title: z.string().trim().min(1).max(100),
      description: z.string().trim().min(1).max(500),
      steps: z.array(z.string().trim().min(1).max(200)).min(2).max(8),
    }).strict(),
  }).strict(),
  narration: z.string().trim().min(1).max(1_500),
  summary: z.string().trim().min(1).max(300),
}).strict();

export type SceneModelOutput = NormalizedSlideSceneOutput | z.infer<typeof QuizSceneModelSchema> | z.infer<typeof InteractiveSceneModelSchema>;
export type SceneIssue = { path: string; message: string };

export class InvalidSceneError extends Error {
  constructor(public readonly issues: SceneIssue[], options?: ErrorOptions) {
    super("INVALID_MODEL_OUTPUT", options);
    this.name = "InvalidSceneError";
  }
}

function normalizedText(value: string): string { return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " "); }
function containsForbiddenMarkup(value: string): boolean { return /<\/?[a-z][^>]*>|https?:\/\/|www\./i.test(value); }

/** 收集会直接显示为普通文本的字段；slide 富文本已在独立白名单边界中完成净化。 */
function collectVisibleText(output: SceneModelOutput): Array<{ path: string; value: string }> {
  const fields = [
    { path: "narration", value: output.narration },
    { path: "summary", value: output.summary },
  ];
  if (output.type === "interactive") {
    fields.push({ path: "content.fallback.title", value: output.content.fallback.title });
    fields.push({ path: "content.fallback.description", value: output.content.fallback.description });
    output.content.fallback.steps.forEach((step, index) => fields.push({ path: `content.fallback.steps.${index}`, value: step }));
    return fields;
  }
  if (output.type === "quiz") {
    fields.push({ path: "title", value: output.title });
    output.content.questions.forEach((question, questionIndex) => {
      fields.push({ path: `content.questions.${questionIndex}.prompt`, value: question.prompt });
      question.options.forEach((option, optionIndex) => fields.push({ path: `content.questions.${questionIndex}.options.${optionIndex}.label`, value: option.label }));
      fields.push({ path: `content.questions.${questionIndex}.explanation`, value: question.explanation });
    });
    return fields;
  }
  return fields;
}

/** 与 OpenMAIC 一样接收原始 HTML，避免整页脚本嵌入 JSON 字符串时反复转义出错。 */
export function parseSceneResponse(text: string, outline: SceneOutline): unknown {
  if (outline.type !== "interactive") return parseModelJson(text);
  const html = text.trim().replace(/^```(?:html)?\s*([\s\S]*?)\s*```$/i, "$1").trim();
  // mock 适配器仍可返回领域 DTO，真实 HTML 与它进入相同的校验/装配边界。
  if (!/^<!doctype html>|^<html[\s>]/i.test(html)) return parseModelJson(text);
  const match = html.match(/<script\b[^>]*\bid\s*=\s*["']scene-meta["'][^>]*>([\s\S]*?)<\/script>/i);
  let meta: Record<string, unknown> = {};
  if (match) {
    try { meta = JSON.parse(match[1]); } catch { throw new InvalidSceneError([{ path: "scene-meta", message: "讲解元数据必须为合法 JSON" }]); }
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new InvalidSceneError([{ path: "scene-meta", message: "讲解元数据必须是对象" }]);
  }
  return {
    type: "interactive",
    content: { type: "interactive", widgetType: outline.widgetType, runtimeContractVersion: 1, html,
      fallback: meta.fallback ?? { title: outline.title, description: outline.teachingObjective, steps: outline.keyPoints } },
    narration: meta.narration ?? outline.teachingObjective,
    summary: meta.summary ?? outline.teachingObjective,
  };
}

/** 校验场景 DTO；slide 先走元素规范化（主题由 courseId 确定性选择），quiz 继续执行严格题目契约。 */
export function validateSceneOutput(value: unknown, outline: SceneOutline, courseId?: string): SceneModelOutput {
  if (outline.type === "slide") {
    let output: NormalizedSlideSceneOutput;
    try {
      output = normalizeGeneratedSlideScene(value, courseId ? resolveCourseTheme(courseId) : undefined);
    } catch (error) {
      if (error instanceof InvalidGeneratedSlideError) throw new InvalidSceneError(error.issues, { cause: error });
      throw error;
    }
    const unsafeField = collectVisibleText(output).find((field) => containsForbiddenMarkup(field.value));
    if (unsafeField) throw new InvalidSceneError([{ path: unsafeField.path, message: "讲稿和摘要不能包含 HTML 标签或外部 URL" }]);
    return output;
  }

  if (outline.type === "interactive") {
    const parsed = InteractiveSceneModelSchema.safeParse(value);
    if (!parsed.success) {
      throw new InvalidSceneError(parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
    }
    const unsafeField = collectVisibleText(parsed.data).find((field) => containsForbiddenMarkup(field.value));
    if (unsafeField) throw new InvalidSceneError([{ path: unsafeField.path, message: "互动降级内容、讲稿和摘要不能包含 HTML 或 URL" }]);
    if (parsed.data.content.widgetType !== outline.widgetType) throw new InvalidSceneError([{ path: "content.widgetType", message: "互动类型必须与当前大纲一致" }]);
    try {
      return { ...parsed.data, content: { ...parsed.data.content, html: postProcessInteractiveHtml(parsed.data.content.html) } };
    } catch (error) {
      if (error instanceof InvalidInteractiveHtmlError) throw new InvalidSceneError(error.issues, { cause: error });
      throw error;
    }
  }

  const parsed = QuizSceneModelSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidSceneError(parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
  }
  const output = parsed.data;
  const issues: SceneIssue[] = [];
  const unsafeField = collectVisibleText(output).find((field) => containsForbiddenMarkup(field.value));
  if (unsafeField) issues.push({ path: unsafeField.path, message: "非代码内容不能包含 HTML 标签或外部 URL" });
  output.content.questions.forEach((question, questionIndex) => {
    const optionKeys = question.options.map((option) => normalizedText(option.label));
    if (new Set(optionKeys).size !== optionKeys.length) issues.push({ path: `content.questions.${questionIndex}.options`, message: "同一道题的选项不能重复" });
    const answerPath = `content.questions.${questionIndex}.correctOptionIndexes`;
    if (new Set(question.correctOptionIndexes).size !== question.correctOptionIndexes.length) issues.push({ path: answerPath, message: "正确答案索引不能重复" });
    if (question.correctOptionIndexes.some((index) => index >= question.options.length)) issues.push({ path: answerPath, message: "正确答案索引超出选项范围" });
    if (question.type === "single_choice" && question.correctOptionIndexes.length !== 1) issues.push({ path: answerPath, message: "单选题必须且只能有一个正确答案" });
    if (question.type === "multiple_choice" && question.correctOptionIndexes.length < 2) issues.push({ path: answerPath, message: "多选题至少需要两个正确答案" });
  });
  if (issues.length > 0) throw new InvalidSceneError(issues);
  return output;
}

/** 将不含任何 ID 的模型 DTO 装配成可持久化 Scene，并由系统生成 Action。 */
export function assembleScene(input: {
  output: SceneModelOutput;
  courseId: string;
  outline: SceneOutline;
  metadata: GenerationMetadata;
  now: number;
}): Scene {
  const { output, courseId, outline, metadata, now } = input;
  // 1. 根据场景类型创建播放动作。
  const actions = output.type === "quiz" || output.type === "interactive"
    ? [{ id: randomUUID(), type: "speech" as const, text: output.narration }, { id: randomUUID(), type: "pause" as const, reason: "learner" as const }]
    : [{ id: randomUUID(), type: "speech" as const, text: output.narration }];
  if (output.type === "slide") {
    // 2. 元素已经过净化并获得服务端 ID，这里只装配固定逻辑画布。
    return SceneSchema.parse({
      id: randomUUID(), courseId, outlineId: outline.id, type: "slide", title: outline.title, summary: output.summary, order: outline.order,
      content: { type: "slide", canvas: assembleSlide(output) },
      actions, generation: metadata, createdAt: now, updatedAt: now,
    });
  }
  if (output.type === "interactive") {
    return SceneSchema.parse({
      id: randomUUID(), courseId, outlineId: outline.id, type: "interactive", title: outline.title, summary: output.summary, order: outline.order,
      content: output.content,
      actions, generation: metadata, createdAt: now, updatedAt: now,
    });
  }
  return SceneSchema.parse({
    id: randomUUID(), courseId, outlineId: outline.id, type: "quiz", title: output.title, summary: output.summary, order: outline.order,
    content: {
      type: "quiz",
      questions: output.content.questions.map((question) => {
        // 3. 给每个选项生成 ID，再将模型答案下标转换为领域 ID 数组。
        const options = question.options.map((option) => ({ id: randomUUID(), label: option.label }));
        return {
          id: randomUUID(), type: question.type, prompt: question.prompt, options,
          correctOptionIds: question.correctOptionIndexes.map((index) => options[index].id), explanation: question.explanation,
        };
      }),
    },
    // 4. 保存题目、播放动作和本次生成记录。
    actions, generation: metadata, createdAt: now, updatedAt: now,
  });
}
