"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Course, SceneOutline } from "@/lib/domain/schemas";

function errorMessage(payload: { error?: { message?: string }; message?: string }, fallback: string) {
  return payload.error?.message ?? payload.message ?? fallback;
}

export function GenerationWorkspace({ initialCourse }: { initialCourse: Course }) {
  const router = useRouter();
  const [course, setCourse] = useState(initialCourse);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  function updateOutline(index: number, changes: Partial<SceneOutline>) {
    setCourse((current) => ({ ...current, outlines: current.outlines.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item) }));
    setDirty(true);
    setSavedNotice(null);
  }

  /** 请求服务端正式大纲管线；主题、场景数量和 Provider 均不由浏览器覆盖。 */
  async function generateCourseOutline() {
    setBusy("outline");
    setError(null);
    setSavedNotice(null);
    try {
      const response = await fetch(`/api/courses/${course.id}/outline/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: course.revision }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "大纲生成失败"));
      setCourse(payload.data.course);
      setDirty(false);
      setSavedNotice("大纲已通过解析、Schema 与语义门，并保存到 MySQL。现在可以人工修订。");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "大纲生成失败");
      // 生成失败也会由服务端提交 failed 与新 revision，立即同步避免重试使用旧版本。
      const latestResponse = await fetch(`/api/courses/${course.id}`);
      if (latestResponse.ok) setCourse((await latestResponse.json()).course);
    } finally {
      setBusy(null);
    }
  }

  /** 将人工修订后的完整大纲交回服务端复验并按 revision 保存。 */
  async function persistOutline(): Promise<Course> {
    const response = await fetch(`/api/courses/${course.id}/outline`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: course.revision, courseTitle: course.title, outlines: course.outlines }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(errorMessage(payload, "大纲保存失败"));
    setCourse(payload.data.course);
    setDirty(false);
    return payload.data.course;
  }

  async function saveOutline() {
    setBusy("save");
    setError(null);
    try {
      await persistOutline();
      setSavedNotice("人工修订已保存，并重新通过课程级语义校验。");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "大纲保存失败");
    } finally {
      setBusy(null);
    }
  }

  async function loadLatestCourse(): Promise<Course> {
    const response = await fetch(`/api/courses/${course.id}`);
    if (!response.ok) throw new Error("无法同步服务器中的最新课程状态");
    const latest = (await response.json()).course as Course;
    setCourse(latest);
    return latest;
  }

  /** 生成一个指定场景；失败后立即读取服务端提交的 failed 进度和新 revision。 */
  async function generateOneScene(current: Course, outlineId: string): Promise<{ course: Course; failed: boolean }> {
    setCourse({
      ...current,
      status: "generating",
      sceneProgress: current.sceneProgress.map((item) => item.outlineId === outlineId ? { ...item, status: "generating" } : item),
    });
    try {
      const response = await fetch(`/api/courses/${current.id}/scenes/${outlineId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: current.revision }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "场景生成失败"));
      const saved = payload.data.course as Course;
      setCourse(saved);
      return { course: saved, failed: false };
    } catch (caught) {
      const latest = await loadLatestCourse();
      const outline = latest.outlines.find((item) => item.id === outlineId);
      setError((currentError) => [currentError, `${outline?.title ?? "场景"}：${caught instanceof Error ? caught.message : "生成失败"}`].filter(Boolean).join("\n"));
      return { course: latest, failed: true };
    }
  }

  /** 严格串行生成 pending 场景；某一项失败后仍继续后面的未生成项。 */
  async function generatePendingScenes(startCourse: Course) {
    let current = startCourse;
    let failureCount = 0;
    for (const outline of current.outlines) {
      const progress = current.sceneProgress.find((item) => item.outlineId === outline.id);
      if (progress?.status !== "pending") continue;
      const result = await generateOneScene(current, outline.id);
      current = result.course;
      if (result.failed) failureCount += 1;
    }
    setCourse(current);
    setSavedNotice(failureCount === 0 && current.status === "ready" ? "全部场景均已通过模型边界并增量保存，可以进入课堂。" : null);
    router.refresh();
  }

  /** 确认前先保存编辑稿，再按大纲顺序逐场景调用正式生成接口。 */
  async function confirmAndGenerateScenes() {
    setBusy("scenes");
    setError(null);
    try {
      const saved = dirty ? await persistOutline() : course;
      await generatePendingScenes(saved);
      setDirty(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "场景生成失败");
    } finally {
      setBusy(null);
    }
  }

  async function continuePendingScenes() {
    setBusy("scenes");
    setError(null);
    try { await generatePendingScenes(course); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "继续生成失败"); }
    finally { setBusy(null); }
  }

  async function retryScene(outlineId: string) {
    setBusy(`scene:${outlineId}`);
    setError(null);
    try {
      const result = await generateOneScene(course, outlineId);
      if (!result.failed && result.course.status === "ready") setSavedNotice("失败场景已修复，整门课程现在可以进入课堂。");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const readyCount = course.sceneProgress.filter((item) => item.status === "ready").length;
  const editable = course.status === "outline_ready";
  const metadata = course.outlineGeneration;
  const pendingCount = course.sceneProgress.filter((item) => item.status === "pending").length;

  return (
    <main className="workspace-shell">
      <header className="site-header site-header--compact">
        <Link className="brand" href="/"><span className="brand-mark">课</span><span><strong>课序</strong><small>COURSE COMPOSER</small></span></Link>
        <div className="step-nav"><span className="is-done">01 主题</span><span className="is-active">02 大纲</span><span>03 课堂</span></div>
      </header>

      <section className="workspace-title reveal reveal--one">
        <div><p className="eyebrow">OUTLINE STUDIO / REV.{course.revision}</p><h1>{course.title}</h1><p>{course.topic} · {course.requestedSceneCount} 个教学场景 · {metadata ? `${metadata.provider} / ${metadata.model}` : "等待生成"}</p></div>
        <span className={`large-state large-state--${course.status}`}>{course.status === "ready" ? "READY" : course.status === "partial_failed" ? "REPAIR" : course.status === "generating" ? "BUILD" : course.status === "draft" || course.status === "failed" ? "DRAFT" : "REVIEW"}</span>
      </section>

      <div className="generation-layout">
        <section className="outline-panel reveal reveal--two">
          <div className="panel-heading"><div><span>COURSE MAP</span><h2>{editable ? "审核课程大纲" : "课程大纲"}</h2></div><p>{editable ? "修改标题、教学目标和关键点；保存时服务端会再次校验。" : "模型输出必须先通过不可信边界，才能进入这里。"}</p></div>

          {course.outlines.length === 0 ? (
            <div className="outline-empty"><span>00</span><div><h3>还没有课程骨架</h3><p>点击右侧按钮后，mock 或当前服务端 Provider 会生成结构化大纲。模型返回的 JSON 不会直接写入数据库。</p></div></div>
          ) : (
            <>
              <label className="course-title-editor"><span>课程标题</span><input value={course.title} disabled={!editable || busy !== null} onChange={(event) => { setCourse((current) => ({ ...current, title: event.target.value })); setDirty(true); setSavedNotice(null); }} /></label>
              <ol className="outline-list">
                {course.outlines.map((outline, index) => {
                  const progress = course.sceneProgress.find((item) => item.outlineId === outline.id);
                  const recoverable = progress?.status === "generating" && course.activeOperation?.outlineId === outline.id && course.activeOperation.expiresAt <= Date.now();
                  return (
                    <li key={outline.id}>
                      <span className="outline-order">{String(outline.order).padStart(2, "0")}</span>
                      <div className="outline-content outline-content--editable">
                        <div><span className={`type-chip type-chip--${outline.type}`}>{outline.type}</span><input className="outline-title-input" aria-label={`第 ${outline.order} 场标题`} value={outline.title} disabled={!editable || busy !== null} onChange={(event) => updateOutline(index, { title: event.target.value })} /></div>
                        <textarea aria-label={`第 ${outline.order} 场教学目标`} value={outline.teachingObjective} disabled={!editable || busy !== null} onChange={(event) => updateOutline(index, { teachingObjective: event.target.value })} />
                        <label><span>关键点（每行一项）</span><textarea value={outline.keyPoints.join("\n")} disabled={!editable || busy !== null} onChange={(event) => updateOutline(index, { keyPoints: event.target.value.split(/\r?\n/).map((point) => point.trim()).filter(Boolean) })} /></label>
                        {progress?.lastError ? <p className="scene-error-inline">{progress.lastError.code} · {progress.lastError.message}</p> : null}
                      </div>
                      <div className="scene-progress-cell">
                        <span className={`progress-mark progress-mark--${progress?.status}`}>{progress?.status === "ready" ? "✓" : progress?.status === "failed" ? "!" : progress?.status === "generating" ? "…" : "○"}</span>
                        <small>{progress?.status === "ready" ? "完成" : progress?.status === "failed" ? "失败" : recoverable ? "可恢复" : progress?.status === "generating" ? "生成中" : "待生成"}</small>
                        {progress?.status === "failed" || recoverable ? <button type="button" onClick={() => retryScene(outline.id)} disabled={busy !== null}>{busy === `scene:${outline.id}` ? "处理中" : recoverable ? "恢复" : "重试"}</button> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>

        <aside className="generation-aside reveal reveal--three">
          <div className="metric-card"><p>SCENE PROGRESS</p><strong>{String(readyCount).padStart(2, "0")}<span> / {String(course.requestedSceneCount).padStart(2, "0")}</span></strong><div className="progress-track"><i style={{ width: `${(readyCount / course.requestedSceneCount) * 100}%` }} /></div></div>
          <div className="boundary-card"><span>M4 SCENE PIPELINE</span><h3>{readyCount > 0 ? `${String(readyCount).padStart(2, "0")} 个场景已独立提交` : metadata ? `${metadata.provider.toUpperCase()} · 大纲已就绪` : "先登记，再调用，后提交"}</h3><p>{course.status === "partial_failed" ? "已完成场景仍安全保留。请在对应大纲右侧重试失败项，pending 场景可继续串行生成。" : "每个 slide / quiz 都独立经过解析、Schema、语义门和短事务；模型不能提供 ID、Action 或答案 ID。"}</p></div>
          {savedNotice ? <p className="form-success" role="status">{savedNotice}</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {course.status === "ready" ? (
            <Link className="button button--accent button--wide" href={`/classroom/${course.id}`}>进入课堂 <span>→</span></Link>
          ) : editable ? (
            <><button className="button button--dark button--wide" type="button" onClick={saveOutline} disabled={busy !== null || !dirty}>{busy === "save" ? "正在校验保存…" : dirty ? "保存修订" : "修订已保存"}<span>↗</span></button><button className="button button--accent button--wide" type="button" onClick={confirmAndGenerateScenes} disabled={busy !== null}>{busy === "scenes" ? `正在生成 ${readyCount + 1} / ${course.requestedSceneCount}…` : "确认大纲并生成场景"}<span>→</span></button></>
          ) : ["generating", "partial_failed"].includes(course.status) ? (
            course.activeOperation ? <p className="generation-hint">存在登记中的场景操作。租约到期后，可在对应场景右侧点击“恢复”。</p> : pendingCount > 0 ? <button className="button button--accent button--wide" type="button" onClick={continuePendingScenes} disabled={busy !== null}>{busy === "scenes" ? `正在生成 ${readyCount + 1} / ${course.requestedSceneCount}…` : `继续生成 ${pendingCount} 个待处理场景`}<span>→</span></button> : <p className="generation-hint">没有待生成项，请在失败场景右侧点击“重试”。</p>
          ) : (
            <button className="button button--accent button--wide" type="button" onClick={generateCourseOutline} disabled={busy !== null || course.status === "outlining"}>{busy === "outline" || course.status === "outlining" ? "正在生成并校验…" : course.status === "failed" ? "重试大纲生成" : "生成课程大纲"}<span>→</span></button>
          )}
          <Link className="text-link" href="/">← 返回课程首页</Link>
        </aside>
      </div>
    </main>
  );
}
