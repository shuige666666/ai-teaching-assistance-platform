import { describe, expect, it } from "vitest";
import { QuizAttemptRequestError, QuizAttemptService } from "@/lib/application/quiz-attempt-service";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";
import { InMemoryQuizAttemptRepository } from "@/lib/repository/in-memory-quiz-attempt-repository";

describe("QuizAttemptService", () => {
  it("依据 Course 中的正确选项判分并保持课程 revision 不变", async () => {
    const courses = new InMemoryCourseRepository();
    const attempts = new InMemoryQuizAttemptRepository();
    const course = await courses.create(materializeFixtureCourse(createFixtureCourse("测验持久化", 3)));
    const scene = course.scenes.find((item) => item.type === "quiz");
    if (!scene || scene.type !== "quiz") throw new Error("fixture quiz missing");
    const question = scene.content.questions[0];
    const service = new QuizAttemptService(courses, attempts, () => 123456);

    const attempt = await service.submit(course.id, {
      sceneId: scene.id,
      questionId: question.id,
      selectedOptionIds: question.correctOptionIds,
    });

    expect(attempt).toMatchObject({ correct: true, submittedAt: 123456 });
    expect(await attempts.listByCourse(course.id)).toHaveLength(1);
    expect((await courses.get(course.id))?.revision).toBe(course.revision);
  });

  it("多选题必须与正确答案集合完全一致", async () => {
    const courses = new InMemoryCourseRepository();
    const attempts = new InMemoryQuizAttemptRepository();
    const course = await courses.create(materializeFixtureCourse(createFixtureCourse("多选判分", 3)));
    const scene = course.scenes.find((item) => item.type === "quiz");
    if (!scene || scene.type !== "quiz") throw new Error("fixture quiz missing");
    const question = scene.content.questions.find((item) => item.type === "multiple_choice");
    if (!question) throw new Error("fixture multiple choice missing");
    const service = new QuizAttemptService(courses, attempts);

    await expect(service.submit(course.id, { sceneId: scene.id, questionId: question.id, selectedOptionIds: question.correctOptionIds.slice(0, 1) })).resolves.toMatchObject({ correct: false });
    await expect(service.submit(course.id, { sceneId: scene.id, questionId: question.id, selectedOptionIds: [...question.correctOptionIds].reverse() })).resolves.toMatchObject({ correct: true });
  });

  it("拒绝不属于题目的选择项", async () => {
    const courses = new InMemoryCourseRepository();
    const course = await courses.create(materializeFixtureCourse(createFixtureCourse("非法选项", 3)));
    const scene = course.scenes.find((item) => item.type === "quiz");
    if (!scene || scene.type !== "quiz") throw new Error("fixture quiz missing");
    const service = new QuizAttemptService(courses, new InMemoryQuizAttemptRepository());
    await expect(service.submit(course.id, {
      sceneId: scene.id,
      questionId: scene.content.questions[0].id,
      selectedOptionIds: ["option-from-another-question"],
    })).rejects.toMatchObject({ code: "OPTION_NOT_FOUND" } satisfies Partial<QuizAttemptRequestError>);
  });
});
