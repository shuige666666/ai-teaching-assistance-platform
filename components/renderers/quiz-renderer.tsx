"use client";

import { useEffect, useRef, useState } from "react";
import type { QuizContent } from "@/lib/domain/schemas";

type QuizRendererProps = {
  content: QuizContent;
  onSubmit?: (questionId: string, selectedOptionId: string) => Promise<{ correct: boolean }>;
  onCompleted?: () => void;
};

/** 展示固定单选题，并在课堂模式下等待服务端持久化后再公布结果。 */
export function QuizRenderer({ content, onSubmit, onCompleted }: QuizRendererProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, { correct: boolean }>>({});
  const [pendingQuestionId, setPendingQuestionId] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const completedNotified = useRef(false);

  useEffect(() => {
    if (!completedNotified.current && Object.keys(results).length === content.questions.length) {
      completedNotified.current = true;
      onCompleted?.();
    }
  }, [content.questions.length, onCompleted, results]);

  /** 未注入 API 时保留纯渲染器的本地判分能力，正式课堂由服务端返回 correct。 */
  async function submit(questionId: string, selectedOptionId: string, correctOptionId: string) {
    setPendingQuestionId(questionId);
    setErrors((current) => ({ ...current, [questionId]: "" }));
    try {
      const result = onSubmit
        ? await onSubmit(questionId, selectedOptionId)
        : { correct: selectedOptionId === correctOptionId };
      setResults((current) => ({ ...current, [questionId]: result }));
    } catch (error) {
      setErrors((current) => ({ ...current, [questionId]: error instanceof Error ? error.message : "提交失败，请重试" }));
    } finally {
      setPendingQuestionId(undefined);
    }
  }

  return (
    <div className="quiz-stack" data-testid="quiz-renderer">
      {content.questions.map((question, questionIndex) => {
        const selectedId = answers[question.id];
        const result = results[question.id];
        const isSubmitted = result !== undefined;
        const isCorrect = result?.correct === true;
        const isPending = pendingQuestionId === question.id;
        return (
          <section className="quiz-card" key={question.id}>
            <p className="quiz-number">CHECK {String(questionIndex + 1).padStart(2, "0")}</p>
            <h3>{question.prompt}</h3>
            <div className="quiz-options">
              {question.options.map((option, optionIndex) => {
                const checked = selectedId === option.id;
                const revealCorrect = isSubmitted && option.id === question.correctOptionId;
                const revealWrong = isSubmitted && checked && !revealCorrect;
                return (
                  <label className={`quiz-option${checked ? " is-selected" : ""}${revealCorrect ? " is-correct" : ""}${revealWrong ? " is-wrong" : ""}`} key={option.id}>
                    <input
                      type="radio"
                      name={question.id}
                      value={option.id}
                      checked={checked}
                      disabled={isSubmitted || isPending}
                      onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))}
                    />
                    <span className="option-letter">{String.fromCharCode(65 + optionIndex)}</span>
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
            {!isSubmitted ? (
              <button
                className="button button--dark quiz-submit"
                type="button"
                disabled={!selectedId || isPending}
                onClick={() => selectedId && void submit(question.id, selectedId, question.correctOptionId)}
              >{isPending ? "正在保存…" : "提交答案"}</button>
            ) : (
              <div className={`quiz-result ${isCorrect ? "is-correct" : "is-wrong"}`} role="status">
                <strong>{isCorrect ? "回答正确" : "再想一步"}</strong>
                <p>{question.explanation}</p>
              </div>
            )}
            {errors[question.id] && <p className="quiz-error" role="alert">{errors[question.id]}</p>}
          </section>
        );
      })}
    </div>
  );
}
