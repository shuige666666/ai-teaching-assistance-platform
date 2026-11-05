"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { EditableQuizQuestion } from "@/lib/domain/quiz-edit";
import type { Scene } from "@/lib/domain/schemas";

type QuizScene = Extract<Scene, { type: "quiz" }>;

function toDraft(scene: QuizScene): EditableQuizQuestion[] {
  return scene.content.questions.map((question) => ({
    type: question.type,
    prompt: question.prompt,
    options: question.options.map((option) => option.label),
    correctOptionIndexes: question.correctOptionIds.map((id) => question.options.findIndex((option) => option.id === id)),
    explanation: question.explanation,
  }));
}

function emptyQuestion(): EditableQuizQuestion {
  return { type: "single_choice", prompt: "", options: ["", ""], correctOptionIndexes: [0], explanation: "" };
}

export function QuizEditDialog({ scene, onClose, onSave }: {
  scene: QuizScene;
  onClose: () => void;
  onSave: (questions: EditableQuizQuestion[]) => Promise<void>;
}) {
  const [questions, setQuestions] = useState(() => toDraft(scene));
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const valid = useMemo(() => questions.every((question) => {
    const answers = new Set(question.correctOptionIndexes);
    return question.prompt.trim() && question.explanation.trim() && question.options.every((option) => option.trim())
      && new Set(question.options.map((option) => option.trim().toLocaleLowerCase())).size === question.options.length
      && [...answers].every((index) => index >= 0 && index < question.options.length)
      && (question.type === "single_choice" ? answers.size === 1 : answers.size >= 2);
  }), [questions]);

  function updateQuestion(index: number, update: (question: EditableQuizQuestion) => EditableQuizQuestion) {
    setQuestions((current) => current.map((question, questionIndex) => questionIndex === index ? update(question) : question));
  }

  function removeOption(questionIndex: number, optionIndex: number) {
    updateQuestion(questionIndex, (question) => ({
      ...question,
      options: question.options.filter((_, index) => index !== optionIndex),
      correctOptionIndexes: question.correctOptionIndexes.filter((index) => index !== optionIndex).map((index) => index > optionIndex ? index - 1 : index),
    }));
  }

  function toggleAnswer(questionIndex: number, optionIndex: number) {
    updateQuestion(questionIndex, (question) => ({
      ...question,
      correctOptionIndexes: question.type === "single_choice"
        ? [optionIndex]
        : question.correctOptionIndexes.includes(optionIndex)
          ? question.correctOptionIndexes.filter((index) => index !== optionIndex)
          : [...question.correctOptionIndexes, optionIndex].sort(),
    }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || !confirmed || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSave(questions.map((question) => ({ ...question, prompt: question.prompt.trim(), explanation: question.explanation.trim(), options: question.options.map((option) => option.trim()) })));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "题目保存失败，请重试");
      setSaving(false);
    }
  }

  return (
    <div className="scene-regeneration-backdrop" role="presentation">
      <section className="quiz-editor-dialog dialog" role="dialog" aria-modal="true" aria-labelledby="quiz-editor-title">
        <header className="dialog-head"><div><p className="eyebrow">测验编辑 · 不调用模型</p><h2 id="quiz-editor-title">手动调整题目</h2></div><button className="icon-btn" type="button" aria-label="关闭题目编辑器" disabled={saving} onClick={onClose}><X aria-hidden="true" /></button></header>
        <p className="quiz-editor-intro">直接编辑题干、选项、答案和解析，不调用模型。保存后旧作答会失效。</p>
        <form onSubmit={submit}>
          <div className="quiz-editor-list">
            {questions.map((question, questionIndex) => (
              <fieldset className="quiz-editor-card" key={questionIndex}>
                <legend>第 {questionIndex + 1} 题</legend>
                <div className="quiz-editor-card-head">
                  <label>题型<select value={question.type} disabled={saving} onChange={(event) => updateQuestion(questionIndex, (current) => ({ ...current, type: event.target.value as EditableQuizQuestion["type"], correctOptionIndexes: [current.correctOptionIndexes[0] ?? 0] }))}><option value="single_choice">单选题</option><option value="multiple_choice">多选题</option></select></label>
                  {questions.length > 1 ? <button className="btn btn--ghost btn--sm quiz-editor-remove" type="button" disabled={saving} onClick={() => setQuestions((current) => current.filter((_, index) => index !== questionIndex))}>删除本题</button> : null}
                </div>
                <label>题干<textarea maxLength={300} value={question.prompt} disabled={saving} onChange={(event) => updateQuestion(questionIndex, (current) => ({ ...current, prompt: event.target.value }))} /></label>
                <div className="quiz-editor-options">
                  <span>选项与正确答案 <small>{question.type === "multiple_choice" ? "至少勾选两项" : "勾选一项"}</small></span>
                  {question.options.map((option, optionIndex) => (
                    <div className="quiz-editor-option" key={optionIndex}>
                      <input type={question.type === "multiple_choice" ? "checkbox" : "radio"} name={`answer-${questionIndex}`} aria-label={`第 ${questionIndex + 1} 题选项 ${optionIndex + 1} 为正确答案`} checked={question.correctOptionIndexes.includes(optionIndex)} disabled={saving} onChange={() => toggleAnswer(questionIndex, optionIndex)} />
                      <b>{String.fromCharCode(65 + optionIndex)}</b>
                      <input type="text" maxLength={180} value={option} aria-label={`第 ${questionIndex + 1} 题选项 ${optionIndex + 1}`} disabled={saving} onChange={(event) => updateQuestion(questionIndex, (current) => ({ ...current, options: current.options.map((value, index) => index === optionIndex ? event.target.value : value) }))} />
                      <button type="button" aria-label={`删除第 ${questionIndex + 1} 题选项 ${optionIndex + 1}`} disabled={saving || question.options.length <= 2} onClick={() => removeOption(questionIndex, optionIndex)}>−</button>
                    </div>
                  ))}
                  {question.options.length < 4 ? <button className="quiz-editor-add-option" type="button" disabled={saving} onClick={() => updateQuestion(questionIndex, (current) => ({ ...current, options: [...current.options, ""] }))}>＋ 添加选项</button> : null}
                </div>
                <label>答案解析<textarea maxLength={500} value={question.explanation} disabled={saving} onChange={(event) => updateQuestion(questionIndex, (current) => ({ ...current, explanation: event.target.value }))} /></label>
              </fieldset>
            ))}
          </div>
          {questions.length < 3 ? <button className="quiz-editor-add-question" type="button" disabled={saving} onClick={() => setQuestions((current) => [...current, emptyQuestion()])}>＋ 新增一道题</button> : null}
          <label className="confirm-check"><input type="checkbox" checked={confirmed} disabled={saving} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>确认清理本场旧作答记录</strong><small>题目与选项会使用新的 ID，旧答案无法继续对应。</small></span></label>
          {error ? <p className="notice notice--danger" role="alert">{error}</p> : null}
          <footer className="dialog-foot"><button className="btn btn--ghost" type="button" disabled={saving} onClick={onClose}>取消修改</button><button className="btn btn--primary" type="submit" disabled={saving || !confirmed || !valid}>{saving ? "正在保存…" : "保存题目"}</button></footer>
        </form>
      </section>
    </div>
  );
}
