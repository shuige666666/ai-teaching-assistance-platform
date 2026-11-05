"use client";

import { CourseMaterialsPanel } from "./course-materials-panel";
import { LineListTextarea } from "./line-list-textarea";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Check, ChevronDown, CircleAlert, CircleCheck, CircleStop, Cpu, Eye, Info, Lightbulb, ListChecks, ListTree, Lock,
  MousePointerClick, Pencil, Play, Presentation, Puzzle, RotateCcw, Save, Sparkles, Target, TriangleAlert, WandSparkles, X,
} from "lucide-react";
import { AppHeader, Stepper, type StepState } from "@/components/layout/app-header";
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

type Tone = "neutral" | "info" | "progress" | "success" | "warning" | "danger";

const courseStatusView: Record<Course["status"], { label: string; tone: Tone }> = {
  draft: { label: "草稿", tone: "neutral" },
  outlining: { label: "正在生成大纲", tone: "progress" },
  outline_ready: { label: "待审核大纲", tone: "info" },
  generating: { label: "正在生成场景", tone: "progress" },
  partial_failed: { label: "部分场景失败", tone: "warning" },
  ready: { label: "可以上课", tone: "success" },
  failed: { label: "生成失败", tone: "danger" },
};

const sceneTypeView = {
  slide: { label: "讲解", icon: Presentation },
  quiz: { label: "测验", icon: ListChecks },
  interactive: { label: "互动", icon: Puzzle },
} as const;

const roleLabels: Record<string, string> = {
  hook: "导入",
  concept: "概念",
  mechanism: "机制",
  worked_example: "例题",
  practice: "练习",
  summary: "总结",
  assessment: "测评",
};

const warningLabels: Record<string, string> = {
  SETTING_PROMPT_CONFLICT: "设置与描述存在冲突",
  PROMPT_AMBIGUOUS: "课程描述不够明确",
  SCOPE_TOO_BROAD: "主题范围偏大",
};

/** 侧栏用一句话告诉用户当前该做什么。 */
function nextStepText(course: Course, materialsPending: boolean) {
  if (materialsPending) return "先保存或移除待上传的教学材料，再继续生成。";
  switch (course.status) {
    case "draft":
      return course.outlines.length === 0 ? "选择是否需要互动场景，然后生成课程大纲。" : "生成课程大纲后即可人工审核。";
    case "outlining":
      return "AI 正在拟定大纲，请稍候。";
    case "outline_ready":
      return "检查并修改大纲，确认后会逐场生成讲解、互动和测验。";
    case "generating":
      return "场景正在逐个生成，已完成的部分可以先预览。";
    case "partial_failed":
      return "部分场景没有生成成功，可在大纲中逐个重试，已完成的场景不受影响。";
    case "ready":
      return "全部场景已生成，可以进入课堂开始讲解。";
    case "failed":
      return "大纲生成没有成功，查看下方原因后可以重试。";
  }
}

