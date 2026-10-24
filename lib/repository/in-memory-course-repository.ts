import { CourseSchema, type Course, type CourseSummary } from "@/lib/domain/schemas";
import { CourseConflictError, type CourseRepository, type CourseSaveOptions } from "./course-repository";
import { validateCourseMaterials } from "@/lib/materials/validation";
import type { CourseMaterial } from "@/lib/materials/types";

function cloneCourse(course: Course): Course { return structuredClone(course); }

export class InMemoryCourseRepository implements CourseRepository {
  private readonly courses = new Map<string, Course>();
  private readonly materials = new Map<string, CourseMaterial[]>();

  /** 保存新课程，并阻止相同 ID 静默覆盖已有聚合。 */
  async create(course: Course): Promise<Course> {
    const parsed = CourseSchema.parse(course);
    if (this.courses.has(parsed.id)) throw new CourseConflictError();
    this.courses.set(parsed.id, cloneCourse(parsed));
    return cloneCourse(parsed);
  }

  /** 从内存读取并重新校验课程，模拟数据库仓储的读取边界。 */
  async get(id: string): Promise<Course | null> {
    const course = this.courses.get(id);
    return course ? CourseSchema.parse(cloneCourse(course)) : null;
  }

  /** 返回首页需要的轻量摘要，避免列表页面依赖完整课程文档。 */
  async list(): Promise<CourseSummary[]> {
    return [...this.courses.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((course) => ({
      id: course.id, topic: course.topic, title: course.title, status: course.status, requestedSceneCount: course.requestedSceneCount,
      readySceneCount: course.sceneProgress.filter((item) => item.status === "ready").length, revision: course.revision, updatedAt: course.updatedAt,
    }));
  }

  /** 使用 expectedRevision 实现与 MySQL 版本一致的乐观并发语义。 */
  async save(course: Course, expectedRevision: number, options: CourseSaveOptions = {}): Promise<Course> {
    const current = this.courses.get(course.id);
    if (!current || current.revision !== expectedRevision || course.revision !== expectedRevision) throw new CourseConflictError();
    const saved = CourseSchema.parse({ ...course, revision: expectedRevision + 1, updatedAt: Math.max(Date.now(), course.updatedAt) });
    const materials = options.replaceMaterials === undefined ? undefined : validateCourseMaterials(course.id, options.replaceMaterials);
    this.courses.set(saved.id, cloneCourse(saved));
    if (materials) this.materials.set(saved.id, structuredClone(materials));
    return cloneCourse(saved);
  }

  /** 材料正文与课程列表分离，读取时返回副本以免生成过程改写持久化内容。 */
  async listMaterials(courseId: string): Promise<CourseMaterial[]> { return structuredClone(this.materials.get(courseId) ?? []); }

  async delete(id: string): Promise<void> { this.courses.delete(id); this.materials.delete(id); }
}
