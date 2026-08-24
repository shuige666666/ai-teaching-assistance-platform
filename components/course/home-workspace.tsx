"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import type { CourseSummary } from "@/lib/domain/schemas";

const statusLabels: Record<CourseSummary["status"], string> = {
  draft: "草稿", outlining: "生成大纲", outline_ready: "大纲就绪", generating: "生成场景", partial_failed: "部分失败", ready: "可以上课", failed: "生成失败",
};

export function HomeWorkspace({ initialCourses, initialError = null }: { initialCourses: CourseSummary[]; initialError?: string | null }) {
  const router = useRouter();
  const [topic, setTopic] = useState("TCP 拥塞控制");
  const [sceneCount, setSceneCount] = useState(4);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState(initialCourses);

  /** 创建成功后只携带 courseId 跳转，生成页从仓储重新读取课程事实。 */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/courses", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, requestedSceneCount: sceneCount }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "创建课程失败");
      router.push(`/generation/${payload.course.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建课程失败");
      setSubmitting(false);
    }
  }

  /** 显式确认后删除课程；成功响应后再从当前列表移除。 */
  async function deleteCourse(course: CourseSummary) {
    if (!window.confirm(`确认删除“${course.title}”吗？该操作会同时删除相关测验记录。`)) return;
    setError(null);
    try {
      const response = await fetch(`/api/courses/${course.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.message ?? "删除课程失败");
      }
      setCourses((current) => current.filter((item) => item.id !== course.id));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除课程失败");
    }
  }

  return (
    <main className="home-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="课序首页"><span className="brand-mark">课</span><span><strong>课序</strong><small>COURSE COMPOSER</small></span></Link>
        <div className="header-status"><span className="status-dot" /> M4 · SCENE GENERATION</div>
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
          <button className="button button--accent button--wide" type="submit" disabled={submitting}>{submitting ? "正在建立课程…" : "生成课程大纲"}<span aria-hidden="true">→</span></button>
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
