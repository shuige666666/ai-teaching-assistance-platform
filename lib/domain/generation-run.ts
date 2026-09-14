import { z } from "zod";

export const GenerationRunTypeSchema = z.enum(["course_generation", "scene_batch", "scene_retry"]);
export const GenerationRunStatusSchema = z.enum([
  "running",
  "awaiting_review",
  "awaiting_generation",
  "completed",
  "partial_failed",
  "failed",
  "cancelled",
  "interrupted",
  "superseded",
]);
export const UsageStatusSchema = z.enum(["complete", "partial", "unavailable"]);

export const GenerationRunSchema = z.object({
  id: z.string().uuid(),
  courseId: z.string().uuid(),
  runType: GenerationRunTypeSchema,
  status: GenerationRunStatusSchema,
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  promptVersion: z.string().min(1).optional(),
  methodVersion: z.string().min(1).optional(),
  rootRequestId: z.string().min(1).optional(),
  baseRevision: z.number().int().nonnegative(),
  finalRevision: z.number().int().nonnegative().optional(),
  requestedSceneCount: z.number().int().nonnegative(),
  succeededSceneCount: z.number().int().nonnegative(),
  failedSceneCount: z.number().int().nonnegative(),
  firstPassSucceededCount: z.number().int().nonnegative(),
  modelCalls: z.number().int().nonnegative(),
  repairCount: z.number().int().nonnegative(),
  repairSucceededCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  usageStatus: UsageStatusSchema,
  activeDurationMs: z.number().int().nonnegative(),
  errorCode: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative(),
});

export type GenerationRunType = z.infer<typeof GenerationRunTypeSchema>;
export type GenerationRunStatus = z.infer<typeof GenerationRunStatusSchema>;
export type UsageStatus = z.infer<typeof UsageStatusSchema>;
export type GenerationRun = z.infer<typeof GenerationRunSchema>;

export const terminalGenerationRunStatuses: ReadonlySet<GenerationRunStatus> = new Set([
  "completed", "partial_failed", "failed", "cancelled", "interrupted", "superseded",
]);

export function isTerminalGenerationRun(status: GenerationRunStatus) {
  return terminalGenerationRunStatuses.has(status);
}

export type GenerationRunCreateInput = Pick<GenerationRun,
  "courseId" | "runType" | "status" | "baseRevision" | "requestedSceneCount" | "startedAt" | "updatedAt"
> & Partial<Pick<GenerationRun,
  "provider" | "model" | "promptVersion" | "methodVersion" | "rootRequestId" | "config"
>> & { courseTitle?: string };

export type GenerationMetricDelta = {
  succeededSceneCount?: number;
  failedSceneCount?: number;
  firstPassSucceededCount?: number;
  modelCalls?: number;
  repairCount?: number;
  repairSucceededCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  usageStatus?: UsageStatus;
  activeDurationMs?: number;
  provider?: string;
  model?: string;
  promptVersion?: string;
  finalRevision?: number;
  errorCode?: string;
  updatedAt: number;
};

export type GenerationRunWithCourse = GenerationRun & { courseTitle: string };

export type UsageRange = "7d" | "30d" | "all";

export type UsageResponse = {
  recordingStartedAt?: number;
  totals: {
    runs: number;
    terminalRuns: number;
    completedRuns: number;
    requestedScenes: number;
    succeededScenes: number;
    firstPassSucceededScenes: number;
    modelCalls: number;
    repairCount: number;
    repairSucceededCount: number;
    inputTokens?: number;
    outputTokens?: number;
    usageStatus: UsageStatus;
    averageActiveDurationMs?: number;
  };
  byStatus: Array<{ status: GenerationRunStatus; count: number }>;
  byDay: Array<{ date: string; runs: number; completedRuns: number; failedRuns: number; modelCalls: number; inputTokens?: number; outputTokens?: number }>;
  byModel: Array<{ provider?: string; model?: string; runs: number; modelCalls: number; inputTokens?: number; outputTokens?: number; averageActiveDurationMs?: number }>;
  recentRuns: Array<{
    id: string;
    courseId: string;
    courseTitle: string;
    runType: GenerationRunType;
    status: GenerationRunStatus;
    provider?: string;
    model?: string;
    promptVersion?: string;
    methodVersion?: string;
    succeededScenes: number;
    requestedScenes: number;
    modelCalls: number;
    repairCount: number;
    inputTokens?: number;
    outputTokens?: number;
    usageStatus: UsageStatus;
    activeDurationMs: number;
    startedAt: number;
    finishedAt?: number;
    errorCode?: string;
  }>;
};

function combineUsageStatus(statuses: UsageStatus[]): UsageStatus {
  if (statuses.length === 0 || statuses.every((status) => status === "unavailable")) return "unavailable";
  return statuses.every((status) => status === "complete") ? "complete" : "partial";
}