function displayBriefValue(brief: CourseBrief, field: CourseBriefField) {
  const value = brief[field];
  if (Array.isArray(value)) return value.length > 0 ? value.join("；") : "无";
  if (field === "learnerLevel") return levelLabels[value as CourseBrief["learnerLevel"]];
  if (field === "teachingStyle") return styleLabels[value as CourseBrief["teachingStyle"]];
  if (field === "durationMinutes") return `${value} 分钟`;
  if (field === "interactionMode") return value === "required" ? "需要互动场景" : "不需要互动场景";
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
  const [materialsPending, setMaterialsPending] = useState(false);
  const [briefEditing, setBriefEditing] = useState(false);
  const [briefExpanded, setBriefExpanded] = useState(initialCourse.scenes.length === 0);
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

  /** 在生成大纲前直接保存互动选择，确保模型只读取 MySQL 中的课程事实。 */
  async function chooseInteractionMode(interactionMode: "off" | "required") {
    if (course.brief.interactionMode === interactionMode || course.outlines.length > 0) return;
    setBusy("interaction");
    setError(null);
    const requestId = beginOperation("正在保存互动场景选择");
    try {
      const response = await request(`/api/courses/${course.id}/brief`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-request-id": requestId },
        body: JSON.stringify({ expectedRevision: course.revision, changes: { interactionMode } }),
      });
      const payload = await response.json();
      if (!response.ok) throw responseError(payload, "互动场景选择保存失败");
      setCourse(payload.data.course);
      setBriefDraft(structuredClone(payload.data.course.brief));
      finishOperation("succeeded", interactionMode === "required" ? "已开启互动场景" : "已关闭互动场景");
    } catch (caught) {
      finishOperation("failed");
      setError(caughtNotice(caught, "互动场景选择保存失败"));
    } finally {
      setBusy(null);
    }
  }

  /** 请求服务端正式大纲管线；主题、场景数量和 Provider 均不由浏览器覆盖。 */
  async function generateCourseOutline() {
    if (materialsPending) return;
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
    if (materialsPending) return;
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
  const failedCount = course.sceneProgress.filter((item) => item.status === "failed").length;
  const editable = course.status === "outline_ready";
  const metadata = course.outlineGeneration;
  const pendingCount = course.sceneProgress.filter((item) => item.status === "pending").length;
  const briefEditable = course.scenes.length === 0 && ["draft", "failed", "outline_ready"].includes(course.status);
  const stage = course.status === "ready" ? 3 : ["generating", "partial_failed"].includes(course.status) ? 2 : 1;
  const steps: Array<{ label: string; state: StepState }> = [
    { label: "主题", state: "done" },
    { label: "大纲", state: stage > 1 ? "done" : "current" },
    { label: "场景", state: stage > 2 ? "done" : stage === 2 ? "current" : "todo" },
    { label: "课堂", state: stage === 3 ? "current" : "todo" },
  ];
  const progressPercent = course.requestedSceneCount ? (readyCount / course.requestedSceneCount) * 100 : 0;

  return (
    <div className="page">
      <AppHeader>
        <Stepper steps={steps} />
      </AppHeader>
      <main className="page-main generation">
        <Link className="back-link" href="/"><ArrowLeft aria-hidden="true" />课程库</Link>
        <section className="course-hero reveal">
          <div className="course-hero__badges">
            <span className={`badge badge--dot badge--${courseStatusView[course.status].tone}`}>{courseStatusView[course.status].label}</span>
            <span className="meta-chip">REV.{course.revision}</span>
            {metadata ? <span className="meta-chip"><Cpu aria-hidden="true" />{metadata.provider} / {metadata.model}</span> : null}
          </div>
          <h1>{course.title}</h1>
          <p>{course.topic} · 计划 {course.requestedSceneCount} 个教学场景</p>
        </section>

        <div className="generation-layout">
          <div className="generation-main">
            <section className="panel brief-panel reveal reveal--two" aria-labelledby="brief-title">
              <header className="panel__head">
                <div className="panel__title">
                  <span className="panel__icon" aria-hidden="true"><Target /></span>
                  <div>
                    <h2 id="brief-title">系统采用的课程要求</h2>
                    <p>{course.briefResolution.status === "resolved" ? "已结合课程描述与设置确定" : "初步推断，生成大纲时会进一步确定"}</p>
                  </div>
                </div>
                <div className="panel__actions">
                  {briefEditable ? (
                    <button className="btn btn--secondary btn--sm" type="button" onClick={() => { if (!briefEditing) setBriefDraft(structuredClone(course.brief)); setBriefEditing(!briefEditing); setBriefExpanded(true); }} disabled={busy !== null}>
                      {briefEditing ? <><X aria-hidden="true" />取消修改</> : <><Pencil aria-hidden="true" />修改要求</>}
                    </button>
                  ) : <span className="meta-chip"><Lock aria-hidden="true" />场景生成后锁定</span>}
                  {!briefEditing ? (
                    <button className="icon-btn" type="button" aria-expanded={briefExpanded} aria-controls="brief-body" aria-label={briefExpanded ? "收起课程要求" : "展开课程要求"} onClick={() => setBriefExpanded(!briefExpanded)}>
                      <ChevronDown className={briefExpanded ? "is-flipped" : undefined} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </header>
              <div id="brief-body" hidden={!briefExpanded && !briefEditing}>
                {briefEditing ? (
                  <div className="brief-editor form-grid">
                    <label className="field"><span>目标受众</span><input value={briefDraft.audience} maxLength={120} onChange={(event) => setBriefDraft({ ...briefDraft, audience: event.target.value })} /></label>
                    <label className="field"><span>学习水平</span><select value={briefDraft.learnerLevel} onChange={(event) => setBriefDraft({ ...briefDraft, learnerLevel: event.target.value as CourseBrief["learnerLevel"] })}><option value="beginner">入门</option><option value="intermediate">进阶</option><option value="advanced">高级</option></select></label>
                    <label className="field span-2"><span>学习目标</span><input value={briefDraft.learningGoal} maxLength={300} onChange={(event) => setBriefDraft({ ...briefDraft, learningGoal: event.target.value })} /></label>
                    <label className="field"><span>预计时长</span><select value={briefDraft.durationMinutes} onChange={(event) => setBriefDraft({ ...briefDraft, durationMinutes: Number(event.target.value) as 10 | 15 | 20 })}><option value="10">10 分钟</option><option value="15">15 分钟</option><option value="20">20 分钟</option></select></label>
                    <label className="field"><span>教学风格</span><select value={briefDraft.teachingStyle} onChange={(event) => setBriefDraft({ ...briefDraft, teachingStyle: event.target.value as CourseBrief["teachingStyle"] })}><option value="structured">结构化讲解</option><option value="case_based">案例导向</option><option value="practice_oriented">练习导向</option></select></label>
                    <label className="field"><span>互动场景</span><select value={briefDraft.interactionMode === "required" ? "required" : "off"} onChange={(event) => setBriefDraft({ ...briefDraft, interactionMode: event.target.value as "off" | "required" })}><option value="off">不需要</option><option value="required">需要，由 AI 安排</option></select></label>
                    <span className="form-grid__spacer" aria-hidden="true" />
                    <label className="field"><span>先修知识（每行一项）</span><LineListTextarea value={briefDraft.prerequisites} onChange={(prerequisites) => setBriefDraft((current) => ({ ...current, prerequisites }))} /></label>
                    <label className="field"><span>附加要求（每行一项）</span><LineListTextarea value={briefDraft.additionalRequirements} onChange={(additionalRequirements) => setBriefDraft((current) => ({ ...current, additionalRequirements }))} /></label>
                    <div className="brief-editor__footer span-2">
                      <p className="form-note"><Info aria-hidden="true" />保存后旧大纲会失效，但不会调用模型；重新生成大纲时才会产生一次模型请求。</p>
                      <button className="btn btn--primary" type="button" onClick={saveBriefChanges} disabled={busy !== null}>
                        {busy === "brief" ? <span className="spinner" aria-hidden="true" /> : <Check aria-hidden="true" />}保存要求并重置大纲
                      </button>
                    </div>
                  </div>
                ) : (
                  <dl className="brief-facts">
                    {briefFieldLabels.map(({ field, label }) => (
                      <div className="brief-fact" key={field}>
                        <dt>{label}</dt>
                        <dd><strong>{displayBriefValue(course.brief, field)}</strong><small className={`source-tag source-tag--${course.briefResolution.sources[field]}`}>{sourceLabels[course.briefResolution.sources[field]]}</small></dd>
                      </div>
                    ))}
                  </dl>
                )}
                {course.briefResolution.warnings.length > 0 ? (
                  <div className="brief-warnings">
                    {course.briefResolution.warnings.map((warning, index) => (
                      <div className="notice notice--warning" key={`${warning.code}-${index}`}>
                        <TriangleAlert aria-hidden="true" />
                        <div className="notice__body"><strong>{warningLabels[warning.code] ?? warning.code}</strong><p>{warning.message}</p></div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </section>

            <CourseMaterialsPanel course={course} disabled={busy !== null} onPendingChange={setMaterialsPending}
              onBusyChange={(saving) => setBusy(saving ? "materials" : null)}
              onCourseChange={(saved) => { setCourse(saved); setDirty(false); setError(null); setOperationView(null); setSavedNotice("教学材料已更新，请重新生成大纲。"); router.refresh(); }} />
            {materialsPending ? (
              <div className="notice notice--warning" role="status">
                <TriangleAlert aria-hidden="true" />
                <p>有尚未保存的材料。请先解析并保存，或移除待上传文件，再开始生成。</p>
              </div>
            ) : null}

            <section className="panel outline-panel reveal reveal--two" aria-labelledby="outline-title">
              <header className="panel__head">
                <div className="panel__title">
                  <span className="panel__icon panel__icon--violet" aria-hidden="true"><ListTree /></span>
                  <div>
                    <h2 id="outline-title">{editable ? "审核课程大纲" : "课程大纲"}</h2>
                    <p>
                      {course.outlines.length === 0
                        ? "大纲生成后会显示在这里"
                        : editable
                          ? "可直接修改标题、教学目标和关键点，保存时服务端会再次校验"
                          : `${course.outlines.length} 个场景 · 已完成 ${readyCount} 个`}
                    </p>
                  </div>
                </div>
                {editable && dirty ? <span className="badge badge--warning">有未保存的修改</span> : null}
              </header>

              {course.outlines.length === 0 ? (
                <div className="outline-empty">
                  <h3>先选择这门课是否需要互动场景</h3>
                  <p>开启后，4 场景安排 1 个，5～6 场景安排 1～2 个，7～8 场景安排 1～3 个互动，AI 会按内容设计关系探索、过程模拟、互动挑战或编程实验。</p>
                  <div className="interaction-choice" role="group" aria-label="互动场景选择">
                    <button type="button" className={`choice-card${course.brief.interactionMode === "off" ? " is-active" : ""}`} aria-pressed={course.brief.interactionMode === "off"} disabled={busy !== null} onClick={() => chooseInteractionMode("off")}>
                      <span className="choice-card__icon" aria-hidden="true"><Presentation /></span>
                      <span><strong>不需要</strong><small>仅使用讲解课件与测验</small></span>
                      <CircleCheck className="choice-card__check" aria-hidden="true" />
                    </button>
                    <button type="button" className={`choice-card${course.brief.interactionMode === "required" ? " is-active" : ""}`} aria-pressed={course.brief.interactionMode === "required"} disabled={busy !== null} onClick={() => chooseInteractionMode("required")}>
                      <span className="choice-card__icon choice-card__icon--green" aria-hidden="true"><MousePointerClick /></span>
                      <span><strong>需要互动</strong><small>AI 按教学目标设计玩法</small></span>
                      <CircleCheck className="choice-card__check" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="outline-body">
                  <label className="field course-title-editor">
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
                      const status = progress?.status === "ready"
                        ? { tone: "success", label: "完成" }
                        : progress?.status === "failed"
                          ? { tone: "danger", label: "失败" }
                          : recoverable
                            ? { tone: "warning", label: "可恢复" }
                            : progress?.status === "generating"
                              ? { tone: "progress", label: "生成中" }
                              : { tone: "neutral", label: "待生成" };
                      const TypeIcon = sceneTypeView[outline.type].icon;
                      return (
                        <li key={outline.id} className={`outline-item outline-item--${progress?.status ?? "pending"}`}>
                          <span className="outline-order" aria-hidden="true">
                            {progress?.status === "ready" ? <Check /> : progress?.status === "generating" && !recoverable ? <span className="spinner" /> : String(outline.order).padStart(2, "0")}
                          </span>
                          <div className="outline-content outline-content--editable">
                            <div className="outline-item__head">
                              <span className={`type-chip type-chip--${outline.type}`}><TypeIcon aria-hidden="true" />{sceneTypeView[outline.type].label}</span>
                              <span className="role-chip">{roleLabels[outline.role] ?? outline.role}</span>
                              <span className="outline-item__status">
                                <span className={`badge badge--dot badge--${status.tone}`}>{status.label}</span>
                                {canRetry || recoverable ? (
                                  <button
                                    className="btn btn--soft btn--sm"
                                    type="button"
                                    onClick={() => retryScene(outline.id)}
                                    disabled={busy !== null}
                                  >
                                    {busy === `scene:${outline.id}` ? <span className="spinner" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
                                    {busy === `scene:${outline.id}` ? "处理中" : recoverable ? "恢复" : "重试"}
                                  </button>
                                ) : null}
                                {progress?.status === "failed" && !canRetry ? (
                                  <em className="outline-item__hint">
                                    {requiresServerConfiguration(progress.lastError) ? "需修正配置" : "需人工处理"}
                                  </em>
                                ) : null}
                              </span>
                            </div>
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
                            <label className="outline-field">
                              <span>教学目标</span>
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
                            </label>
                            <label className="outline-field">
                              <span>{editable ? "关键点（每行一项）" : "关键点"}</span>
                              <LineListTextarea
                                value={outline.keyPoints}
                                disabled={!editable || busy !== null}
                                onChange={(keyPoints) => updateOutline(index, { keyPoints })}
                              />
                            </label>
                            {outline.type === "interactive" ? (
                              <div className="outline-field outline-field--widget">
                                <span>互动设计</span>
                                <div className="outline-widget-row">
                                  <select aria-label={`第 ${outline.order} 场互动类型`} value={outline.widgetType} disabled={!editable || busy !== null} onChange={(event) => updateOutline(index, { widgetType: event.target.value as SceneOutline["widgetType"] })}>
                                    <option value="diagram">关系探索</option><option value="simulation">过程模拟</option><option value="game">互动挑战</option><option value="code">编程实验</option>
                                  </select>
                                  {outline.widgetType === "code" ? <select aria-label={`第 ${outline.order} 场编程语言`} value={outline.widgetOutline?.language ?? "python"} disabled={!editable || busy !== null} onChange={(event) => updateOutline(index, { widgetOutline: { designIdea: outline.widgetOutline?.designIdea ?? "编写代码、运行并通过测试", language: event.target.value as "python" | "javascript" } })}><option value="python">Python</option><option value="javascript">JavaScript</option></select> : null}
                                </div>
                                <textarea aria-label={`第 ${outline.order} 场互动设计`} value={outline.widgetOutline?.designIdea ?? ""} placeholder="学生做什么，操作如何改变结果，如何反馈与完成" disabled={!editable || busy !== null} onChange={(event) => updateOutline(index, { widgetOutline: event.target.value.trim() ? { ...outline.widgetOutline, designIdea: event.target.value } : undefined })} />
                              </div>
                            ) : null}
                            {progress?.lastError ? (
                              <p className="scene-error-inline">
                                <CircleAlert aria-hidden="true" />
                                <span><code>{progress.lastError.code}</code>{progress.lastError.message}</span>
                              </p>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </section>
          </div>

          <aside className="generation-aside reveal reveal--three" aria-label="生成进度与操作">
            <section className="panel progress-panel">
              <div className="progress-panel__label">场景进度</div>
              <strong className="progress-count">
                {String(readyCount).padStart(2, "0")}
                <span> / {String(course.requestedSceneCount).padStart(2, "0")}</span>
              </strong>
              <span className={`meter meter--lg${course.status === "ready" ? " meter--success" : ""}`} aria-hidden="true"><i style={{ width: `${progressPercent}%` }} /></span>
              <ul className="progress-legend">
                <li><i className="dot dot--success" />完成 {readyCount}</li>
                {failedCount ? <li><i className="dot dot--danger" />失败 {failedCount}</li> : null}
                <li><i className="dot dot--neutral" />待生成 {pendingCount}</li>
              </ul>
              <p className="next-step"><Lightbulb aria-hidden="true" /><span>{nextStepText(course, materialsPending)}</span></p>

              <div className="aside-actions">
                {course.status === "ready" ? (
                  <Link className="btn btn--primary btn--lg btn--block" href={`/classroom/${course.id}`}>
                    <Presentation aria-hidden="true" />进入课堂
                  </Link>
                ) : editable ? (
                  <>
                    <button
                      className="btn btn--primary btn--lg btn--block"
                      type="button"
                      onClick={confirmAndGenerateScenes}
                      disabled={busy !== null || materialsPending}
                    >
                      {busy === "scenes" ? <span className="spinner" aria-hidden="true" /> : <WandSparkles aria-hidden="true" />}
                      {busy === "scenes"
                        ? `正在生成 ${readyCount + 1} / ${course.requestedSceneCount}…`
                        : "确认大纲并生成场景"}
                    </button>
                    <button
                      className="btn btn--secondary btn--block"
                      type="button"
                      onClick={saveOutline}
                      disabled={busy !== null || !dirty}
                    >
                      {busy === "save" ? <span className="spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}
                      {busy === "save" ? "正在校验保存…" : dirty ? "保存修订" : "修订已保存"}
                    </button>
                  </>
                ) : ["generating", "partial_failed"].includes(course.status) ? (
                  course.activeOperation ? (
                    <p className="aside-hint">存在登记中的场景操作。租约到期后，可在对应场景右侧点击“恢复”。</p>
                  ) : pendingCount > 0 ? (
                    <button
                      className="btn btn--primary btn--lg btn--block"
                      type="button"
                      onClick={continuePendingScenes}
                      disabled={busy !== null}
                    >
                      {busy === "scenes" ? <span className="spinner" aria-hidden="true" /> : <Play aria-hidden="true" />}
                      {busy === "scenes"
                        ? `正在生成 ${readyCount + 1} / ${course.requestedSceneCount}…`
                        : `继续生成 ${pendingCount} 个待处理场景`}
                    </button>
                  ) : (
                    <p className="aside-hint">没有待生成项，请在失败场景右侧点击“重试”。</p>
                  )
                ) : (
                  <button
                    className="btn btn--primary btn--lg btn--block"
                    type="button"
                    onClick={generateCourseOutline}
                    disabled={
                      busy !== null || materialsPending ||
                      course.status === "outlining" ||
                      Boolean(course.lastError && !canRetryGeneration(course.lastError))
                    }
                  >
                    {busy === "outline" || course.status === "outlining" ? <span className="spinner" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                    {busy === "outline" || course.status === "outlining"
                      ? "正在生成并校验…"
                      : course.lastError && !canRetryGeneration(course.lastError)
                        ? requiresServerConfiguration(course.lastError)
                          ? "请先修正服务端配置"
                          : "当前错误需要人工处理"
                        : course.status === "failed"
                          ? "重试大纲生成"
                          : "生成课程大纲"}
                  </button>
                )}
                {course.status !== "ready" && readyCount > 0 && busy === null ? (
                  <Link className="btn btn--secondary btn--block" href={`/classroom/${course.id}`}>
                    <Eye aria-hidden="true" />预览已生成的 {readyCount} 个场景
                  </Link>
                ) : null}
                {busy && busy !== "materials" ? (
                  <button className="btn btn--ghost btn--block" type="button" onClick={cancelCurrentRequests}>
                    <CircleStop aria-hidden="true" />取消当前请求
                  </button>
                ) : null}
              </div>
            </section>

            {operationView ? (
              <div
                className={`operation operation--${operationView.status}`}
                role="status"
                aria-live="polite"
              >
                <div className="operation__head">
                  {operationView.status === "running" ? <span className="spinner" aria-hidden="true" /> : operationView.status === "succeeded" ? <CircleCheck aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
                  <span>{operationStatusLabels[operationView.status]}</span>
                  <span className="operation__time">
                    {operationView.status === "running" ? `${(operationElapsedMs / 1000).toFixed(1)}s` : null}
                  </span>
                </div>
                <p>{operationView.label}</p>
                <small>
                  {operationView.status === "running"
                    ? "模型生成通常需要几十秒；临时远端异常会在 4 次总预算内自动重试。"
                    : "可用下方 requestId 对照终端中的结束日志。"}
                </small>
                <code className="request-id">requestId: {operationView.requestId}</code>
              </div>
            ) : null}
            {savedNotice ? (
              <div className="notice notice--success" role="status">
                <CircleCheck aria-hidden="true" />
                <p>{savedNotice}</p>
              </div>
            ) : null}
            {error ? <ErrorPanel error={error} /> : null}
          </aside>
        </div>
      </main>
    </div>
  );
}

const operationStatusLabels: Record<OperationView["status"], string> = {
  running: "正在处理",
  succeeded: "已完成",
  failed: "未完成",
  cancelled: "已取消",
};

/** 失败提示先给结论和下一步，技术诊断折叠在详情里供排查。 */
function ErrorPanel({ error }: { error: ErrorNotice }) {
  const hasDiagnostics = Boolean(error.requestId || error.upstreamCalls !== undefined || error.validationKind || error.issues?.length);
  return (
    <div className="notice notice--danger error-notice" role="alert">
      <CircleAlert aria-hidden="true" />
      <div className="notice__body">
        <strong>{requiresServerConfiguration(error) ? "需要修正服务端配置" : error.retryable ? "操作没有完成，可以重试" : "操作失败，需要人工处理"}</strong>
        <p className="notice__pre">{error.message}</p>
        <small>{recoveryGuidance(error)}</small>
        {hasDiagnostics ? (
          <details className="tech-details">
            <summary>技术详情 · {error.code}</summary>
            <div className="tech-details__body">
              {error.requestId ? <code>requestId: {error.requestId}</code> : null}
              {error.upstreamCalls !== undefined ? <code>上游调用: {error.upstreamCalls}</code> : null}
              {error.validationKind ? <code>失败阶段: {validationKindLabels[error.validationKind] ?? error.validationKind}</code> : null}
              {error.issues && error.issues.length > 0 ? (
                <ul className="error-issues">
                  {error.issues.slice(0, 5).map((issue, index) => (
                    <li key={`${issue.path}-${index}`}>
                      <code>{issue.path || "root"}</code>：{issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </details>
        ) : <small className="error-code">{error.code}</small>}
      </div>
    </div>
  );
}
