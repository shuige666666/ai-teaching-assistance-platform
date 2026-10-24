import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DetectedCourseBriefSchema } from "@/lib/domain/course-brief";
import { BriefResolutionWarningSchema, SceneOutlineSchema, type SceneOutline } from "@/lib/domain/schemas";
import type { MaterialContextBlock } from "@/lib/materials/types";

const ModelWarningSchema = BriefResolutionWarningSchema.refine(
  (warning) => warning.code === "PROMPT_AMBIGUOUS" || warning.code === "SCOPE_TOO_BROAD",
  "模型只能报告原文歧义或范围过宽，设置冲突由服务端判断",
);

const nullAsUndefined = (value: unknown) => value === null ? undefined : value;
const OutlineItemModelSchema = SceneOutlineSchema.omit({ id: true }).strip().extend({
  misconceptions: z.preprocess(nullAsUndefined, SceneOutlineSchema.shape.misconceptions),
  assessmentFocus: z.preprocess(nullAsUndefined, SceneOutlineSchema.shape.assessmentFocus),
  estimatedMinutes: z.preprocess(nullAsUndefined, SceneOutlineSchema.shape.estimatedMinutes),
  widgetType: z.preprocess(nullAsUndefined, SceneOutlineSchema.shape.widgetType),
  sourceBlockIds: z.preprocess(nullAsUndefined, SceneOutlineSchema.shape.sourceBlockIds),
  // OpenMAIC 风格的 description 与本项目 designIdea 同义；不因辅助字段别名多付一次 repair。
  widgetOutline: z.preprocess((value) => {
    if (!value || typeof value !== "object") return undefined;
    const item = value as Record<string, unknown>;
    const designIdea = item.designIdea ?? item.description;
    if (typeof designIdea !== "string" || !designIdea.trim()) return undefined;
    return { designIdea, ...(item.language ? { language: item.language } : {}) };
  }, SceneOutlineSchema.shape.widgetOutline),
});

export const OutlineModelOutputSchema = z.object({
  courseTitle: z.string().trim().min(1).max(120),
  detectedBrief: DetectedCourseBriefSchema.strip().default({}),
  warnings: z.array(ModelWarningSchema).max(8).default([]),
  outlines: z.array(OutlineItemModelSchema).min(4).max(8),
}).strip();

export type OutlineModelOutput = z.infer<typeof OutlineModelOutputSchema>;
export type OutlineIssue = { path: string; message: string };
export type OutlineValidationKind = "json" | "schema" | "semantic";

export class InvalidOutlineError extends Error {
  public readonly validationKind: OutlineValidationKind;

  constructor(public readonly issues: OutlineIssue[], options?: ErrorOptions & { validationKind?: OutlineValidationKind }) {
    super("INVALID_MODEL_OUTPUT", options);
    this.name = "InvalidOutlineError";
    this.validationKind = options?.validationKind ?? "semantic";
  }
}

function normalizedKey(value: string): string { return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " "); }

/**
 * 校验并规范化模型返回的大纲，确保结构和课程级规则满足生成契约。
 * 同时整理大纲顺序、文本空白和重复关键点。
 */
