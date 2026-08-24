import { QuizAttemptSchema, type QuizAttempt } from "@/lib/domain/quiz-attempt";
import type { QuizAttemptRepository } from "./quiz-attempt-repository";

export class InMemoryQuizAttemptRepository implements QuizAttemptRepository {
  private readonly attempts: QuizAttempt[] = [];

  /** 单元测试中模拟独立的学习行为存储，不修改 Course revision。 */
  async create(attempt: QuizAttempt): Promise<QuizAttempt> {
    const parsed = QuizAttemptSchema.parse(attempt);
    this.attempts.push(structuredClone(parsed));
    return structuredClone(parsed);
  }

  async listByCourse(courseId: string): Promise<QuizAttempt[]> {
    return this.attempts.filter((attempt) => attempt.courseId === courseId).map((attempt) => structuredClone(attempt));
  }
}
