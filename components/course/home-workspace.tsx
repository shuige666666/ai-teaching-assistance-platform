"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import type { CourseSummary } from "@/lib/domain/schemas";

type CreationProgress = {
  phase: "saving" | "opening";
  requestId: string;
  startedAt: number;
};

function apiErrorMessage(payload: { error?: { message?: string } }, fallback: string) {
  return payload.error?.message ?? fallback;
}

const statusLabels: Record<CourseSummary["status"], string> = {
  draft: "草稿", outlining: "生成大纲", outline_ready: "大纲就绪", generating: "生成场景", partial_failed: "部分失败", ready: "可以上课", failed: "生成失败",
};

export function HomeWorkspace({ initialCourses, initialError = null }: { initialCourses: CourseSummary[]; initialError?: string | null }) {
  const router = useRouter();
  // 1. 状态
  const [topic, setTopic] = useState("TCP 拥塞控制");
  const [sceneCount, setSceneCount] = useState(4);
  const [submitting, setSubmitting] = useState(false);
  const [creationProgress, setCreationProgress] = useState<CreationProgress | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState(initialCourses);

  useEffect(() => {
    if (!creationProgress) return;
    const timer = window.setInterval(() => setElapsedMs(Date.now() - creationProgress.startedAt), 250);
    return () => window.clearInterval(timer);
  }, [creationProgress]);


  // 2. 业务逻辑
  /** 创建成功后只携带 courseId 跳转，生成页从仓储重新读取课程事实。 */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // 创建课程
    event.preventDefault();
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setSubmitting(true);
    setElapsedMs(0);
    setCreationProgress({ phase: "saving", requestId, startedAt });
    setError(null);
    try {
      const response = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-request-id": requestId },
        body: JSON.stringify({ topic, requestedSceneCount: sceneCount }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(payload, "创建课程失败"));
      setCreationProgress({ phase: "opening", requestId: payload.meta?.requestId ?? requestId, startedAt });
      // 开发模式的 RSC 客户端跳转可能长时间停留在 Rendering；完整导航可可靠进入服务端页面。
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/generation/${payload.course.id}`);
    } catch (caught) {
      const message = caught instanceof DOMException && caught.name === "AbortError"
        ? `保存课程超过 15 秒，已停止等待。请用请求编号 ${requestId} 检查终端日志，刷新后确认课程是否已经创建。`
        : caught instanceof Error ? caught.message : "创建课程失败";
      setError(message);
      setSubmitting(false);
      setCreationProgress(null);
    } finally {
      window.clearTimeout(timeout);
    }
  }


  /** 显式确认后删除课程；成功响应后再从当前列表移除。 */
  async function deleteCourse(course: CourseSummary) {
    // 删除课程
    if (!window.confirm(`确认删除“${course.title}”吗？该操作会同时删除相关测验记录。`)) return;
    setError(null);
    try {
      const response = await fetch(`/api/courses/${course.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(apiErrorMessage(payload, "删除课程失败"));
      }
      setCourses((current) => current.filter((item) => item.id !== course.id));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除课程失败");
    }
  }

  // 3. 页面 UI
  return (
    <main className="home-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="课序首页"><span className="brand-mark">课</span><span><strong>课序</strong><small>COURSE COMPOSER</small></span></Link>
        <div className="header-status"><span className="status-dot" /> M6 · ACCEPTANCE READY</div>
      </header>

      <section className="hero-grid">
        <div className="hero-copy reveal reveal--one">
          <p className="eyebrow">AI TEACHING ASSISTANCE PLATFORM</p>
          <h1>把一个主题，<br />编排成一堂课。</h1>
          <p className="hero-description">从主题到大纲，再逐项生成 slide 与 quiz；每个场景独立校验、提交和恢复，局部失败不会抹掉已经完成的教学内容。</p>
          <div className="principle-row"><span>结构化契约</span><span>增量持久化</span><span>失败隔离</span></div>
        </div>

        <form className="composer-card reveal reveal--two" onSubmit={handleSubmit}>
          <div className="card-index">01 / COURSE BRIEF</div>
          <label htmlFor="topic">这堂课要讲什么？</label>
          <textarea id="topic" name="topic" value={topic} minLength={2} maxLength={500} onChange={(event) => setTopic(event.target.value)} placeholder="例如：TCP 拥塞控制" required />
          <div className="field-row">
            <div><span className="field-label">场景数量</span><div className="segment-control" aria-label="场景数量">{[3, 4, 5].map((count) => <button className={sceneCount === count ? "is-active" : ""} type="button" key={count} onClick={() => setSceneCount(count)}>{count}</button>)}</div></div>
            <div className="mode-note"><span>运行模式</span><strong>AI PIPELINE + MYSQL</strong></div>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {creationProgress ? (
            <div className="creation-progress" role="status" aria-live="polite">
              <div className="creation-progress__head"><span>LIVE REQUEST</span><strong>{(elapsedMs / 1000).toFixed(1)}s</strong></div>
              <ol>
                <li className="is-active"><span>01</span><div><strong>保存课程草稿</strong><small>{creationProgress.phase === "saving" ? "正在写入 MySQL" : "已经完成"}</small></div></li>
                <li className={creationProgress.phase === "opening" ? "is-active" : ""}><span>02</span><div><strong>打开大纲工作台</strong><small>{creationProgress.phase === "opening" ? "正在加载页面" : "等待保存完成"}</small></div></li>
              </ol>
              <code>requestId: {creationProgress.requestId}</code>
            </div>
          ) : null}
          <button className="button button--accent button--wide" type="submit" disabled={submitting}>{creationProgress?.phase === "opening" ? "课程已保存，正在打开…" : submitting ? "正在保存课程草稿…" : "生成课程大纲"}<span aria-hidden="true">→</span></button>
          <p className="form-footnote">默认 mock 无需模型 Key；remote Provider 仅由服务端环境配置。</p>
        </form>
      </section>

      <section className="library reveal reveal--three">
        <div className="section-heading"><div><p className="eyebrow">MYSQL WORKSPACE</p><h2>最近课程</h2></div><span>{courses.length.toString().padStart(2, "0")} ITEMS</span></div>
        {initialError ? <p className="library-error" role="alert">{initialError}</p> : null}
        {courses.length === 0 && !initialError ? (
          <div className="empty-library"><span className="empty-number">00</span><div><h3>还没有课程</h3><p>上方创建的第一门课程会保存到 MySQL，并可在服务重启后恢复。</p></div></div>
        ) : (
          <div className="course-grid">{courses.map((course, index) => (
            <article className="course-card" key={course.id}>
              <Link className="course-card-main" href={course.status === "ready" ? `/classroom/${course.id}` : `/generation/${course.id}`}>
                <span className="course-card-number">{String(index + 1).padStart(2, "0")}</span>
                <h3>{course.title}</h3><p>{course.topic}</p><div className="course-card-meta"><span>{course.readySceneCount}/{course.requestedSceneCount} 场景</span><span>REV.{course.revision}</span></div>
              </Link>
              <div className="course-card-actions"><span className={`course-status course-status--${course.status}`}>{statusLabels[course.status]}</span><button type="button" onClick={() => deleteCourse(course)} aria-label={`删除课程：${course.title}`}>删除</button></div>
            </article>
          ))}</div>
        )}
      </section>
    </main>
  );
}
