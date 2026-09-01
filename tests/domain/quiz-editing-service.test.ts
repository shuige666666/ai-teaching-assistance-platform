import { describe, expect, it } from "vitest";
import { QuizEditingService } from "@/lib/application/quiz-editing-service";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { EditQuizSceneInputSchema } from "@/lib/domain/quiz-edit";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";
import { CourseConflictError } from "@/lib/repository/course-repository";

describe("QuizEditingService", () => {
  it("不调用模型即可把人工题目装配为新 Quiz Scene", async () => {
    const repository = new InMemoryCourseRepository();
    const course = await repository.create(materializeFixtureCourse(createFixtureCourse("人工编辑测验", 4)));
    const oldQuiz = course.scenes.find((scene) => scene.type === "quiz");
    if (!oldQuiz || oldQuiz.type !== "quiz") throw new Error("fixture quiz missing");
    const next = await new QuizEditingService(repository, () => 987654).edit(course.id, oldQuiz.outlineId, {
      expectedRevision: course.revision,
      confirmQuizAttemptDeletion: true,
      questions: [{ type: "multiple_choice", prompt: "哪些属于 ACID？", options: ["原子性", "一致性", "随机性"], correctOptionIndexes: [0, 1], explanation: "原子性与一致性属于 ACID。" }],
    });
    const quiz = next.scenes.find((scene) => scene.outlineId === oldQuiz.outlineId);
    if (!quiz || quiz.type !== "quiz") throw new Error("edited quiz missing");
    expect(next.revision).toBe(course.revision + 1);
    expect(quiz.id).not.toBe(oldQuiz.id);
    expect(quiz.content.questions[0]).toMatchObject({ type: "multiple_choice", prompt: "哪些属于 ACID？" });
    expect(quiz.content.questions[0].correctOptionIds).toEqual(quiz.content.questions[0].options.slice(0, 2).map((option) => option.id));
    expect(next.scenes.filter((scene) => scene.outlineId !== oldQuiz.outlineId)).toEqual(course.scenes.filter((scene) => scene.outlineId !== oldQuiz.outlineId));
  });

  it("拒绝未确认清理、非法多选答案和过期版本", async () => {
    expect(EditQuizSceneInputSchema.safeParse({ expectedRevision: 1, confirmQuizAttemptDeletion: false, questions: [] }).success).toBe(false);
    expect(EditQuizSceneInputSchema.safeParse({ expectedRevision: 1, confirmQuizAttemptDeletion: true, questions: [{ type: "multiple_choice", prompt: "题目", options: ["A", "B"], correctOptionIndexes: [0], explanation: "解析" }] }).success).toBe(false);
    const repository = new InMemoryCourseRepository();
    const course = await repository.create(materializeFixtureCourse(createFixtureCourse("版本冲突", 4)));
    const quiz = course.scenes.find((scene) => scene.type === "quiz")!;
    await expect(new QuizEditingService(repository).edit(course.id, quiz.outlineId, {
      expectedRevision: course.revision + 1,
      confirmQuizAttemptDeletion: true,
      questions: [{ type: "single_choice", prompt: "题目", options: ["A", "B"], correctOptionIndexes: [0], explanation: "解析" }],
    })).rejects.toBeInstanceOf(CourseConflictError);
  });
});
