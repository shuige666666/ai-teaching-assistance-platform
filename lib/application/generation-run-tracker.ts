import type { Course, GenerationMetadata } from "@/lib/domain/schemas";
import type { GenerationRun, GenerationRunStatus, GenerationRunType } from "@/lib/domain/generation-run";
import { metadataAttemptMetrics, type GenerationAttemptMetrics } from "@/lib/generation/attempt-metrics";
import { writeServerEvent } from "@/lib/observability/server-log";
import type { GenerationRunRepository } from "@/lib/repository/generation-run-repository";

export type SceneRunContext = { runId: string; runType: GenerationRunType };

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : error instanceof Error ? error.name : "INTERNAL_ERROR";
}

function errorAttemptMetrics(error: unknown, fallbackDurationMs: number): GenerationAttemptMetrics {
  if (error && typeof error === "object" && "attemptMetrics" in error) {
    const metrics = (error as { attemptMetrics?: GenerationAttemptMetrics }).attemptMetrics;
    if (metrics) return metrics;
  }
  const upstreamCalls = error && typeof error === "object" && "upstreamCalls" in error && typeof error.upstreamCalls === "number"
    ? error.upstreamCalls : 0;
  return {
    durationMs: fallbackDurationMs,
    upstreamCalls,
    repairAttempted: false,
    usageStatus: "unavailable",
  };
}

/** 以 best-effort 方式记录生成运行；观测写入失败不能覆盖课程真实结果。 */
export class GenerationRunTracker {
  constructor(
    private readonly repository: GenerationRunRepository,
    private readonly now: () => number = Date.now,
    private readonly methodVersion = process.env.GENERATION_METHOD_VERSION?.trim() || "production-baseline",
  ) {}

