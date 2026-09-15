"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Folder, FolderInput, Pencil, Trash2 } from "lucide-react";
import type { CourseBriefOverrides } from "@/lib/domain/course-brief";
import type { CourseFolder, CourseFolderMembership } from "@/lib/domain/course-folder";
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
  initialFolders,
  initialMemberships,
  initialError = null,
}: {
  initialCourses: CourseSummary[];
  initialFolders: CourseFolder[];
  initialMemberships: CourseFolderMembership[];
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
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [courses, setCourses] = useState(initialCourses);
  const [folders, setFolders] = useState(initialFolders);
  const [memberships, setMemberships] = useState(initialMemberships);
  const [activeFolder, setActiveFolder] = useState<"all" | "unfiled" | string>("all");
  const [folderEditor, setFolderEditor] = useState<{ mode: "create" | "rename"; value: string; folderId?: string; moveCourseId?: string } | null>(null);
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [folderDeleteConfirm, setFolderDeleteConfirm] = useState<{ folderId: string; mode: "unfile" | "delete_courses" } | null>(null);
  const [courseMoveMenuId, setCourseMoveMenuId] = useState<string | null>(null);
  const [courseRename, setCourseRename] = useState<{ courseId: string; value: string } | null>(null);
  const [courseDeleteConfirmId, setCourseDeleteConfirmId] = useState<string | null>(null);
  const [libraryPending, setLibraryPending] = useState(false);
  const folderMenuRef = useRef<HTMLDivElement | null>(null);

  const membershipByCourse = useMemo(() => new Map(memberships.map((membership) => [membership.courseId, membership.folderId])), [memberships]);
  const visibleCourses = useMemo(() => courses.filter((course) => {
    const folderId = membershipByCourse.get(course.id);
    if (activeFolder === "all") return true;
    if (activeFolder === "unfiled") return folderId === undefined;
    return folderId === activeFolder;
  }), [activeFolder, courses, membershipByCourse]);
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const membership of memberships) counts.set(membership.folderId, (counts.get(membership.folderId) ?? 0) + 1);
    return counts;
  }, [memberships]);

  useEffect(() => {
    if (!creationProgress) return;
    const timer = window.setInterval(() => setElapsedMs(Date.now() - creationProgress.startedAt), 250);
    return () => window.clearInterval(timer);
  }, [creationProgress]);

  useEffect(() => {
    if (!folderMenuId) return;
    /** 点击当前文件夹菜单之外的区域时，同时退出删除选择和确认状态。 */
    function closeFolderMenu(event: PointerEvent) {
      if (event.target instanceof Node && !folderMenuRef.current?.contains(event.target)) {
        setFolderMenuId(null);
        setFolderDeleteConfirm(null);
      }
    }
    document.addEventListener("pointerdown", closeFolderMenu, true);
    return () => document.removeEventListener("pointerdown", closeFolderMenu, true);
  }, [folderMenuId]);

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

  /** 第二次点击确认后删除课程；成功响应后再从当前列表移除。 */
  async function deleteCourse(course: CourseSummary) {
    setLibraryError(null);
    setLibraryPending(true);
    try {
      const response = await fetch(`/api/courses/${course.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(apiErrorMessage(payload, "删除课程失败"));
      }
      setCourses((current) => current.filter((item) => item.id !== course.id));
      setMemberships((current) => current.filter((item) => item.courseId !== course.id));
      setCourseDeleteConfirmId(null);
      router.refresh();
    } catch (caught) {
      setLibraryError(caught instanceof Error ? caught.message : "删除课程失败");
    } finally {
      setLibraryPending(false);
    }
  }

  /** 创建或重命名文件夹；从移动菜单创建时，创建成功后继续完成归类。 */
  async function saveFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!folderEditor) return;
    setLibraryError(null);
    setLibraryPending(true);
    try {
      const endpoint = folderEditor.mode === "create" ? "/api/course-folders" : `/api/course-folders/${folderEditor.folderId}`;
      const response = await fetch(endpoint, {
        method: folderEditor.mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: folderEditor.value }),
      });
      const payload = await response.json() as { data?: { folder: CourseFolder }; error?: { message?: string } };
      if (!response.ok || !payload.data?.folder) throw new Error(apiErrorMessage(payload, "文件夹保存失败"));
      const saved = payload.data.folder;
      if (folderEditor.mode === "create") setFolders((current) => [...current, saved]);
      else setFolders((current) => current.map((folder) => folder.id === saved.id ? saved : folder));
      if (folderEditor.moveCourseId) await moveCourse(folderEditor.moveCourseId, saved.id);
      setFolderEditor(null);
      setFolderMenuId(null);
    } catch (caught) {
      setLibraryError(caught instanceof Error ? caught.message : "文件夹保存失败");
    } finally {
      setLibraryPending(false);
    }
  }

  /** 删除文件夹时由用户明确选择保留课程或连同课程一起删除。 */
  async function deleteFolder(folderId: string, mode: "unfile" | "delete_courses") {
    setLibraryError(null);
    setLibraryPending(true);
    try {
      const response = await fetch(`/api/course-folders/${folderId}?mode=${mode}`, { method: "DELETE" });
      const payload = await response.json() as { data?: { deletedCourseIds: string[] }; error?: { message?: string } };
      if (!response.ok) throw new Error(apiErrorMessage(payload, "删除文件夹失败"));
      const deletedCourseIds = new Set(payload.data?.deletedCourseIds ?? []);
      setFolders((current) => current.filter((folder) => folder.id !== folderId));
      setMemberships((current) => current.filter((membership) => membership.folderId !== folderId));
      if (deletedCourseIds.size > 0) setCourses((current) => current.filter((course) => !deletedCourseIds.has(course.id)));
      if (activeFolder === folderId) setActiveFolder(mode === "unfile" ? "unfiled" : "all");
      setFolderMenuId(null);
      setFolderDeleteConfirm(null);
    } catch (caught) {
      setLibraryError(caught instanceof Error ? caught.message : "删除文件夹失败");
    } finally {
      setLibraryPending(false);
    }
  }

  /** 将课程归入一个文件夹，folderId 为空时移回未分类。 */
  async function moveCourse(courseId: string, folderId: string | null) {
    setLibraryError(null);
    setLibraryPending(true);
    try {
      const response = await fetch(`/api/courses/${courseId}/folder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      const payload = await response.json() as { data?: { folderId: string | null }; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(apiErrorMessage(payload, "移动课程失败"));
      setMemberships((current) => {
        const rest = current.filter((membership) => membership.courseId !== courseId);
        return folderId ? [...rest, { courseId, folderId, movedAt: Date.now() }] : rest;
      });
      setCourseMoveMenuId(null);
      return true;
    } catch (caught) {
      setLibraryError(caught instanceof Error ? caught.message : "移动课程失败");
      return false;
    } finally {
      setLibraryPending(false);
    }
  }

  /** 课程改名继续使用 Course revision，避免覆盖同时发生的 Agent 修改。 */
  async function renameCourse(event: FormEvent<HTMLFormElement>, course: CourseSummary) {
    event.preventDefault();
    if (!courseRename) return;
    setLibraryError(null);
    setLibraryPending(true);
    try {
      const response = await fetch(`/api/courses/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: courseRename.value, expectedRevision: course.revision }),
      });
      const payload = await response.json() as { course?: { title: string; revision: number; updatedAt: number }; error?: { message?: string } };
      if (!response.ok || !payload.course) throw new Error(apiErrorMessage(payload, "课程改名失败"));
      setCourses((current) => current.map((item) => item.id === course.id ? { ...item, ...payload.course } : item));
      setCourseRename(null);
    } catch (caught) {
      setLibraryError(caught instanceof Error ? caught.message : "课程改名失败");
    } finally {
      setLibraryPending(false);
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
        <div className="home-header-actions">
          <div className="header-status"><span className="status-dot" /> M12.4 · COURSE WORKSPACE</div>
          <Link className="settings-link" href="/settings">用量统计</Link>
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
          <div className="library-heading-actions">
            <span>{courses.length.toString().padStart(2, "0")} ITEMS</span>
            <button type="button" disabled={libraryPending} onClick={() => setFolderEditor({ mode: "create", value: "" })}>＋ 新建文件夹</button>
          </div>
        </div>
        <nav className="course-folder-bar" aria-label="课程文件夹">
          <button className={activeFolder === "all" ? "is-active" : ""} type="button" onClick={() => setActiveFolder("all")}>全部课程 <small>{courses.length}</small></button>
          <button className={activeFolder === "unfiled" ? "is-active" : ""} type="button" onClick={() => setActiveFolder("unfiled")}>未分类 <small>{courses.length - memberships.length}</small></button>
          {folders.map((folder) => (
            <div
              className={`course-folder-filter${activeFolder === folder.id ? " is-active" : ""}`}
              key={folder.id}
              ref={folderMenuId === folder.id ? folderMenuRef : undefined}
            >
              <button className="course-folder-name" type="button" title={folder.name} onClick={() => setActiveFolder(folder.id)}>
                <span>{folder.name}</span><small>{folderCounts.get(folder.id) ?? 0}</small>
              </button>
              <button
                className="course-folder-more"
                type="button"
                aria-label={`管理文件夹：${folder.name}`}
                onClick={() => { setFolderMenuId((current) => current === folder.id ? null : folder.id); setFolderDeleteConfirm(null); }}
              >···</button>
              {folderMenuId === folder.id ? (
                <div className="course-folder-menu" role="menu">
                  {folderDeleteConfirm?.folderId === folder.id ? (
                    <div className="course-folder-delete-confirm" role="alertdialog" aria-modal="true">
                      <strong>{folderDeleteConfirm.mode === "delete_courses" ? `删除文件夹和 ${folderCounts.get(folder.id) ?? 0} 门课程？` : "删除空文件夹？"}</strong>
                      <p>{folderDeleteConfirm.mode === "delete_courses" ? "课程内容和关联记录将被永久删除。" : "该文件夹删除后无法恢复。"}</p>
                      <div>
                        <button type="button" disabled={libraryPending} onClick={() => setFolderDeleteConfirm(null)}>取消</button>
                        <button className="is-destructive" type="button" disabled={libraryPending} onClick={() => void deleteFolder(folder.id, folderDeleteConfirm.mode)}>
                          {libraryPending ? "删除中…" : "确认删除"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button className="course-folder-rename-option" type="button" role="menuitem" disabled={libraryPending} onClick={() => { setFolderEditor({ mode: "rename", folderId: folder.id, value: folder.name }); setFolderMenuId(null); }}>重命名文件夹</button>
                      {(folderCounts.get(folder.id) ?? 0) > 0 ? (
                        <>
                          <button className="course-folder-delete-option" type="button" role="menuitem" disabled={libraryPending} onClick={() => void deleteFolder(folder.id, "unfile")}>
                            <Folder aria-hidden="true" />
                            <span><strong>仅删除文件夹</strong><small>课程保留在未分类中</small></span>
                          </button>
                          <button className="course-folder-delete-option is-destructive" type="button" role="menuitem" disabled={libraryPending} onClick={() => setFolderDeleteConfirm({ folderId: folder.id, mode: "delete_courses" })}>
                            <Trash2 aria-hidden="true" />
                            <span><strong>删除文件夹和 {folderCounts.get(folder.id)} 门课程</strong><small>课程内容及关联记录会一并删除</small></span>
                          </button>
                        </>
                      ) : (
                        <button className="course-folder-delete-option" type="button" role="menuitem" disabled={libraryPending} onClick={() => setFolderDeleteConfirm({ folderId: folder.id, mode: "unfile" })}>
                          <Trash2 aria-hidden="true" />
                          <span><strong>删除空文件夹</strong></span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </nav>
        {folderEditor ? (
          <form className="course-folder-editor" onSubmit={saveFolder}>
            <label>
              <span>{folderEditor.mode === "create" ? "新建文件夹" : "重命名文件夹"}</span>
              <input autoFocus maxLength={80} value={folderEditor.value} onChange={(event) => setFolderEditor({ ...folderEditor, value: event.target.value })} placeholder="例如：计算机网络" />
            </label>
            <button type="submit" disabled={libraryPending || !folderEditor.value.trim()}>保存</button>
            <button type="button" disabled={libraryPending} onClick={() => setFolderEditor(null)}>取消</button>
          </form>
        ) : null}
        {initialError ? (
          <p className="library-error" role="alert">
            {initialError}
          </p>
        ) : null}
        {libraryError ? <p className="library-error" role="alert">{libraryError}</p> : null}
        {visibleCourses.length === 0 && !initialError ? (
          <div className="empty-library">
            <span className="empty-number">00</span>
            <div>
              <h3>{courses.length === 0 ? "还没有课程" : "当前文件夹还没有课程"}</h3>
              <p>{courses.length === 0 ? "上方创建的第一门课程会保存到 MySQL，并可在服务重启后恢复。" : "可以从其他课程卡片的“移动”菜单将课程归入这里。"}</p>
            </div>
          </div>
        ) : (
          <div className="course-grid">
            {visibleCourses.map((course, index) => (
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
                    <span>{folders.find((folder) => folder.id === membershipByCourse.get(course.id))?.name ?? "未分类"} · REV.{course.revision}</span>
                  </div>
                </Link>
                <div className="course-card-actions">
                  <button
                    className="course-card-action-icon"
                    type="button"
                    title="移动到文件夹"
                    disabled={libraryPending}
                    onClick={() => { setCourseMoveMenuId((current) => current === course.id ? null : course.id); setCourseDeleteConfirmId(null); }}
                    aria-label={`移动课程：${course.title}`}
                  >
                    <FolderInput aria-hidden="true" />
                  </button>
                  <button
                    className="course-card-action-icon"
                    type="button"
                    title="编辑课程名称"
                    disabled={libraryPending}
                    onClick={() => { setCourseRename({ courseId: course.id, value: course.title }); setCourseMoveMenuId(null); setCourseDeleteConfirmId(null); }}
                    aria-label={`编辑课程名称：${course.title}`}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                  <button
                    className="course-card-action-icon course-card-action-delete"
                    type="button"
                    title="删除课程"
                    disabled={libraryPending}
                    onClick={() => {
                      setCourseDeleteConfirmId(course.id);
                      setCourseMoveMenuId(null);
                      setCourseRename(null);
                    }}
                    aria-label={`删除课程：${course.title}`}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                  <span className={`course-status course-status--${course.status}`}>
                    {statusLabels[course.status]}
                  </span>
                </div>
                {courseMoveMenuId === course.id ? (
                  <div className="course-move-menu" role="menu">
                    <span>移动到文件夹</span>
                    <button className={membershipByCourse.get(course.id) === undefined ? "is-current" : ""} type="button" role="menuitem" onClick={() => void moveCourse(course.id, null)}>未分类</button>
                    {folders.map((folder) => (
                      <button className={membershipByCourse.get(course.id) === folder.id ? "is-current" : ""} type="button" role="menuitem" key={folder.id} onClick={() => void moveCourse(course.id, folder.id)}>{folder.name}</button>
                    ))}
                    <button className="course-move-create" type="button" role="menuitem" onClick={() => { setFolderEditor({ mode: "create", value: "", moveCourseId: course.id }); setCourseMoveMenuId(null); }}>＋ 新建文件夹</button>
                  </div>
                ) : null}
                {courseRename?.courseId === course.id ? (
                  <form className="course-card-rename" onSubmit={(event) => void renameCourse(event, course)}>
                    <label><span>编辑课程名称</span><input autoFocus maxLength={120} value={courseRename.value} onChange={(event) => setCourseRename({ courseId: course.id, value: event.target.value })} /></label>
                    <div><button type="submit" disabled={libraryPending || !courseRename.value.trim()}>保存</button><button type="button" disabled={libraryPending} onClick={() => setCourseRename(null)}>取消</button></div>
                  </form>
                ) : null}
                {courseDeleteConfirmId === course.id ? (
                  <div className="course-delete-overlay" role="alertdialog" aria-modal="true" aria-labelledby={`delete-course-${course.id}`}>
                    <strong id={`delete-course-${course.id}`}>删除课程？</strong>
                    <p>课程内容和关联记录将被永久删除。</p>
                    <div>
                      <button type="button" autoFocus disabled={libraryPending} onClick={() => setCourseDeleteConfirmId(null)}>取消</button>
                      <button className="course-delete-confirm-button" type="button" disabled={libraryPending} onClick={() => void deleteCourse(course)}>
                        {libraryPending ? "删除中…" : "删除"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
