import { randomUUID } from "node:crypto";
import type { AIAdapter } from "@/lib/ai/contracts";
import { CourseSchema, type Course, type DomainError, type SceneOutline } from "@/lib/domain/schemas";
import { generateOutline, OutlineGenerationError } from "@/lib/generation/outline-pipeline";
import { validateEditedOutline } from "@/lib/generation/outline-schema";
import { CourseConflictError, type CourseRepository } from "@/lib/repository/course-repository";
import type { GenerationRunTracker } from "./generation-run-tracker";

export class OutlineApplicationError extends Error {
  constructor(public readonly code: "COURSE_NOT_FOUND" | "INVALID_COURSE_STATE", message: string) {
    super(message);
    this.name = "OutlineApplicationError";
  }
}

function asDomainError(error: unknown, requestId: string): DomainError {
  if (error instanceof OutlineGenerationError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      stage: "outline",
      details: {
        requestId,
        upstreamCalls: error.upstreamCalls,
        ...(error.validationKind ? { validationKind: error.validationKind } : {}),
        ...(error.issues ? { issues: error.issues } : {}),
      },
    };
  }
  return { code: "INTERNAL_ERROR", message: "大纲生成过程中发生内部错误", retryable: true, stage: "outline", details: { requestId } };
}

export class OutlineGenerationService {
  constructor(
    private readonly repository: CourseRepository,
    private readonly adapter: AIAdapter,
    private readonly timeoutMs = 90_000,
    private readonly now: () => number = Date.now,
    private readonly generationRuns?: GenerationRunTracker,
  ) {}

  /** 用两个短事务包围模型调用，并用 operation id 与 revision 阻止迟到结果覆盖新状态。 */
  async generate(courseId: string, expectedRevision: number, requestId: string, requestSignal?: AbortSignal): Promise<Course> {
    // 1. 从数据库读取这门课程。
    const current = await this.repository.get(courseId);
    if (!current) throw new OutlineApplicationError("COURSE_NOT_FOUND", "课程不存在，请返回首页重新创建");
    if (current.revision !== expectedRevision) throw new CourseConflictError();
    // 2. 检查课程现在是否允许重新生成大纲。
    const expiredOperation = current.status === "outlining" && current.activeOperation && current.activeOperation.expiresAt <= this.now();
    if (!["draft", "failed", "outline_ready"].includes(current.status) && !expiredOperation) {
      throw new OutlineApplicationError("INVALID_COURSE_STATE", "当前课程状态不允许生成大纲");
    }

    const operationId = randomUUID();
    const startedAt = this.now();
    // 3. 先把课程标记为“正在生成大纲”，并保存本次操作 ID。
    const registered = await this.repository.save(CourseSchema.parse({
      ...current,
      status: "outlining",
      activeOperation: { id: operationId, stage: "outline", startedAt, expiresAt: startedAt + this.timeoutMs + 30_000 },
      lastError: undefined,
      updatedAt: startedAt,
    }), expectedRevision);
    const generationRunId = await this.generationRuns?.startCourseGeneration(registered, requestId, startedAt);

    // 4. 设置模型请求的取消和超时条件。
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal;
    try {
      // 5. 调用 generateOutline()，让模型生成并校验大纲。
      const generated = await generateOutline(this.adapter, {
        topic: registered.topic,
        sceneCount: registered.requestedSceneCount,
        provisionalBrief: registered.brief,
        provisionalResolution: registered.briefResolution,
        requestId,
        signal,
      });
      // 6. 再次读取课程，确认这次操作还没有被其他请求替代。
      const latest = await this.repository.get(courseId);
      if (!latest || latest.revision !== registered.revision || latest.activeOperation?.id !== operationId) throw new CourseConflictError();
      const now = this.now();
      // 7. 保存课程标题、大纲和每一项的 pending 生成进度。
      const saved = await this.repository.save(CourseSchema.parse({
        ...latest,
        title: generated.courseTitle,
        brief: generated.brief,
        briefResolution: generated.briefResolution,
        status: "outline_ready",
        outlines: generated.outlines,
        scenes: [],
        sceneProgress: generated.outlines.map((outline) => ({ outlineId: outline.id, status: "pending", attempts: 0, updatedAt: now })),
        outlineGeneration: generated.metadata,
        activeOperation: undefined,
        lastError: undefined,
        updatedAt: now,
      }), latest.revision);
      await this.generationRuns?.recordOutlineSuccess(generationRunId, saved, generated.metadata);
      return saved;
    } catch (error) {
      // 8. 如果本次操作仍有效，就把课程标记为生成失败并保存错误原因。
      const latest = await this.repository.get(courseId);
      let failedCourse = latest;
      try {
        if (latest?.activeOperation?.id === operationId && latest.revision === registered.revision) {
          failedCourse = await this.repository.save(CourseSchema.parse({
            ...latest,
            status: "failed",
            activeOperation: undefined,
            lastError: asDomainError(error, requestId),
            updatedAt: this.now(),
          }), latest.revision);
        }
      } finally {
        await this.generationRuns?.recordOutlineFailure(generationRunId, failedCourse, error, this.now() - startedAt);
      }
      throw error;
    }
  }

  /** 保存人工审核后的文案；ID、类型、角色和顺序仍由原始服务端大纲控制。 */
  async edit(courseId: string, expectedRevision: number, courseTitle: string, outlines: SceneOutline[]): Promise<Course> {
    // 1. 读取课程，并检查浏览器提交的版本号是否仍有效。
    const current = await this.repository.get(courseId);
    if (!current) throw new OutlineApplicationError("COURSE_NOT_FOUND", "课程不存在，请返回首页重新创建");
    if (current.revision !== expectedRevision) throw new CourseConflictError();
    if (current.status !== "outline_ready") throw new OutlineApplicationError("INVALID_COURSE_STATE", "只有待审核的大纲可以编辑");
    // 2. 检查用户没有修改大纲 ID、类型、角色和顺序。
    const structureMatches = current.outlines.every((item, index) => {
      const edited = outlines[index];
      return edited && edited.id === item.id && edited.type === item.type && edited.role === item.role && edited.order === item.order;
    });
    if (!structureMatches || outlines.length !== current.outlines.length) {
      throw new OutlineApplicationError("INVALID_COURSE_STATE", "不能通过编辑接口修改大纲 ID、类型、角色或顺序");
    }
    // 3. 校验用户修改后的标题、目标和关键点。
    const validated = validateEditedOutline(courseTitle, outlines, current.requestedSceneCount, current.brief.interactionMode);
    // 4. 保存修改后的大纲，并把课程版本号加一。
    return this.repository.save(CourseSchema.parse({ ...current, title: validated.courseTitle, outlines: validated.outlines, updatedAt: this.now() }), expectedRevision);
  }
}
