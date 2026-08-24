"use client";

import { useState } from "react";
import type { QuizContent } from "@/lib/domain/schemas";

type QuizRendererProps = {
  content: QuizContent;
};

/** 在浏览器中确定性判分，测验提交不调用模型。 */
export function QuizRenderer({ content }: QuizRendererProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});

  return (
    <div className="quiz-stack" data-testid="quiz-renderer">
      {content.questions.map((question, questionIndex) => {
        const selectedId = answers[question.id];
        const isSubmitted = submitted[question.id] === true;
        const isCorrect = selectedId === question.correctOptionId;
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
                      disabled={isSubmitted}
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
                disabled={!selectedId}
                onClick={() => setSubmitted((current) => ({ ...current, [question.id]: true }))}
              >提交答案</button>
            ) : (
              <div className={`quiz-result ${isCorrect ? "is-correct" : "is-wrong"}`} role="status">
                <strong>{isCorrect ? "回答正确" : "再想一步"}</strong>
                <p>{question.explanation}</p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
