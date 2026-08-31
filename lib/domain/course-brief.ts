import { z } from "zod";
import {
  CourseBriefFieldSchema,
  CourseBriefResolutionSchema,
  CourseBriefSchema,
  type BriefResolutionWarning,
  type BriefValueSource,
  type CourseBrief,
  type CourseBriefField,
  type CourseBriefResolution,
} from "./schemas";

export const CourseBriefOverridesSchema = CourseBriefSchema.partial().extend({
  interactionMode: z.enum(["off", "required"]).optional(),
}).strict();

export const DetectedCourseBriefSchema = CourseBriefSchema.omit({ interactionMode: true }).partial().strict();
export type CourseBriefOverrides = z.infer<typeof CourseBriefOverridesSchema>;
export type DetectedCourseBrief = z.infer<typeof DetectedCourseBriefSchema>;
export const COURSE_BRIEF_FIELDS = CourseBriefFieldSchema.options;

function truncate(value: string, maxLength: number) {
  let result = "";
  for (const character of value) {
    if ((result + character).length > maxLength) break;
    result += character;
  }
  return result;
}

function normalizeList(values: string[]) {
  const unique = new Map<string, string>();
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/gu, " ");
    const key = normalized.toLocaleLowerCase("zh-CN");
    if (normalized && !unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()];
}

function normalizeBrief(brief: CourseBrief): CourseBrief {
  return CourseBriefSchema.parse({
    ...brief,
    audience: brief.audience.trim(),
    learningGoal: brief.learningGoal.trim(),
    prerequisites: normalizeList(brief.prerequisites),
    additionalRequirements: normalizeList(brief.additionalRequirements),
  });
}

/** 根据原始描述生成稳定默认值，不调用模型，也不猜测用户身份。 */
export function createDefaultCourseBrief(topic: string): CourseBrief {
  const normalizedTopic = topic.trim();
  return CourseBriefSchema.parse({
    audience: "无特定专业背景的学习者",
    learnerLevel: "beginner",
    learningGoal: truncate(`理解「${normalizedTopic}」的核心概念、基本机制与典型应用`, 300),
    prerequisites: [],
    durationMinutes: 15,
    teachingStyle: "case_based",
    interactionMode: "off",
    additionalRequirements: [],
  });
}

/** 合并创建请求中的显式设置并记录逐字段来源，字段缺失与显式空数组保持不同。 */
export function createProvisionalCourseBrief(topic: string, overridesValue: unknown = {}) {
  const defaults = createDefaultCourseBrief(topic);
  const overrides = CourseBriefOverridesSchema.parse(overridesValue);
  const brief = { ...defaults, ...overrides } as CourseBrief;
  const sources = Object.fromEntries(COURSE_BRIEF_FIELDS.map((field) => [
    field,
    Object.hasOwn(overrides, field) ? "explicit_setting" : "default",
  ])) as Record<CourseBriefField, BriefValueSource>;
  return {
    brief: normalizeBrief(brief),
    resolution: CourseBriefResolutionSchema.parse({ status: "provisional", sources, warnings: [] }),
  };
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function explicitValues(brief: CourseBrief, resolution: CourseBriefResolution): CourseBriefOverrides {
  return Object.fromEntries(COURSE_BRIEF_FIELDS
    .filter((field) => resolution.sources[field] === "explicit_setting")
    .map((field) => [field, brief[field]])) as CourseBriefOverrides;
}

/** 按显式设置、Prompt 检测、默认值的固定优先级复算最终 Brief。 */
export function resolveCourseBrief(input: {
  topic: string;
  provisionalBrief: CourseBrief;
  provisionalResolution: CourseBriefResolution;
  detectedBrief: unknown;
  modelWarnings?: BriefResolutionWarning[];
  resolvedAt: number;
}) {
  const defaults = createDefaultCourseBrief(input.topic);
  const detected = DetectedCourseBriefSchema.parse(input.detectedBrief);
  const explicit = explicitValues(input.provisionalBrief, input.provisionalResolution);
  const sources = {} as Record<CourseBriefField, BriefValueSource>;
  const values = {} as Record<CourseBriefField, CourseBrief[CourseBriefField]>;
  const warnings: BriefResolutionWarning[] = [];

  for (const field of COURSE_BRIEF_FIELDS) {
    if (Object.hasOwn(explicit, field)) {
      values[field] = explicit[field] as never;
      sources[field] = "explicit_setting";
      if (Object.hasOwn(detected, field) && !sameValue(explicit[field], detected[field as keyof DetectedCourseBrief])) {
        warnings.push({ code: "SETTING_PROMPT_CONFLICT", field, message: `${field} 的高级设置覆盖了课程描述中的要求` });
      }
    } else if (Object.hasOwn(detected, field)) {
      values[field] = detected[field as keyof DetectedCourseBrief] as never;
      sources[field] = "prompt";
    } else {
      values[field] = defaults[field] as never;
      sources[field] = "default";
    }
  }
  // 互动是用户在大纲生成前的显式选择，不允许模型从自由文本中擅自开启。
  values.interactionMode = explicit.interactionMode ?? "off";
  sources.interactionMode = Object.hasOwn(explicit, "interactionMode") ? "explicit_setting" : "default";

  const informationalWarnings = (input.modelWarnings ?? []).filter((warning) =>
    warning.code === "PROMPT_AMBIGUOUS" || warning.code === "SCOPE_TOO_BROAD");
  const uniqueWarnings = [...new Map([...warnings, ...informationalWarnings].map((warning) => [
    `${warning.code}:${warning.field ?? ""}:${warning.message}`,
    warning,
  ])).values()];
  return {
    brief: normalizeBrief(values as CourseBrief),
    resolution: CourseBriefResolutionSchema.parse({
      status: "resolved",
      sources,
      warnings: uniqueWarnings,
      resolvedAt: new Date(input.resolvedAt).toISOString(),
    }),
  };
}

/** 将确认前修改的字段提升为显式设置，并让旧大纲重新进入待生成状态。 */
export function applyCourseBriefChanges(brief: CourseBrief, resolution: CourseBriefResolution, changesValue: unknown) {
  const changes = CourseBriefOverridesSchema.parse(changesValue);
  if (Object.keys(changes).length === 0) throw new z.ZodError([{ code: "custom", path: ["changes"], message: "至少修改一个课程要求字段" }]);
  const sources = { ...resolution.sources };
  for (const field of COURSE_BRIEF_FIELDS) {
    if (Object.hasOwn(changes, field)) sources[field] = "explicit_setting";
  }
  return {
    brief: normalizeBrief({ ...brief, ...changes }),
    resolution: CourseBriefResolutionSchema.parse({ status: "provisional", sources, warnings: [] }),
  };
}

/** 从 provisional Brief 中提取只允许覆盖默认值的显式设置。 */
export function readExplicitBriefOverrides(brief: CourseBrief, resolution: CourseBriefResolution) {
  return explicitValues(brief, resolution);
}
