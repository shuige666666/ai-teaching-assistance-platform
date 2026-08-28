import { z } from "zod";

const TopicSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  category: z.enum(["concept_explanation", "mechanism_process", "programming_practice"]),
  title: z.string().trim().min(1),
  prompt: z.string().trim().min(20).max(500),
  evaluationFocus: z.array(z.string().trim().min(1)).min(2),
  publicTopic: z.literal(true),
  containsPersonalData: z.literal(false),
});

export const DatasetSchema = z.object({
  version: z.literal("course-quality.v1"),
  status: z.enum(["candidate", "frozen"]),
  frozenAt: z.string().datetime().nullable(),
  sceneCount: z.literal(5),
  generationPolicy: z.object({
    provider: z.literal("deepseek"),
    outlinePromptVersion: z.literal("outline.v1"),
    slidePromptVersion: z.literal("scene-slide.v1"),
    quizPromptVersion: z.literal("scene-quiz.v1"),
    manualRetryLimitPerStage: z.literal(0),
    notes: z.string().min(1),
  }),
  topics: z.array(TopicSchema).length(6),
}).superRefine((dataset, context) => {
  const ids = dataset.topics.map((topic) => topic.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["topics"], message: "评价主题 ID 必须唯一" });
  for (const category of ["concept_explanation", "mechanism_process", "programming_practice"]) {
    if (dataset.topics.filter((topic) => topic.category === category).length !== 2) {
      context.addIssue({ code: "custom", path: ["topics"], message: `${category} 必须恰好包含两个主题` });
    }
  }
  if (dataset.status === "frozen" && !dataset.frozenAt) context.addIssue({ code: "custom", path: ["frozenAt"], message: "冻结评价集必须记录 frozenAt" });
  if (dataset.status === "candidate" && dataset.frozenAt) context.addIssue({ code: "custom", path: ["frozenAt"], message: "候选评价集不能提前记录 frozenAt" });
});

export const DensityPolicySchema = z.object({
  version: z.literal("slide-density.v1"),
  status: z.enum(["candidate", "frozen"]),
  frozenAt: z.string().datetime().nullable(),
  countingRules: z.object({ collapseWhitespace: z.literal(true), visibleFields: z.array(z.string()).min(1), excludedFields: z.array(z.string()).min(1), codeMetrics: z.array(z.string()).min(1) }),
  viewports: z.array(z.object({ id: z.enum(["desktop", "narrow"]), width: z.number().int().positive(), height: z.number().int().positive() })).length(2),
  v2Targets: z.object({
    sceneTitleRecommendedChars: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
    subtitleMaxChars: z.number().int().positive(),
    paragraphRecommendedChars: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
    paragraphHardMaxChars: z.number().int().positive(),
    itemRecommendedMaxChars: z.number().int().positive(),
    itemHardMaxChars: z.number().int().positive(),
    calloutRecommendedMaxChars: z.number().int().positive(),
    calloutHardMaxChars: z.number().int().positive(),
    codeRecommendedLines: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
    minimumBodyFontPx: z.number().positive(),
    templateVisibleCharBudgets: z.record(z.string(), z.number().int().positive()),
  }),
  baselineObservation: z.object({
    legacyVisibleCharWarning: z.number().int().positive(),
    legacyVisibleCharFail: z.number().int().positive(),
    longestItemWarning: z.number().int().positive(),
    longestItemFail: z.number().int().positive(),
    codeLineWarning: z.number().int().positive(),
    codeLineFail: z.number().int().positive(),
    notes: z.string().min(1),
  }),
  domOverflowRule: z.object({ tolerancePx: z.number().nonnegative(), horizontal: z.string().min(1), vertical: z.string().min(1), blockingFromVersion: z.literal("M7.2"), m7_0Behavior: z.literal("observe_only") }),
}).superRefine((policy, context) => {
  const desktop = policy.viewports.find((viewport) => viewport.id === "desktop");
  const narrow = policy.viewports.find((viewport) => viewport.id === "narrow");
  if (desktop?.width !== 1280 || desktop.height !== 720) context.addIssue({ code: "custom", path: ["viewports"], message: "桌面视口必须固定为 1280×720" });
  if (narrow?.width !== 390 || narrow.height !== 844) context.addIssue({ code: "custom", path: ["viewports"], message: "窄屏视口必须固定为 390×844" });
  if (policy.status === "frozen" && !policy.frozenAt) context.addIssue({ code: "custom", path: ["frozenAt"], message: "冻结密度协议必须记录 frozenAt" });
  if (policy.status === "candidate" && policy.frozenAt) context.addIssue({ code: "custom", path: ["frozenAt"], message: "候选密度协议不能提前记录 frozenAt" });
});

