"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, BookOpen, Check, ChevronDown, CircleAlert, Clock, DatabaseZap, Ellipsis, Folder, FolderInput, FolderOpen,
  FolderPlus, Inbox, Info, ListTree, PenLine, Pencil, Plus, Presentation, RefreshCw, Search, SearchX, SlidersHorizontal,
  Sparkles, Trash2, WandSparkles, X,
} from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import type { CourseBriefOverrides } from "@/lib/domain/course-brief";
import type { CourseFolder, CourseFolderMembership } from "@/lib/domain/course-folder";
import type { Course, CourseSummary } from "@/lib/domain/schemas";
import { MaterialFilePicker, materialUploadBody, type MaterialUpload } from "./material-file-picker";

const flowSteps = [
  { icon: PenLine, title: "描述主题", text: "写下要讲的内容，可附讲义或教材" },
  { icon: ListTree, title: "审核大纲", text: "AI 拟定大纲，你来修改和确认" },
  { icon: WandSparkles, title: "生成场景", text: "逐场生成讲解、互动与测验" },
  { icon: Presentation, title: "进入课堂", text: "分段讲解、对话修订、一键导出" },
];

const topicSuggestions = ["TCP 拥塞控制", "二分查找算法", "光合作用的两个阶段", "一元函数积分入门"];

// 固定时区，避免服务端和浏览器时区不同导致水合差异。
const dateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", timeZone: "Asia/Shanghai" });

/** 按课程 ID 稳定挑选首字图标配色，让课程卡片在列表中更易区分。 */
function glyphTone(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 6;
}

type CreationProgress = {
  phase: "saving" | "materials" | "opening";
  requestId: string;
  startedAt: number;
};

function apiErrorMessage(payload: { error?: { message?: string } }, fallback: string) {
  return payload.error?.message ?? fallback;
}

const statusLabels: Record<CourseSummary["status"], string> = {
  draft: "草稿",
  outlining: "生成大纲中",
  outline_ready: "待审核大纲",
  generating: "生成场景中",
  partial_failed: "部分失败",
  ready: "可以上课",
  failed: "生成失败",
};

