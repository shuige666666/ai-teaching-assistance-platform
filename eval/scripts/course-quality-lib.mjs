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

/** 校验六题评价集；正式 DeepSeek 基线只允许使用已经确认冻结的输入。 */
export function parseEvaluationDataset(value, requireFrozen = false) {
  const dataset = DatasetSchema.parse(value);
  if (requireFrozen && dataset.status !== "frozen") throw new Error("付费基线只能使用开发者已经确认并冻结的评价集");
  return dataset;
}

/** 从持久化课程中提取复现实验所需的公开内容与生成元数据。 */
export function sanitizeCourse(course) {
  return {
    courseId: course.id,
    schemaVersion: course.schemaVersion,
    title: course.title,
    status: course.status,
    revision: course.revision,
    requestedSceneCount: course.requestedSceneCount,
    outlineGeneration: course.outlineGeneration,
    outlines: course.outlines.map(({ type, title, teachingObjective, keyPoints, order, estimatedMinutes }) => ({ type, title, teachingObjective, keyPoints, order, estimatedMinutes })),
    scenes: course.scenes.map((scene) => ({
      type: scene.type,
      title: scene.title,
      summary: scene.summary,
      order: scene.order,
      content: scene.content,
      narration: scene.actions.find((action) => action.type === "speech")?.text ?? "",
      generation: scene.generation,
    })),
    sceneProgress: course.sceneProgress.map(({ status, attempts, lastError }) => ({ status, attempts, lastError })),
  };
}

/** 统计一次课程生成的上游调用，失败请求保留预算消耗但不虚构 token。 */
export function countUpstreamCalls(result) {
  const successfulCalls = (result.course.outlineGeneration?.upstreamCalls ?? 0)
    + result.course.scenes.reduce((total, scene) => total + (scene.generation?.upstreamCalls ?? 0), 0);
  const failedCalls = result.collectionErrors
    .filter((error) => error.stage === "scene")
    .reduce((total, error) => total + (error.details?.upstreamCalls ?? 0), 0);
  return { successfulCalls, failedCalls, totalCalls: successfulCalls + failedCalls };
}

/** 生成一份只陈述基线事实的摘要；人工评分延后到 v0.3/v0.4 对照阶段。 */
export function createRunSummary(report) {
  const courses = report.results.map((result) => ({
    topicId: result.topicId,
    courseId: result.course.courseId,
    title: result.course.title,
    status: result.course.status,
    savedScenes: result.course.scenes.length,
    requestedScenes: result.course.requestedSceneCount,
    durationMs: result.durationMs,
    ...countUpstreamCalls(result),
    repairedSavedScenes: result.course.scenes.filter((scene) => scene.generation?.repaired).length,
    archivedScenes: result.sceneArchives?.length ?? 0,
    errors: result.collectionErrors,
  }));
  const generations = report.results.flatMap((result) => [result.course.outlineGeneration, ...result.course.scenes.map((scene) => scene.generation)]).filter(Boolean);
  return {
    courses,
    readyCourses: courses.filter((course) => course.status === "ready").length,
    partialFailedCourses: courses.filter((course) => course.status === "partial_failed").length,
    failedCourses: courses.filter((course) => course.status === "failed").length,
    savedScenes: courses.reduce((total, course) => total + course.savedScenes, 0),
    requestedScenes: courses.reduce((total, course) => total + course.requestedScenes, 0),
    archivedScenes: courses.reduce((total, course) => total + course.archivedScenes, 0),
    totalUpstreamCalls: courses.reduce((total, course) => total + course.totalCalls, 0),
    failedSceneUpstreamCalls: courses.reduce((total, course) => total + course.failedCalls, 0),
    recordedInputTokens: generations.reduce((total, generation) => total + (generation.usage?.inputTokens ?? 0), 0),
    recordedOutputTokens: generations.reduce((total, generation) => total + (generation.usage?.outputTokens ?? 0), 0),
  };
}