/** 折叠空白后统计页面实际可见字段，代码原文和 narration 不计入可见字符。 */
function normalizedLength(value) {
  return [...String(value ?? "").replace(/\s+/gu, " ").trim()].length;
}

/** 为一个 v1 slide 生成只用于 M7.0 观察的确定性密度报告。 */
export function analyzeLegacySlide(scene, policy) {
  const visibleItems = [{ path: "scene.title", value: scene.title }];
  if (scene.content.subtitle) visibleItems.push({ path: "content.subtitle", value: scene.content.subtitle });
  let codeLineCount = 0;
  let longestCodeLineChars = 0;
  for (const [blockIndex, block] of scene.content.blocks.entries()) {
    const base = `content.blocks.${blockIndex}`;
    if (block.type === "paragraph") visibleItems.push({ path: `${base}.text`, value: block.text });
    if (block.type === "bullet_list") block.items.forEach((value, index) => visibleItems.push({ path: `${base}.items.${index}`, value }));
    if (block.type === "callout") {
      if (block.title) visibleItems.push({ path: `${base}.title`, value: block.title });
      visibleItems.push({ path: `${base}.text`, value: block.text });
    }
    if (block.type === "code") {
      if (block.caption) visibleItems.push({ path: `${base}.caption`, value: block.caption });
      const lines = block.code.replace(/\r\n/gu, "\n").split("\n");
      codeLineCount += lines.length;
      longestCodeLineChars = Math.max(longestCodeLineChars, ...lines.map(normalizedLength));
    }
  }
  const lengths = visibleItems.map((item) => ({ path: item.path, chars: normalizedLength(item.value) }));
  const visibleCharCount = lengths.reduce((sum, item) => sum + item.chars, 0);
  const longestItemChars = Math.max(0, ...lengths.map((item) => item.chars));
  const normalizedValues = visibleItems.map((item) => String(item.value).replace(/\s+/gu, " ").trim().toLocaleLowerCase("zh-CN")).filter(Boolean);
  const duplicateSignals = [...new Set(normalizedValues.filter((value, index) => normalizedValues.indexOf(value) !== index))];
  const limits = policy.baselineObservation;
  const fail = visibleCharCount > limits.legacyVisibleCharFail || longestItemChars > limits.longestItemFail || codeLineCount > limits.codeLineFail;
  const warning = visibleCharCount > limits.legacyVisibleCharWarning || longestItemChars > limits.longestItemWarning || codeLineCount > limits.codeLineWarning || duplicateSignals.length > 0;
  return {
    template: "legacy_stack",
    visibleCharCount,
    longestItemChars,
    blockCount: scene.content.blocks.length,
    codeLineCount,
    longestCodeLineChars,
    duplicateSignals,
    densityStatus: fail ? "fail" : warning ? "warning" : "pass",
    visibleItems: lengths,
    policyVersion: policy.version,
    enforcement: "observe_only",
  };
}

/** 同时校验评价集与密度协议，确保二者处于相同冻结状态和时间点。 */
export function parseEvaluationInputs(datasetValue, densityValue, requireFrozen = false) {
  const dataset = DatasetSchema.parse(datasetValue);
  const density = DensityPolicySchema.parse(densityValue);
  if (dataset.status !== density.status) throw new Error("评价集和密度协议必须处于相同状态");
  if (dataset.frozenAt !== density.frozenAt) throw new Error("评价集和密度协议必须使用同一个 frozenAt");
  if (requireFrozen && dataset.status !== "frozen") throw new Error("付费基线只能使用开发者已经确认并冻结的评价协议");
  return { dataset, density };
}

export const HUMAN_SCORE_DIMENSIONS = ["factualCorrectness", "goalAlignment", "structureCoherence", "explanationCaseValue", "visibleReadability", "visualHierarchyLayout", "quizAlignment"];

/** 为每门课程建立可直接填写的评分表，同时附上课程定位信息。 */
export function createHumanScoreTemplate(runId, topics, results = []) {
  const resultByTopic = new Map(results.map((result) => [result.topicId, result]));
  return {
    version: "course-quality-human-scores.v1",
    runId,
    evaluator: null,
    completedAt: null,
    courses: topics.map((topic) => {
      const result = resultByTopic.get(topic.id);
      return {
        topicId: topic.id,
        courseId: result?.course.courseId ?? null,
        title: result?.course.title ?? topic.title,
        status: result?.course.status ?? null,
        savedScenes: result?.course.scenes.length ?? null,
        requestedScenes: result?.course.requestedSceneCount ?? null,
        scores: Object.fromEntries(HUMAN_SCORE_DIMENSIONS.map((dimension) => [dimension, null])),
        criticalError: null,
        criticalErrorEvidence: null,
        overallNotes: null,
      };
    }),
  };
}
