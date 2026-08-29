"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Course, CourseBrief, CourseBriefField, SceneOutline } from "@/lib/domain/schemas";

type ErrorIssue = { path: string; message: string };
type ErrorNotice = {
  code: string;
  message: string;
  retryable: boolean;
  requestId?: string;
  upstreamCalls?: number;
  validationKind?: string;
  issues?: ErrorIssue[];
};
type OperationView = {
  requestId: string;
  label: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: number;
};

class ClientRequestError extends Error {
  constructor(public readonly notice: ErrorNotice) {
    super(notice.message);
    this.name = "ClientRequestError";
  }
}

function responseError(payload: { error?: Partial<ErrorNotice> }, fallback: string) {
  return new ClientRequestError({
    code: payload.error?.code ?? "REQUEST_FAILED",
    message: payload.error?.message ?? fallback,
    retryable: payload.error?.retryable ?? true,
    requestId: payload.error?.requestId,
    upstreamCalls: payload.error?.upstreamCalls,
    validationKind: payload.error?.validationKind,
    issues: payload.error?.issues,
  });
}

/** 从课程持久化错误中恢复可展示的脱敏诊断，刷新页面后仍能继续排查。 */
function storedErrorNotice(error?: Course["lastError"]): ErrorNotice | null {
  if (!error) return null;
  const details = error.details;
  const issues = Array.isArray(details?.issues)
    ? details.issues.filter((issue): issue is ErrorIssue => Boolean(
      issue && typeof issue === "object" && typeof (issue as { path?: unknown }).path === "string" && typeof (issue as { message?: unknown }).message === "string",
    ))
    : undefined;
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    requestId: typeof details?.requestId === "string" ? details.requestId : undefined,
    upstreamCalls: typeof details?.upstreamCalls === "number" ? details.upstreamCalls : undefined,
    validationKind: typeof details?.validationKind === "string" ? details.validationKind : undefined,
    issues,
  };
}

function caughtNotice(caught: unknown, fallback: string): ErrorNotice {
  if (caught instanceof ClientRequestError) return caught.notice;
  if (caught instanceof DOMException && caught.name === "AbortError")
    return {
      code: "REQUEST_CANCELLED",
      message: "本次浏览器请求已取消；服务端若已完成提交，刷新页面即可恢复。",
      retryable: true,
    };
  return {
    code: "REQUEST_FAILED",
    message: caught instanceof Error ? caught.message : fallback,
    retryable: true,
  };
}

/** 兼容修复前已经持久化为不可重试的模型输出错误；重新采样仍可能成功。 */
function canRetryGeneration(error?: { code: string; retryable: boolean }) {
  return Boolean(error && (error.retryable || error.code === "INVALID_MODEL_OUTPUT"));
}

function requiresServerConfiguration(error?: { code: string }) {
  return error?.code === "AI_NOT_CONFIGURED" || error?.code === "AI_AUTH_FAILED";
}

/** 根据服务端分类告诉用户下一步，不暴露 Provider 原始响应。 */
function recoveryGuidance(error: ErrorNotice) {
  if (requiresServerConfiguration(error)) return "请修正服务端 Provider 配置后再试。";
  if (error.retryable) return "服务端已在单请求预算内完成自动重试；仍失败时可在对应场景手动重试。";
  return "该错误不会自动重试，请根据 requestId 检查终端日志。";
}

const briefFieldLabels: Array<{ field: CourseBriefField; label: string }> = [
  { field: "audience", label: "目标受众" },
  { field: "learnerLevel", label: "学习水平" },
  { field: "learningGoal", label: "学习目标" },
  { field: "prerequisites", label: "先修知识" },
  { field: "durationMinutes", label: "预计时长" },
  { field: "teachingStyle", label: "教学风格" },
  { field: "interactionMode", label: "互动模式" },
  { field: "additionalRequirements", label: "附加要求" },
];

