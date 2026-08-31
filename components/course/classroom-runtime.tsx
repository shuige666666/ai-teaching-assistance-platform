"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SceneRenderer } from "@/components/renderers/scene-renderer";
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

export function ClassroomRuntime({ course }: { course: Course }) {
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
  async function submitQuiz(questionId: string, selectedOptionId: string) {
    // 6. 把用户选择的选项发送给服务端判分并保存。
    const response = await fetch(`/api/courses/${course.id}/quiz-attempts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneId: scene.id, questionId, selectedOptionId }),
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
        <Link className="exit-link" href={`/generation/${course.id}`}>退出课堂</Link>
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
          <div className="runtime-note"><span>PLAYBACK POLICY</span><strong>{continuousPlay ? "连续播放已开启" : "手动场景导航"}</strong><p>切换场景会取消旧语音与计时器；测验提交或互动场景完成后，播放器才会结束学习者等待。</p></div>
        </aside>
      </div>

      <footer className="classroom-controls">
        <button className="control-button" type="button" disabled={sceneIndex === 0} onClick={() => moveTo(sceneIndex - 1)}>← <span>上一场景</span></button>
        <div className="control-center"><span className="control-index">{String(scene.order).padStart(2, "0")}</span><span className="control-divider" /><span>{statusLabels[playback.state.status]}</span></div>
        <button className="control-button" type="button" disabled={sceneIndex === course.scenes.length - 1} onClick={() => moveTo(sceneIndex + 1)}><span>下一场景</span> →</button>
      </footer>
    </main>
  );
}
