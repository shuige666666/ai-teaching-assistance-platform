import type { QuizAttempt } from "@/lib/domain/quiz-attempt";

export interface QuizAttemptRepository {
  create(attempt: QuizAttempt): Promise<QuizAttempt>;
  listByCourse(courseId: string): Promise<QuizAttempt[]>;
}
