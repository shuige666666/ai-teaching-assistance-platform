import { randomUUID } from "node:crypto";
import type { AIAdapter } from "@/lib/ai/contracts";
import { CourseSchema, type Course, type DomainError, type Scene, type SceneOutline } from "@/lib/domain/schemas";
import { generateScene, SceneGenerationError } from "@/lib/generation/scene-pipeline";
import { extractInteractiveAuthorHtml } from "@/lib/interactive/html-policy";
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

/** 只构造当前场景的修订参考；互动内容剥离平台运行注入，其他数据库字段不外发。 */
function buildRevisionReference(scene: Scene) {
  const narration = scene.actions.filter((action) => action.type === "speech").map((action) => action.text);
  return {
    type: scene.type,
    title: scene.title,
    summary: scene.summary,
    narration,
    content: scene.type === "interactive"
      ? { ...scene.content, html: extractInteractiveAuthorHtml(scene.content.html) }
      : scene.content,
  };
}

export class SceneGenerationService {
  constructor(
    private readonly repository: CourseRepository,
    private readonly adapter: AIAdapter,
    private readonly timeoutMs = 120_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** 运行失败的互动采用干净重生成，只发送错误背景，不向模型发送旧 HTML。 */
  async regenerateFailedInteractive(courseId: string, outlineId: string, expectedRevision: number, requestId: string, options: {
    runtimeError: string;
    requestSignal?: AbortSignal;
  }): Promise<Course> {
    return this.replaceReadyScene(courseId, outlineId, expectedRevision, requestId, {
      kind: "regenerate",
      runtimeError: options.runtimeError.slice(0, 500),
      requestSignal: options.requestSignal,
    });
  }

  /** 根据用户意见修订 ready 场景；仅当前旧场景会作为不可信参考发送给模型。 */
  async revise(courseId: string, outlineId: string, expectedRevision: number, requestId: string, options: {
    instruction: string;
    confirmQuizAttemptDeletion?: boolean;
    requestSignal?: AbortSignal;
  }): Promise<Course> {
    return this.replaceReadyScene(courseId, outlineId, expectedRevision, requestId, {
      kind: "revise",
      instruction: options.instruction.slice(0, 500),
      confirmQuizAttemptDeletion: options.confirmQuizAttemptDeletion,
      requestSignal: options.requestSignal,
    });
  }

  /** 新增页只在内存中扩展候选课程；生成成功后才一次插入目录、场景和进度。 */
  async insert(courseId: string, expectedRevision: number, requestId: string, outline: SceneOutline, position: number, instruction: string, requestSignal?: AbortSignal): Promise<Course> {
    const current = await this.repository.get(courseId);
    if (!current) throw new SceneApplicationError("COURSE_NOT_FOUND", "课程不存在");
    if (current.revision !== expectedRevision) throw new CourseConflictError();
    if (current.status !== "ready" || current.activeOperation) throw new SceneApplicationError("INVALID_COURSE_STATE", "只有没有生成任务的 ready 课程可以新增页面");
    if (current.outlines.length >= 8 || current.requestedSceneCount >= 8) throw new SceneApplicationError("INVALID_COURSE_STATE", "课程最多包含 8 个页面");
    if (position < 1 || position > current.outlines.length + 1) throw new SceneApplicationError("INVALID_COURSE_STATE", `新增页位置必须在 1～${current.outlines.length + 1} 之间`);
    if (current.outlines.some((item) => item.id === outline.id)) throw new SceneApplicationError("INVALID_COURSE_STATE", "新增页 ID 与已有大纲冲突");

    const operationId = randomUUID();
    const startedAt = this.now();
    const candidateOutlines = [...current.outlines];
    candidateOutlines.splice(position - 1, 0, { ...outline, order: position });
    const outlineIds = candidateOutlines.map((item) => item.id);
    const orderById = new Map(outlineIds.map((id, index) => [id, index + 1]));
    const orderedOutlines = candidateOutlines.map((item) => ({ ...item, order: orderById.get(item.id)! }));
    const orderedScenes = current.scenes.map((scene) => ({ ...scene, order: orderById.get(scene.outlineId)! })).sort((a, b) => a.order - b.order);
    const orderedProgress = [
      ...current.sceneProgress,
      { outlineId: outline.id, status: "pending" as const, attempts: 0, updatedAt: startedAt },
    ].sort((a, b) => (orderById.get(a.outlineId) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(b.outlineId) ?? Number.MAX_SAFE_INTEGER));
    // 1. 先在内存验证新增后的完整课程，失败时不登记租约、不留下半成品。
    const generationCourseShape = CourseSchema.parse({
      ...current,
      status: "generating",
      requestedSceneCount: current.requestedSceneCount + 1,
      outlines: orderedOutlines,
      scenes: orderedScenes,
      sceneProgress: orderedProgress,
    });
    const generationOutline = orderedOutlines.find((item) => item.id === outline.id)!;
    // 2. 只登记租约；持久化课程仍保持原有目录和页数，不写入占位页。
    const registered = await this.repository.save(CourseSchema.parse({
      ...current,
      status: "generating",
      activeOperation: { id: operationId, stage: "scene", purpose: "insert", outlineId: outline.id, startedAt, expiresAt: startedAt + this.timeoutMs + 30_000 },
      updatedAt: startedAt,
    }), expectedRevision);
    const generationCourse = CourseSchema.parse({
      ...generationCourseShape,
      revision: registered.revision,
      activeOperation: registered.activeOperation,
      updatedAt: registered.updatedAt,
    });
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal;
    try {
      // 3. 新增指令进入与已有场景相同的底层生成、修复、装配链。
      signal.throwIfAborted();
      const scene = await generateScene(this.adapter, { course: generationCourse, outline: generationOutline, requestId, signal, regeneration: { kind: "insert", instruction: instruction.slice(0, 500) } });
      signal.throwIfAborted();
      const latest = await this.repository.get(courseId);
      if (!latest || latest.revision !== registered.revision || latest.activeOperation?.id !== operationId) throw new CourseConflictError();
      signal.throwIfAborted();
      const finalProgress = orderedProgress.map((item) => item.outlineId === outline.id ? { ...item, status: "ready" as const, updatedAt: this.now() } : item);
      const finalScenes = [...orderedScenes, scene].sort((a, b) => a.order - b.order);
      // 4. 新页和更新后的连续页序一次提交，旧页面 ID 与作答保持不变。
      return await this.repository.save(CourseSchema.parse({
        ...latest,
        requestedSceneCount: current.requestedSceneCount + 1,
        status: "ready",
        outlines: orderedOutlines,
        scenes: finalScenes,
        sceneProgress: finalProgress,
        activeOperation: undefined,
        lastError: undefined,
        updatedAt: this.now(),
      }), latest.revision);
    } catch (error) {
      const failure = signal.aborted && !(error instanceof SceneGenerationError)
        ? new SceneGenerationError("AI_TIMEOUT", "新增页面已取消或超时，原课程保持不变", true, 0, undefined, { cause: error }) : error;
      const latest = await this.repository.get(courseId);
      // 5. 只有仍持有本次租约时才清理；迟到响应不能覆盖其他操作。
      if (latest?.revision === registered.revision && latest.activeOperation?.id === operationId) {
        await this.repository.save(CourseSchema.parse({
          ...latest,
          status: "ready",
          activeOperation: undefined,
          lastError: asDomainError(failure),
          updatedAt: this.now(),
        }), latest.revision);
      }
      throw failure;
    }
  }

  /** 两个入口共用租约、候选校验和原子替换，避免并发语义出现分叉。 */
  private async replaceReadyScene(courseId: string, outlineId: string, expectedRevision: number, requestId: string, options:
    | { kind: "regenerate"; runtimeError: string; requestSignal?: AbortSignal }
    | { kind: "revise"; instruction: string; confirmQuizAttemptDeletion?: boolean; requestSignal?: AbortSignal }
  ): Promise<Course> {
    const current = await this.repository.get(courseId);
    if (!current) throw new SceneApplicationError("COURSE_NOT_FOUND", "课程不存在");
    if (current.revision !== expectedRevision) throw new CourseConflictError();
    const outline = current.outlines.find((item) => item.id === outlineId);
    if (!outline) throw new SceneApplicationError("OUTLINE_NOT_FOUND", "场景大纲不存在");
    const oldScene = current.scenes.find((item) => item.outlineId === outlineId);
    const progress = current.sceneProgress.find((item) => item.outlineId === outlineId);
    const expired = current.activeOperation?.stage === "scene" && current.activeOperation.outlineId === outlineId && current.activeOperation.expiresAt <= this.now();
    if (!oldScene || outline.type !== oldScene.type || progress?.status !== "ready") {
      throw new SceneApplicationError("INVALID_COURSE_STATE", "只能替换已经保存的 ready 场景");
    }
    if (options.kind === "regenerate" && oldScene.type !== "interactive") {
      throw new SceneApplicationError("INVALID_COURSE_STATE", "运行失败重生成只适用于 interactive 场景");
    }
    if (options.kind === "revise" && oldScene.type === "quiz" && !options.confirmQuizAttemptDeletion) {
      throw new SceneApplicationError("INVALID_COURSE_STATE", "修订测验前必须确认清理本场旧作答记录");
    }
    if ((current.activeOperation && !expired) || (!["ready", "partial_failed"].includes(current.status) && !expired)) {
      throw new SceneApplicationError("INVALID_COURSE_STATE", "课程已有生成操作，请稍后刷新重试");
    }
    options.requestSignal?.throwIfAborted();
    const operationId = randomUUID(), startedAt = this.now();
    // 1. 只登记租约和尝试次数；旧 HTML、ready 进度与其他场景全部保留。
    const registered = await this.repository.save(CourseSchema.parse({
      ...current, status: "generating",
      sceneProgress: current.sceneProgress.map((item) => item.outlineId === outlineId ? { ...item, attempts: item.attempts + 1, lastError: undefined, updatedAt: startedAt } : item),
      activeOperation: { id: operationId, stage: "scene", outlineId, startedAt, expiresAt: startedAt + this.timeoutMs + 30_000 },
      updatedAt: startedAt,
    }), expectedRevision);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = options.requestSignal ? AbortSignal.any([options.requestSignal, timeout]) : timeout;
    const settledStatus = current.sceneProgress.every((item) => item.status === "ready") ? "ready" : "partial_failed";
    let upstreamCalls = 0;
    try {
      // 2. 复用首次生成的预算、Prompt、解析和装配；不同入口只改变模型上下文。
      signal.throwIfAborted();
      const scene = await generateScene(this.adapter, { course: registered, outline, requestId, signal,
        regeneration: options.kind === "regenerate"
          ? { kind: "regenerate", replacedSceneSummary: oldScene.summary, runtimeError: options.runtimeError }
          : { kind: "revise", instruction: options.instruction, existingScene: buildRevisionReference(oldScene) } });
      upstreamCalls = scene.generation.upstreamCalls;
      signal.throwIfAborted();
      const latest = await this.repository.get(courseId);
      if (!latest || latest.revision !== registered.revision || latest.activeOperation?.id !== operationId) throw new CourseConflictError();
      signal.throwIfAborted();
      // 3. 候选完整通过后才原子替换目标场景；新 id 让课堂清空旧播放/完成状态。
      return await this.repository.save(CourseSchema.parse({
        ...latest, status: settledStatus, activeOperation: undefined,
        scenes: latest.scenes.map((item) => item.outlineId === outlineId ? scene : item),
        sceneProgress: latest.sceneProgress.map((item) => item.outlineId === outlineId ? { ...item, lastError: undefined, updatedAt: this.now() } : item),
        lastError: settledStatus === "ready" ? undefined : current.lastError,
        updatedAt: this.now(),
      }), latest.revision, options.kind === "revise" && oldScene.type === "quiz" ? { clearQuizAttemptsForSceneId: oldScene.id } : undefined);
    } catch (error) {
      const failure = signal.aborted && !(error instanceof SceneGenerationError)
        ? new SceneGenerationError("AI_TIMEOUT", "场景替换已取消或超时，原场景已保留", true, upstreamCalls, undefined, { cause: error }) : error;
      const latest = await this.repository.get(courseId);
      // 4. 仅清理本请求仍持有的租约，不用失败回滚覆盖其他请求的新结果。
      if (latest?.revision === registered.revision && latest.activeOperation?.id === operationId) {
        await this.repository.save(CourseSchema.parse({
          ...latest, status: settledStatus, activeOperation: undefined,
          sceneProgress: latest.sceneProgress.map((item) => item.outlineId === outlineId ? { ...item, lastError: asDomainError(failure), updatedAt: this.now() } : item),
          updatedAt: this.now(),
        }), latest.revision);
      }
      throw failure;
    }
  }

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
