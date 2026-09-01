import { z } from "zod";
import { CanvasSlideContentSchema } from "./slide-schemas";
import { WidgetTypeSchema } from "@/lib/interactive/widget-types";

export const CURRENT_SCHEMA_VERSION = 5 as const;

export const CourseBriefSchema = z.object({
  audience: z.string().trim().min(1).max(120),
  learnerLevel: z.enum(["beginner", "intermediate", "advanced"]),
  learningGoal: z.string().trim().min(2).max(300),
  prerequisites: z.array(z.string().trim().min(1).max(120)).max(5),
  durationMinutes: z.union([z.literal(10), z.literal(15), z.literal(20)]),
  teachingStyle: z.enum(["structured", "case_based", "practice_oriented"]),
  interactionMode: z.enum(["off", "auto", "required"]),
  additionalRequirements: z.array(z.string().trim().min(1).max(160)).max(5),
}).strict();

export const CourseBriefFieldSchema = z.enum([
  "audience",
  "learnerLevel",
  "learningGoal",
  "prerequisites",
  "durationMinutes",
  "teachingStyle",
  "interactionMode",
  "additionalRequirements",
]);

export const BriefValueSourceSchema = z.enum(["explicit_setting", "prompt", "default"]);
export const BriefResolutionWarningSchema = z.object({
  code: z.enum(["SETTING_PROMPT_CONFLICT", "PROMPT_AMBIGUOUS", "SCOPE_TOO_BROAD"]),
  field: CourseBriefFieldSchema.optional(),
  message: z.string().trim().min(1).max(300),
}).strict();
export const CourseBriefResolutionSchema = z.object({
  status: z.enum(["provisional", "resolved"]),
  sources: z.object({
    audience: BriefValueSourceSchema,
    learnerLevel: BriefValueSourceSchema,
    learningGoal: BriefValueSourceSchema,
    prerequisites: BriefValueSourceSchema,
    durationMinutes: BriefValueSourceSchema,
    teachingStyle: BriefValueSourceSchema,
    interactionMode: BriefValueSourceSchema,
    additionalRequirements: BriefValueSourceSchema,
  }).strict(),
  warnings: z.array(BriefResolutionWarningSchema).max(16),
  resolvedAt: z.string().datetime().optional(),
}).strict();

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
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
  generatedAt: z.number().int().nonnegative(),
});

export const SceneOutlineSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["slide", "quiz", "interactive"]),
  widgetType: WidgetTypeSchema.optional(),
  widgetOutline: z.object({
    designIdea: z.string().trim().min(1).max(600),
    language: z.enum(["python", "javascript"]).optional(),
  }).strict().optional(),
  role: z.enum(["hook", "concept", "mechanism", "worked_example", "practice", "summary", "assessment"]),
  title: z.string().trim().min(1).max(80),
  teachingObjective: z.string().trim().min(1).max(300),
  keyPoints: z.array(z.string().trim().min(1).max(160)).min(2).max(5),
  misconceptions: z.array(z.string().trim().min(1).max(160)).max(3).optional(),
  assessmentFocus: z.string().trim().min(1).max(300).optional(),
  order: z.number().int().positive(),
  estimatedMinutes: z.number().int().min(1).max(20).optional(),
}).strict();

export const SlideContentSchema = CanvasSlideContentSchema;

export const QuizOptionSchema = z.object({ id: z.string().min(1), label: z.string().trim().min(1).max(180) }).strict();
export const QuizQuestionSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["single_choice", "multiple_choice"]),
    prompt: z.string().trim().min(1).max(300),
    options: z.array(QuizOptionSchema).min(2).max(4),
    correctOptionIds: z.array(z.string().min(1)).min(1).max(4),
    explanation: z.string().trim().min(1).max(500),
  }).strict()
  .superRefine((question, context) => {
    const optionIds = question.options.map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length)
      context.addIssue({ code: "custom", message: "测验选项 ID 必须唯一" });
    if (new Set(question.correctOptionIds).size !== question.correctOptionIds.length)
      context.addIssue({ code: "custom", message: "正确答案 ID 不能重复" });
    if (question.correctOptionIds.some((id) => !optionIds.includes(id)))
      context.addIssue({ code: "custom", message: "正确答案必须引用现有选项" });
    if (question.type === "single_choice" && question.correctOptionIds.length !== 1)
      context.addIssue({ code: "custom", message: "单选题必须且只能有一个正确答案" });
    if (question.type === "multiple_choice" && question.correctOptionIds.length < 2)
      context.addIssue({ code: "custom", message: "多选题至少需要两个正确答案" });
  });
