import { CourseSchema, type Course, type CourseSummary } from "@/lib/domain/schemas";
import { CourseConflictError, type CourseRepository } from "./course-repository";

function cloneCourse(course: Course): Course { return structuredClone(course); }

export class InMemoryCourseRepository implements CourseRepository {
  private readonly courses = new Map<string, Course>();

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
  async save(course: Course, expectedRevision: number): Promise<Course> {
    const current = this.courses.get(course.id);
    if (!current || current.revision !== expectedRevision || course.revision !== expectedRevision) throw new CourseConflictError();
    const saved = CourseSchema.parse({ ...course, revision: expectedRevision + 1, updatedAt: Math.max(Date.now(), course.updatedAt) });
    this.courses.set(saved.id, cloneCourse(saved));
    return cloneCourse(saved);
  }

  async delete(id: string): Promise<void> { this.courses.delete(id); }
}
