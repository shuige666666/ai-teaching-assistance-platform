import { randomUUID } from "node:crypto";
import type { AIAdapter } from "@/lib/ai/contracts";
import { CourseSchema, type Course, type DomainError, type SceneOutline } from "@/lib/domain/schemas";
import { generateOutline, OutlineGenerationError } from "@/lib/generation/outline-pipeline";
import { validateEditedOutline } from "@/lib/generation/outline-schema";
import { CourseConflictError, type CourseRepository } from "@/lib/repository/course-repository";

export class OutlineApplicationError extends Error {
  constructor(public readonly code: "COURSE_NOT_FOUND" | "INVALID_COURSE_STATE", message: string) {
    super(message);
    this.name = "OutlineApplicationError";
  }
}

function asDomainError(error: unknown): DomainError {
  if (error instanceof OutlineGenerationError) {
    return { code: error.code, message: error.message, retryable: error.retryable, stage: "outline", details: error.issues ? { issues: error.issues } : undefined };
  }
  return { code: "INTERNAL_ERROR", message: "大纲生成过程中发生内部错误", retryable: true, stage: "outline" };
}

export class OutlineGenerationService {
  constructor(
    private readonly repository: CourseRepository,
    private readonly adapter: AIAdapter,
    private readonly timeoutMs = 90_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** 用两个短事务包围模型调用，并用 operation id 与 revision 阻止迟到结果覆盖新状态。 */
  async generate(courseId: string, expectedRevision: number, requestId: string, requestSignal?: AbortSignal): Promise<Course> {
    const current = await this.repository.get(courseId);
    if (!current) throw new OutlineApplicationError("COURSE_NOT_FOUND", "课程不存在，请返回首页重新创建");
    if (current.revision !== expectedRevision) throw new CourseConflictError();
    const expiredOperation = current.status === "outlining" && current.activeOperation && current.activeOperation.expiresAt <= this.now();
    if (!["draft", "failed", "outline_ready"].includes(current.status) && !expiredOperation) {
      throw new OutlineApplicationError("INVALID_COURSE_STATE", "当前课程状态不允许生成大纲");
    }

    const operationId = randomUUID();
    const startedAt = this.now();
    const registered = await this.repository.save(CourseSchema.parse({
      ...current,
      status: "outlining",
      activeOperation: { id: operationId, stage: "outline", startedAt, expiresAt: startedAt + this.timeoutMs + 30_000 },
      lastError: undefined,
      updatedAt: startedAt,
    }), expectedRevision);

    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal;
    try {
      // 模型网络调用发生在两次 repository.save 之间，不占用数据库连接或事务。
      const generated = await generateOutline(this.adapter, {
        topic: registered.topic,
        sceneCount: registered.requestedSceneCount,
        requestId,
        signal,
      });
      const latest = await this.repository.get(courseId);
      if (!latest || latest.revision !== registered.revision || latest.activeOperation?.id !== operationId) throw new CourseConflictError();
      const now = this.now();
      return await this.repository.save(CourseSchema.parse({
        ...latest,
        title: generated.courseTitle,
        status: "outline_ready",
        outlines: generated.outlines,
        scenes: [],
        sceneProgress: generated.outlines.map((outline) => ({ outlineId: outline.id, status: "pending", attempts: 0, updatedAt: now })),
        outlineGeneration: generated.metadata,
        activeOperation: undefined,
        lastError: undefined,
        updatedAt: now,
      }), latest.revision);
    } catch (error) {
      // 只有当前操作仍拥有租约时才记录失败，避免失败回写覆盖另一请求的新结果。
      const latest = await this.repository.get(courseId);
      if (latest?.activeOperation?.id === operationId && latest.revision === registered.revision) {
        await this.repository.save(CourseSchema.parse({
          ...latest,
          status: "failed",
          activeOperation: undefined,
          lastError: asDomainError(error),
          updatedAt: this.now(),
        }), latest.revision);
      }
      throw error;
    }
  }

  /** 保存人工审核后的文案；ID、类型和顺序仍由原始服务端大纲控制。 */
  async edit(courseId: string, expectedRevision: number, courseTitle: string, outlines: SceneOutline[]): Promise<Course> {
    const current = await this.repository.get(courseId);
    if (!current) throw new OutlineApplicationError("COURSE_NOT_FOUND", "课程不存在，请返回首页重新创建");
    if (current.revision !== expectedRevision) throw new CourseConflictError();
    if (current.status !== "outline_ready") throw new OutlineApplicationError("INVALID_COURSE_STATE", "只有待审核的大纲可以编辑");
    const structureMatches = current.outlines.every((item, index) => {
      const edited = outlines[index];
      return edited && edited.id === item.id && edited.type === item.type && edited.order === item.order;
    });
    if (!structureMatches || outlines.length !== current.outlines.length) {
      throw new OutlineApplicationError("INVALID_COURSE_STATE", "不能通过编辑接口修改大纲 ID、类型或顺序");
    }
    const validated = validateEditedOutline(courseTitle, outlines, current.requestedSceneCount);
    return this.repository.save(CourseSchema.parse({ ...current, title: validated.courseTitle, outlines: validated.outlines, updatedAt: this.now() }), expectedRevision);
  }
}
