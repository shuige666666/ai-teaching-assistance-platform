import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SceneOutlineSchema, type SceneOutline } from "@/lib/domain/schemas";

const OutlineItemModelSchema = z.object({
  type: z.enum(["slide", "quiz"]),
  title: z.string().trim().min(1).max(80),
  teachingObjective: z.string().trim().min(1).max(300),
  keyPoints: z.array(z.string().trim().min(1).max(160)).min(2).max(5),
  order: z.number().int().positive(),
  estimatedMinutes: z.number().int().min(1).max(20).optional(),
}).strict();

export const OutlineModelOutputSchema = z.object({
  courseTitle: z.string().trim().min(1).max(120),
  outlines: z.array(OutlineItemModelSchema).min(3).max(5),
}).strict();

export type OutlineModelOutput = z.infer<typeof OutlineModelOutputSchema>;
export type OutlineIssue = { path: string; message: string };

export class InvalidOutlineError extends Error {
  constructor(public readonly issues: OutlineIssue[], options?: ErrorOptions) {
    super("INVALID_MODEL_OUTPUT", options);
    this.name = "InvalidOutlineError";
  }
}

function normalizedKey(value: string): string { return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " "); }

/** 执行课程级语义门，并只做去空白、关键点去重和顺序重排等确定性修正。 */
export function validateAndNormalizeOutline(value: unknown, requestedSceneCount: number): OutlineModelOutput {
  const parsed = OutlineModelOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidOutlineError(parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
  }
  const normalized: OutlineModelOutput = {
    courseTitle: parsed.data.courseTitle.trim(),
    outlines: [...parsed.data.outlines].sort((a, b) => a.order - b.order).map((outline, index) => ({
      ...outline,
      title: outline.title.trim(),
      teachingObjective: outline.teachingObjective.trim(),
      keyPoints: [...new Map(outline.keyPoints.map((point) => [normalizedKey(point), point.trim()])).values()],
      order: index + 1,
    })),
  };
  const issues: OutlineIssue[] = [];
  if (normalized.outlines.length !== requestedSceneCount) issues.push({ path: "outlines", message: `大纲数量必须恰好为 ${requestedSceneCount}` });
  const quizCount = normalized.outlines.filter((item) => item.type === "quiz").length;
  if (quizCount < 1 || quizCount > 2) issues.push({ path: "outlines", message: "课程必须包含 1～2 个测验场景" });
  if (normalized.outlines[0]?.type === "quiz") issues.push({ path: "outlines.0.type", message: "第一场景不能是测验" });
  const titleKeys = normalized.outlines.map((item) => normalizedKey(item.title));
  if (new Set(titleKeys).size !== titleKeys.length) issues.push({ path: "outlines.title", message: "大纲标题不能重复" });
  const objectives = normalized.outlines.map((item) => normalizedKey(item.teachingObjective));
  if (objectives.length > 1 && new Set(objectives).size === 1) issues.push({ path: "outlines.teachingObjective", message: "各场景教学目标不能全部相同" });
  normalized.outlines.forEach((item, index) => {
    if (item.keyPoints.length < 2) issues.push({ path: `outlines.${index}.keyPoints`, message: "关键点去重后至少保留 2 项" });
  });
  if (/只返回|json|prompt/i.test(normalized.courseTitle)) issues.push({ path: "courseTitle", message: "课程标题不能包含 Prompt 模板指令" });
  if (issues.length > 0) throw new InvalidOutlineError(issues);
  return normalized;
}

/** 为已通过模型边界的大纲补齐领域 ID，模型不能控制实体标识。 */
export function assembleSceneOutlines(output: OutlineModelOutput): SceneOutline[] {
  return output.outlines.map((outline) => SceneOutlineSchema.parse({ ...outline, id: randomUUID() }));
}

/** 复用模型语义门校验人工编辑，同时保留已有 ID 和结构顺序。 */
export function validateEditedOutline(courseTitle: string, outlines: SceneOutline[], requestedSceneCount: number) {
  const normalized = validateAndNormalizeOutline({
    courseTitle,
    outlines: outlines.map((outline) => ({
      type: outline.type,
      title: outline.title,
      teachingObjective: outline.teachingObjective,
      keyPoints: outline.keyPoints,
      order: outline.order,
      estimatedMinutes: outline.estimatedMinutes,
    })),
  }, requestedSceneCount);
  return {
    courseTitle: normalized.courseTitle,
    outlines: normalized.outlines.map((outline, index) => SceneOutlineSchema.parse({ ...outline, id: outlines[index].id })),
  };
}