/** 把机器报告压缩成人工可快速核对的单页索引。 */
export function createSummaryMarkdown(report) {
  const summary = createRunSummary(report);
  const rows = summary.courses.map((course) => `| ${course.topicId} | ${course.status} | ${course.savedScenes}/${course.requestedScenes} | ${course.archivedScenes} | ${course.totalCalls} |`).join("\n");
  const title = report.runLabel ?? "M7.0 DeepSeek v0.3 基线摘要";
  const closing = report.comparisonScope
    ? "本目录用于 v0.3/v0.4 的 slide/quiz 配对视觉复核；互动场景不进入本轮配对。"
    : "人工评分暂不在 M7.0 执行。完成 v0.4 优化并用相同六题重新生成课程后，再以 v0.3/v0.4 配对方式进行内容与视觉评分；本目录只保存基线事实和场景快照。";
  return `# ${title}

> 运行 ID：\`${report.runId}\`<br>
> 冻结时间：\`${report.frozenAt}\`<br>
> 模型：\`${report.server.provider} / ${report.server.model}\`

本次保留 ${summary.savedScenes}/${summary.requestedScenes} 个场景，其中 ${summary.archivedScenes} 个已保存为可离线打开的 MHTML。课程状态为 ${summary.readyCourses} 门 \`ready\`、${summary.partialFailedCourses} 门 \`partial_failed\`、${summary.failedCourses} 门 \`failed\`。上游调用共 ${summary.totalUpstreamCalls} 次；可追溯 token 为输入 ${summary.recordedInputTokens}、输出 ${summary.recordedOutputTokens}。

| 主题 | 状态 | 已保存/请求场景 | MHTML | 上游调用 |
| --- | --- | ---: | ---: | ---: |
${rows}

${closing}
`;
}

export const PAIRED_SCENE_TYPES = ["slide", "quiz"];
export const MANUAL_SCORE_DIMENSIONS = ["readability", "layoutHierarchy", "renderingCompleteness"];

/** @typedef {"slide" | "quiz"} PairableSceneType */
/** @typedef {{ topicId: string, sceneType: PairableSceneType, occurrence: number, pairId: string, sceneOrder: number, title: string, archive: ({ filename: string, format?: string, viewport?: { width: number, height: number } } | null) }} PairableScene */
/** @typedef {{ pairId: string, topicId: string, sceneType: PairableSceneType, occurrence: number, baseline: PairableScene, candidate: PairableScene }} CourseQualityPair */
/** @typedef {{ baseline: Array<PairableScene & { reason: string }>, candidate: Array<PairableScene & { reason: string }> }} UnmatchedScenes */

/** 列出一门运行中可用于 slide/quiz 配对的已归档场景，并按类型计算稳定序号。 */
/** @returns {PairableScene[]} */
function listPairableScenes(report) {
  return report.results.flatMap((result) => {
    const occurrenceByType = new Map();
    return [...(result.course.scenes ?? [])]
      .sort((left, right) => left.order - right.order)
      .filter((scene) => PAIRED_SCENE_TYPES.includes(scene.type))
      .map((scene) => {
        const occurrence = (occurrenceByType.get(scene.type) ?? 0) + 1;
        occurrenceByType.set(scene.type, occurrence);
        const archive = (result.sceneArchives ?? []).find((item) => item.sceneOrder === scene.order && item.sceneType === scene.type);
        return {
          topicId: result.topicId,
          sceneType: scene.type,
          occurrence,
          pairId: `${result.topicId}/${scene.type}-${String(occurrence).padStart(2, "0")}`,
          sceneOrder: scene.order,
          title: scene.title,
          archive: archive ? { filename: archive.filename, format: archive.format, viewport: archive.viewport } : null,
        };
      });
  });
}

/** 返回运行中出现的互动场景，供本轮 slide/quiz 配对做范围检查。 */
export function listInteractiveScenes(report) {
  return report.results.flatMap((result) => (result.course.scenes ?? [])
    .filter((scene) => scene.type === "interactive")
    .map((scene) => ({ topicId: result.topicId, sceneOrder: scene.order, title: scene.title })));
}