/** 将运行事实转换为设置页契约；这里仅做汇总，不反向修改运行记录。 */
export function buildUsageResponse(runs: GenerationRunWithCourse[]): UsageResponse {
  const ordered = [...runs].sort((a, b) => b.startedAt - a.startedAt);
  const terminal = ordered.filter((run) => isTerminalGenerationRun(run.status));
  const knownInput = ordered.filter((run) => run.inputTokens !== undefined);
  const knownOutput = ordered.filter((run) => run.outputTokens !== undefined);
  const byStatusMap = new Map<GenerationRunStatus, number>();
  const byDayMap = new Map<string, UsageResponse["byDay"][number]>();
  const byModelMap = new Map<string, UsageResponse["byModel"][number] & { durationTotal: number; durationCount: number }>();

  for (const run of ordered) {
    byStatusMap.set(run.status, (byStatusMap.get(run.status) ?? 0) + 1);
    // 产品当前只面向中国时区，避免浏览器和数据库所在时区造成日期分组漂移。
    const date = new Date(run.startedAt + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    const day = byDayMap.get(date) ?? { date, runs: 0, completedRuns: 0, failedRuns: 0, modelCalls: 0 };
    day.runs += 1;
    day.completedRuns += run.status === "completed" ? 1 : 0;
    day.failedRuns += ["partial_failed", "failed", "interrupted"].includes(run.status) ? 1 : 0;
    day.modelCalls += run.modelCalls;
    if (run.inputTokens !== undefined) day.inputTokens = (day.inputTokens ?? 0) + run.inputTokens;
    if (run.outputTokens !== undefined) day.outputTokens = (day.outputTokens ?? 0) + run.outputTokens;
    byDayMap.set(date, day);

    const modelKey = `${run.provider ?? ""}\u0000${run.model ?? ""}`;
    const model = byModelMap.get(modelKey) ?? {
      provider: run.provider, model: run.model, runs: 0, modelCalls: 0, durationTotal: 0, durationCount: 0,
    };
    model.runs += 1;
    model.modelCalls += run.modelCalls;
    if (run.inputTokens !== undefined) model.inputTokens = (model.inputTokens ?? 0) + run.inputTokens;
    if (run.outputTokens !== undefined) model.outputTokens = (model.outputTokens ?? 0) + run.outputTokens;
    if (isTerminalGenerationRun(run.status)) {
      model.durationTotal += run.activeDurationMs;
      model.durationCount += 1;
    }
    byModelMap.set(modelKey, model);
  }

  const totalDuration = terminal.reduce((sum, run) => sum + run.activeDurationMs, 0);
  return {
    recordingStartedAt: ordered.length > 0 ? Math.min(...ordered.map((run) => run.startedAt)) : undefined,
    totals: {
      runs: ordered.length,
      terminalRuns: terminal.length,
      completedRuns: ordered.filter((run) => run.status === "completed").length,
      requestedScenes: ordered.reduce((sum, run) => sum + run.requestedSceneCount, 0),
      succeededScenes: ordered.reduce((sum, run) => sum + run.succeededSceneCount, 0),
      firstPassSucceededScenes: ordered.reduce((sum, run) => sum + run.firstPassSucceededCount, 0),
      modelCalls: ordered.reduce((sum, run) => sum + run.modelCalls, 0),
      repairCount: ordered.reduce((sum, run) => sum + run.repairCount, 0),
      repairSucceededCount: ordered.reduce((sum, run) => sum + run.repairSucceededCount, 0),
      inputTokens: knownInput.length > 0 ? knownInput.reduce((sum, run) => sum + run.inputTokens!, 0) : undefined,
      outputTokens: knownOutput.length > 0 ? knownOutput.reduce((sum, run) => sum + run.outputTokens!, 0) : undefined,
      usageStatus: combineUsageStatus(ordered.filter((run) => run.modelCalls > 0).map((run) => run.usageStatus)),
      averageActiveDurationMs: terminal.length > 0 ? Math.round(totalDuration / terminal.length) : undefined,
    },
    byStatus: [...byStatusMap].map(([status, count]) => ({ status, count })),
    byDay: [...byDayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byModel: [...byModelMap.values()].map(({ durationTotal, durationCount, ...model }) => ({
      ...model,
      averageActiveDurationMs: durationCount > 0 ? Math.round(durationTotal / durationCount) : undefined,
    })).sort((a, b) => b.modelCalls - a.modelCalls),
    recentRuns: ordered.slice(0, 20).map((run) => ({
      id: run.id,
      courseId: run.courseId,
      courseTitle: run.courseTitle,
      runType: run.runType,
      status: run.status,
      provider: run.provider,
      model: run.model,
      promptVersion: run.promptVersion,
      methodVersion: run.methodVersion,
      succeededScenes: run.succeededSceneCount,
      requestedScenes: run.requestedSceneCount,
      modelCalls: run.modelCalls,
      repairCount: run.repairCount,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      usageStatus: run.usageStatus,
      activeDurationMs: run.activeDurationMs,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      errorCode: run.errorCode,
    })),
  };
}
