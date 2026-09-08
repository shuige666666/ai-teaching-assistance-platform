import { randomUUID } from "node:crypto";
import { CourseSchema, SceneSchema, type Course } from "@/lib/domain/schemas";
import { EditQuizSceneInputSchema, type EditQuizSceneInput } from "@/lib/domain/quiz-edit";
import { buildQuizQuestions } from "@/lib/domain/quiz-question-builder";
import { CourseConflictError, type CourseRepository } from "@/lib/repository/course-repository";
import { SceneApplicationError } from "./scene-generation-service";

export class QuizEditingService {
  constructor(private readonly repository: CourseRepository, private readonly now: () => number = Date.now) {}

  /** 将人工填写的无 ID 题目装配成新 Quiz Scene，并与旧作答清理一起原子保存。 */
  async edit(courseId: string, outlineId: string, input: EditQuizSceneInput): Promise<Course> {
    const parsed = EditQuizSceneInputSchema.parse(input);
    const current = await this.repository.get(courseId);
    if (!current) throw new SceneApplicationError("COURSE_NOT_FOUND", "课程不存在");
    if (current.revision !== parsed.expectedRevision) throw new CourseConflictError();
    const outline = current.outlines.find((item) => item.id === outlineId);
    if (!outline) throw new SceneApplicationError("OUTLINE_NOT_FOUND", "场景大纲不存在");
    const oldScene = current.scenes.find((item) => item.outlineId === outlineId);
    const progress = current.sceneProgress.find((item) => item.outlineId === outlineId);
    if (outline.type !== "quiz" || oldScene?.type !== "quiz" || progress?.status !== "ready") {
      throw new SceneApplicationError("INVALID_COURSE_STATE", "只能手动编辑已经保存的 ready 测验场景");
    }
    if (current.activeOperation || !["ready", "partial_failed"].includes(current.status)) {
      throw new SceneApplicationError("INVALID_COURSE_STATE", "课程已有生成操作，请稍后刷新重试");
    }

    const now = Math.max(this.now(), current.updatedAt);
    const replacement = SceneSchema.parse({
      ...oldScene,
      id: randomUUID(),
      content: { type: "quiz", questions: buildQuizQuestions(parsed.questions) },
      createdAt: now,
      updatedAt: now,
    });

    // 新 Scene 使用全新题目和选项 ID；旧作答必须在同一事务中失效。
    return this.repository.save(CourseSchema.parse({
      ...current,
      scenes: current.scenes.map((scene) => scene.outlineId === outlineId ? replacement : scene),
      updatedAt: now,
    }), current.revision, { clearQuizAttemptsForSceneId: oldScene.id });
  }
}