export const QuizContentSchema = z.object({
  type: z.literal("quiz"),
  questions: z.array(QuizQuestionSchema).min(1).max(3),
}).strict();

export const InteractiveFallbackSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  steps: z.array(z.string().trim().min(1).max(200)).min(2).max(8),
}).strict();

export const InteractiveContentSchema = z.object({
  type: z.literal("interactive"),
  widgetType: WidgetTypeSchema,
  runtimeContractVersion: z.literal(1),
  html: z.string().min(1),
  fallback: InteractiveFallbackSchema,
}).strict();

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("speech"),
    text: z.string().trim().min(1).max(1500),
    rate: z.number().min(0.5).max(2).optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("pause"),
    reason: z.enum(["timed", "learner"]),
    durationMs: z.number().int().min(0).max(30000).optional(),
  }),
]);

const SceneBaseSchema = z.object({
  id: z.string().min(1),
  courseId: z.string().min(1),
  outlineId: z.string().min(1),
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(300),
  order: z.number().int().positive(),
  actions: z.array(ActionSchema).min(1),
  generation: GenerationMetadataSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export const SceneSchema = z.discriminatedUnion("type", [
  SceneBaseSchema.extend({ type: z.literal("slide"), content: SlideContentSchema }),
  SceneBaseSchema.extend({ type: z.literal("quiz"), content: QuizContentSchema }),
  SceneBaseSchema.extend({ type: z.literal("interactive"), content: InteractiveContentSchema }),
]);

export const SceneProgressSchema = z.object({
  outlineId: z.string().min(1),
  status: z.enum(["pending", "generating", "ready", "failed"]),
  attempts: z.number().int().nonnegative(),
  lastError: DomainErrorSchema.optional(),
  updatedAt: z.number().int().nonnegative(),
});

export const CourseSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    id: z.string().min(1),
    topic: z.string().trim().min(2).max(500),
    title: z.string().trim().min(1).max(120),
    requestedSceneCount: z.number().int().min(4).max(8),
    status: z.enum([
      "draft",
      "outlining",
      "outline_ready",
      "generating",
      "partial_failed",
      "ready",
      "failed",
    ]),
    revision: z.number().int().nonnegative(),
    brief: CourseBriefSchema,
    briefResolution: CourseBriefResolutionSchema,
    outlines: z.array(SceneOutlineSchema).max(8),
    scenes: z.array(SceneSchema).max(8),
    sceneProgress: z.array(SceneProgressSchema).max(8),
    outlineGeneration: GenerationMetadataSchema.optional(),
    activeOperation: z
      .object({
        id: z.string().min(1),
        stage: z.enum(["outline", "scene"]),
        outlineId: z.string().min(1).optional(),
        startedAt: z.number().int().nonnegative(),
        expiresAt: z.number().int().nonnegative(),
      })
      .optional(),
    lastError: DomainErrorSchema.optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .superRefine((course, context) => {
    if (course.briefResolution.status === "provisional" && course.briefResolution.resolvedAt !== undefined) {
      context.addIssue({ code: "custom", path: ["briefResolution", "resolvedAt"], message: "provisional Brief 不能记录 resolvedAt" });
    }
    if (course.briefResolution.status === "resolved" && !course.briefResolution.resolvedAt) {
      context.addIssue({ code: "custom", path: ["briefResolution", "resolvedAt"], message: "resolved Brief 必须记录 resolvedAt" });
    }
    const outlineIds = course.outlines.map((outline) => outline.id);
    const orders = course.outlines.map((outline) => outline.order);
    if (new Set(outlineIds).size !== outlineIds.length)
      context.addIssue({ code: "custom", message: "大纲 ID 必须唯一" });
    if (orders.some((order, index) => order !== index + 1))
      context.addIssue({ code: "custom", message: "大纲顺序必须从 1 连续递增" });
    if (["outline_ready", "generating", "partial_failed", "ready"].includes(course.status)) {
      if (course.outlines.length !== course.requestedSceneCount)
        context.addIssue({ code: "custom", message: "当前状态要求大纲数量与请求数量一致" });
      const quizCount = course.outlines.filter((outline) => outline.type === "quiz").length;
      if (quizCount < 1 || quizCount > 2 || course.outlines[0]?.type === "quiz")
        context.addIssue({ code: "custom", message: "课程必须包含 1～2 个且非首场景的测验" });
      const interactiveCount = course.outlines.filter((outline) => outline.type === "interactive").length;
      const maxInteractive = course.requestedSceneCount === 4 ? 1 : course.requestedSceneCount <= 6 ? 2 : 3;
      if (course.brief.interactionMode === "off" && interactiveCount !== 0)
        context.addIssue({ code: "custom", message: "不需要互动的课程不能包含 interactive 场景" });
      if (course.brief.interactionMode === "required" && (interactiveCount < 1 || interactiveCount > maxInteractive))
        context.addIssue({ code: "custom", message: `当前场景数必须包含 1～${maxInteractive} 个互动场景` });
      if (course.brief.interactionMode === "auto" && interactiveCount > maxInteractive)
        context.addIssue({ code: "custom", message: `当前场景数最多包含 ${maxInteractive} 个互动场景` });
      if (course.outlines[0]?.type === "interactive")
        context.addIssue({ code: "custom", message: "第一场景不能是互动场景" });
      if (course.outlines.filter((outline) => outline.type === "slide").length < 2)
        context.addIssue({ code: "custom", message: "课程至少需要 2 个讲解幻灯片" });
      for (const outline of course.outlines) {
        if (outline.type === "quiz" && !["assessment", "practice"].includes(outline.role)) {
          context.addIssue({ code: "custom", path: ["outlines"], message: "quiz 大纲必须使用 assessment 或 practice 角色" });
        }
        if (outline.type === "slide" && outline.role === "assessment") {
          context.addIssue({ code: "custom", path: ["outlines"], message: "slide 大纲不能使用 assessment 角色" });
        }
        if (outline.type === "interactive" && !outline.widgetType) {
          context.addIssue({ code: "custom", path: ["outlines"], message: "interactive 大纲必须声明互动类型" });
        }
        if (outline.type !== "interactive" && (outline.widgetType !== undefined || outline.widgetOutline !== undefined)) {
          context.addIssue({ code: "custom", path: ["outlines"], message: "非 interactive 大纲不能声明 widgetType" });
        }
        if (outline.type === "interactive" && course.outlines[outline.order - 2]?.type === "interactive") {
          context.addIssue({ code: "custom", path: ["outlines"], message: "interactive 场景不能连续排列" });
        }
      }
    }
    const progressIds = course.sceneProgress.map((progress) => progress.outlineId);
    if (course.outlines.length > 0 && progressIds.join("|") !== outlineIds.join("|"))
      context.addIssue({ code: "custom", message: "场景进度必须与大纲一一对应" });
    const sceneIds = course.scenes.map((scene) => scene.id);
    const sceneOutlineIds = course.scenes.map((scene) => scene.outlineId);
    if (new Set(sceneIds).size !== sceneIds.length)
      context.addIssue({ code: "custom", message: "场景 ID 必须唯一" });
    if (new Set(sceneOutlineIds).size !== sceneOutlineIds.length)
      context.addIssue({ code: "custom", message: "同一大纲只能对应一个场景" });
    for (const scene of course.scenes) {
      const outline = course.outlines.find((item) => item.id === scene.outlineId);
      if (
        !outline ||
        scene.courseId !== course.id ||
        scene.type !== outline.type ||
        scene.order !== outline.order
      ) {
        context.addIssue({ code: "custom", message: "场景必须引用同一课程中同类型、同顺序的大纲" });
      }
      if (scene.updatedAt < scene.createdAt)
        context.addIssue({ code: "custom", message: "场景更新时间不能早于创建时间" });
      if (scene.type === "interactive" && scene.content.widgetType !== outline?.widgetType)
        context.addIssue({ code: "custom", message: "互动内容必须与大纲互动类型一致" });

      const actionIds = scene.actions.map((action) => action.id);
      if (new Set(actionIds).size !== actionIds.length)
        context.addIssue({ code: "custom", message: "场景内 Action ID 必须唯一" });
      if (!scene.actions.some((action) => action.type === "speech"))
        context.addIssue({ code: "custom", message: "每个场景至少需要一个 speech Action" });
      for (const action of scene.actions) {
        if (action.type === "pause" && action.reason === "timed" && action.durationMs === undefined) {
          context.addIssue({ code: "custom", message: "timed pause 必须提供 durationMs" });
        }
        if (action.type === "pause" && action.reason === "learner" && action.durationMs !== undefined) {
          context.addIssue({ code: "custom", message: "learner pause 不允许提供 durationMs" });
        }
      }
      const lastAction = scene.actions.at(-1);
      if (["quiz", "interactive"].includes(scene.type) && !(lastAction?.type === "pause" && lastAction.reason === "learner")) {
        context.addIssue({ code: "custom", message: "quiz 和 interactive 最后一个 Action 必须是 learner pause" });
      }
      if (
        scene.type === "slide" &&
        scene.actions.some((action) => action.type === "pause" && action.reason === "learner")
      ) {
        context.addIssue({ code: "custom", message: "slide 不允许包含 learner pause" });
      }
      if (scene.type === "slide") {
        const elementIds = scene.content.canvas.elements.map((element) => element.id);
        if (new Set(elementIds).size !== elementIds.length)
          context.addIssue({ code: "custom", message: "幻灯片元素 ID 必须唯一" });
        for (const element of scene.content.canvas.elements) {
          if (element.type !== "code") continue;
          const lineIds = element.lines.map((line) => line.id);
          if (new Set(lineIds).size !== lineIds.length)
            context.addIssue({ code: "custom", message: "代码元素内的行 ID 必须唯一" });
        }
      } else if (scene.type === "quiz") {
        const questionIds = scene.content.questions.map((question) => question.id);
        if (new Set(questionIds).size !== questionIds.length)
          context.addIssue({ code: "custom", message: "测验 Question ID 必须唯一" });
      }
    }
    if (course.status === "ready") {
      const allReady = course.sceneProgress.every((progress) => progress.status === "ready");
      if (!allReady || course.scenes.length !== course.outlines.length)
        context.addIssue({ code: "custom", message: "ready 课程必须包含全部已完成场景" });
    }
    if (
      course.status === "partial_failed" &&
      !course.sceneProgress.some((progress) => progress.status === "failed")
    ) {
      context.addIssue({ code: "custom", message: "partial_failed 课程必须包含失败场景" });
    }
    if (course.activeOperation && !["outlining", "generating"].includes(course.status)) {
      context.addIssue({ code: "custom", message: "activeOperation 只能存在于生成状态" });
    }
    if (course.updatedAt < course.createdAt)
      context.addIssue({ code: "custom", message: "更新时间不能早于创建时间" });
  });

export type DomainError = z.infer<typeof DomainErrorSchema>;
export type GenerationMetadata = z.infer<typeof GenerationMetadataSchema>;
export type CourseBrief = z.infer<typeof CourseBriefSchema>;
export type CourseBriefField = z.infer<typeof CourseBriefFieldSchema>;
export type BriefValueSource = z.infer<typeof BriefValueSourceSchema>;
export type BriefResolutionWarning = z.infer<typeof BriefResolutionWarningSchema>;
export type CourseBriefResolution = z.infer<typeof CourseBriefResolutionSchema>;
export type SceneOutline = z.infer<typeof SceneOutlineSchema>;
export type SlideContent = z.infer<typeof SlideContentSchema>;
export type QuizContent = z.infer<typeof QuizContentSchema>;
export type InteractiveContent = z.infer<typeof InteractiveContentSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type SceneProgress = z.infer<typeof SceneProgressSchema>;
export type Course = z.infer<typeof CourseSchema>;
export type CourseStatus = Course["status"];

export interface CourseSummary {
  id: string;
  topic: string;
  title: string;
  status: CourseStatus;
  requestedSceneCount: number;
  readySceneCount: number;
  revision: number;
  updatedAt: number;
}
