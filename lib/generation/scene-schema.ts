import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SceneSchema, type GenerationMetadata, type Scene, type SceneOutline } from "@/lib/domain/schemas";

const ParagraphModelSchema = z.object({ type: z.literal("paragraph"), text: z.string().trim().min(1).max(500) }).strict();
const BulletListModelSchema = z.object({ type: z.literal("bullet_list"), items: z.array(z.string().trim().min(1).max(180)).min(2).max(6) }).strict();
const CalloutModelSchema = z.object({
  type: z.literal("callout"),
  tone: z.enum(["info", "example", "warning"]),
  title: z.string().trim().min(1).max(80).optional(),
  text: z.string().trim().min(1).max(400),
}).strict();
const CodeModelSchema = z.object({
  type: z.literal("code"),
  language: z.string().regex(/^[a-zA-Z0-9_+#.-]{1,32}$/),
  code: z.string().min(1).max(6_000),
  caption: z.string().trim().min(1).max(120).optional(),
}).strict();
const SlideBlockModelSchema = z.discriminatedUnion("type", [ParagraphModelSchema, BulletListModelSchema, CalloutModelSchema, CodeModelSchema]);

const SlideSceneModelSchema = z.object({
  type: z.literal("slide"),
  title: z.string().trim().min(1).max(80),
  content: z.object({ subtitle: z.string().trim().min(1).max(120).optional(), blocks: z.array(SlideBlockModelSchema).min(1).max(5) }).strict(),
  narration: z.string().trim().min(1).max(1_500),
  summary: z.string().trim().min(1).max(300),
}).strict();

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

export const SceneModelOutputSchema = z.discriminatedUnion("type", [SlideSceneModelSchema, QuizSceneModelSchema]);
export type SceneModelOutput = z.infer<typeof SceneModelOutputSchema>;
export type SceneIssue = { path: string; message: string };

export class InvalidSceneError extends Error {
  constructor(public readonly issues: SceneIssue[], options?: ErrorOptions) {
    super("INVALID_MODEL_OUTPUT", options);
    this.name = "InvalidSceneError";
  }
}

function normalizedText(value: string): string { return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " "); }
function containsForbiddenMarkup(value: string): boolean { return /<\/?[a-z][^>]*>|https?:\/\/|www\./i.test(value); }

/** 校验场景 DTO 的类型一致性、可见内容、安全文本和测验索引等课程语义。 */
export function validateSceneOutput(value: unknown, outline: SceneOutline): SceneModelOutput {
  const parsed = SceneModelOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidSceneError(parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
  }
  const output = parsed.data;
  const issues: SceneIssue[] = [];
  if (output.type !== outline.type) issues.push({ path: "type", message: `场景类型必须与大纲的 ${outline.type} 一致` });
  if (containsForbiddenMarkup(JSON.stringify(output))) issues.push({ path: "content", message: "场景内容不能包含 HTML 标签或外部 URL" });

  if (output.type === "slide") {
    if (JSON.stringify(output.content).length > 8_000) issues.push({ path: "content", message: "幻灯片可见内容超过页面上限" });
    const blockKeys = output.content.blocks.map((block) => normalizedText(JSON.stringify(block)));
    if (new Set(blockKeys).size !== blockKeys.length) issues.push({ path: "content.blocks", message: "幻灯片不能包含完全重复的内容块" });
  } else {
    output.content.questions.forEach((question, questionIndex) => {
      const optionKeys = question.options.map((option) => normalizedText(option.label));
      if (new Set(optionKeys).size !== optionKeys.length) issues.push({ path: `content.questions.${questionIndex}.options`, message: "同一道题的选项不能重复" });
      if (question.correctOptionIndex >= question.options.length) issues.push({ path: `content.questions.${questionIndex}.correctOptionIndex`, message: "正确答案索引超出选项范围" });
    });
  }
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
    // 2. 给 slide 的每个内容块生成 ID。
    return SceneSchema.parse({
      id: randomUUID(), courseId, outlineId: outline.id, type: "slide", title: output.title, summary: output.summary, order: outline.order,
      content: { type: "slide", subtitle: output.content.subtitle, blocks: output.content.blocks.map((block) => ({ ...block, id: randomUUID() })) },
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
