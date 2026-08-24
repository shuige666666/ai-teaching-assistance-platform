import { z } from "zod";

export const CURRENT_SCHEMA_VERSION = 1 as const;

export const DomainErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  stage: z.enum(["outline", "scene", "storage", "playback"]).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const GenerationMetadataSchema = z.object({
  provider: z.enum(["mock", "deepseek", "bailian"]),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  requestId: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  upstreamCalls: z.number().int().nonnegative(),
  repaired: z.boolean(),
  usage: z.object({ inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional() }).optional(),
  generatedAt: z.number().int().nonnegative(),
});

export const SceneOutlineSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["slide", "quiz"]),
  title: z.string().trim().min(1).max(80),
  teachingObjective: z.string().trim().min(1).max(300),
  keyPoints: z.array(z.string().trim().min(1).max(160)).min(2).max(5),
  order: z.number().int().positive(),
  estimatedMinutes: z.number().int().min(1).max(20).optional(),
});

const ParagraphBlockSchema = z.object({ id: z.string().min(1), type: z.literal("paragraph"), text: z.string().trim().min(1).max(500) });
const BulletListBlockSchema = z.object({ id: z.string().min(1), type: z.literal("bullet_list"), items: z.array(z.string().trim().min(1).max(180)).min(2).max(6) });
const CalloutBlockSchema = z.object({ id: z.string().min(1), type: z.literal("callout"), tone: z.enum(["info", "example", "warning"]), title: z.string().trim().min(1).max(80).optional(), text: z.string().trim().min(1).max(400) });
const CodeBlockSchema = z.object({ id: z.string().min(1), type: z.literal("code"), language: z.string().regex(/^[a-zA-Z0-9_+#.-]{1,32}$/), code: z.string().min(1).max(6000), caption: z.string().trim().min(1).max(120).optional() });

export const SlideBlockSchema = z.discriminatedUnion("type", [ParagraphBlockSchema, BulletListBlockSchema, CalloutBlockSchema, CodeBlockSchema]);
export const SlideContentSchema = z.object({ type: z.literal("slide"), subtitle: z.string().trim().min(1).max(120).optional(), blocks: z.array(SlideBlockSchema).min(1).max(5) });

const QuizOptionSchema = z.object({ id: z.string().min(1), label: z.string().trim().min(1).max(180) });
const SingleChoiceQuestionSchema = z.object({
  id: z.string().min(1), type: z.literal("single_choice"), prompt: z.string().trim().min(1).max(300),
  options: z.array(QuizOptionSchema).min(2).max(4), correctOptionId: z.string().min(1), explanation: z.string().trim().min(1).max(500),
}).superRefine((question, context) => {
  const optionIds = question.options.map((option) => option.id);
  if (new Set(optionIds).size !== optionIds.length) context.addIssue({ code: "custom", message: "测验选项 ID 必须唯一" });
  if (!optionIds.includes(question.correctOptionId)) context.addIssue({ code: "custom", message: "正确答案必须引用现有选项" });
});
export const QuizContentSchema = z.object({ type: z.literal("quiz"), questions: z.array(SingleChoiceQuestionSchema).min(1).max(3) });

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1), type: z.literal("speech"), text: z.string().trim().min(1).max(1500), rate: z.number().min(0.5).max(2).optional() }),
  z.object({ id: z.string().min(1), type: z.literal("pause"), reason: z.enum(["timed", "learner"]), durationMs: z.number().int().min(0).max(30000).optional() }),
]);

const SceneBaseSchema = z.object({
  id: z.string().min(1), courseId: z.string().min(1), outlineId: z.string().min(1), title: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(300), order: z.number().int().positive(), actions: z.array(ActionSchema).min(1),
  generation: GenerationMetadataSchema, createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
});
export const SceneSchema = z.discriminatedUnion("type", [
  SceneBaseSchema.extend({ type: z.literal("slide"), content: SlideContentSchema }),
  SceneBaseSchema.extend({ type: z.literal("quiz"), content: QuizContentSchema }),
]);

export const SceneProgressSchema = z.object({
  outlineId: z.string().min(1), status: z.enum(["pending", "generating", "ready", "failed"]), attempts: z.number().int().nonnegative(),
  lastError: DomainErrorSchema.optional(), updatedAt: z.number().int().nonnegative(),
});

