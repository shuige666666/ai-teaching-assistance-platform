import { z } from "zod";

export const EditableQuizQuestionSchema = z.object({
  type: z.enum(["single_choice", "multiple_choice"]),
  prompt: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(180)).min(2).max(4),
  correctOptionIndexes: z.array(z.number().int().nonnegative()).min(1).max(4),
  explanation: z.string().trim().min(1).max(500),
}).strict().superRefine((question, context) => {
  const normalizedOptions = question.options.map((option) => option.toLocaleLowerCase());
  if (new Set(normalizedOptions).size !== normalizedOptions.length) context.addIssue({ code: "custom", path: ["options"], message: "同一道题的选项不能重复" });
  if (new Set(question.correctOptionIndexes).size !== question.correctOptionIndexes.length) context.addIssue({ code: "custom", path: ["correctOptionIndexes"], message: "正确答案不能重复" });
  if (question.correctOptionIndexes.some((index) => index >= question.options.length)) context.addIssue({ code: "custom", path: ["correctOptionIndexes"], message: "正确答案超出选项范围" });
  if (question.type === "single_choice" && question.correctOptionIndexes.length !== 1) context.addIssue({ code: "custom", path: ["correctOptionIndexes"], message: "单选题必须且只能选择一个正确答案" });
  if (question.type === "multiple_choice" && question.correctOptionIndexes.length < 2) context.addIssue({ code: "custom", path: ["correctOptionIndexes"], message: "多选题至少需要两个正确答案" });
});

export const EditQuizSceneInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  confirmQuizAttemptDeletion: z.literal(true),
  questions: z.array(EditableQuizQuestionSchema).min(1).max(3),
}).strict();

export type EditQuizSceneInput = z.infer<typeof EditQuizSceneInputSchema>;
export type EditableQuizQuestion = z.infer<typeof EditableQuizQuestionSchema>;