const sourceLabels = { explicit_setting: "高级设置", prompt: "课程描述", default: "系统默认" } as const;
const levelLabels = { beginner: "入门", intermediate: "进阶", advanced: "高级" } as const;
const styleLabels = { structured: "结构化讲解", case_based: "案例导向", practice_oriented: "练习导向" } as const;
const validationKindLabels: Record<string, string> = {
  json: "JSON 解析",
  schema: "Schema 结构校验",
  semantic: "课程语义校验",
};

function displayBriefValue(brief: CourseBrief, field: CourseBriefField) {
  const value = brief[field];
  if (Array.isArray(value)) return value.length > 0 ? value.join("；") : "无";
  if (field === "learnerLevel") return levelLabels[value as CourseBrief["learnerLevel"]];
  if (field === "teachingStyle") return styleLabels[value as CourseBrief["teachingStyle"]];
  if (field === "durationMinutes") return `${value} 分钟`;
  if (field === "interactionMode") return "关闭（M7.1）";
  return String(value);
}

export function GenerationWorkspace({ initialCourse }: { initialCourse: Course }) {
  const router = useRouter();
  const [course, setCourse] = useState(initialCourse);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ErrorNotice | null>(() => storedErrorNotice(initialCourse.lastError));
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [operationView, setOperationView] = useState<OperationView | null>(null);
  const [operationElapsedMs, setOperationElapsedMs] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [briefEditing, setBriefEditing] = useState(false);
  const [briefDraft, setBriefDraft] = useState<CourseBrief>(() => structuredClone(initialCourse.brief));
  const [leaseClock, setLeaseClock] = useState(initialCourse.updatedAt);
  const activeRequests = useRef(new Set<AbortController>());
  const cancellationRequested = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    const controllers = activeRequests.current;
    return () => {
      mounted.current = false;
      cancellationRequested.current = true;
      controllers.forEach((controller) => controller.abort());
    };
  }, []);

  useEffect(() => {
    if (!operationView || operationView.status !== "running") return;
    const timer = window.setInterval(() => setOperationElapsedMs(Date.now() - operationView.startedAt), 250);
    return () => window.clearInterval(timer);
  }, [operationView]);

  useEffect(() => {
    const expiresAt = course.activeOperation?.expiresAt;
    if (!expiresAt || expiresAt <= leaseClock) return;
    // 到达租约时间后主动刷新恢复条件，不在 render 阶段读取不稳定时钟。
    const timeout = window.setTimeout(
      () => setLeaseClock(Date.now()),
      Math.max(0, expiresAt - Date.now() + 25),
    );
    return () => window.clearTimeout(timeout);
  }, [course.activeOperation?.expiresAt, leaseClock]);

  /** 为页面发出的请求统一登记 AbortController，离开页面或用户取消时可全部终止。 */
  async function request(input: RequestInfo | URL, init?: RequestInit) {
    const controller = new AbortController();
    activeRequests.current.add(controller);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      activeRequests.current.delete(controller);
    }
  }

  /** 建立浏览器可见的操作编号；同一编号随请求传到服务端日志。 */
  function beginOperation(label: string) {
    const requestId = crypto.randomUUID();
    setOperationElapsedMs(0);
    setOperationView({
      requestId,
      label,
      status: "running",
      startedAt: Date.now(),
    });
    return requestId;
  }

  function finishOperation(status: OperationView["status"], label?: string) {
    setOperationView((current) =>
      current ? { ...current, status, label: label ?? current.label } : current,
    );
  }

  function cancelCurrentRequests() {
    cancellationRequested.current = true;
    activeRequests.current.forEach((controller) => controller.abort());
    finishOperation("cancelled", "浏览器请求已取消；等待刷新同步服务端事实");
    setBusy(null);
    setError({
      code: "REQUEST_CANCELLED",
      message: "已取消浏览器中的未完成请求。刷新页面可同步服务端最终状态。",
      retryable: true,
    });
  }

  function updateOutline(index: number, changes: Partial<SceneOutline>) {
    // 1. 先更新页面上的大纲内容，暂时不保存到数据库。
    setCourse((current) => ({
      ...current,
      outlines: current.outlines.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...changes } : item,
      ),
    }));
    setDirty(true);
    setSavedNotice(null);
  }

  /** 保存真正发生变化的 Brief 字段；服务端负责标记来源并使旧大纲失效。 */
  async function saveBriefChanges() {
    const changes = Object.fromEntries(
      briefFieldLabels
        .filter(({ field }) => JSON.stringify(briefDraft[field]) !== JSON.stringify(course.brief[field]))
        .map(({ field }) => [field, briefDraft[field]]),
    );
    if (Object.keys(changes).length === 0) {
      setBriefEditing(false);
      return;
    }
    setBusy("brief");
    setError(null);
    setSavedNotice(null);
    const requestId = beginOperation("正在保存课程要求并使旧大纲失效");
    try {
      const response = await request(`/api/courses/${course.id}/brief`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-request-id": requestId },
        body: JSON.stringify({ expectedRevision: course.revision, changes }),
      });
      const payload = await response.json();
      if (!response.ok) throw responseError(payload, "课程要求保存失败");
      setCourse(payload.data.course);
      setBriefDraft(structuredClone(payload.data.course.brief));
      setBriefEditing(false);
      setDirty(false);
      finishOperation("succeeded", "课程要求已保存，请重新生成大纲");
      setSavedNotice("课程要求已更新；依赖旧要求的大纲已失效，请重新生成。 ");
      router.refresh();
    } catch (caught) {
      finishOperation(caught instanceof DOMException && caught.name === "AbortError" ? "cancelled" : "failed");
      setError(caughtNotice(caught, "课程要求保存失败"));
    } finally {
      setBusy(null);
    }
  }

  /** 请求服务端正式大纲管线；主题、场景数量和 Provider 均不由浏览器覆盖。 */
  async function generateCourseOutline() {
    // 1. 重置页面状态，准备开始生成大纲。
    cancellationRequested.current = false;
    setBusy("outline");
    setError(null);
    setSavedNotice(null);

    // 2. 生成本次请求编号，并显示“正在生成”。
    const requestId = beginOperation("正在生成并校验课程大纲");

    try {
      // 3. 发送当前课程版本号，请求服务端生成大纲。
      const response = await request(`/api/courses/${course.id}/outline/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify({ expectedRevision: course.revision }),
      });

      // 4. 读取接口返回的已保存课程。
      const payload = await response.json();
      if (!response.ok) throw responseError(payload, "大纲生成失败");
      setCourse(payload.data.course);
      setDirty(false);
      finishOperation("succeeded", "课程大纲已生成并保存");
      setSavedNotice("大纲已通过解析、Schema 与语义门，并保存到 MySQL。现在可以人工修订。");

      // 5. 刷新页面数据，显示最新课程状态。
      router.refresh();
    } catch (caught) {
      finishOperation(
        caught instanceof DOMException && caught.name === "AbortError" ? "cancelled" : "failed",
      );
      setError(caughtNotice(caught, "大纲生成失败"));
      if (caught instanceof DOMException && caught.name === "AbortError") return;

      // 生成失败也会由服务端提交 failed 与新 revision，立即同步避免重试使用旧版本。
      // 6. 生成失败后重新读取课程，显示服务端保存的失败状态。
      const latestResponse = await request(`/api/courses/${course.id}`);
      if (latestResponse.ok) setCourse((await latestResponse.json()).course);
    } finally {
      setBusy(null);
    }
  }

  /** 将人工修订后的完整大纲交回服务端复验并按 revision 保存。 */
  async function persistOutline(): Promise<Course> {
    // 1. 把用户修改后的完整大纲发给服务端检查并保存。
    const requestId = beginOperation("正在验证并保存人工修订的大纲");
    const response = await request(`/api/courses/${course.id}/outline`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": requestId,
      },
      body: JSON.stringify({
        expectedRevision: course.revision,
        courseTitle: course.title,
        outlines: course.outlines,
      }),
    });

    // 2. 读取服务端校验后的保存结果。
    const payload = await response.json();
    if (!response.ok) {
      finishOperation("failed");
      throw responseError(payload, "大纲保存失败");
    }

    // 3. 用保存后的课程替换页面中的旧课程。
    setCourse(payload.data.course);
    setDirty(false);
    finishOperation("succeeded", "人工修订的大纲已保存");
    return payload.data.course;
  }

  async function saveOutline() {
    cancellationRequested.current = false;
    setBusy("save");
    setError(null);
    try {
      await persistOutline();
      setSavedNotice("人工修订已保存，并重新通过课程级语义校验。");
      router.refresh();
    } catch (caught) {
      finishOperation(
        caught instanceof DOMException && caught.name === "AbortError" ? "cancelled" : "failed",
      );
      setError(caughtNotice(caught, "大纲保存失败"));
    } finally {
      setBusy(null);
    }
  }

  async function loadLatestCourse(): Promise<Course> {
    // 1. 从服务端重新读取这门课程。
    const response = await request(`/api/courses/${course.id}`);
    if (!response.ok) throw new Error("无法同步服务器中的最新课程状态");
    const latest = (await response.json()).course as Course;
    setCourse(latest);
    return latest;
  }

  /** 生成一个指定场景；失败后立即读取服务端提交的 failed 进度和新 revision。 */
  async function generateOneScene(
    current: Course,
    outlineId: string,
  ): Promise<{ course: Course; failed: boolean }> {
    // 1. 找到当前要生成的场景标题。
    const outline = current.outlines.find((item) => item.id === outlineId);
    const requestId = beginOperation(
      `正在生成场景 ${outline?.order ?? "?"}/${current.requestedSceneCount} · ${outline?.title ?? outlineId}`,
    );
    // 2. 页面先显示该场景正在生成。
    setCourse({
      ...current,
      status: "generating",
      sceneProgress: current.sceneProgress.map((item) =>
        item.outlineId === outlineId ? { ...item, status: "generating" } : item,
      ),
    });
    try {
      // 3. 请求服务端只生成这一场。
      const response = await request(`/api/courses/${current.id}/scenes/${outlineId}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify({ expectedRevision: current.revision }),
      });
      const payload = await response.json();
      if (!response.ok) throw responseError(payload, "场景生成失败");
      // 4. 用服务端返回的课程更新页面。
      const saved = payload.data.course as Course;
      setCourse(saved);
      finishOperation("succeeded", `场景 ${outline?.order ?? "?"} 已校验并保存`);
      return { course: saved, failed: false };
    } catch (caught) {
      finishOperation(
        caught instanceof DOMException && caught.name === "AbortError" ? "cancelled" : "failed",
      );
      if (caught instanceof DOMException && caught.name === "AbortError" && !mounted.current) {
        return { course: current, failed: true };
      }
      // 5. 失败后重新读取课程，显示这场的失败原因。
      const latest = await loadLatestCourse();
      const latestOutline = latest.outlines.find((item) => item.id === outlineId);
      const notice = caughtNotice(caught, "场景生成失败");
      setError((currentError) => ({
        ...notice,
        message: [currentError?.message, `${latestOutline?.title ?? "场景"}：${notice.message}`]
          .filter(Boolean)
          .join("\n"),
      }));
      return { course: latest, failed: true };
    }
  }

  /** 严格串行生成 pending 场景；某一项失败后仍继续后面的未生成项。 */
  async function generatePendingScenes(startCourse: Course) {
    // 1. 从当前课程开始，依次生成未完成的场景。
    let current = startCourse;
    let failureCount = 0;
    // 2. 按大纲顺序，一个一个生成场景。
    for (const outline of current.outlines) {
      const progress = current.sceneProgress.find((item) => item.outlineId === outline.id);
      // 3. 只处理状态为 pending 的场景。
      if (progress?.status !== "pending") continue;
      const result = await generateOneScene(current, outline.id);
      current = result.course;
      if (result.failed) failureCount += 1;
      // 4. 用户取消后，不再开始下一场生成。
      if (cancellationRequested.current) break;
    }
    // 5. 循环结束后，显示最后一次保存的课程状态。
    setCourse(current);
    setSavedNotice(
      failureCount === 0 && current.status === "ready"
        ? "全部场景均已通过模型边界并增量保存，可以进入课堂。"
        : null,
    );
    router.refresh();
  }

  /** 确认前先保存编辑稿，再按大纲顺序逐场景调用正式生成接口。 */
  async function confirmAndGenerateScenes() {
    // 1. 如果用户改过大纲，先保存大纲。
    cancellationRequested.current = false;
    setBusy("scenes");
    setError(null);
    try {
      // 2. 再按顺序生成所有待处理场景。
      const saved = dirty ? await persistOutline() : course;
      await generatePendingScenes(saved);
      setDirty(false);
    } catch (caught) {
      finishOperation(
        caught instanceof DOMException && caught.name === "AbortError" ? "cancelled" : "failed",
      );
      setError(caughtNotice(caught, "场景生成失败"));
    } finally {
      setBusy(null);
    }
  }

  async function continuePendingScenes() {
    cancellationRequested.current = false;
    setBusy("scenes");
    setError(null);
    try {
      await generatePendingScenes(course);
    } catch (caught) {
      setError(caughtNotice(caught, "继续生成失败"));
    } finally {
      setBusy(null);
    }
  }

  async function retryScene(outlineId: string) {
    cancellationRequested.current = false;
    setBusy(`scene:${outlineId}`);
    setError(null);
    try {
      const result = await generateOneScene(course, outlineId);
      if (!result.failed && result.course.status === "ready")
        setSavedNotice("失败场景已修复，整门课程现在可以进入课堂。");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const readyCount = course.sceneProgress.filter((item) => item.status === "ready").length;
  const editable = course.status === "outline_ready";
  const metadata = course.outlineGeneration;
  const pendingCount = course.sceneProgress.filter((item) => item.status === "pending").length;
  const briefEditable = course.scenes.length === 0 && ["draft", "failed", "outline_ready"].includes(course.status);

  return (
    <main className="workspace-shell">
      <header className="site-header site-header--compact">
        <Link className="brand" href="/">
          <span className="brand-mark">课</span>
          <span>
            <strong>课序</strong>
            <small>COURSE COMPOSER</small>
          </span>
        </Link>
        <div className="step-nav">
          <span className="is-done">01 主题</span>
          <span className="is-active">02 大纲</span>
          <span>03 课堂</span>
        </div>
      </header>

      <section className="workspace-title reveal reveal--one">
        <div>
          <p className="eyebrow">OUTLINE STUDIO / REV.{course.revision}</p>
          <h1>{course.title}</h1>
          <p>
            {course.topic} · {course.requestedSceneCount} 个教学场景 ·{" "}
            {metadata ? `${metadata.provider} / ${metadata.model}` : "等待生成"}
          </p>
        </div>
        <span className={`large-state large-state--${course.status}`}>
          {course.status === "ready"
            ? "READY"
            : course.status === "partial_failed"
              ? "REPAIR"
              : course.status === "generating"
                ? "BUILD"
                : course.status === "draft" || course.status === "failed"
                  ? "DRAFT"
                  : "REVIEW"}
        </span>
      </section>

      <div className="generation-layout">
        <section className="brief-panel reveal reveal--two">
          <div className="brief-panel__head">
            <div><span>COURSE BRIEF / {course.briefResolution.status.toUpperCase()}</span><h2>系统采用的课程要求</h2></div>
            {briefEditable ? <button type="button" onClick={() => { if (!briefEditing) setBriefDraft(structuredClone(course.brief)); setBriefEditing(!briefEditing); }} disabled={busy !== null}>{briefEditing ? "取消修改" : "修改要求"}</button> : <small>场景生成后锁定</small>}
          </div>
          {briefEditing ? (
            <div className="brief-editor">
              <label><span>目标受众</span><input value={briefDraft.audience} maxLength={120} onChange={(event) => setBriefDraft({ ...briefDraft, audience: event.target.value })} /></label>
              <label><span>学习水平</span><select value={briefDraft.learnerLevel} onChange={(event) => setBriefDraft({ ...briefDraft, learnerLevel: event.target.value as CourseBrief["learnerLevel"] })}><option value="beginner">入门</option><option value="intermediate">进阶</option><option value="advanced">高级</option></select></label>
              <label className="brief-editor__wide"><span>学习目标</span><input value={briefDraft.learningGoal} maxLength={300} onChange={(event) => setBriefDraft({ ...briefDraft, learningGoal: event.target.value })} /></label>
              <label><span>预计时长</span><select value={briefDraft.durationMinutes} onChange={(event) => setBriefDraft({ ...briefDraft, durationMinutes: Number(event.target.value) as 10 | 15 | 20 })}><option value="10">10 分钟</option><option value="15">15 分钟</option><option value="20">20 分钟</option></select></label>
              <label><span>教学风格</span><select value={briefDraft.teachingStyle} onChange={(event) => setBriefDraft({ ...briefDraft, teachingStyle: event.target.value as CourseBrief["teachingStyle"] })}><option value="structured">结构化讲解</option><option value="case_based">案例导向</option><option value="practice_oriented">练习导向</option></select></label>
              <label><span>先修知识（每行一项）</span><textarea value={briefDraft.prerequisites.join("\n")} onChange={(event) => setBriefDraft({ ...briefDraft, prerequisites: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) })} /></label>
              <label><span>附加要求（每行一项）</span><textarea value={briefDraft.additionalRequirements.join("\n")} onChange={(event) => setBriefDraft({ ...briefDraft, additionalRequirements: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) })} /></label>
              <div className="brief-editor__notice">保存后旧大纲会失效，但不会调用模型；重新生成大纲时才会产生一次 outline.v2 请求。</div>
              <button className="button button--accent" type="button" onClick={saveBriefChanges} disabled={busy !== null}>保存要求并重置大纲 <span>→</span></button>
            </div>
          ) : (
            <div className="brief-facts">
              {briefFieldLabels.map(({ field, label }) => <div key={field}><span>{label}</span><strong>{displayBriefValue(course.brief, field)}</strong><small>{sourceLabels[course.briefResolution.sources[field]]}</small></div>)}
            </div>
          )}
          {course.briefResolution.warnings.length > 0 ? <div className="brief-warnings">{course.briefResolution.warnings.map((warning, index) => <p key={`${warning.code}-${index}`}><strong>{warning.code}</strong>{warning.message}</p>)}</div> : null}
        </section>
        <section className="outline-panel reveal reveal--two">
          <div className="panel-heading">
            <div>
              <span>COURSE MAP</span>
              <h2>{editable ? "审核课程大纲" : "课程大纲"}</h2>
            </div>
            <p>
              {editable
                ? "修改标题、教学目标和关键点；保存时服务端会再次校验。"
                : "模型输出必须先通过不可信边界，才能进入这里。"}
            </p>
          </div>

          {course.outlines.length === 0 ? (
            <div className="outline-empty">
              <span>00</span>
              <div>
                <h3>还没有课程骨架</h3>
                <p>
                  点击右侧按钮后，mock 或当前服务端 Provider 会生成结构化大纲。模型返回的 JSON
                  不会直接写入数据库。
                </p>
              </div>
            </div>
          ) : (
            <>
              <label className="course-title-editor">
                <span>课程标题</span>
                <input
                  value={course.title}
                  disabled={!editable || busy !== null}
                  onChange={(event) => {
                    setCourse((current) => ({
                      ...current,
                      title: event.target.value,
                    }));
                    setDirty(true);
                    setSavedNotice(null);
                  }}
                />
              </label>
              <ol className="outline-list">
                {course.outlines.map((outline, index) => {
                  const progress = course.sceneProgress.find((item) => item.outlineId === outline.id);
                  const recoverable =
                    progress?.status === "generating" &&
                    course.activeOperation?.outlineId === outline.id &&
                    course.activeOperation.expiresAt <= leaseClock;
                  const canRetry = progress?.status === "failed" && canRetryGeneration(progress.lastError);
                  return (
                    <li key={outline.id}>
                      <span className="outline-order">{String(outline.order).padStart(2, "0")}</span>
                      <div className="outline-content outline-content--editable">
                        <div>
                          <span className={`type-chip type-chip--${outline.type}`}>{outline.type}</span>
                          <span className="role-chip">{outline.role}</span>
                          <input
                            className="outline-title-input"
                            aria-label={`第 ${outline.order} 场标题`}
                            value={outline.title}
                            disabled={!editable || busy !== null}
                            onChange={(event) =>
                              updateOutline(index, {
                                title: event.target.value,
                              })
                            }
                          />
                        </div>
                        <textarea
                          aria-label={`第 ${outline.order} 场教学目标`}
                          value={outline.teachingObjective}
                          disabled={!editable || busy !== null}
                          onChange={(event) =>
                            updateOutline(index, {
                              teachingObjective: event.target.value,
                            })
                          }
                        />
                        <label>
                          <span>关键点（每行一项）</span>
                          <textarea
                            value={outline.keyPoints.join("\n")}
                            disabled={!editable || busy !== null}
                            onChange={(event) =>
                              updateOutline(index, {
                                keyPoints: event.target.value
                                  .split(/\r?\n/)
                                  .map((point) => point.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </label>
                        {progress?.lastError ? (
                          <p className="scene-error-inline">
                            {progress.lastError.code} · {progress.lastError.message}
                          </p>
                        ) : null}
                      </div>
                      <div className="scene-progress-cell">
                        <span className={`progress-mark progress-mark--${progress?.status}`}>
                          {progress?.status === "ready"
                            ? "✓"
                            : progress?.status === "failed"
                              ? "!"
                              : progress?.status === "generating"
                                ? "…"
                                : "○"}
                        </span>
                        <small>
                          {progress?.status === "ready"
                            ? "完成"
                            : progress?.status === "failed"
                              ? "失败"
                              : recoverable
                                ? "可恢复"
                                : progress?.status === "generating"
                                  ? "生成中"
                                  : "待生成"}
                        </small>
                        {canRetry || recoverable ? (
                          <button
                            type="button"
                            onClick={() => retryScene(outline.id)}
                            disabled={busy !== null}
                          >
                            {busy === `scene:${outline.id}` ? "处理中" : recoverable ? "恢复" : "重试"}
                          </button>
                        ) : null}
                        {progress?.status === "failed" && !canRetry ? (
                          <em>
                            {requiresServerConfiguration(progress.lastError) ? "需修正配置" : "需人工处理"}
                          </em>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>

        <aside className="generation-aside reveal reveal--three">
          <div className="metric-card">
            <p>SCENE PROGRESS</p>
            <strong>
              {String(readyCount).padStart(2, "0")}
              <span> / {String(course.requestedSceneCount).padStart(2, "0")}</span>
            </strong>
            <div className="progress-track">
              <i
                style={{
                  width: `${(readyCount / course.requestedSceneCount) * 100}%`,
                }}
              />
            </div>
          </div>
          <div className="boundary-card">
            <span>M7.1 BRIEF-AWARE PIPELINE</span>
            <h3>
              {readyCount > 0
                ? `${String(readyCount).padStart(2, "0")} 个场景已独立提交`
                : metadata
                  ? `${metadata.provider.toUpperCase()} · 大纲已就绪`
                  : "先登记，再调用，后提交"}
            </h3>
            <p>
              {course.status === "partial_failed"
                ? "已完成场景仍安全保留。模型输出不合约可重新采样；认证或配置错误需要先修正服务端环境。"
                : "每个 slide / quiz 都独立经过解析、Schema、语义门和短事务；离开页面会取消浏览器请求，服务端事实仍可刷新恢复。"}
            </p>
          </div>
          {operationView ? (
            <div
              className={`operation-console operation-console--${operationView.status}`}
              role="status"
              aria-live="polite"
            >
              <div>
                <span>LIVE OPERATION</span>
                <strong>
                  {operationView.status === "running"
                    ? `${(operationElapsedMs / 1000).toFixed(1)}s`
                    : operationView.status.toUpperCase()}
                </strong>
              </div>
              <p>{operationView.label}</p>
              <code>requestId: {operationView.requestId}</code>
              <small>
                {operationView.status === "running"
                  ? "终端每 10 秒输出 running 心跳；临时远端异常会在 4 次总预算内自动重试"
                  : "可用 requestId 对照终端中的结束日志"}
              </small>
            </div>
          ) : null}
          {savedNotice ? (
            <p className="form-success" role="status">
              {savedNotice}
            </p>
          ) : null}
          {error ? (
            <div className="form-error error-notice" role="alert">
              <span>
                {error.code} · {requiresServerConfiguration(error) ? "需修正配置" : error.retryable ? "可手动重试" : "需人工处理"}
              </span>
              <p>{error.message}</p>
              {error.requestId || error.upstreamCalls !== undefined || error.validationKind ? (
                <div className="error-diagnostics">
                  {error.requestId ? <code>requestId: {error.requestId}</code> : null}
                  {error.upstreamCalls !== undefined ? <code>上游调用: {error.upstreamCalls}</code> : null}
                  {error.validationKind ? <code>失败阶段: {validationKindLabels[error.validationKind] ?? error.validationKind}</code> : null}
                </div>
              ) : null}
              {error.issues && error.issues.length > 0 ? (
                <ul className="error-issues">
                  {error.issues.slice(0, 5).map((issue, index) => (
                    <li key={`${issue.path}-${index}`}>
                      <code>{issue.path || "root"}</code>：{issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              <small>{recoveryGuidance(error)}</small>
            </div>
          ) : null}
          {busy ? (
            <button className="cancel-request" type="button" onClick={cancelCurrentRequests}>
              取消当前请求
            </button>
          ) : null}
          {course.status !== "ready" && readyCount > 0 && busy === null ? (
            <Link className="button button--dark button--wide" href={`/classroom/${course.id}`}>
              预览已生成的 {readyCount} 个场景 <span>→</span>
            </Link>
          ) : null}
          {course.status === "ready" ? (
            <Link className="button button--accent button--wide" href={`/classroom/${course.id}`}>
              进入课堂 <span>→</span>
            </Link>
          ) : editable ? (
            <>
              <button
                className="button button--dark button--wide"
                type="button"
                onClick={saveOutline}
                disabled={busy !== null || !dirty}
              >
                {busy === "save" ? "正在校验保存…" : dirty ? "保存修订" : "修订已保存"}
                <span>↗</span>
              </button>
              <button
                className="button button--accent button--wide"
                type="button"
                onClick={confirmAndGenerateScenes}
                disabled={busy !== null}
              >
                {busy === "scenes"
                  ? `正在生成 ${readyCount + 1} / ${course.requestedSceneCount}…`
                  : "确认大纲并生成场景"}
                <span>→</span>
              </button>
            </>
          ) : ["generating", "partial_failed"].includes(course.status) ? (
            course.activeOperation ? (
              <p className="generation-hint">
                存在登记中的场景操作。租约到期后，可在对应场景右侧点击“恢复”。
              </p>
            ) : pendingCount > 0 ? (
              <button
                className="button button--accent button--wide"
                type="button"
                onClick={continuePendingScenes}
                disabled={busy !== null}
              >
                {busy === "scenes"
                  ? `正在生成 ${readyCount + 1} / ${course.requestedSceneCount}…`
                  : `继续生成 ${pendingCount} 个待处理场景`}
                <span>→</span>
              </button>
            ) : (
              <p className="generation-hint">没有待生成项，请在失败场景右侧点击“重试”。</p>
            )
          ) : (
            <button
              className="button button--accent button--wide"
              type="button"
              onClick={generateCourseOutline}
              disabled={
                busy !== null ||
                course.status === "outlining" ||
                Boolean(course.lastError && !canRetryGeneration(course.lastError))
              }
            >
              {busy === "outline" || course.status === "outlining"
                ? "正在生成并校验…"
                : course.lastError && !canRetryGeneration(course.lastError)
                  ? requiresServerConfiguration(course.lastError)
                    ? "请先修正服务端配置"
                    : "当前错误需要人工处理"
                  : course.status === "failed"
                    ? "重试大纲生成"
                    : "生成课程大纲"}
              <span>→</span>
            </button>
          )}
          <Link className="text-link" href="/">
            ← 返回课程首页
          </Link>
        </aside>
      </div>
    </main>
  );
}
