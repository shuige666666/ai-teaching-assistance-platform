import { applyCourseBriefChanges } from "@/lib/domain/course-brief";
import { CourseSchema, type Course } from "@/lib/domain/schemas";
import { CourseConflictError, type CourseRepository } from "@/lib/repository/course-repository";
import { OutlineApplicationError } from "./outline-generation-service";

export class CourseBriefService {
  constructor(private readonly repository: CourseRepository, private readonly now: () => number = Date.now) {}

  /** 在场景生成前保存 Brief 修改，并使依赖旧要求的大纲与进度整体失效。 */
  async edit(courseId: string, expectedRevision: number, changes: unknown): Promise<Course> {
    const current = await this.repository.get(courseId);
    if (!current) throw new OutlineApplicationError("COURSE_NOT_FOUND", "课程不存在，请返回首页重新创建");
    if (current.revision !== expectedRevision) throw new CourseConflictError();
    if (current.scenes.length > 0 || !["draft", "failed", "outline_ready"].includes(current.status)) {
      throw new OutlineApplicationError("INVALID_COURSE_STATE", "课程要求只能在场景生成前修改");
    }

    const updated = applyCourseBriefChanges(current.brief, current.briefResolution, changes);
    return this.repository.save(CourseSchema.parse({
      ...current,
      brief: updated.brief,
      briefResolution: updated.resolution,
      title: current.topic.slice(0, 120),
      status: "draft",
      outlines: [],
      sceneProgress: [],
      outlineGeneration: undefined,
      activeOperation: undefined,
      lastError: undefined,
      updatedAt: this.now(),
    }), expectedRevision);
  }
}
