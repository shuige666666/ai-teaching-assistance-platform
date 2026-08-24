"use client";

import Link from "next/link";
import { useState } from "react";
import { SceneRenderer } from "@/components/renderers/scene-renderer";
import type { Course } from "@/lib/domain/schemas";

export function ClassroomWorkspace({ course }: { course: Course }) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const scene = course.scenes[sceneIndex];
  const speech = scene.actions.find((action) => action.type === "speech");
  const progress = ((sceneIndex + 1) / course.scenes.length) * 100;

  /** 切页时只更新当前场景游标；自动 Action 播放将在 M5 独立实现。 */
  function moveTo(index: number) {
    setSceneIndex(Math.max(0, Math.min(course.scenes.length - 1, index)));
  }

  return (
    <main className="classroom-shell">
      <header className="classroom-header">
        <Link className="brand brand--inverse" href="/"><span className="brand-mark">课</span><span><strong>课序</strong><small>CLASSROOM</small></span></Link>
        <div className="classroom-course"><span>{course.title}</span><small>REV.{course.revision} · {(course.scenes[0]?.generation.provider ?? "unknown").toUpperCase()}</small></div>
        <Link className="exit-link" href={`/generation/${course.id}`}>退出课堂</Link>
      </header>

      <div className="classroom-progress"><i style={{ width: `${progress}%` }} /></div>

      <div className="classroom-layout">
        <nav className="scene-rail" aria-label="课程场景">
          <p>SCENES</p>
          {course.scenes.map((item, index) => (
            <button className={index === sceneIndex ? "is-active" : ""} type="button" key={item.id} onClick={() => moveTo(index)} aria-label={`打开场景 ${index + 1}：${item.title}`}>
              <span>{String(index + 1).padStart(2, "0")}</span><i /><small>{item.type === "quiz" ? "测验" : "讲解"}</small>
            </button>
          ))}
        </nav>

        <section className="classroom-stage">
          <div className="scene-heading"><div><p className="eyebrow">{scene.type.toUpperCase()} · SCENE {String(sceneIndex + 1).padStart(2, "0")}</p><h1>{scene.title}</h1></div><span>{String(sceneIndex + 1).padStart(2, "0")} / {String(course.scenes.length).padStart(2, "0")}</span></div>
          <SceneRenderer scene={scene} />
        </section>

        <aside className="narration-panel">
          <div><p className="eyebrow">NARRATION</p><h2>讲解稿</h2></div>
          <blockquote>{speech?.type === "speech" ? speech.text : "当前场景没有讲解动作。"}</blockquote>
          <div className="runtime-note"><span>播放器状态</span><strong>手动翻页 / M5 待实现</strong><p>Action 自动播放、暂停与语音适配器将在 M5 接入。</p></div>
        </aside>
      </div>

      <footer className="classroom-controls">
        <button className="control-button" type="button" disabled={sceneIndex === 0} onClick={() => moveTo(sceneIndex - 1)}>← <span>上一场景</span></button>
        <div className="control-center"><span className="control-index">{String(sceneIndex + 1).padStart(2, "0")}</span><span className="control-divider" /><span>{scene.type === "quiz" ? "完成测验后继续" : "阅读本场景内容"}</span></div>
        <button className="control-button" type="button" disabled={sceneIndex === course.scenes.length - 1} onClick={() => moveTo(sceneIndex + 1)}><span>下一场景</span> →</button>
      </footer>
    </main>
  );
}
