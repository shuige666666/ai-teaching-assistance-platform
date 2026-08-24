import { randomUUID } from "node:crypto";
import type { AIAdapter } from "@/lib/ai/contracts";
import { CourseSchema, type Course, type DomainError } from "@/lib/domain/schemas";
import { generateScene, SceneGenerationError } from "@/lib/generation/scene-pipeline";
import { CourseConflictError, type CourseRepository } from "@/lib/repository/course-repository";

export class SceneApplicationError extends Error {
  constructor(public readonly code: "COURSE_NOT_FOUND" | "OUTLINE_NOT_FOUND" | "INVALID_COURSE_STATE", message: string) {
    super(message);
    this.name = "SceneApplicationError";
  }
}

function asDomainError(error: unknown): DomainError {
  if (error instanceof SceneGenerationError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      stage: "scene",
      details: { upstreamCalls: error.upstreamCalls, ...(error.issues ? { issues: error.issues } : {}) },
    };
  }
  return { code: "INTERNAL_ERROR", message: "场景生成过程中发生内部错误", retryable: true, stage: "scene" };
}

export class SceneGenerationService {
  constructor(
    private readonly repository: CourseRepository,
    private readonly adapter: AIAdapter,
    private readonly timeoutMs = 120_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** 独立生成一个大纲场景；失败只更新对应进度，不删除其他已完成场景。 */
  async generate(courseId: string, outlineId: string, expectedRevision: number, requestId: string, requestSignal?: AbortSignal): Promise<Course> {
    const current = await this.repository.get(courseId);
    if (!current) throw new SceneApplicationError("COURSE_NOT_FOUND", "课程不存在，请返回首页重新创建");
    if (current.revision !== expectedRevision) throw new CourseConflictError();
    const outline = current.outlines.find((item) => item.id === outlineId);
    if (!outline) throw new SceneApplicationError("OUTLINE_NOT_FOUND", "场景大纲不存在或不属于当前课程");
    const progress = current.sceneProgress.find((item) => item.outlineId === outlineId);
    const expiredOperation = current.activeOperation?.stage === "scene" && current.activeOperation.outlineId === outlineId && current.activeOperation.expiresAt <= this.now();
    if (!progress || (!["pending", "failed"].includes(progress.status) && !(progress.status === "generating" && expiredOperation))) {
      throw new SceneApplicationError("INVALID_COURSE_STATE", "当前场景不是待生成或可重试状态");
    }
    if (!["outline_ready", "generating", "partial_failed"].includes(current.status)) {
      throw new SceneApplicationError("INVALID_COURSE_STATE", "当前课程状态不允许生成场景");
    }
    if (current.activeOperation && !expiredOperation) {
      throw new SceneApplicationError("INVALID_COURSE_STATE", "课程已有未完成的生成操作");
    }

    const operationId = randomUUID();
    const startedAt = this.now();
    const registeredProgress = current.sceneProgress.map((item) => item.outlineId === outlineId ? {
      ...item,
      status: "generating" as const,
      attempts: item.attempts + 1,
      lastError: undefined,
      updatedAt: startedAt,
    } : item);
    const registered = await this.repository.save(CourseSchema.parse({
      ...current,
      status: "generating",
      sceneProgress: registeredProgress,
      activeOperation: { id: operationId, stage: "scene", outlineId, startedAt, expiresAt: startedAt + this.timeoutMs + 30_000 },
      updatedAt: startedAt,
    }), expectedRevision);

    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal;
    try {
      // 远端模型调用发生在两个 save 之间，数据库连接已经释放。
      const scene = await generateScene(this.adapter, { course: registered, outline, requestId, signal });
      const latest = await this.repository.get(courseId);
      if (!latest || latest.revision !== registered.revision || latest.activeOperation?.id !== operationId) throw new CourseConflictError();
      const now = this.now();
      const nextProgress = latest.sceneProgress.map((item) => item.outlineId === outlineId ? { ...item, status: "ready" as const, lastError: undefined, updatedAt: now } : item);
      const nextScenes = [...latest.scenes.filter((item) => item.outlineId !== outlineId), scene].sort((a, b) => a.order - b.order);
      const allReady = nextProgress.every((item) => item.status === "ready");
      const hasFailure = nextProgress.some((item) => item.status === "failed");
      return await this.repository.save(CourseSchema.parse({
        ...latest,
        status: allReady ? "ready" : hasFailure ? "partial_failed" : "generating",
        scenes: nextScenes,
        sceneProgress: nextProgress,
        activeOperation: undefined,
        lastError: hasFailure ? latest.lastError : undefined,
        updatedAt: now,
      }), latest.revision);
    } catch (error) {
      // 只有本操作仍持有 revision 与 operation id 时，才把目标场景标记为失败。
      const latest = await this.repository.get(courseId);
      if (latest?.revision === registered.revision && latest.activeOperation?.id === operationId) {
        const failure = asDomainError(error);
        await this.repository.save(CourseSchema.parse({
          ...latest,
          status: "partial_failed",
          sceneProgress: latest.sceneProgress.map((item) => item.outlineId === outlineId ? { ...item, status: "failed" as const, lastError: failure, updatedAt: this.now() } : item),
          activeOperation: undefined,
          lastError: failure,
          updatedAt: this.now(),
        }), latest.revision);
      }
      throw error;
    }
  }
}
