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
  awaitingLearner: "等待作答",
  completed: "本场景完成",
} as const;

export function ClassroomRuntime({ course }: { course: Course }) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [continuousPlay, setContinuousPlay] = useState(false);
  const [browserSpeechEnabled, setBrowserSpeechEnabled] = useState(false);
  const [browserSpeechSupported, setBrowserSpeechSupported] = useState(false);
  const scene = course.scenes[sceneIndex];
  const playback = usePlaybackController(scene, browserSpeechEnabled, continuousPlay);
  const speech = scene.actions.find((action) => action.type === "speech");
  const courseProgress = ((sceneIndex + playback.progress / 100) / course.scenes.length) * 100;

  useEffect(() => {
    // localStorage 与浏览器能力只在挂载后读取，避免服务端渲染访问 window。
    const timeout = window.setTimeout(() => {
      const supported = isBrowserSpeechAvailable();
      setBrowserSpeechSupported(supported);
      setBrowserSpeechEnabled(supported && window.localStorage.getItem(SPEECH_PREFERENCE_KEY) === "on");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
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
    const response = await fetch(`/api/courses/${course.id}/quiz-attempts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneId: scene.id, questionId, selectedOptionId }),
    });
    const payload = await response.json() as { attempt?: { correct: boolean }; error?: { message?: string } };
    if (!response.ok || !payload.attempt) throw new Error(payload.error?.message ?? "作答记录保存失败，请重试");
    return { correct: payload.attempt.correct };
  }

  function primaryControl() {
    if (playback.state.status === "playing") return <button className="runtime-primary" type="button" onClick={playback.pause}><span>Ⅱ</span>暂停讲解</button>;
    if (playback.state.status === "paused") return <button className="runtime-primary" type="button" onClick={playback.resume}><span>▶</span>继续讲解</button>;
    if (playback.state.status === "completed") return <button className="runtime-primary" type="button" onClick={() => { setContinuousPlay(false); playback.replay(); }}><span>↻</span>重新播放</button>;
    if (playback.state.status === "awaitingLearner") return <div className="runtime-wait"><i />请完成当前测验</div>;
    return <button className="runtime-primary" type="button" onClick={() => { setContinuousPlay(true); playback.play(); }}><span>▶</span>开始课堂</button>;
  }

  return (
    <main className="classroom-shell">
      <header className="classroom-header">
        <Link className="brand brand--inverse" href="/"><span className="brand-mark">课</span><span><strong>课序</strong><small>CLASSROOM</small></span></Link>
        <div className="classroom-course"><span>{course.title}</span><small>REV.{course.revision} · {(course.scenes[0]?.generation.provider ?? "unknown").toUpperCase()}</small></div>
        <Link className="exit-link" href={`/generation/${course.id}`}>退出课堂</Link>
      </header>

      <div className="classroom-progress"><i style={{ width: `${courseProgress}%` }} /></div>

      <div className="classroom-layout">
        <nav className="scene-rail" aria-label="课程场景">
          <p>SCENES</p>
          {course.scenes.map((item, index) => (
            <button className={index === sceneIndex ? "is-active" : index < sceneIndex ? "is-passed" : ""} type="button" key={item.id} onClick={() => moveTo(index)} aria-label={`打开场景 ${index + 1}：${item.title}`}>
              <span>{String(index + 1).padStart(2, "0")}</span><i /><small>{item.type === "quiz" ? "测验" : "讲解"}</small>
            </button>
          ))}
        </nav>

        <section className="classroom-stage">
          <div className="scene-heading"><div><p className="eyebrow">{scene.type.toUpperCase()} · SCENE {String(sceneIndex + 1).padStart(2, "0")}</p><h1>{scene.title}</h1></div><span>{String(sceneIndex + 1).padStart(2, "0")} / {String(course.scenes.length).padStart(2, "0")}</span></div>
          <SceneRenderer
            scene={scene}
            quizSessionId={playback.state.runId}
            onQuizSubmit={submitQuiz}
            onQuizCompleted={playback.completeLearner}
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
          <div className="runtime-note"><span>PLAYBACK POLICY</span><strong>{continuousPlay ? "连续播放已开启" : "手动场景导航"}</strong><p>切换场景会取消旧语音与计时器；测验可直接作答，全部提交成功后完成本场景。</p></div>
        </aside>
      </div>

      <footer className="classroom-controls">
        <button className="control-button" type="button" disabled={sceneIndex === 0} onClick={() => moveTo(sceneIndex - 1)}>← <span>上一场景</span></button>
        <div className="control-center"><span className="control-index">{String(sceneIndex + 1).padStart(2, "0")}</span><span className="control-divider" /><span>{statusLabels[playback.state.status]}</span></div>
        <button className="control-button" type="button" disabled={sceneIndex === course.scenes.length - 1} onClick={() => moveTo(sceneIndex + 1)}><span>下一场景</span> →</button>
      </footer>
    </main>
  );
}