const statusTones: Record<CourseSummary["status"], "neutral" | "info" | "progress" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  outlining: "progress",
  outline_ready: "info",
  generating: "progress",
  partial_failed: "warning",
  ready: "success",
  failed: "danger",
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
  const [materialUploads, setMaterialUploads] = useState<MaterialUpload[]>([]);
  const [pendingDraft, setPendingDraft] = useState<Course | null>(null);
  const [creationProgress, setCreationProgress] = useState<CreationProgress | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [courses, setCourses] = useState(initialCourses);
  const [folders, setFolders] = useState(initialFolders);
  const [memberships, setMemberships] = useState(initialMemberships);
  const [activeFolder, setActiveFolder] = useState<"all" | "unfiled" | string>("all");
  const [query, setQuery] = useState("");
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
    const timeout = window.setTimeout(() => controller.abort(), materialUploads.length ? 90_000 : 15_000);
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
      // 上传失败后复用已创建的草稿；重新读取版本，兼容响应丢失但服务端已经保存的情况。
      let draft = pendingDraft;
      if (draft) {
        const latest = await fetch(`/api/courses/${draft.id}`, { signal: controller.signal });
        const latestPayload = await latest.json();
        if (!latest.ok) throw new Error(apiErrorMessage(latestPayload, "草稿读取失败"));
        draft = latestPayload.course as Course;
      } else {
        const response = await fetch("/api/courses", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-request-id": requestId },
          body: JSON.stringify({ topic, requestedSceneCount: sceneCount, briefOverrides }),
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(apiErrorMessage(payload, "创建课程失败"));
        draft = payload.course as Course;
      }
      setPendingDraft(draft);
      if (materialUploads.length) {
        setCreationProgress({ phase: "materials", requestId, startedAt });
        const response = await fetch(`/api/courses/${draft.id}/materials`, {
          method: "POST", headers: { "x-request-id": requestId }, body: materialUploadBody(draft.revision, materialUploads), signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(apiErrorMessage(payload, "材料上传失败；课程草稿已保留，请调整材料后重试"));
      }
      setCreationProgress({ phase: "opening", requestId, startedAt });
      // 开发模式的 RSC 客户端跳转可能长时间停留在 Rendering；完整导航可可靠进入服务端页面。
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/generation/${draft.id}`);
    } catch (caught) {
      const message =
        caught instanceof DOMException && caught.name === "AbortError"
          ? `操作超时，已停止等待。已保存的课程草稿会保留；请重试或进入草稿继续处理。请求编号：${requestId}`
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

  const readyCourseCount = courses.filter((course) => course.status === "ready").length;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredCourses = normalizedQuery
    ? visibleCourses.filter((course) => `${course.title}\n${course.topic}`.toLocaleLowerCase().includes(normalizedQuery))
    : visibleCourses;
  const creationSteps = [
    { key: "saving", title: "保存课程草稿", active: "正在写入 MySQL" },
    ...(materialUploads.length ? [{ key: "materials", title: "解析并保存教学材料", active: "正在提取原文和来源位置" }] : []),
    { key: "opening", title: "打开大纲工作台", active: "正在加载页面" },
  ];
  const creationIndex = creationProgress ? creationSteps.findIndex((step) => step.key === creationProgress.phase) : -1;

  function focusComposer() {
    const field = document.getElementById("topic");
    field?.scrollIntoView({ behavior: "smooth", block: "center" });
    field?.focus({ preventScroll: true });
  }

  // 3. 页面 UI
  return (
    <div className="page">
      <AppHeader active="library" />
      <main className="page-main home">
        <section className="home-hero">
          <div className="home-intro reveal">
            <p className="eyebrow-chip"><Sparkles aria-hidden="true" />AI 教学辅助平台</p>
            <h1>
              把一个主题，
              <br />
              编排成一堂<mark>课</mark>。
            </h1>
            <p className="lead">输入教学主题或上传讲义，AI 先拟定可审核的课程大纲，再逐场生成讲解课件、互动实验和随堂测验，最后在课堂中分段讲解。</p>
            <ol className="flow-steps">
              {flowSteps.map(({ icon: Icon, title, text }, index) => (
                <li key={title}>
                  <span className={`flow-steps__icon flow-steps__icon--${index + 1}`} aria-hidden="true"><Icon /></span>
                  <span><strong>{title}</strong><small>{text}</small></span>
                </li>
              ))}
            </ol>
            {courses.length > 0 ? (
              <dl className="home-stats">
                <div><dt>课程总数</dt><dd>{courses.length}</dd></div>
                <div><dt>可以上课</dt><dd>{readyCourseCount}</dd></div>
                <div><dt>文件夹</dt><dd>{folders.length}</dd></div>
              </dl>
            ) : null}
          </div>

          <form className="composer reveal reveal--two" onSubmit={handleSubmit} aria-labelledby="composer-title">
            <header className="composer__head">
              <span className="composer__icon" aria-hidden="true"><WandSparkles /></span>
              <div>
                <h2 id="composer-title">新建一门课</h2>
                <p>只需一个主题，其余要求都可以稍后调整。</p>
              </div>
            </header>
            <fieldset className="material-course-fields" disabled={submitting || pendingDraft !== null}>
              <div className="field">
                <label className="field-label" htmlFor="topic">这堂课要讲什么？</label>
                <textarea
                  id="topic"
                  name="topic"
                  value={topic}
                  minLength={2}
                  maxLength={500}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="例如：TCP 拥塞控制；也可以写明对象和重点，如“面向高一学生讲解光合作用的两个阶段”"
                  required
                />
                <div className="topic-suggestions">
                  <span>试试：</span>
                  {topicSuggestions.map((item) => (
                    <button type="button" key={item} className={topic === item ? "is-active" : ""} onClick={() => setTopic(item)}>{item}</button>
                  ))}
                </div>
              </div>
              <div className="composer-row">
                <div className="field">
                  <span className="field-label">场景数量</span>
                  <div className="segmented" role="group" aria-label="场景数量">
                    {[4, 5, 6, 7, 8].map((count) => (
                      <button
                        className={sceneCount === count ? "is-active" : ""}
                        type="button"
                        key={count}
                        aria-pressed={sceneCount === count}
                        onClick={() => setSceneCount(count)}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="composer-estimate"><Clock aria-hidden="true" />每个场景是一页讲解、一次互动或一组测验</p>
              </div>
              <details className="disclosure">
                <summary>
                  <SlidersHorizontal aria-hidden="true" />
                  <span>高级课程要求</span>
                  <small>可选 · 留空时由描述和默认值补齐</small>
                  <ChevronDown className="disclosure__chevron" aria-hidden="true" />
                </summary>
                <div className="disclosure__body form-grid">
                  <label className="field">
                    <span>目标受众</span>
                    <input
                      value={audience}
                      maxLength={120}
                      onChange={(event) => setAudience(event.target.value)}
                      placeholder="例如：有 Java 基础的本科生"
                    />
                  </label>
                  <label className="field">
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
                  <label className="field span-2">
                    <span>学习目标</span>
                    <input
                      value={learningGoal}
                      maxLength={300}
                      onChange={(event) => setLearningGoal(event.target.value)}
                      placeholder="例如：能够解释拥塞窗口变化并分析常见抓包现象"
                    />
                  </label>
                  <label className="field">
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
                  <label className="field">
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
                  <label className="field">
                    <span>先修知识（每行一项）</span>
                    <textarea
                      value={prerequisites}
                      onChange={(event) => setPrerequisites(event.target.value)}
                      placeholder="例如：计算机网络基础"
                    />
                  </label>
                  <label className="field">
                    <span>附加要求（每行一项）</span>
                    <textarea
                      value={additionalRequirements}
                      onChange={(event) => setAdditionalRequirements(event.target.value)}
                      placeholder="例如：包含一次抓包案例"
                    />
                  </label>
                  <p className="form-note span-2"><Info aria-hidden="true" />是否加入互动场景在下一步的大纲工作台选择；开启后 AI 会按课程长度安排 1～3 个互动。</p>
                </div>
              </details>
            </fieldset>
            <MaterialFilePicker uploads={materialUploads} onChange={setMaterialUploads} disabled={submitting} />
            {pendingDraft && !submitting ? (
              <div className="notice notice--info" role="status">
                <Info aria-hidden="true" />
                <p>课程草稿已保存。可以调整材料后重试，或 <Link className="inline-link" href={`/generation/${pendingDraft.id}`}>进入草稿继续处理</Link>。</p>
              </div>
            ) : null}
            {error ? (
              <div className="notice notice--danger" role="alert">
                <CircleAlert aria-hidden="true" />
                <div className="notice__body"><strong>没能创建课程</strong><p className="notice__pre">{error}</p></div>
              </div>
            ) : null}
            {creationProgress ? (
              <div className="progress-steps" role="status" aria-live="polite">
                <div className="progress-steps__head">
                  <span>正在准备课程</span>
                  <strong>{(elapsedMs / 1000).toFixed(1)}s</strong>
                </div>
                <ol>
                  {creationSteps.map((step, index) => {
                    const state = index < creationIndex ? "done" : index === creationIndex ? "active" : "todo";
                    return (
                      <li key={step.key} className={`is-${state}`}>
                        <span className="step-icon" aria-hidden="true">
                          {state === "done" ? <Check /> : state === "active" ? <span className="spinner" /> : index + 1}
                        </span>
                        <span>
                          <strong>{step.title}</strong>
                          <small>{state === "done" ? "已经完成" : state === "active" ? step.active : "等待上一步完成"}</small>
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <code className="request-id">requestId: {creationProgress.requestId}</code>
              </div>
            ) : null}
            <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={submitting}>
              {submitting ? <span className="spinner" aria-hidden="true" /> : null}
              {creationProgress?.phase === "opening"
                ? "课程已保存，正在打开…"
                : creationProgress?.phase === "materials" ? "正在解析教学材料…" : submitting
                  ? "正在保存课程草稿…"
                  : pendingDraft ? "继续准备课程" : "生成课程大纲"}
              {!submitting ? <ArrowRight aria-hidden="true" /> : null}
            </button>
          </form>
        </section>

        <section className="library reveal reveal--three" aria-labelledby="library-title">
          <div className="library-head">
            <div>
              <h2 id="library-title">我的课程</h2>
              <p>{courses.length ? `共 ${courses.length} 门课程，已生成的课程可直接进入课堂。` : "创建的课程会保存在这里，服务重启后也能继续。"}</p>
            </div>
            <div className="library-tools">
              {courses.length > 0 ? (
                <label className="search-field">
                  <Search aria-hidden="true" />
                  <input type="search" value={query} placeholder="搜索课程标题或主题" aria-label="搜索课程" onChange={(event) => setQuery(event.target.value)} />
                </label>
              ) : null}
              <button className="btn btn--secondary" type="button" disabled={libraryPending} onClick={() => setFolderEditor({ mode: "create", value: "" })}><FolderPlus aria-hidden="true" />新建文件夹</button>
            </div>
          </div>
          {courses.length > 0 || folders.length > 0 ? (
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
                    <Folder aria-hidden="true" /><span>{folder.name}</span><small>{folderCounts.get(folder.id) ?? 0}</small>
                  </button>
                  <button
                    className="course-folder-more"
                    type="button"
                    aria-label={`管理文件夹：${folder.name}`}
                    aria-expanded={folderMenuId === folder.id}
                    onClick={() => { setFolderMenuId((current) => current === folder.id ? null : folder.id); setFolderDeleteConfirm(null); }}
                  ><Ellipsis aria-hidden="true" /></button>
                  {folderMenuId === folder.id ? (
                    <div className="course-folder-menu popover" role="menu">
                      {folderDeleteConfirm?.folderId === folder.id ? (
                        <div className="course-folder-delete-confirm" role="alertdialog" aria-modal="true">
                          <strong>{folderDeleteConfirm.mode === "delete_courses" ? `删除文件夹和 ${folderCounts.get(folder.id) ?? 0} 门课程？` : "删除空文件夹？"}</strong>
                          <p>{folderDeleteConfirm.mode === "delete_courses" ? "课程内容和关联记录将被永久删除。" : "该文件夹删除后无法恢复。"}</p>
                          <div>
                            <button className="btn btn--secondary btn--sm" type="button" disabled={libraryPending} onClick={() => setFolderDeleteConfirm(null)}>取消</button>
                            <button className="btn btn--danger btn--sm" type="button" disabled={libraryPending} onClick={() => void deleteFolder(folder.id, folderDeleteConfirm.mode)}>
                              {libraryPending ? "删除中…" : "确认删除"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button className="menu-item" type="button" role="menuitem" disabled={libraryPending} onClick={() => { setFolderEditor({ mode: "rename", folderId: folder.id, value: folder.name }); setFolderMenuId(null); }}>
                            <Pencil aria-hidden="true" /><span><strong>重命名文件夹</strong></span>
                          </button>
                          {(folderCounts.get(folder.id) ?? 0) > 0 ? (
                            <>
                              <button className="menu-item" type="button" role="menuitem" disabled={libraryPending} onClick={() => void deleteFolder(folder.id, "unfile")}>
                                <Folder aria-hidden="true" />
                                <span><strong>仅删除文件夹</strong><small>课程保留在未分类中</small></span>
                              </button>
                              <button className="menu-item is-destructive" type="button" role="menuitem" disabled={libraryPending} onClick={() => setFolderDeleteConfirm({ folderId: folder.id, mode: "delete_courses" })}>
                                <Trash2 aria-hidden="true" />
                                <span><strong>删除文件夹和 {folderCounts.get(folder.id)} 门课程</strong><small>课程内容及关联记录会一并删除</small></span>
                              </button>
                            </>
                          ) : (
                            <button className="menu-item is-destructive" type="button" role="menuitem" disabled={libraryPending} onClick={() => setFolderDeleteConfirm({ folderId: folder.id, mode: "unfile" })}>
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
          ) : null}
          {folderEditor ? (
            <form className="course-folder-editor" onSubmit={saveFolder}>
              <label className="field">
                <span>{folderEditor.mode === "create" ? (folderEditor.moveCourseId ? "新建文件夹并移入课程" : "新建文件夹") : "重命名文件夹"}</span>
                <input autoFocus maxLength={80} value={folderEditor.value} onChange={(event) => setFolderEditor({ ...folderEditor, value: event.target.value })} placeholder="例如：计算机网络" />
              </label>
              <button className="btn btn--primary" type="submit" disabled={libraryPending || !folderEditor.value.trim()}>保存</button>
              <button className="btn btn--ghost" type="button" disabled={libraryPending} onClick={() => setFolderEditor(null)}>取消</button>
            </form>
          ) : null}
          {initialError ? (
            <div className="notice notice--danger library-notice" role="alert">
              <DatabaseZap aria-hidden="true" />
              <div className="notice__body"><strong>课程库暂时无法读取</strong><p>{initialError}</p></div>
              <button className="btn btn--secondary btn--sm" type="button" onClick={() => router.refresh()}><RefreshCw aria-hidden="true" />重试</button>
            </div>
          ) : null}
          {libraryError ? (
            <div className="notice notice--danger library-notice" role="alert">
              <CircleAlert aria-hidden="true" />
              <div className="notice__body"><p>{libraryError}</p></div>
              <button className="icon-btn" type="button" aria-label="关闭提示" onClick={() => setLibraryError(null)}><X aria-hidden="true" /></button>
            </div>
          ) : null}
          {initialError ? null : filteredCourses.length === 0 ? (
            courses.length === 0 ? (
              <div className="empty-state">
                <span className="empty-state__icon" aria-hidden="true"><BookOpen /></span>
                <h3>还没有课程</h3>
                <p>在上方输入一个教学主题，就能得到第一门包含讲解、互动和测验的结构化微课。</p>
                <button className="btn btn--primary" type="button" onClick={focusComposer}><Plus aria-hidden="true" />创建第一门课程</button>
              </div>
            ) : normalizedQuery ? (
              <div className="empty-state">
                <span className="empty-state__icon" aria-hidden="true"><SearchX /></span>
                <h3>没有找到匹配“{query.trim()}”的课程</h3>
                <p>换个关键词试试，或在“全部课程”中查找。</p>
                <button className="btn btn--secondary" type="button" onClick={() => setQuery("")}>清除搜索</button>
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-state__icon" aria-hidden="true"><FolderOpen /></span>
                <h3>{activeFolder === "unfiled" ? "所有课程都已归类" : "这个文件夹还是空的"}</h3>
                <p>{activeFolder === "unfiled" ? "新建的课程会先出现在这里。" : "在课程卡片右上角点击“移动到文件夹”，即可把课程归入这里。"}</p>
              </div>
            )
          ) : (
            <div className="course-grid">
              {filteredCourses.map((course) => {
                const folderName = folders.find((folder) => folder.id === membershipByCourse.get(course.id))?.name;
                const percent = course.requestedSceneCount ? Math.round((course.readySceneCount / course.requestedSceneCount) * 100) : 0;
                return (
                  <article className="course-card" key={course.id}>
                    <Link
                      className="course-card-main"
                      href={course.status === "ready" ? `/classroom/${course.id}` : `/generation/${course.id}`}
                    >
                      <div className="course-card__top">
                        <span className={`course-glyph course-glyph--${glyphTone(course.id)}`} aria-hidden="true">{Array.from(course.title.trim() || "课")[0]}</span>
                        <span className={`badge badge--dot badge--${statusTones[course.status]}`}>{statusLabels[course.status]}</span>
                      </div>
                      <h3>{course.title}</h3>
                      <p>{course.topic}</p>
                      <div className="course-card__progress">
                        <span className={`meter${course.status === "ready" ? " meter--success" : ""}`} aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
                        <span>{course.readySceneCount}/{course.requestedSceneCount} 场景</span>
                      </div>
                      <div className="course-card-meta">
                        <span title={folderName ?? "未分类"}><Folder aria-hidden="true" />{folderName ?? "未分类"} · {dateFormatter.format(course.updatedAt)}</span>
                        <span className="course-card__cta">{course.status === "ready" ? "进入课堂" : "继续制作"}<ArrowRight aria-hidden="true" /></span>
                      </div>
                    </Link>
                    <div className="course-card-actions">
                      <button
                        className="icon-btn"
                        type="button"
                        title="移动到文件夹"
                        disabled={libraryPending}
                        aria-expanded={courseMoveMenuId === course.id}
                        onClick={() => { setCourseMoveMenuId((current) => current === course.id ? null : course.id); setCourseDeleteConfirmId(null); }}
                        aria-label={`移动课程：${course.title}`}
                      >
                        <FolderInput aria-hidden="true" />
                      </button>
                      <button
                        className="icon-btn"
                        type="button"
                        title="编辑课程名称"
                        disabled={libraryPending}
                        onClick={() => { setCourseRename({ courseId: course.id, value: course.title }); setCourseMoveMenuId(null); setCourseDeleteConfirmId(null); }}
                        aria-label={`编辑课程名称：${course.title}`}
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                      <button
                        className="icon-btn icon-btn--danger"
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
                    </div>
                    {courseMoveMenuId === course.id ? (
                      <div className="course-move-menu popover" role="menu">
                        <span className="popover__title">移动到文件夹</span>
                        <button className={`menu-item${membershipByCourse.get(course.id) === undefined ? " is-current" : ""}`} type="button" role="menuitem" onClick={() => void moveCourse(course.id, null)}><Inbox aria-hidden="true" /><span><strong>未分类</strong></span></button>
                        {folders.map((folder) => (
                          <button className={`menu-item${membershipByCourse.get(course.id) === folder.id ? " is-current" : ""}`} type="button" role="menuitem" key={folder.id} onClick={() => void moveCourse(course.id, folder.id)}><Folder aria-hidden="true" /><span><strong>{folder.name}</strong></span></button>
                        ))}
                        <button className="menu-item menu-item--accent" type="button" role="menuitem" onClick={() => { setFolderEditor({ mode: "create", value: "", moveCourseId: course.id }); setCourseMoveMenuId(null); }}><FolderPlus aria-hidden="true" /><span><strong>新建文件夹</strong></span></button>
                      </div>
                    ) : null}
                    {courseRename?.courseId === course.id ? (
                      <form className="course-card-rename popover" onSubmit={(event) => void renameCourse(event, course)}>
                        <label className="field"><span>编辑课程名称</span><input autoFocus maxLength={120} value={courseRename.value} onChange={(event) => setCourseRename({ courseId: course.id, value: event.target.value })} /></label>
                        <div><button className="btn btn--ghost btn--sm" type="button" disabled={libraryPending} onClick={() => setCourseRename(null)}>取消</button><button className="btn btn--primary btn--sm" type="submit" disabled={libraryPending || !courseRename.value.trim()}>保存</button></div>
                      </form>
                    ) : null}
                    {courseDeleteConfirmId === course.id ? (
                      <div className="course-delete-overlay" role="alertdialog" aria-modal="true" aria-labelledby={`delete-course-${course.id}`}>
                        <span className="course-delete-overlay__icon" aria-hidden="true"><Trash2 /></span>
                        <strong id={`delete-course-${course.id}`}>删除这门课程？</strong>
                        <p>课程内容和关联记录将被永久删除，无法恢复。</p>
                        <div>
                          <button className="btn btn--secondary btn--sm" type="button" autoFocus disabled={libraryPending} onClick={() => setCourseDeleteConfirmId(null)}>取消</button>
                          <button className="btn btn--danger btn--sm" type="button" disabled={libraryPending} onClick={() => void deleteCourse(course)}>
                            {libraryPending ? "删除中…" : "删除"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
