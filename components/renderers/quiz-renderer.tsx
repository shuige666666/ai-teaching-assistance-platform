"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck, Lightbulb } from "lucide-react";
import type { QuizContent } from "@/lib/domain/schemas";

type QuizRendererProps = {
  content: QuizContent;
  onSubmit?: (questionId: string, selectedOptionIds: string[]) => Promise<{ correct: boolean }>;
  onCompleted?: () => void;
};

/** 展示单选与多选题，并在课堂模式下等待服务端按答案集合判分。 */
export function QuizRenderer({ content, onSubmit, onCompleted }: QuizRendererProps) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
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
  async function submit(questionId: string, selectedOptionIds: string[], correctOptionIds: string[]) {
    setPendingQuestionId(questionId);
    setErrors((current) => ({ ...current, [questionId]: "" }));
    try {
      const result = onSubmit
        ? await onSubmit(questionId, selectedOptionIds)
        : { correct: selectedOptionIds.length === correctOptionIds.length && selectedOptionIds.every((id) => correctOptionIds.includes(id)) };
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
        const selectedIds = answers[question.id] ?? [];
        const result = results[question.id];
        const isSubmitted = result !== undefined;
        const isCorrect = result?.correct === true;
        const isPending = pendingQuestionId === question.id;
        return (
          <section className="quiz-card" key={question.id}>
            <div className="quiz-meta">
              <p className="quiz-number">第 {questionIndex + 1} 题</p>
              <span className="quiz-type-label">{question.type === "multiple_choice" ? "多选题" : "单选题"}</span>
            </div>
            <h3>{question.prompt}</h3>
            <div className="quiz-options">
              {question.options.map((option, optionIndex) => {
                const checked = selectedIds.includes(option.id);
                const revealCorrect = isSubmitted && question.correctOptionIds.includes(option.id);
                const revealWrong = isSubmitted && checked && !revealCorrect;
                return (
                  <label className={`quiz-option${checked ? " is-selected" : ""}${revealCorrect ? " is-correct" : ""}${revealWrong ? " is-wrong" : ""}`} key={option.id}>
                    <input
                      type={question.type === "multiple_choice" ? "checkbox" : "radio"}
                      name={question.id}
                      value={option.id}
                      checked={checked}
                      disabled={isSubmitted || isPending}
                      onChange={() => setAnswers((current) => {
                        if (question.type === "single_choice") return { ...current, [question.id]: [option.id] };
                        const existing = current[question.id] ?? [];
                        return { ...current, [question.id]: existing.includes(option.id) ? existing.filter((id) => id !== option.id) : [...existing, option.id] };
                      })}
                    />
                    <span className="option-letter">{String.fromCharCode(65 + optionIndex)}</span>
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
            {!isSubmitted ? (
              <button
                className="btn btn--primary quiz-submit"
                type="button"
                disabled={selectedIds.length === 0 || isPending}
                onClick={() => selectedIds.length > 0 && void submit(question.id, selectedIds, question.correctOptionIds)}
              >{isPending ? <span className="spinner" aria-hidden="true" /> : null}{isPending ? "正在保存…" : "提交答案"}</button>
            ) : (
              <div className={`quiz-result ${isCorrect ? "is-correct" : "is-wrong"}`} role="status">
                <strong>{isCorrect ? <CircleCheck aria-hidden="true" /> : <Lightbulb aria-hidden="true" />}{isCorrect ? "回答正确" : "再想一步"}</strong>
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
