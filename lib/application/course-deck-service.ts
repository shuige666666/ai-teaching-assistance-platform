import { z } from "zod";
import { AgentApplicationError } from "@/lib/agent/contracts";
import { CourseSchema, type Course } from "@/lib/domain/schemas";
import { CourseConflictError, type CourseRepository } from "@/lib/repository/course-repository";

export const EditDeckInputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("rename"), sceneId: z.string().min(1), expectedRevision: z.number().int().nonnegative(), title: z.string().trim().min(1).max(80) }).strict(),
  z.object({ operation: z.literal("move"), sceneId: z.string().min(1), expectedRevision: z.number().int().nonnegative(), toPosition: z.number().int().positive() }).strict(),
  z.object({ operation: z.literal("delete"), sceneId: z.string().min(1), expectedRevision: z.number().int().nonnegative() }).strict(),
]);
export type EditDeckInput = z.infer<typeof EditDeckInputSchema>;

export type PreparedDeckDelete = {
  kind: "delete";
  courseId: string;
  baseRevision: number;
  sceneId: string;
  outlineId: string;
  sceneType: "slide" | "quiz" | "interactive";
  title: string;
  position: number;
  summary: string;
};

export type CourseDeckResult = {
  operation: "rename" | "move" | "delete";
  changed: boolean;
  beforeRevision: number;
  afterRevision: number;
  sceneId: string;
  outlineId: string;
  beforePosition: number;
  afterPosition: number;
  beforeTitle: string;
  afterTitle: string;
  removedSceneIds?: string[];
};

function requireEditableCourse(current: Course | null, expectedRevision: number): Course {
  if (!current) throw new AgentApplicationError("NOT_FOUND", "课程不存在", 404);
  if (current.revision !== expectedRevision) throw new CourseConflictError();
  if (current.status !== "ready" || current.activeOperation) {
    throw new AgentApplicationError("TOOL_EXECUTION_FAILED", "只有没有生成任务的 ready 课程可以调整页序", 409);
  }
  return current;
}

function sceneContext(course: Course, sceneId: string) {
  const scene = course.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new AgentApplicationError("NOT_FOUND", "目标页面不存在或不属于当前课程", 404);
  const outline = course.outlines.find((item) => item.id === scene.outlineId);
  if (!outline) throw new AgentApplicationError("NOT_FOUND", "目标页面目录不存在", 404);
  const progress = course.sceneProgress.find((item) => item.outlineId === outline.id);
  if (progress?.status !== "ready") throw new AgentApplicationError("TOOL_EXECUTION_FAILED", "只能调整已经保存的 ready 页面", 409);
  return { scene, outline, position: outline.order };
}

function reorderCourse(course: Course, outlineIds: string[]): Course {
  const orderById = new Map(outlineIds.map((id, index) => [id, index + 1]));
  const outlines = outlineIds.map((id) => {
    const outline = course.outlines.find((item) => item.id === id);
    if (!outline) throw new AgentApplicationError("INVALID_ARGUMENT", "页序中包含不存在的大纲");
    return { ...outline, order: orderById.get(id)! };
  });
  const scenes = course.scenes
    .map((scene) => ({ ...scene, order: orderById.get(scene.outlineId)! }))
    .sort((a, b) => a.order - b.order);
  const sceneProgress = course.sceneProgress
    .slice()
    .sort((a, b) => (orderById.get(a.outlineId) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(b.outlineId) ?? Number.MAX_SAFE_INTEGER));
  return CourseSchema.parse({ ...course, outlines, scenes, sceneProgress });
}

export class CourseDeckService {
  constructor(private readonly repository: CourseRepository, private readonly now: () => number = Date.now) {}

  /** 修改目录标题；只同步 Scene.title，不改画布中的标题元素。 */
  async rename(courseId: string, expectedRevision: number, sceneId: string, title: string): Promise<CourseDeckResult> {
    const current = requireEditableCourse(await this.repository.get(courseId), expectedRevision);
    const { scene, outline, position } = sceneContext(current, sceneId);
    if (outline.title === title && scene.title === title) {
      return { operation: "rename", changed: false, beforeRevision: current.revision, afterRevision: current.revision, sceneId, outlineId: outline.id, beforePosition: position, afterPosition: position, beforeTitle: outline.title, afterTitle: title };
    }
    const now = this.now();
    const candidate = CourseSchema.parse({
      ...current,
      outlines: current.outlines.map((item) => item.id === outline.id ? { ...item, title } : item),
      scenes: current.scenes.map((item) => item.id === scene.id ? { ...item, title, updatedAt: Math.max(now, item.updatedAt) } : item),
      updatedAt: now,
    });
    const saved = await this.repository.save(candidate, current.revision);
    return { operation: "rename", changed: true, beforeRevision: current.revision, afterRevision: saved.revision, sceneId, outlineId: outline.id, beforePosition: position, afterPosition: position, beforeTitle: outline.title, afterTitle: title };
  }

