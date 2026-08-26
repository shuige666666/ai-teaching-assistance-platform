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
    // 1. 从数据库读取这门课程。
    const current = await this.repository.get(courseId);
    if (!current) throw new SceneApplicationError("COURSE_NOT_FOUND", "课程不存在，请返回首页重新创建");
    if (current.revision !== expectedRevision) throw new CourseConflictError();
    // 2. 找到本次要生成的那一项大纲。
    const outline = current.outlines.find((item) => item.id === outlineId);
    if (!outline) throw new SceneApplicationError("OUTLINE_NOT_FOUND", "场景大纲不存在或不属于当前课程");
    const progress = current.sceneProgress.find((item) => item.outlineId === outlineId);
    // 3. 检查这一场是否处于可以生成或重试的状态。
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
    // 4. 先把这一场标记为 generating，并记录本次操作 ID。
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

    // 5. 设置模型请求的取消和超时条件。
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal;
    try {
      // 6. 调用 generateScene()，让模型生成这一场的内容和 Action。
      const scene = await generateScene(this.adapter, { course: registered, outline, requestId, signal });
      // 7. 再次读取课程，确认这次操作仍然有效。
      const latest = await this.repository.get(courseId);
      if (!latest || latest.revision !== registered.revision || latest.activeOperation?.id !== operationId) throw new CourseConflictError();
      const now = this.now();
      const nextProgress = latest.sceneProgress.map((item) => item.outlineId === outlineId ? { ...item, status: "ready" as const, lastError: undefined, updatedAt: now } : item);
      // 8. 把新场景放进 scenes，并按大纲顺序排列。
      const nextScenes = [...latest.scenes.filter((item) => item.outlineId !== outlineId), scene].sort((a, b) => a.order - b.order);
      const allReady = nextProgress.every((item) => item.status === "ready");
      const hasFailure = nextProgress.some((item) => item.status === "failed");
      // 9. 如果全部场景都完成，课程状态改为 ready；否则保持生成中或部分失败。
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
      // 10. 如果本次操作仍有效，就把这一场标记为失败并保存错误原因。
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
