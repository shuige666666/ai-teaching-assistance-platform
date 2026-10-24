import { CourseSchema, type Course } from "@/lib/domain/schemas";
import { extractCourseMaterial } from "@/lib/materials/extract";
import { MaterialError, MAX_MATERIAL_FILES, type CourseMaterial } from "@/lib/materials/types";
import { validateCourseMaterials } from "@/lib/materials/validation";
import { CourseConflictError, type CourseRepository } from "@/lib/repository/course-repository";

export class CourseMaterialService {
  constructor(private readonly repository: CourseRepository) {}

  /** 在解析前检查编辑状态；数据库 revision 会在最终提交时再次保护并发写入。 */
  private async editableCourse(courseId: string, expectedRevision: number): Promise<Course> {
    const course = await this.repository.get(courseId);
    if (!course) throw new MaterialError("COURSE_NOT_FOUND", "课程不存在", 404);
    if (course.revision !== expectedRevision) throw new CourseConflictError();
    if (course.scenes.length || course.activeOperation || !["draft", "outline_ready", "failed"].includes(course.status)) {
      throw new MaterialError("MATERIALS_LOCKED", "开始生成页面后材料已固定；请新建课程使用其他材料", 409);
    }
    return course;
  }

  /** 全部材料解析成功后一次保存；失败时保留原材料和大纲，方便修正后重试。 */
  async replace(courseId: string, expectedRevision: number, uploads: Array<{ file: File; pageRange: string }>, signal?: AbortSignal) {
    if (!uploads.length || uploads.length > MAX_MATERIAL_FILES) throw new MaterialError("INVALID_MATERIAL_COUNT", "每门课程支持 1～3 份教学材料");
    const course = await this.editableCourse(courseId, expectedRevision);
    const materials: CourseMaterial[] = [];
    for (const upload of uploads) materials.push(await extractCourseMaterial(courseId, upload.file, upload.pageRange, signal));
    signal?.throwIfAborted();
    return this.save(course, validateCourseMaterials(courseId, materials));
  }

  /** 删除一份材料时同时清空旧大纲，保证下一次生成使用当前材料集合。 */
  async remove(courseId: string, expectedRevision: number, materialId: string) {
    const course = await this.editableCourse(courseId, expectedRevision);
    const materials = await this.repository.listMaterials(courseId);
    if (!materials.some((material) => material.id === materialId)) throw new MaterialError("MATERIAL_NOT_FOUND", "材料不存在", 404);
    return this.save(course, materials.filter((material) => material.id !== materialId));
  }

  /** 通过课程仓储的同一事务提交材料替换和大纲失效，不保存上传原件。 */
  private async save(course: Course, materials: CourseMaterial[]) {
    const saved = await this.repository.save(CourseSchema.parse({
      ...course, status: "draft", outlines: [], scenes: [], sceneProgress: [], outlineGeneration: undefined,
      activeOperation: undefined, lastError: undefined, updatedAt: Date.now(),
    }), course.revision, { replaceMaterials: materials });
    return { course: saved, materials };
  }
}
