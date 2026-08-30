import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SceneSchema, type GenerationMetadata, type Scene, type SceneOutline } from "@/lib/domain/schemas";
import {
  assembleSlide,
  InvalidGeneratedSlideError,
  normalizeGeneratedSlideScene,
  type NormalizedSlideSceneOutput,
} from "@/lib/slides/normalize-slide";

const QuizQuestionModelSchema = z.object({
  type: z.literal("single_choice"),
  prompt: z.string().trim().min(1).max(300),
  options: z.array(z.object({ label: z.string().trim().min(1).max(180) }).strict()).min(2).max(4),
  correctOptionIndex: z.number().int().nonnegative(),
  explanation: z.string().trim().min(1).max(500),
}).strict();
const QuizSceneModelSchema = z.object({
  type: z.literal("quiz"),
  title: z.string().trim().min(1).max(80),
  content: z.object({ questions: z.array(QuizQuestionModelSchema).min(1).max(3) }).strict(),
  narration: z.string().trim().min(1).max(1_500),
  summary: z.string().trim().min(1).max(300),
}).strict();

export type SceneModelOutput = NormalizedSlideSceneOutput | z.infer<typeof QuizSceneModelSchema>;
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

/** 校验场景 DTO；slide 先走元素规范化，quiz 继续执行严格题目契约。 */
export function validateSceneOutput(value: unknown, outline: SceneOutline): SceneModelOutput {
  if (outline.type === "slide") {
    let output: NormalizedSlideSceneOutput;
    try {
      output = normalizeGeneratedSlideScene(value);
    } catch (error) {
      if (error instanceof InvalidGeneratedSlideError) throw new InvalidSceneError(error.issues, { cause: error });
      throw error;
    }
    const unsafeField = collectVisibleText(output).find((field) => containsForbiddenMarkup(field.value));
    if (unsafeField) throw new InvalidSceneError([{ path: unsafeField.path, message: "讲稿和摘要不能包含 HTML 标签或外部 URL" }]);
    return output;
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
    if (question.correctOptionIndex >= question.options.length) issues.push({ path: `content.questions.${questionIndex}.correctOptionIndex`, message: "正确答案索引超出选项范围" });
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
  const actions = output.type === "quiz"
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
  return SceneSchema.parse({
    id: randomUUID(), courseId, outlineId: outline.id, type: "quiz", title: output.title, summary: output.summary, order: outline.order,
    content: {
      type: "quiz",
      questions: output.content.questions.map((question) => {
        // 3. 给每个选项生成 ID，再根据下标找到正确选项。
        const options = question.options.map((option) => ({ id: randomUUID(), label: option.label }));
        return {
          id: randomUUID(), type: "single_choice", prompt: question.prompt, options,
          correctOptionId: options[question.correctOptionIndex].id, explanation: question.explanation,
        };
      }),
    },
    // 4. 保存题目、播放动作和本次生成记录。
    actions, generation: metadata, createdAt: now, updatedAt: now,
  });
}