export const CourseSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION), id: z.string().min(1), topic: z.string().trim().min(2).max(500), title: z.string().trim().min(1).max(120),
  requestedSceneCount: z.number().int().min(3).max(5), status: z.enum(["draft", "outlining", "outline_ready", "generating", "partial_failed", "ready", "failed"]),
  revision: z.number().int().nonnegative(), outlines: z.array(SceneOutlineSchema).max(5), scenes: z.array(SceneSchema).max(5), sceneProgress: z.array(SceneProgressSchema).max(5),
  outlineGeneration: GenerationMetadataSchema.optional(),
  activeOperation: z.object({ id: z.string().min(1), stage: z.enum(["outline", "scene"]), outlineId: z.string().min(1).optional(), startedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative() }).optional(),
  lastError: DomainErrorSchema.optional(), createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}).superRefine((course, context) => {
  const outlineIds = course.outlines.map((outline) => outline.id);
  const orders = course.outlines.map((outline) => outline.order);
  if (new Set(outlineIds).size !== outlineIds.length) context.addIssue({ code: "custom", message: "大纲 ID 必须唯一" });
  if (orders.some((order, index) => order !== index + 1)) context.addIssue({ code: "custom", message: "大纲顺序必须从 1 连续递增" });
  if (["outline_ready", "generating", "partial_failed", "ready"].includes(course.status)) {
    if (course.outlines.length !== course.requestedSceneCount) context.addIssue({ code: "custom", message: "当前状态要求大纲数量与请求数量一致" });
    const quizCount = course.outlines.filter((outline) => outline.type === "quiz").length;
    if (quizCount < 1 || quizCount > 2 || course.outlines[0]?.type === "quiz") context.addIssue({ code: "custom", message: "课程必须包含 1～2 个且非首场景的测验" });
  }
  const progressIds = course.sceneProgress.map((progress) => progress.outlineId);
  if (course.outlines.length > 0 && progressIds.join("|") !== outlineIds.join("|")) context.addIssue({ code: "custom", message: "场景进度必须与大纲一一对应" });
  const sceneIds = course.scenes.map((scene) => scene.id);
  const sceneOutlineIds = course.scenes.map((scene) => scene.outlineId);
  if (new Set(sceneIds).size !== sceneIds.length) context.addIssue({ code: "custom", message: "场景 ID 必须唯一" });
  if (new Set(sceneOutlineIds).size !== sceneOutlineIds.length) context.addIssue({ code: "custom", message: "同一大纲只能对应一个场景" });
  for (const scene of course.scenes) {
    const outline = course.outlines.find((item) => item.id === scene.outlineId);
    if (!outline || scene.courseId !== course.id || scene.type !== outline.type || scene.order !== outline.order) {
      context.addIssue({ code: "custom", message: "场景必须引用同一课程中同类型、同顺序的大纲" });
    }
    if (scene.updatedAt < scene.createdAt) context.addIssue({ code: "custom", message: "场景更新时间不能早于创建时间" });

    const actionIds = scene.actions.map((action) => action.id);
    if (new Set(actionIds).size !== actionIds.length) context.addIssue({ code: "custom", message: "场景内 Action ID 必须唯一" });
    if (!scene.actions.some((action) => action.type === "speech")) context.addIssue({ code: "custom", message: "每个场景至少需要一个 speech Action" });
    for (const action of scene.actions) {
      if (action.type === "pause" && action.reason === "timed" && action.durationMs === undefined) {
        context.addIssue({ code: "custom", message: "timed pause 必须提供 durationMs" });
      }
      if (action.type === "pause" && action.reason === "learner" && action.durationMs !== undefined) {
        context.addIssue({ code: "custom", message: "learner pause 不允许提供 durationMs" });
      }
    }
    const lastAction = scene.actions.at(-1);
    if (scene.type === "quiz" && !(lastAction?.type === "pause" && lastAction.reason === "learner")) {
      context.addIssue({ code: "custom", message: "quiz 最后一个 Action 必须是 learner pause" });
    }
    if (scene.type === "slide" && scene.actions.some((action) => action.type === "pause" && action.reason === "learner")) {
      context.addIssue({ code: "custom", message: "slide 不允许包含 learner pause" });
    }
    if (scene.type === "slide") {
      const blockIds = scene.content.blocks.map((block) => block.id);
      if (new Set(blockIds).size !== blockIds.length) context.addIssue({ code: "custom", message: "幻灯片 Block ID 必须唯一" });
    } else {
      const questionIds = scene.content.questions.map((question) => question.id);
      if (new Set(questionIds).size !== questionIds.length) context.addIssue({ code: "custom", message: "测验 Question ID 必须唯一" });
    }
  }
  if (course.status === "ready") {
    const allReady = course.sceneProgress.every((progress) => progress.status === "ready");
    if (!allReady || course.scenes.length !== course.outlines.length) context.addIssue({ code: "custom", message: "ready 课程必须包含全部已完成场景" });
  }
  if (course.status === "partial_failed" && !course.sceneProgress.some((progress) => progress.status === "failed")) {
    context.addIssue({ code: "custom", message: "partial_failed 课程必须包含失败场景" });
  }
  if (course.activeOperation && !["outlining", "generating"].includes(course.status)) {
    context.addIssue({ code: "custom", message: "activeOperation 只能存在于生成状态" });
  }
  if (course.updatedAt < course.createdAt) context.addIssue({ code: "custom", message: "更新时间不能早于创建时间" });
});

export type DomainError = z.infer<typeof DomainErrorSchema>;
export type GenerationMetadata = z.infer<typeof GenerationMetadataSchema>;
export type SceneOutline = z.infer<typeof SceneOutlineSchema>;
export type SlideBlock = z.infer<typeof SlideBlockSchema>;
export type SlideContent = z.infer<typeof SlideContentSchema>;
export type QuizContent = z.infer<typeof QuizContentSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type SceneProgress = z.infer<typeof SceneProgressSchema>;
export type Course = z.infer<typeof CourseSchema>;
export type CourseStatus = Course["status"];

export interface CourseSummary {
  id: string; topic: string; title: string; status: CourseStatus; requestedSceneCount: number; readySceneCount: number; revision: number; updatedAt: number;
}
