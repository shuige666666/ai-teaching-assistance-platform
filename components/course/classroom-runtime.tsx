"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CourseAgentDrawer } from "@/components/agent/course-agent-drawer";
import { QuizEditDialog } from "@/components/course/quiz-edit-dialog";
import { ExportButton } from "@/components/export/export-button";
import { SceneRenderer } from "@/components/renderers/scene-renderer";
import { SceneMaterialSources } from "./scene-material-sources";
import type { EditableQuizQuestion } from "@/lib/domain/quiz-edit";
import type { Course } from "@/lib/domain/schemas";
import { isBrowserSpeechAvailable } from "@/lib/playback/speech-adapters";
import { usePlaybackController } from "@/lib/playback/use-playback-controller";
import type { AgentCourseUpdate } from "@/lib/agent/contracts";

const SPEECH_PREFERENCE_KEY = "ai-teaching-browser-speech";
const AGENT_DRAWER_WIDTH_KEY = "ai-teaching-agent-drawer-width";
const DEFAULT_AGENT_DRAWER_WIDTH = 470;
const NARRATION_PANEL_WIDTH_KEY = "ai-teaching-narration-panel-width";
const DEFAULT_NARRATION_PANEL_WIDTH = 290;
const MIN_NARRATION_PANEL_WIDTH = 250;
const MAX_NARRATION_PANEL_WIDTH = 800;

const statusLabels = {
  idle: "准备就绪",
  playing: "正在讲解",
  paused: "已暂停",
  awaitingLearner: "等待学习者",
  completed: "本场景完成",
} as const;

