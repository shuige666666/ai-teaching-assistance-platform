"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { QuizEditDialog } from "@/components/course/quiz-edit-dialog";
import { ExportButton } from "@/components/export/export-button";
import { SceneRenderer } from "@/components/renderers/scene-renderer";
import type { EditableQuizQuestion } from "@/lib/domain/quiz-edit";
import type { Course } from "@/lib/domain/schemas";
import { isBrowserSpeechAvailable } from "@/lib/playback/speech-adapters";
import { usePlaybackController } from "@/lib/playback/use-playback-controller";

const SPEECH_PREFERENCE_KEY = "ai-teaching-browser-speech";

const statusLabels = {
  idle: "准备就绪",
  playing: "正在讲解",
  paused: "已暂停",
  awaitingLearner: "等待学习者",
  completed: "本场景完成",
} as const;

export function ClassroomRuntime({ course: initialCourse }: { course: Course }) {
  const [course, setCourse] = useState(initialCourse);
  const [regenerating, setRegenerating] = useState(false);
  const [replacementMode, setReplacementMode] = useState<"revise" | "regenerate">("revise");
  const [regenerationElapsedSeconds, setRegenerationElapsedSeconds] = useState(0);
  const [regenerationOpen, setRegenerationOpen] = useState(false);
  const [regenerationInstruction, setRegenerationInstruction] = useState("");
  const [quizDeletionConfirmed, setQuizDeletionConfirmed] = useState(false);
  const [manualRegenerationError, setManualRegenerationError] = useState<string | null>(null);
  const [quizEditorOpen, setQuizEditorOpen] = useState(false);
  const regenerationRequest = useRef<AbortController | null>(null);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [continuousPlay, setContinuousPlay] = useState(false);
  const [browserSpeechEnabled, setBrowserSpeechEnabled] = useState(false);
  const [browserSpeechSupported, setBrowserSpeechSupported] = useState(false);
  // 1. 根据 sceneIndex 取出当前要显示的场景。
  const scene = course.scenes[sceneIndex];
  // 2. 把当前场景交给播放控制器执行语音和暂停动作。
  const playback = usePlaybackController(scene, browserSpeechEnabled, continuousPlay);
  const speech = scene.actions.find((action) => action.type === "speech");
  const courseProgress = ((sceneIndex + playback.progress / 100) / course.scenes.length) * 100;
  const isPartialPreview = course.status !== "ready" || course.scenes.length < course.requestedSceneCount;

  // 离开课堂时取消请求，避免迟到响应写入已离开的页面。
  useEffect(() => () => regenerationRequest.current?.abort(), []);

  // 模型响应时间不可预测；等待层持续显示真实经过时间，不伪造完成百分比。
  useEffect(() => {
    if (!regenerating) return;
    const startedAt = Date.now();
    const interval = window.setInterval(() => setRegenerationElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, [regenerating]);

  /** 两个外部入口共用等待与刷新反馈，但只向对应接口提交其所需字段。 */
  async function replaceScene(mode: "revise" | "regenerate", options: { instruction?: string; runtimeError?: string; confirmQuizAttemptDeletion?: boolean }) {
    if (regenerationRequest.current) return;
    const controller = new AbortController();
    regenerationRequest.current = controller;
    setReplacementMode(mode);
    setRegenerationElapsedSeconds(0);
    setRegenerating(true);
    setContinuousPlay(false);
    playback.pause();
    try {
      const response = await fetch(`/api/courses/${course.id}/scenes/${scene.outlineId}/${mode}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({
          expectedRevision: course.revision,
          ...(mode === "revise" ? { instruction: options.instruction?.slice(0, 500), confirmQuizAttemptDeletion: options.confirmQuizAttemptDeletion ?? false } : {}),
          ...(mode === "regenerate" ? { runtimeError: options.runtimeError?.slice(0, 500) } : {}),
        }),
      });
      const payload = await response.json() as { data?: { course: Course }; error?: { code?: string; message?: string; requestId?: string } };
      if (!response.ok || !payload.data?.course) {
        throw new Error(`${payload.error?.code ?? "REGENERATION_FAILED"}：${payload.error?.message ?? "重新生成失败"}${payload.error?.requestId ? `（请求 ${payload.error.requestId}）` : ""}`);
      }
      controller.signal.throwIfAborted();
      setRegenerationOpen(false);
      setRegenerationInstruction("");
      setQuizDeletionConfirmed(false);
      // 提交完成后整页重新读取 MySQL，避免局部状态遗漏新场景的 Action 或作答关联。
      window.location.reload();
    } catch (error) {
      // 读取失败不覆盖主错误；取消后服务端也可能仍在清理租约，下一次请求仍有版本保护。
      try {
        const refreshed = await fetch(`/api/courses/${course.id}`, { signal: AbortSignal.timeout(5000) });
        const payload = await refreshed.json() as { course?: Course };
        if (refreshed.ok && payload.course) setCourse(payload.course);
      } catch { /* 保留本地旧课程，提示用户刷新核对。 */ }
      const actionName = mode === "revise" ? "修订" : "重新生成";
      throw new Error(controller.signal.aborted ? "已取消本次等待，请刷新核对状态后再试。原内容不会在新结果提交前被删除。" : `${error instanceof Error ? error.message : `${actionName}失败`}。未成功提交的新结果不会替换原场景。`);
    } finally {
      regenerationRequest.current = null;
      setRegenerating(false);
    }
  }

  /** 从课堂修订面板提交用户意见；quiz 必须先明确确认清理旧作答。 */
  async function submitManualRegeneration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setManualRegenerationError(null);
    // 关闭输入面板后让课堂继续可见，按钮区域承担后台请求的反馈。
    setRegenerationOpen(false);
    try {
      await replaceScene("revise", {
        instruction: regenerationInstruction.trim() || undefined,
        confirmQuizAttemptDeletion: scene.type === "quiz" ? quizDeletionConfirmed : false,
      });
    } catch (error) {
      setManualRegenerationError(error instanceof Error ? error.message : "重新生成失败，原场景已保留");
    }
  }

  /** 手动题目编辑不调用模型，服务端生成新 ID 并原子清理旧作答。 */
  async function saveQuizQuestions(questions: EditableQuizQuestion[]) {
    if (scene.type !== "quiz") throw new Error("当前场景不是测验");
    const response = await fetch(`/api/courses/${course.id}/scenes/${scene.outlineId}/quiz`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: course.revision, confirmQuizAttemptDeletion: true, questions }),
    });
    const payload = await response.json() as { data?: { course: Course }; error?: { code?: string; message?: string; requestId?: string } };
    if (!response.ok || !payload.data?.course) {
      throw new Error(`${payload.error?.code ?? "QUIZ_EDIT_FAILED"}：${payload.error?.message ?? "题目保存失败"}${payload.error?.requestId ? `（请求 ${payload.error.requestId}）` : ""}`);
    }
    setQuizEditorOpen(false);
    window.location.reload();
  }

  useEffect(() => {
    // 3. 页面加载后再读取浏览器是否支持语音。
    const timeout = window.setTimeout(() => {
      const supported = isBrowserSpeechAvailable();
      setBrowserSpeechSupported(supported);
      setBrowserSpeechEnabled(supported && window.localStorage.getItem(SPEECH_PREFERENCE_KEY) === "on");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    // 4. 当前场景播放完成后，连续播放模式自动切到下一场。
    if (playback.state.status !== "completed" || !continuousPlay) return;
    if (sceneIndex >= course.scenes.length - 1) {
      const timeout = window.setTimeout(() => setContinuousPlay(false), 0);
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(() => setSceneIndex((current) => current + 1), 650);
    return () => window.clearTimeout(timeout);
  }, [continuousPlay, course.scenes.length, playback.state.status, sceneIndex]);

  /** 手工切页会停止连续播放，旧 Action 由 controller 在 scene 变化时取消。 */
  function moveTo(index: number) {
    // 5. 手动切页时，停止连续播放。
    setContinuousPlay(false);
    setSceneIndex(Math.max(0, Math.min(course.scenes.length - 1, index)));
  }

  function toggleBrowserSpeech() {
    const next = !browserSpeechEnabled;
    setBrowserSpeechEnabled(next);
    window.localStorage.setItem(SPEECH_PREFERENCE_KEY, next ? "on" : "off");
  }

  /** 只提交题目和选择项；正确答案由服务端从当前 Course 读取并计算。 */
  async function submitQuiz(questionId: string, selectedOptionIds: string[]) {
    // 6. 把用户选择的选项发送给服务端判分并保存。
    const response = await fetch(`/api/courses/${course.id}/quiz-attempts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneId: scene.id, questionId, selectedOptionIds }),
    });
    const payload = await response.json() as { attempt?: { correct: boolean }; error?: { message?: string } };
    // 7. 保存成功后，把服务端判分结果交给测验组件。
    if (!response.ok || !payload.attempt) throw new Error(payload.error?.message ?? "作答记录保存失败，请重试");
    return { correct: payload.attempt.correct };
  }

  function primaryControl() {
    if (playback.state.status === "playing") return <button className="runtime-primary" type="button" onClick={playback.pause}><span>Ⅱ</span>暂停讲解</button>;
    if (playback.state.status === "paused") return <button className="runtime-primary" type="button" onClick={playback.resume}><span>▶</span>继续讲解</button>;
    if (playback.state.status === "completed") return <button className="runtime-primary" type="button" onClick={() => { setContinuousPlay(false); playback.replay(); }}><span>↻</span>重新播放</button>;
    if (playback.state.status === "awaitingLearner") return <div className="runtime-wait"><i />{scene.type === "interactive" ? "请完成当前互动" : "请完成当前测验"}</div>;
    return <button className="runtime-primary" type="button" onClick={() => { setContinuousPlay(true); playback.play(); }}><span>▶</span>开始课堂</button>;
  }

  return (
    <main className="classroom-shell">
      <header className="classroom-header">
        <Link className="brand brand--inverse" href="/"><span className="brand-mark">课</span><span><strong>课序</strong><small>CLASSROOM</small></span></Link>
        <div className="classroom-course"><span>{course.title}</span><small>REV.{course.revision} · {(course.scenes[0]?.generation.provider ?? "unknown").toUpperCase()}{isPartialPreview ? " · PARTIAL PREVIEW" : ""}</small></div>
        <div className="classroom-actions">
          <ExportButton course={course} />
          <Link className="exit-link" href={`/generation/${course.id}`}>退出课堂</Link>
        </div>
      </header>

      <div className="classroom-progress"><i style={{ width: `${courseProgress}%` }} /></div>

      <div className="classroom-layout">
        <nav className="scene-rail" aria-label="课程场景">
          <p>SCENES</p>
          {course.scenes.map((item, index) => (
            <button className={index === sceneIndex ? "is-active" : index < sceneIndex ? "is-passed" : ""} type="button" key={item.id} onClick={() => moveTo(index)} aria-label={`打开场景 ${item.order}：${item.title}`}>
              <span>{String(item.order).padStart(2, "0")}</span><i /><small>{item.type === "quiz" ? "测验" : item.type === "interactive" ? "互动" : "讲解"}</small>
            </button>
          ))}
        </nav>

        <section className={`classroom-stage${scene.type === "slide" ? " classroom-stage--slide" : scene.type === "interactive" ? " classroom-stage--interactive" : ""}`}>
          {isPartialPreview ? (
            <div className="partial-course-notice" role="status">
              <div><span>PARTIAL COURSE PREVIEW</span><strong>已生成 {course.scenes.length} / {course.requestedSceneCount} 个场景</strong></div>
              <p>这里只显示已经校验并保存成功的场景；失败或待生成项仍需返回生成页处理。</p>
              <Link href={`/generation/${course.id}`}>返回生成页 →</Link>
            </div>
          ) : null}
          {scene.type === "slide" ? (
            <div className="scene-slide-meta" aria-label={`当前场景：${scene.title}`}>
              <span>SLIDE · SCENE {String(scene.order).padStart(2, "0")}</span>
              <span>{String(scene.order).padStart(2, "0")} / {String(course.requestedSceneCount).padStart(2, "0")}</span>
            </div>
          ) : (
            <div className="scene-heading"><div><p className="eyebrow">{scene.type.toUpperCase()} · SCENE {String(scene.order).padStart(2, "0")}</p><h1>{scene.title}</h1></div><span>{String(scene.order).padStart(2, "0")} / {String(course.requestedSceneCount).padStart(2, "0")}</span></div>
          )}
          <SceneRenderer
            scene={scene}
            quizSessionId={playback.state.runId}
            onQuizSubmit={submitQuiz}
            onQuizCompleted={playback.completeLearner}
            onInteractiveCompleted={playback.completeLearner}
            onInteractiveRegenerate={(runtimeError) => replaceScene("regenerate", { runtimeError })}
            onCancelRegeneration={() => regenerationRequest.current?.abort()}
          />
        </section>

        <aside className="narration-panel">
          <div className="runtime-heading"><div><p className="eyebrow">ACTION RUNTIME</p><h2>课堂调度台</h2></div><span className={`runtime-lamp runtime-lamp--${playback.state.status}`} aria-hidden="true" /></div>
          <div className="runtime-status" aria-live="polite"><span>{statusLabels[playback.state.status]}</span><small>ACTION {Math.min(playback.state.actionIndex + 1, playback.state.actionCount)} / {playback.state.actionCount}</small></div>
          {primaryControl()}
          <div className="runtime-track"><i style={{ width: `${playback.progress}%` }} /></div>
          <blockquote tabIndex={0} aria-label="当前场景讲解文本，可上下滚动">{speech?.type === "speech" ? speech.text : "当前场景没有讲解动作。"}</blockquote>
          <div className="speech-switch">
            <div><span>浏览器朗读</span><small>{browserSpeechSupported ? "可选增强 · 失败自动回退文本" : "当前浏览器不支持，使用文本计时"}</small></div>
            <button type="button" role="switch" aria-checked={browserSpeechEnabled} disabled={!browserSpeechSupported} className={browserSpeechEnabled ? "is-on" : ""} onClick={toggleBrowserSpeech}><i /></button>
          </div>
          <button className={`scene-regenerate-toggle${regenerating ? " is-running" : ""}`} type="button" disabled={regenerating} onClick={() => {
            setManualRegenerationError(null);
            setQuizDeletionConfirmed(false);
            setRegenerationOpen(true);
          }}>{regenerating ? <><i className="scene-regenerate-spinner" aria-hidden="true" /><strong>后台{replacementMode === "revise" ? "修订" : "重生成"}中 · {String(Math.floor(regenerationElapsedSeconds / 60)).padStart(2, "0")}:{String(regenerationElapsedSeconds % 60).padStart(2, "0")}</strong></> : <><span>↻</span>修订本场</>}</button>
          {scene.type === "quiz" ? <button className="scene-quiz-edit-toggle" type="button" disabled={regenerating} onClick={() => setQuizEditorOpen(true)}><span>✎</span>手动调整题目</button> : null}
          {regenerating ? <p className="scene-regenerate-status" role="status">课程仍可浏览；完成后将自动刷新。</p> : null}
          {!regenerating && manualRegenerationError ? <p className="scene-regenerate-status is-error" role="alert">{manualRegenerationError}</p> : null}
          <div className="runtime-note"><span>PLAYBACK POLICY</span><strong>{continuousPlay ? "连续播放已开启" : "手动场景导航"}</strong><p>切换场景会取消旧语音与计时器；测验提交或互动场景完成后，播放器才会结束学习者等待。</p></div>
        </aside>
      </div>

      {regenerationOpen ? (
        <div className="scene-regeneration-backdrop" role="presentation">
          <section className="scene-regeneration-dialog" role="dialog" aria-modal="true" aria-labelledby="scene-regeneration-title">
            <header><div><p className="eyebrow">SCENE REVISION · {scene.type.toUpperCase()}</p><h2 id="scene-regeneration-title">修订本场</h2></div><button type="button" aria-label="关闭修订面板" disabled={regenerating} onClick={() => setRegenerationOpen(false)}>×</button></header>
            <p>新内容完整生成并保存成功后才会替换当前场景；失败、取消或版本冲突都会保留原内容。</p>
            <form onSubmit={submitManualRegeneration}>
              <label htmlFor="scene-regeneration-instruction">修改意见 <small>必填 · 最多 500 字</small></label>
              <textarea id="scene-regeneration-instruction" maxLength={500} value={regenerationInstruction} disabled={regenerating} onChange={(event) => setRegenerationInstruction(event.target.value)} placeholder="例如：减少文字，增加一个贴近实际开发的案例，并突出关键结论。" />
              <div className="scene-regeneration-count">{regenerationInstruction.length} / 500</div>
              {scene.type === "quiz" ? (
                <label className="scene-regeneration-confirm"><input type="checkbox" checked={quizDeletionConfirmed} disabled={regenerating} onChange={(event) => setQuizDeletionConfirmed(event.target.checked)} /><span><strong>确认清理本场旧作答记录</strong><small>新测验的问题和选项会使用新的 ID，旧作答不能继续对应。</small></span></label>
              ) : null}
              {manualRegenerationError ? <p className="scene-regeneration-error" role="alert">{manualRegenerationError}</p> : null}
              <footer><button type="button" disabled={regenerating} onClick={() => setRegenerationOpen(false)}>保留原场景</button><button type="submit" disabled={regenerating || !regenerationInstruction.trim() || (scene.type === "quiz" && !quizDeletionConfirmed)}>{regenerating ? "正在修订…" : "确认修订"}</button></footer>
            </form>
          </section>
        </div>
      ) : null}

      {quizEditorOpen && scene.type === "quiz" ? <QuizEditDialog scene={scene} onClose={() => setQuizEditorOpen(false)} onSave={saveQuizQuestions} /> : null}

      <footer className="classroom-controls">
        <button className="control-button" type="button" disabled={sceneIndex === 0} onClick={() => moveTo(sceneIndex - 1)}>← <span>上一场景</span></button>
        <div className="control-center"><span className="control-index">{String(scene.order).padStart(2, "0")}</span><span className="control-divider" /><span>{statusLabels[playback.state.status]}</span></div>
        <button className="control-button" type="button" disabled={sceneIndex === course.scenes.length - 1} onClick={() => moveTo(sceneIndex + 1)}><span>下一场景</span> →</button>
      </footer>
    </main>
  );
}
