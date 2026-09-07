"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import type { CourseBriefOverrides } from "@/lib/domain/course-brief";
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
  draft: "草稿",
  outlining: "生成大纲",
  outline_ready: "大纲就绪",
  generating: "生成场景",
  partial_failed: "部分失败",
  ready: "可以上课",
  failed: "生成失败",
};

export function HomeWorkspace({
  initialCourses,
  initialError = null,
}: {
  initialCourses: CourseSummary[];
  initialError?: string | null;
}) {
  const router = useRouter();
  // 1. 状态
  const [topic, setTopic] = useState("TCP 拥塞控制");
  const [sceneCount, setSceneCount] = useState(5);
  const [audience, setAudience] = useState("");
  const [learnerLevel, setLearnerLevel] = useState<CourseBriefOverrides["learnerLevel"]>();
  const [learningGoal, setLearningGoal] = useState("");
  const [prerequisites, setPrerequisites] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<CourseBriefOverrides["durationMinutes"]>();
  const [teachingStyle, setTeachingStyle] = useState<CourseBriefOverrides["teachingStyle"]>();
  const [additionalRequirements, setAdditionalRequirements] = useState("");
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
      const briefOverrides: CourseBriefOverrides = {
        ...(audience.trim() ? { audience: audience.trim() } : {}),
        ...(learnerLevel ? { learnerLevel } : {}),
        ...(learningGoal.trim() ? { learningGoal: learningGoal.trim() } : {}),
        ...(prerequisites.trim()
          ? {
              prerequisites: prerequisites
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean),
            }
          : {}),
        ...(durationMinutes ? { durationMinutes } : {}),
        ...(teachingStyle ? { teachingStyle } : {}),
        ...(additionalRequirements.trim()
          ? {
              additionalRequirements: additionalRequirements
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean),
            }
          : {}),
      };
      const response = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-request-id": requestId },
        body: JSON.stringify({ topic, requestedSceneCount: sceneCount, briefOverrides }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(payload, "创建课程失败"));
      setCreationProgress({ phase: "opening", requestId: payload.meta?.requestId ?? requestId, startedAt });
      // 开发模式的 RSC 客户端跳转可能长时间停留在 Rendering；完整导航可可靠进入服务端页面。
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/generation/${payload.course.id}`);
    } catch (caught) {
      const message =
        caught instanceof DOMException && caught.name === "AbortError"
          ? `保存课程超过 15 秒，已停止等待。请用请求编号 ${requestId} 检查终端日志，刷新后确认课程是否已经创建。`
          : caught instanceof Error
            ? caught.message
            : "创建课程失败";
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
        <Link className="brand" href="/" aria-label="课序首页">
          <span className="brand-mark">课</span>
          <span>
            <strong>课序</strong>
            <small>COURSE COMPOSER</small>
          </span>
        </Link>
        <div className="header-status">
          <span className="status-dot" /> M11 · COURSE WORKSPACE
        </div>
      </header>

      <section className="hero-grid">
        <div className="hero-copy reveal reveal--one">
          <p className="eyebrow">AI TEACHING ASSISTANCE PLATFORM</p>
          <h1>
            把一个主题，
            <br />
            编排成一堂课。
          </h1>
        </div>

        <form className="composer-card reveal reveal--two" onSubmit={handleSubmit}>
          <div className="card-index">01 / COURSE BRIEF</div>
          <label htmlFor="topic">这堂课要讲什么？</label>
          <textarea
            id="topic"
            name="topic"
            value={topic}
            minLength={2}
            maxLength={500}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="例如：TCP 拥塞控制"
            required
          />
          <div className="field-row">
            <div>
              <span className="field-label">场景数量</span>
              <div className="segment-control" aria-label="场景数量">
                {[4, 5, 6, 7, 8].map((count) => (
                  <button
                    className={sceneCount === count ? "is-active" : ""}
                    type="button"
                    key={count}
                    onClick={() => setSceneCount(count)}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>
            <div className="mode-note">
              <span>运行模式</span>
              <strong>AI PIPELINE + MYSQL</strong>
            </div>
          </div>
          <details className="brief-settings">
            <summary>
              <span>高级课程要求</span>
              <small>可选 · 留空时由描述和默认值补齐</small>
            </summary>
            <div className="brief-settings__grid">
              <label>
                <span>目标受众</span>
                <input
                  value={audience}
                  maxLength={120}
                  onChange={(event) => setAudience(event.target.value)}
                  placeholder="例如：有 Java 基础的本科生"
                />
              </label>
              <label>
                <span>学习水平</span>
                <select
                  value={learnerLevel ?? ""}
                  onChange={(event) =>
                    setLearnerLevel((event.target.value || undefined) as CourseBriefOverrides["learnerLevel"])
                  }
                >
                  <option value="">自动判断</option>
                  <option value="beginner">入门</option>
                  <option value="intermediate">进阶</option>
                  <option value="advanced">高级</option>
                </select>
              </label>
              <label className="brief-settings__wide">
                <span>学习目标</span>
                <input
                  value={learningGoal}
                  maxLength={300}
                  onChange={(event) => setLearningGoal(event.target.value)}
                  placeholder="例如：能够解释拥塞窗口变化并分析常见抓包现象"
                />
              </label>
              <label>
                <span>预计时长</span>
                <select
                  value={durationMinutes ?? ""}
                  onChange={(event) =>
                    setDurationMinutes(
                      event.target.value ? (Number(event.target.value) as 10 | 15 | 20) : undefined,
                    )
                  }
                >
                  <option value="">默认 15 分钟</option>
                  <option value="10">10 分钟</option>
                  <option value="15">15 分钟</option>
                  <option value="20">20 分钟</option>
                </select>
              </label>
              <label>
                <span>教学风格</span>
                <select
                  value={teachingStyle ?? ""}
                  onChange={(event) =>
                    setTeachingStyle(
                      (event.target.value || undefined) as CourseBriefOverrides["teachingStyle"],
                    )
                  }
                >
                  <option value="">默认案例导向</option>
                  <option value="structured">结构化讲解</option>
                  <option value="case_based">案例导向</option>
                  <option value="practice_oriented">练习导向</option>
                </select>
              </label>
              <label>
                <span>先修知识（每行一项）</span>
                <textarea
                  value={prerequisites}
                  onChange={(event) => setPrerequisites(event.target.value)}
                  placeholder="例如：计算机网络基础"
                />
              </label>
              <label>
                <span>附加要求（每行一项）</span>
                <textarea
                  value={additionalRequirements}
                  onChange={(event) => setAdditionalRequirements(event.target.value)}
                  placeholder="例如：包含一次抓包案例"
                />
              </label>
            </div>
            <p>互动场景在下一步的大纲工作台选择；开启后 AI 会按课程长度安排 1～3 个 diagram。</p>
          </details>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {creationProgress ? (
            <div className="creation-progress" role="status" aria-live="polite">
              <div className="creation-progress__head">
                <span>LIVE REQUEST</span>
                <strong>{(elapsedMs / 1000).toFixed(1)}s</strong>
              </div>
              <ol>
                <li className="is-active">
                  <span>01</span>
                  <div>
                    <strong>保存课程草稿</strong>
                    <small>{creationProgress.phase === "saving" ? "正在写入 MySQL" : "已经完成"}</small>
                  </div>
                </li>
                <li className={creationProgress.phase === "opening" ? "is-active" : ""}>
                  <span>02</span>
                  <div>
                    <strong>打开大纲工作台</strong>
                    <small>{creationProgress.phase === "opening" ? "正在加载页面" : "等待保存完成"}</small>
                  </div>
                </li>
              </ol>
              <code>requestId: {creationProgress.requestId}</code>
            </div>
          ) : null}
          <button className="button button--accent button--wide" type="submit" disabled={submitting}>
            {creationProgress?.phase === "opening"
              ? "课程已保存，正在打开…"
              : submitting
                ? "正在保存课程草稿…"
                : "生成课程大纲"}
            <span aria-hidden="true">→</span>
          </button>
        </form>
      </section>

      <section className="library reveal reveal--three">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MYSQL WORKSPACE</p>
            <h2>最近课程</h2>
          </div>
          <span>{courses.length.toString().padStart(2, "0")} ITEMS</span>
        </div>
        {initialError ? (
          <p className="library-error" role="alert">
            {initialError}
          </p>
        ) : null}
        {courses.length === 0 && !initialError ? (
          <div className="empty-library">
            <span className="empty-number">00</span>
            <div>
              <h3>还没有课程</h3>
              <p>上方创建的第一门课程会保存到 MySQL，并可在服务重启后恢复。</p>
            </div>
          </div>
        ) : (
          <div className="course-grid">
            {courses.map((course, index) => (
              <article className="course-card" key={course.id}>
                <Link
                  className="course-card-main"
                  href={course.status === "ready" ? `/classroom/${course.id}` : `/generation/${course.id}`}
                >
                  <span className="course-card-number">{String(index + 1).padStart(2, "0")}</span>
                  <h3>{course.title}</h3>
                  <p>{course.topic}</p>
                  <div className="course-card-meta">
                    <span>
                      {course.readySceneCount}/{course.requestedSceneCount} 场景
                    </span>
                    <span>REV.{course.revision}</span>
                  </div>
                </Link>
                <div className="course-card-actions">
                  <span className={`course-status course-status--${course.status}`}>
                    {statusLabels[course.status]}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteCourse(course)}
                    aria-label={`删除课程：${course.title}`}
                  >
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
