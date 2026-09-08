import { randomUUID } from "node:crypto";
import { EditableQuizQuestionSchema, type EditableQuizQuestion } from "./quiz-edit";
import type { QuizContent } from "./schemas";

/** 把带引用 ID 的领域题目转换成便于人工和 Agent 校验的无 ID 结构。 */
export function toEditableQuizQuestions(content: QuizContent): EditableQuizQuestion[] {
  return content.questions.map((question) => ({
    type: question.type,
    prompt: question.prompt,
    options: question.options.map((option) => option.label),
    correctOptionIndexes: question.correctOptionIds.map((id) => question.options.findIndex((option) => option.id === id)),
    explanation: question.explanation,
  })).map((question) => EditableQuizQuestionSchema.parse(question));
}

/** 校验无 ID 题目并由服务端统一创建最终问题、选项 ID。 */
export function buildQuizQuestions(questions: EditableQuizQuestion[]) {
  return questions.map((input) => {
    const question = EditableQuizQuestionSchema.parse(input);
    const options = question.options.map((label) => ({ id: randomUUID(), label }));
    return {
      id: randomUUID(),
      type: question.type,
      prompt: question.prompt,
      options,
      correctOptionIds: question.correctOptionIndexes.map((index) => options[index].id),
      explanation: question.explanation,
    };
  });
}