export function ClassroomRuntime({ course: initialCourse }: { course: Course }) {
  const [course, setCourse] = useState(initialCourse);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentDraft, setAgentDraft] = useState("");
  const [agentDrawerWidth, setAgentDrawerWidth] = useState(DEFAULT_AGENT_DRAWER_WIDTH);
  const agentDrawerWidthLoaded = useRef(false);
  const [narrationPanelWidth, setNarrationPanelWidth] = useState(DEFAULT_NARRATION_PANEL_WIDTH);
  const narrationPanelWidthLoaded = useRef(false);
  const narrationResize = useRef<{ pointerId: number; startX: number; startWidth: number; cursor: string; userSelect: string } | null>(null);
  const [regenerating, setRegenerating] = useState(false);
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

  // 侧栏宽度只属于当前浏览器的工作区偏好，不写入课程或会话数据。
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(AGENT_DRAWER_WIDTH_KEY));
    const restore = window.setTimeout(() => {
      if (Number.isFinite(stored) && stored >= 360 && stored <= 680) setAgentDrawerWidth(stored);
      agentDrawerWidthLoaded.current = true;
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);
  useEffect(() => {
    if (agentDrawerWidthLoaded.current) window.localStorage.setItem(AGENT_DRAWER_WIDTH_KEY, String(agentDrawerWidth));
  }, [agentDrawerWidth]);

  // 调度台宽度保存在当前浏览器，刷新或重新进入课堂后继续沿用。
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(NARRATION_PANEL_WIDTH_KEY));
    const restore = window.setTimeout(() => {
      if (Number.isFinite(stored) && stored >= MIN_NARRATION_PANEL_WIDTH && stored <= MAX_NARRATION_PANEL_WIDTH) setNarrationPanelWidth(stored);
      narrationPanelWidthLoaded.current = true;
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);
  useEffect(() => {
    if (narrationPanelWidthLoaded.current) window.localStorage.setItem(NARRATION_PANEL_WIDTH_KEY, String(narrationPanelWidth));
  }, [narrationPanelWidth]);

  /** 调整右侧调度台宽度时，为中间课堂画面保留基本可读空间。 */
  function clampNarrationPanelWidth(width: number) {
    const agentInset = agentOpen && window.innerWidth >= 1280 ? Math.min(agentDrawerWidth, Math.max(0, window.innerWidth - 720)) : 0;
    const availableMaximum = Math.max(MIN_NARRATION_PANEL_WIDTH, window.innerWidth - agentInset - 720);
    return Math.round(Math.min(MAX_NARRATION_PANEL_WIDTH, availableMaximum, Math.max(MIN_NARRATION_PANEL_WIDTH, width)));
  }

  function beginNarrationResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (window.innerWidth <= 1080) return;
    narrationResize.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: narrationPanelWidth,
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function resizeNarrationPanel(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = narrationResize.current;
    if (!active || active.pointerId !== event.pointerId) return;
    setNarrationPanelWidth(clampNarrationPanelWidth(active.startWidth + active.startX - event.clientX));
  }

  function finishNarrationResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = narrationResize.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.style.cursor = active.cursor;
    document.body.style.userSelect = active.userSelect;
    narrationResize.current = null;
  }

  function resizeNarrationWithKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setNarrationPanelWidth((current) => clampNarrationPanelWidth(current + (event.key === "ArrowLeft" ? 16 : -16)));
  }

  /** 两个外部入口共用等待与刷新反馈，但只向对应接口提交其所需字段。 */
  async function replaceScene(mode: "revise" | "regenerate", options: { instruction?: string; runtimeError?: string; confirmQuizAttemptDeletion?: boolean }) {
    if (regenerationRequest.current) return;
    const controller = new AbortController();
    regenerationRequest.current = controller;
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

  /** 根据稳定 sceneId 响应 Agent 侧栏的场景导航，不让侧栏复制一份页序状态。 */
  function moveToSceneId(sceneId: string) {
    const index = course.scenes.findIndex((item) => item.id === sceneId);
    if (index >= 0) moveTo(index);
  }

  function toggleBrowserSpeech() {
    const next = !browserSpeechEnabled;
    setBrowserSpeechEnabled(next);
    window.localStorage.setItem(SPEECH_PREFERENCE_KEY, next ? "on" : "off");
  }

  /** Agent 保存课程后按稳定 sceneId 刷新数据，避免页序或局部状态造成跳页。 */
  async function refreshCourseAfterAgent(update: AgentCourseUpdate) {
    setContinuousPlay(false);
    playback.pause();
    const previousScene = course.scenes[sceneIndex];
    const previousIndex = sceneIndex;
    const response = await fetch(`/api/courses/${course.id}`, { cache: "no-store" });
    const payload = await response.json() as { course?: Course; error?: { message?: string } };
    if (!response.ok || !payload.course) throw new Error(payload.error?.message ?? "课程已保存，但课堂刷新失败");
    const replacement = previousScene && update.sceneReplacements?.find((item) => item.oldSceneId === previousScene.id);
    const preferredId = replacement?.newSceneId ?? (previousScene && !update.removedSceneIds?.includes(previousScene.id) ? previousScene.id : undefined);
    const nextIndex = preferredId ? payload.course.scenes.findIndex((item) => item.id === preferredId) : -1;
    setCourse(payload.course);
    // 当前页仍存在时保持原页；被替换时跟随稳定 outlineId；被删除时落到原位置附近。
    if (nextIndex >= 0) setSceneIndex(nextIndex);
    else if (replacement) {
      const outlineIndex = payload.course.scenes.findIndex((item) => item.outlineId === replacement.outlineId);
      setSceneIndex(outlineIndex >= 0 ? outlineIndex : Math.min(previousIndex, payload.course.scenes.length - 1));
    } else setSceneIndex(Math.min(previousIndex, Math.max(0, payload.course.scenes.length - 1)));
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
    <main
      className={`classroom-shell${agentOpen ? " classroom-shell--agent-open" : ""}`}
      style={{ "--agent-drawer-width": `${agentDrawerWidth}px`, "--narration-panel-width": `${narrationPanelWidth}px` } as CSSProperties}
    >
      <header className="classroom-header">
        <Link className="brand brand--inverse" href="/"><span className="brand-mark">课</span><span><strong>课序</strong><small>CLASSROOM</small></span></Link>
        <div className="classroom-course"><span>{course.title}</span><small>REV.{course.revision} · {(course.scenes[0]?.generation.provider ?? "unknown").toUpperCase()}{isPartialPreview ? " · PARTIAL PREVIEW" : ""}</small></div>
        <div className="classroom-actions">
          <button
            className={`classroom-agent-switch${agentOpen ? " is-active" : ""}`}
            type="button"
            role="switch"
            aria-checked={agentOpen}
            aria-label="智能修订"
            onClick={() => setAgentOpen((current) => !current)}
          >
            <span className="classroom-agent-switch__label">智能修订</span>
            <span className="classroom-agent-switch__track" aria-hidden="true"><i /></span>
          </button>
          <SceneMaterialSources key={scene.id} scene={scene} />
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
          <button
            className="narration-panel-resize"
            type="button"
            aria-label="调整课堂调度台宽度"
            title="拖动调整调度台宽度，双击恢复默认宽度"
            onDoubleClick={() => setNarrationPanelWidth(DEFAULT_NARRATION_PANEL_WIDTH)}
            onKeyDown={resizeNarrationWithKeyboard}
            onPointerDown={beginNarrationResize}
            onPointerMove={resizeNarrationPanel}
            onPointerUp={finishNarrationResize}
            onPointerCancel={finishNarrationResize}
          />
          <div className="runtime-heading"><div><p className="eyebrow">ACTION RUNTIME</p><h2>课堂调度台</h2></div><span className={`runtime-lamp runtime-lamp--${playback.state.status}`} aria-hidden="true" /></div>
          <div className="runtime-status" aria-live="polite"><span>{statusLabels[playback.state.status]}</span><small>ACTION {Math.min(playback.state.actionIndex + 1, playback.state.actionCount)} / {playback.state.actionCount}</small></div>
          {primaryControl()}
          <div className="runtime-track"><i style={{ width: `${playback.progress}%` }} /></div>
          <blockquote tabIndex={0} aria-label="当前场景讲解文本，可上下滚动">{speech?.type === "speech" ? speech.text : "当前场景没有讲解动作。"}</blockquote>
          <div className="speech-switch">
            <div><span>浏览器朗读</span><small>{browserSpeechSupported ? "可选增强 · 失败自动回退文本" : "当前浏览器不支持，使用文本计时"}</small></div>
            <button type="button" role="switch" aria-checked={browserSpeechEnabled} disabled={!browserSpeechSupported} className={browserSpeechEnabled ? "is-on" : ""} onClick={toggleBrowserSpeech}><i /></button>
          </div>
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

      <CourseAgentDrawer
        open={agentOpen}
        courseId={course.id}
        courseTitle={course.title}
        courseRevision={course.revision}
        currentSceneId={scene.id}
        scenes={course.scenes.map(({ id, order, title, type }) => ({ id, order, title, type }))}
        onSceneSelect={moveToSceneId}
        drawerWidth={agentDrawerWidth}
        onDrawerWidthChange={setAgentDrawerWidth}
        initialDraft={agentDraft}
        onDraftChange={setAgentDraft}
        onClose={() => setAgentOpen(false)}
        onCourseUpdated={refreshCourseAfterAgent}
      />

      <footer className="classroom-controls">
        <button className="control-button" type="button" disabled={sceneIndex === 0} onClick={() => moveTo(sceneIndex - 1)}>← <span>上一场景</span></button>
        <div className="control-center"><span className="control-index">{String(scene.order).padStart(2, "0")}</span><span className="control-divider" /><span>{statusLabels[playback.state.status]}</span></div>
        <button className="control-button" type="button" disabled={sceneIndex === course.scenes.length - 1} onClick={() => moveTo(sceneIndex + 1)}><span>下一场景</span> →</button>
      </footer>
    </main>
  );
}