  /** 按稳定 sceneId 移动页面，并同步三组顺序数据。 */
  async move(courseId: string, expectedRevision: number, sceneId: string, toPosition: number): Promise<CourseDeckResult> {
    const current = requireEditableCourse(await this.repository.get(courseId), expectedRevision);
    const { outline, position } = sceneContext(current, sceneId);
    if (toPosition < 1 || toPosition > current.outlines.length) throw new AgentApplicationError("INVALID_ARGUMENT", `目标页码必须在 1～${current.outlines.length} 之间`);
    if (toPosition === position) {
      return { operation: "move", changed: false, beforeRevision: current.revision, afterRevision: current.revision, sceneId, outlineId: outline.id, beforePosition: position, afterPosition: position, beforeTitle: outline.title, afterTitle: outline.title };
    }
    const ids = current.outlines.map((item) => item.id);
    ids.splice(position - 1, 1);
    ids.splice(toPosition - 1, 0, outline.id);
    const candidate = reorderCourse({ ...current, updatedAt: this.now() }, ids);
    const saved = await this.repository.save(candidate, current.revision);
    return { operation: "move", changed: true, beforeRevision: current.revision, afterRevision: saved.revision, sceneId, outlineId: outline.id, beforePosition: position, afterPosition: toPosition, beforeTitle: outline.title, afterTitle: outline.title };
  }

  /** 先冻结稳定身份和版本，交给 Agent confirmation 卡等待用户确认。 */
  async prepareDelete(courseId: string, expectedRevision: number, sceneId: string): Promise<PreparedDeckDelete> {
    const current = requireEditableCourse(await this.repository.get(courseId), expectedRevision);
    const { scene, outline, position } = sceneContext(current, sceneId);
    if (current.outlines.length <= 4) throw new AgentApplicationError("INVALID_COURSE_STATE", "课程至少保留 4 个页面，不能删除当前页", 409);
    const remainingIds = current.outlines.filter((item) => item.id !== outline.id).map((item) => item.id);
    // 删除前先验证候选课程的结构约束，但不把候选半成品保存到数据库。
    const reduced = {
      ...current,
      requestedSceneCount: current.requestedSceneCount - 1,
      outlines: current.outlines.filter((item) => item.id !== outline.id),
      scenes: current.scenes.filter((item) => item.id !== scene.id),
      sceneProgress: current.sceneProgress.filter((item) => item.outlineId !== outline.id),
    };
    CourseSchema.parse(reorderCourse(reduced, remainingIds));
    return {
      kind: "delete", courseId, baseRevision: current.revision, sceneId: scene.id, outlineId: outline.id,
      sceneType: scene.type, title: outline.title, position,
      summary: `删除第 ${position} 页《${outline.title}》${scene.type === "quiz" ? "，同时清理本页旧作答记录" : ""}`,
    };
  }

  /** 在确认后重新读取并删除目标页，quiz 作答清理与课程保存共用一个事务。 */
  async commitDelete(prepared: PreparedDeckDelete): Promise<CourseDeckResult> {
    const current = requireEditableCourse(await this.repository.get(prepared.courseId), prepared.baseRevision);
    const { scene, outline, position } = sceneContext(current, prepared.sceneId);
    if (scene.outlineId !== prepared.outlineId || scene.type !== prepared.sceneType) throw new AgentApplicationError("INVALID_ARGUMENT", "确认目标与当前页面身份不一致");
    if (current.outlines.length <= 4) throw new AgentApplicationError("INVALID_COURSE_STATE", "课程至少保留 4 个页面，不能删除当前页", 409);
    const remainingIds = current.outlines.filter((item) => item.id !== outline.id).map((item) => item.id);
    const candidate = reorderCourse({
      ...current,
      requestedSceneCount: current.requestedSceneCount - 1,
      outlines: current.outlines.filter((item) => item.id !== outline.id),
      scenes: current.scenes.filter((item) => item.id !== scene.id),
      sceneProgress: current.sceneProgress.filter((item) => item.outlineId !== outline.id),
      updatedAt: this.now(),
    }, remainingIds);
    const saved = await this.repository.save(candidate, current.revision, scene.type === "quiz" ? { clearQuizAttemptsForSceneId: scene.id } : undefined);
    return { operation: "delete", changed: true, beforeRevision: current.revision, afterRevision: saved.revision, sceneId: scene.id, outlineId: outline.id, beforePosition: position, afterPosition: Math.min(position, saved.outlines.length), beforeTitle: outline.title, afterTitle: "", removedSceneIds: [scene.id] };
  }
}