export function validateAndNormalizeOutline(
  value: unknown,
  requestedSceneCount: number,
  interactionMode: "off" | "auto" | "required" = "off",
): OutlineModelOutput {
  // 先校验模型输出的字段、类型和单项取值范围。
  const parsed = OutlineModelOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidOutlineError(
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      { validationKind: "schema", cause: parsed.error },
    );
  }
  // 统一顺序和文本格式，让后续课程级检查使用确定的结果。
  const normalized: OutlineModelOutput = {
    ...parsed.data,
    courseTitle: parsed.data.courseTitle.trim(),
    outlines: [...parsed.data.outlines].sort((a, b) => a.order - b.order).map((outline, index) => ({
      ...outline,
      ...(outline.sourceBlockIds ? { sourceBlockIds: [...new Set(outline.sourceBlockIds)] } : {}),
      title: outline.title.trim(),
      teachingObjective: outline.teachingObjective.trim(),
      keyPoints: [...new Map(outline.keyPoints.map((point) => [normalizedKey(point), point.trim()])).values()],
      misconceptions: outline.misconceptions
        ? [...new Map(outline.misconceptions.map((item) => [normalizedKey(item), item.trim()])).values()]
        : undefined,
      order: index + 1,
    })),
  };
  // 检查场景数量、类型分布、顺序和课程级互动约束。
  const issues: OutlineIssue[] = [];
  if (normalized.outlines.length !== requestedSceneCount) issues.push({ path: "outlines", message: `大纲数量必须恰好为 ${requestedSceneCount}` });
  const quizCount = normalized.outlines.filter((item) => item.type === "quiz").length;
  if (quizCount < 1 || quizCount > 2) issues.push({ path: "outlines", message: "课程必须包含 1～2 个测验场景" });
  if (normalized.outlines[0]?.type === "quiz") issues.push({ path: "outlines.0.type", message: "第一场景不能是测验" });
  const interactiveCount = normalized.outlines.filter((item) => item.type === "interactive").length;
  const maxInteractive = requestedSceneCount === 4 ? 1 : requestedSceneCount <= 6 ? 2 : 3;
  if (interactionMode === "off" && interactiveCount !== 0) issues.push({ path: "outlines", message: "用户未开启互动场景" });
  if (interactionMode === "required" && (interactiveCount < 1 || interactiveCount > maxInteractive)) {
    issues.push({ path: "outlines", message: `当前场景数需要 1～${maxInteractive} 个 interactive` });
  }
  if (normalized.outlines[0]?.type === "interactive") issues.push({ path: "outlines.0.type", message: "第一场景不能是互动场景" });
  if (normalized.outlines.filter((item) => item.type === "slide").length < 2) issues.push({ path: "outlines", message: "课程至少需要 2 个 slide" });
  const titleKeys = normalized.outlines.map((item) => normalizedKey(item.title));
  if (new Set(titleKeys).size !== titleKeys.length) issues.push({ path: "outlines.title", message: "大纲标题不能重复" });
  const objectives = normalized.outlines.map((item) => normalizedKey(item.teachingObjective));
  if (objectives.length > 1 && new Set(objectives).size === 1) issues.push({ path: "outlines.teachingObjective", message: "各场景教学目标不能全部相同" });
  // 检查每个场景的角色、关键点和互动配置。
  normalized.outlines.forEach((item, index) => {
    if (item.keyPoints.length < 2) issues.push({ path: `outlines.${index}.keyPoints`, message: "关键点去重后至少保留 2 项" });
    if (item.type === "quiz" && !["assessment", "practice"].includes(item.role)) issues.push({ path: `outlines.${index}.role`, message: "quiz 必须使用 assessment 或 practice 角色" });
    if (item.type === "slide" && item.role === "assessment") issues.push({ path: `outlines.${index}.role`, message: "slide 不能使用 assessment 角色" });
    if (item.type === "interactive" && !item.widgetType) issues.push({ path: `outlines.${index}.widgetType`, message: "interactive 必须声明互动类型" });
    if (item.type !== "interactive" && (item.widgetType !== undefined || item.widgetOutline !== undefined)) issues.push({ path: `outlines.${index}.widgetType`, message: "非 interactive 场景不能声明互动配置" });
    if (item.type === "interactive" && normalized.outlines[index - 1]?.type === "interactive") issues.push({ path: `outlines.${index}.type`, message: "interactive 场景不能连续排列" });
  });
  if (issues.length > 0) throw new InvalidOutlineError(issues);
  return normalized;
}

/** 为已通过模型边界校验的大纲补齐领域 ID，模型不能控制实体标识。 */
export function assembleSceneOutlines(output: OutlineModelOutput): SceneOutline[] {
  return output.outlines.map((outline) => SceneOutlineSchema.parse({ ...outline, id: randomUUID() }));
}

/** 来源 ID 必须属于实际送入模型的原文，材料课程的每页都要明确规划依据。 */
export function validateOutlineSources(outlines: Array<{ sourceBlockIds?: string[] }>, blocks: MaterialContextBlock[]): void {
  const allowed = new Set(blocks.map((block) => block.id));
  const issues: OutlineIssue[] = [];
  outlines.forEach((outline, index) => {
    if (blocks.length && !outline.sourceBlockIds?.length) issues.push({ path: `outlines.${index}.sourceBlockIds`, message: "请为本页选择 1～10 个教学材料片段 ID" });
    if (outline.sourceBlockIds?.some((id) => !allowed.has(id))) issues.push({ path: `outlines.${index}.sourceBlockIds`, message: "引用 ID 必须来自教学材料 JSON，不能虚构或引用其他课程" });
  });
  if (issues.length) throw new InvalidOutlineError(issues);
}

/** 复用模型语义门校验人工编辑，同时保留已有 ID、角色、类型与结构顺序。 */
export function validateEditedOutline(courseTitle: string, outlines: SceneOutline[], requestedSceneCount: number, interactionMode: "off" | "auto" | "required") {
  // 人工编辑也复用模型生成阶段的规则，避免两套大纲约束出现差异。
  const normalized = validateAndNormalizeOutline({
    courseTitle,
    outlines: outlines.map(({ id, ...outline }) => {
      void id;
      return outline;
    }),
  }, requestedSceneCount, interactionMode);
  return {
    courseTitle: normalized.courseTitle,
    outlines: normalized.outlines.map((outline, index) => SceneOutlineSchema.parse({ ...outline, id: outlines[index].id })),
  };
}
