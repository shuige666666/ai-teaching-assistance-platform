import { randomUUID } from "node:crypto";
import { QuizAttemptInputSchema, QuizAttemptSchema, type QuizAttempt, type QuizAttemptInput } from "@/lib/domain/quiz-attempt";
import type { CourseRepository } from "@/lib/repository/course-repository";
import type { QuizAttemptRepository } from "@/lib/repository/quiz-attempt-repository";

export class QuizAttemptRequestError extends Error {
  constructor(public readonly code: "COURSE_NOT_FOUND" | "QUIZ_NOT_FOUND" | "QUESTION_NOT_FOUND" | "OPTION_NOT_FOUND") {
    super(code);
    this.name = "QuizAttemptRequestError";
  }
}

export class QuizAttemptService {
  constructor(
    private readonly courses: CourseRepository,
    private readonly attempts: QuizAttemptRepository,
    private readonly now: () => number = Date.now,
  ) {}

  /** 从 MySQL 课程事实中定位题目并判分，客户端只负责提交选择项。 */
  async submit(courseId: string, input: QuizAttemptInput): Promise<QuizAttempt> {
    const parsedInput = QuizAttemptInputSchema.parse(input);
    const course = await this.courses.get(courseId);
    if (!course) throw new QuizAttemptRequestError("COURSE_NOT_FOUND");
    const scene = course.scenes.find((item) => item.id === parsedInput.sceneId);
    if (!scene || scene.type !== "quiz") throw new QuizAttemptRequestError("QUIZ_NOT_FOUND");
    const question = scene.content.questions.find((item) => item.id === parsedInput.questionId);
    if (!question) throw new QuizAttemptRequestError("QUESTION_NOT_FOUND");
    if (!question.options.some((option) => option.id === parsedInput.selectedOptionId)) {
      throw new QuizAttemptRequestError("OPTION_NOT_FOUND");
    }

    return this.attempts.create(QuizAttemptSchema.parse({
      id: randomUUID(),
      courseId,
      ...parsedInput,
      correct: parsedInput.selectedOptionId === question.correctOptionId,
      submittedAt: this.now(),
    }));
  }
}
