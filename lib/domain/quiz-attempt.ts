import { z } from "zod";

export const QuizAttemptInputSchema = z.object({
  sceneId: z.string().min(1),
  questionId: z.string().min(1),
  selectedOptionId: z.string().min(1),
}).strict();

export const QuizAttemptSchema = QuizAttemptInputSchema.extend({
  id: z.string().min(1),
  courseId: z.string().min(1),
  correct: z.boolean(),
  submittedAt: z.number().int().nonnegative(),
}).strict();

export type QuizAttemptInput = z.infer<typeof QuizAttemptInputSchema>;
export type QuizAttempt = z.infer<typeof QuizAttemptSchema>;