  private async safely<T>(operation: string, task: () => Promise<T>): Promise<T | undefined> {
    try { return await task(); }
    catch (error) {
      writeServerEvent("error", "generation.metrics.write_failed", {
        operation,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return undefined;
    }
  }

  /** 重新生成大纲时终止旧的开放运行，再登记新的整课运行。 */
  async startCourseGeneration(course: Course, requestId: string, startedAt: number): Promise<string | undefined> {
    return this.safely("start_course_generation", async () => {
      await this.repository.supersedeOpenCourseGeneration(course.id, startedAt);
      const run = await this.repository.create({
        courseId: course.id,
        courseTitle: course.title,
        runType: "course_generation",
        status: "running",
        methodVersion: this.methodVersion,
        rootRequestId: requestId,
        baseRevision: Math.max(0, course.revision - 1),
        requestedSceneCount: course.requestedSceneCount,
        startedAt,
        updatedAt: startedAt,
      });
      return run.id;
    });
  }

  async recordOutlineSuccess(runId: string | undefined, course: Course, metadata: GenerationMetadata) {
    if (!runId) return;
    await this.safely("outline_success", async () => {
      await this.appendAttempt(runId, metadataAttemptMetrics(metadata), { finalRevision: course.revision });
      await this.repository.transition(runId, "awaiting_review", { finalRevision: course.revision, updatedAt: this.now() });
    });
  }

  async recordOutlineFailure(runId: string | undefined, course: Course | null, error: unknown, fallbackDurationMs: number) {
    if (!runId) return;
    await this.safely("outline_failure", async () => {
      await this.appendAttempt(runId, errorAttemptMetrics(error, fallbackDurationMs), {
        finalRevision: course?.revision,
        errorCode: errorCode(error),
      });
      const at = this.now();
      await this.repository.transition(runId, "failed", {
        finalRevision: course?.revision,
        errorCode: errorCode(error),
        finishedAt: at,
        updatedAt: at,
      });
    });
  }

  /** pending 场景沿用整课/批次运行，failed 场景始终创建独立重试运行。 */
  async startSceneAttempt(course: Course, progressStatus: "pending" | "failed" | "generating", requestId: string, startedAt: number): Promise<SceneRunContext | undefined> {
    return this.safely("start_scene_attempt", async () => {
      if (progressStatus === "failed") {
        const retry = await this.repository.create({
          courseId: course.id,
          courseTitle: course.title,
          runType: "scene_retry",
          status: "running",
          methodVersion: this.methodVersion,
          rootRequestId: requestId,
          baseRevision: course.revision,
          requestedSceneCount: 1,
          startedAt,
          updatedAt: startedAt,
        });
        return { runId: retry.id, runType: retry.runType };
      }

      if (progressStatus === "generating") {
        // 过期租约说明上一个进程没有可靠收尾；冻结旧运行，恢复请求另起批次。
        const interrupted = await this.repository.findOpen(course.id, ["course_generation", "scene_batch"]);
        if (interrupted) {
          await this.repository.transition(interrupted.id, "interrupted", {
            finalRevision: course.revision,
            errorCode: "GENERATION_OPERATION_EXPIRED",
            finishedAt: startedAt,
            updatedAt: startedAt,
          });
        }
      }

      const initial = await this.repository.findOpen(course.id, ["course_generation"]);
      if (initial) {
        await this.repository.transition(initial.id, "running", { updatedAt: startedAt });
        return { runId: initial.id, runType: initial.runType };
      }
      let batch = await this.repository.findOpen(course.id, ["scene_batch"]);
      if (!batch) {
        batch = await this.repository.create({
          courseId: course.id,
          courseTitle: course.title,
          runType: "scene_batch",
          status: "running",
          methodVersion: this.methodVersion,
          rootRequestId: requestId,
          baseRevision: course.revision,
          requestedSceneCount: course.sceneProgress.filter((item) => item.status === "pending" || item.outlineId === course.activeOperation?.outlineId).length,
          startedAt,
          updatedAt: startedAt,
        });
      } else {
        await this.repository.transition(batch.id, "running", { updatedAt: startedAt });
      }
      return { runId: batch.id, runType: batch.runType };
    });
  }

  async recordSceneSuccess(context: SceneRunContext | undefined, course: Course, metadata: GenerationMetadata) {
    if (!context) return;
    await this.safely("scene_success", async () => {
      const updated = await this.appendAttempt(context.runId, metadataAttemptMetrics(metadata), {
        succeededSceneCount: 1,
        firstPassSucceededCount: metadata.upstreamCalls === 1 && !metadata.repaired ? 1 : 0,
        finalRevision: course.revision,
      });
      await this.settleSceneRun(updated, course.revision);
    });
  }

  async recordSceneFailure(context: SceneRunContext | undefined, course: Course | null, error: unknown, fallbackDurationMs: number, metadata?: GenerationMetadata) {
    if (!context) return;
    await this.safely("scene_failure", async () => {
      const metrics = metadata ? metadataAttemptMetrics(metadata) : errorAttemptMetrics(error, fallbackDurationMs);
      const updated = await this.appendAttempt(context.runId, metrics, {
        failedSceneCount: 1,
        finalRevision: course?.revision,
        errorCode: errorCode(error),
      });
      await this.settleSceneRun(updated, course?.revision, errorCode(error));
    });
  }

  async supersedeCourseGeneration(courseId: string) {
    await this.safely("supersede_course_generation", () => this.repository.supersedeOpenCourseGeneration(courseId, this.now()));
  }

  async deleteCourseRuns(courseId: string) {
    await this.safely("delete_course_runs", () => this.repository.deleteByCourseId(courseId));
  }

  private async appendAttempt(runId: string, metrics: GenerationAttemptMetrics, extra: {
    succeededSceneCount?: number;
    failedSceneCount?: number;
    firstPassSucceededCount?: number;
    finalRevision?: number;
    errorCode?: string;
  } = {}) {
    return this.repository.appendMetrics(runId, {
      ...extra,
      provider: metrics.provider,
      model: metrics.model,
      promptVersion: metrics.promptVersion,
      modelCalls: metrics.upstreamCalls,
      repairCount: metrics.repairAttempted ? 1 : 0,
      repairSucceededCount: metrics.repairAttempted && extra.failedSceneCount !== 1 ? 1 : 0,
      inputTokens: metrics.usage?.inputTokens,
      outputTokens: metrics.usage?.outputTokens,
      usageStatus: metrics.usageStatus,
      activeDurationMs: metrics.durationMs,
      updatedAt: this.now(),
    });
  }

  /** 场景运行按自己的请求快照收尾，不用后来修订后的课程状态改写首次结果。 */
  private async settleSceneRun(run: GenerationRun | null | undefined, finalRevision?: number, failureCode?: string) {
    if (!run) return;
    const at = this.now();
    const attempts = run.succeededSceneCount + run.failedSceneCount;
    let status: GenerationRunStatus;
    if (run.runType === "scene_retry") status = run.failedSceneCount > 0 ? "failed" : "completed";
    else if (attempts < run.requestedSceneCount) status = "awaiting_generation";
    else status = run.failedSceneCount > 0 ? "partial_failed" : "completed";
    await this.repository.transition(run.id, status, {
      finalRevision,
      errorCode: failureCode,
      finishedAt: ["completed", "partial_failed", "failed"].includes(status) ? at : undefined,
      updatedAt: at,
    });
  }
}
