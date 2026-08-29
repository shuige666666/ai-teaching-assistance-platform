import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DetectedCourseBriefSchema } from "@/lib/domain/course-brief";
import { BriefResolutionWarningSchema, CourseBriefSchema, SceneOutlineSchema, type CourseBrief, type SceneOutline } from "@/lib/domain/schemas";

const ModelWarningSchema = BriefResolutionWarningSchema.refine(
  (warning) => warning.code === "PROMPT_AMBIGUOUS" || warning.code === "SCOPE_TOO_BROAD",
  "模型只能报告原文歧义或范围过宽，设置冲突由服务端判断",
);

const OutlineItemModelSchema = SceneOutlineSchema.omit({ id: true });

export const OutlineModelOutputSchema = z.object({
  courseTitle: z.string().trim().min(1).max(120),
  detectedBrief: DetectedCourseBriefSchema,
  warnings: z.array(ModelWarningSchema).max(8),
  resolvedBrief: CourseBriefSchema,
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

/** 执行 outline.v2 结构与课程级语义校验，只做排序、去空白和去重等确定性修正。 */
export function validateAndNormalizeOutline(value: unknown, requestedSceneCount: number): OutlineModelOutput {
  const parsed = OutlineModelOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidOutlineError(parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
  }
  const normalized: OutlineModelOutput = {
    ...parsed.data,
    courseTitle: parsed.data.courseTitle.trim(),
    outlines: [...parsed.data.outlines].sort((a, b) => a.order - b.order).map((outline, index) => ({
      ...outline,
      title: outline.title.trim(),
      teachingObjective: outline.teachingObjective.trim(),
      keyPoints: [...new Map(outline.keyPoints.map((point) => [normalizedKey(point), point.trim()])).values()],
      misconceptions: outline.misconceptions
        ? [...new Map(outline.misconceptions.map((item) => [normalizedKey(item), item.trim()])).values()]
        : undefined,
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
    if (item.type === "quiz" && !["assessment", "practice"].includes(item.role)) issues.push({ path: `outlines.${index}.role`, message: "quiz 必须使用 assessment 或 practice 角色" });
    if (item.type === "slide" && item.role === "assessment") issues.push({ path: `outlines.${index}.role`, message: "slide 不能使用 assessment 角色" });
  });
  if (/只返回|json|prompt/i.test(normalized.courseTitle)) issues.push({ path: "courseTitle", message: "课程标题不能包含 Prompt 模板指令" });
  if (issues.length > 0) throw new InvalidOutlineError(issues);
  return normalized;
}

/** 校验模型声明采用的 Brief 是否与服务端按固定优先级复算的结果完全一致。 */
export function validateResolvedBrief(modelBrief: CourseBrief, serverBrief: CourseBrief) {
  if (JSON.stringify(modelBrief) !== JSON.stringify(serverBrief)) {
    throw new InvalidOutlineError([{ path: "resolvedBrief", message: "模型采用的课程要求与服务端复算结果不一致" }]);
  }
}

/** 为已通过模型边界的大纲补齐领域 ID，模型不能控制实体标识。 */
export function assembleSceneOutlines(output: OutlineModelOutput): SceneOutline[] {
  return output.outlines.map((outline) => SceneOutlineSchema.parse({ ...outline, id: randomUUID() }));
}

/** 复用模型语义门校验人工编辑，同时保留已有 ID、角色、类型与结构顺序。 */
export function validateEditedOutline(courseTitle: string, outlines: SceneOutline[], requestedSceneCount: number, brief: CourseBrief) {
  const normalized = validateAndNormalizeOutline({
    courseTitle,
    detectedBrief: {},
    warnings: [],
    resolvedBrief: brief,
    outlines: outlines.map(({ id, ...outline }) => {
      void id;
      return outline;
    }),
  }, requestedSceneCount);
  return {
    courseTitle: normalized.courseTitle,
    outlines: normalized.outlines.map((outline, index) => SceneOutlineSchema.parse({ ...outline, id: outlines[index].id })),
  };
}
