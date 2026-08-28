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
  return `# M7.0 DeepSeek v0.3 基线摘要

> 运行 ID：\`${report.runId}\`<br>
> 冻结时间：\`${report.frozenAt}\`<br>
> 模型：\`${report.server.provider} / ${report.server.model}\`

本次保留 ${summary.savedScenes}/${summary.requestedScenes} 个场景，其中 ${summary.archivedScenes} 个已保存为可离线打开的 MHTML。课程状态为 ${summary.readyCourses} 门 \`ready\`、${summary.partialFailedCourses} 门 \`partial_failed\`。上游调用共 ${summary.totalUpstreamCalls} 次；可追溯 token 为输入 ${summary.recordedInputTokens}、输出 ${summary.recordedOutputTokens}。

| 主题 | 状态 | 已保存/请求场景 | MHTML | 上游调用 |
| --- | --- | ---: | ---: | ---: |
${rows}

人工评分暂不在 M7.0 执行。完成 v0.4 优化并用相同六题重新生成课程后，再以 v0.3/v0.4 配对方式进行内容与视觉评分；本目录只保存基线事实和场景快照。
`;
}