/** 本轮只接受 slide/quiz；互动场景出现时直接提示运行范围不匹配。 */
export function assertSlideQuizOnly(report, label) {
  const interactive = listInteractiveScenes(report);
  if (interactive.length > 0) {
    throw new Error(`${label} 包含 ${interactive.length} 个 interactive 场景，本轮只允许 slide/quiz 配对`);
  }
}

/** 按主题、场景类型和类型内序号配对；缺少归档文件的场景不会被伪造成可评分配对。 */
/** @returns {{ pairs: CourseQualityPair[], unmatched: UnmatchedScenes }} */
export function buildCourseQualityPairs(baselineReport, candidateReport) {
  const baselineScenes = listPairableScenes(baselineReport);
  const candidateScenes = listPairableScenes(candidateReport);
  const baselineById = new Map(baselineScenes.map((scene) => [scene.pairId, scene]));
  const candidateById = new Map(candidateScenes.map((scene) => [scene.pairId, scene]));
  const ids = [...new Set([...baselineById.keys(), ...candidateById.keys()])].sort();
  /** @type {CourseQualityPair[]} */
  const pairs = [];
  /** @type {UnmatchedScenes} */
  const unmatched = { baseline: [], candidate: [] };

  for (const pairId of ids) {
    const baseline = baselineById.get(pairId);
    const candidate = candidateById.get(pairId);
    if (baseline?.archive && candidate?.archive) {
      pairs.push({ pairId, topicId: baseline.topicId, sceneType: baseline.sceneType, occurrence: baseline.occurrence, baseline, candidate });
      continue;
    }
    if (baseline) unmatched.baseline.push({ ...baseline, reason: baseline.archive ? "missing_candidate" : "missing_baseline_archive" });
    if (candidate) unmatched.candidate.push({ ...candidate, reason: candidate.archive ? "missing_baseline" : "missing_candidate_archive" });
  }
  return { pairs, unmatched };
}

function mean(values) {
  return values.length === 0 ? null : Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2));
}

/** 汇总人工填写的三项分数和总体偏好，不增加内容正确性或互动指标。 */
export function summarizeCourseQualityScores(pairs, scores) {
  const scoreByPairId = new Map(scores.map((score) => [score.pairId, score]));
  const values = Object.fromEntries(MANUAL_SCORE_DIMENSIONS.map((dimension) => [dimension, { baseline: [], candidate: [] }]));
  const preference = { baseline: 0, tie: 0, candidate: 0 };
  const missingPairIds = [];

  for (const pair of pairs) {
    const score = scoreByPairId.get(pair.pairId);
    if (!score) {
      missingPairIds.push(pair.pairId);
      continue;
    }
    if (!Object.hasOwn(preference, score.preference)) throw new Error(`${pair.pairId} 的 preference 必须是 baseline、tie 或 candidate`);
    preference[score.preference] += 1;
    for (const dimension of MANUAL_SCORE_DIMENSIONS) {
      const baseline = score.baseline?.[dimension];
      const candidate = score.candidate?.[dimension];
      if (![baseline, candidate].every((value) => Number.isInteger(value) && value >= 1 && value <= 5)) {
        throw new Error(`${pair.pairId} 的 ${dimension} 分数必须是 1 到 5 的整数`);
      }
      values[dimension].baseline.push(baseline);
      values[dimension].candidate.push(candidate);
    }
  }

  return {
    pairCount: pairs.length,
    scoredPairCount: pairs.length - missingPairIds.length,
    missingPairIds,
    preference,
    dimensions: Object.fromEntries(MANUAL_SCORE_DIMENSIONS.map((dimension) => [
      dimension,
      {
        baselineMean: mean(values[dimension].baseline),
        candidateMean: mean(values[dimension].candidate),
        difference: values[dimension].baseline.length && values[dimension].candidate.length
          ? Number((mean(values[dimension].candidate) - mean(values[dimension].baseline)).toFixed(2))
          : null,
      },
    ])),
  };
}
