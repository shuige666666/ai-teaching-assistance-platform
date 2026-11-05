"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, ChevronDown, Ellipsis, MapPin, MessagesSquare, Plus, SendHorizontal, Square, X } from "lucide-react";
import type { AgentContentBlock, AgentContextInfo, AgentCourseUpdate, AgentMessage, AgentRun, AgentSession, AgentSseEvent, AgentToolBlock } from "@/lib/agent/contracts";
import type { Scene } from "@/lib/domain/schemas";

type AgentSceneSummary = Pick<Scene, "id" | "order" | "title" | "type">;

type Props = {
  open: boolean;
  courseId: string;
  courseTitle: string;
  courseRevision: number;
  currentSceneId: string;
  scenes: AgentSceneSummary[];
  onSceneSelect(sceneId: string): void;
  drawerWidth: number;
  onDrawerWidthChange(width: number): void;
  initialDraft?: string;
  onDraftChange(value: string): void;
  onClose(): void;
  onCourseUpdated(update: AgentCourseUpdate): Promise<void>;
};

const toolStatus = {
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  waiting_confirmation: "需要确认",
  not_executed: "未执行",
  cancelled: "已取消",
} as const;

const agentSuggestions = ["这一页的讲解太难了，帮我改得更通俗", "给当前页补充一个生活化的案例", "检查整门课有几页，先不要修改"];

const sessionStatus = {
  idle: "可继续",
  running: "执行中",
  waiting_confirmation: "等待确认",
} as const;

function runSummary(run: AgentRun | null) {
  if (!run?.metrics) return null;
  const metrics = run.metrics;
  const usage = metrics.inputTokens === undefined && metrics.outputTokens === undefined
    ? "token 未提供"
    : `token ${metrics.inputTokens ?? "?"}/${metrics.outputTokens ?? "?"}`;
  return `模型 ${metrics.modelCalls} 次 · 工具 ${metrics.toolCompleted}/${metrics.toolCalls} 成功 · ${usage}`;
}

function jsonText(value: unknown) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function formatSessionTime(value: number) {
  return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function MarkdownAnswer({ text }: { text: string }) {
  return <div className="agent-answer"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;
}

function confirmationCopy(block: AgentToolBlock) {
  const result = typeof block.result === "object" && block.result !== null ? block.result as { summary?: unknown } : undefined;
  const summary = typeof result?.summary === "string" ? result.summary : "这项课程修改需要你的确认";
  if (block.confirmationKind === "delete") return {
    title: "即将删除课程页面",
    summary,
    detail: "确认后会从当前课程目录移除这一页并更新页序；取消则不会修改课程。",
    confirmLabel: "确认删除",
  };
  if (block.confirmationKind === "regenerate_quiz") return {
    title: "即将重新生成测验",
    summary,
    detail: "确认后会替换本页题目，并清理这页已有的作答记录。",
    confirmLabel: "确认重新生成测验",
  };
  return {
    title: "即将修改测验题目",
    summary,
    detail: "确认后会保存新的题目，并清理这页已有的作答记录。",
    confirmLabel: "确认修改测验",
  };
}

function ConfirmationCallout({ block, onConfirm }: { block: AgentToolBlock; onConfirm(block: AgentToolBlock, decision: "confirm" | "cancel"): void }) {
  const copy = confirmationCopy(block);
  return (
    <div className="agent-confirmation-callout" role="alert">
      <div className="agent-confirmation-callout__heading"><span>需要你的确认</span><strong>{copy.title}</strong></div>
      <p>{copy.summary}</p>
      <small>{copy.detail}</small>
      <div className="agent-confirm-actions">
        <button type="button" onClick={() => onConfirm(block, "cancel")}>取消</button>
        <button type="button" onClick={() => onConfirm(block, "confirm")}>{copy.confirmLabel}</button>
      </div>
    </div>
  );
}

function ToolCard({ block }: { block: AgentToolBlock }) {
  return (
    <details className={`agent-tool agent-tool--${block.status}`}>
      <summary>
        <span className="agent-tool__mark">{block.status === "completed" ? "✓" : block.status === "failed" ? "!" : block.status === "running" ? "·" : "?"}</span>
        <strong>{block.label}</strong>
        {block.targetSceneId ? <small>{block.targetSceneId.slice(0, 8)}</small> : null}
        <em>{block.durationMs === undefined ? toolStatus[block.status] : `${toolStatus[block.status]} · ${block.durationMs}ms`}</em>
      </summary>
      <div className="agent-tool__detail">
        <span>入参</span>
        <pre>{jsonText(block.arguments)}</pre>
        {block.result !== undefined ? <><span>结果原文</span><pre>{jsonText(block.result)}</pre></> : null}
      </div>
    </details>
  );
}

function ToolGroup({ blocks, onConfirm }: { blocks: AgentToolBlock[]; onConfirm(block: AgentToolBlock, decision: "confirm" | "cancel"): void }) {
  const completed = blocks.every((block) => block.status === "completed");
  const pending = blocks.filter((block) => block.status === "waiting_confirmation" && block.confirmationId);
  return (
    <details className="agent-tool-group" open={pending.length > 0 || undefined}>
      <summary><span>•••</span><strong>{blocks.length} 个工具调用</strong><em>{completed ? "已完成" : pending.length ? "需要确认" : blocks.some((block) => block.status === "running") ? "执行中" : "已结束"}</em></summary>
      <div className="agent-tool-group__body">
        {pending.map((block) => <ConfirmationCallout key={`confirmation-${block.id}`} block={block} onConfirm={onConfirm} />)}
        {blocks.map((block) => <ToolCard key={block.id} block={block} />)}
      </div>
    </details>
  );
}

function AssistantBlocks({ blocks, onConfirm, clockMs, thinkingStarts }: { blocks: AgentContentBlock[]; onConfirm(block: AgentToolBlock, decision: "confirm" | "cancel"): void; clockMs: number; thinkingStarts: Readonly<Record<string, number>> }) {
  const nodes: ReactNode[] = [];
  for (let index = 0; index < blocks.length;) {
    const block = blocks[index];
    if (block.type === "thinking") {
      const startedAt = thinkingStarts[block.id];
      const durationMs = startedAt === undefined ? block.durationMs : Math.max(0, clockMs - startedAt);
      nodes.push(<details className="agent-thinking" key={block.id}><summary><span>✣</span><strong>{startedAt === undefined ? "已思考" : "思考中"} {(durationMs / 1000).toFixed(1)}s</strong><em>{block.text.replace(/\s+/g, " ").slice(0, 42)}</em></summary><pre>{block.text}</pre></details>);
      index += 1;
      continue;
    }
    if (block.type === "text") {
      nodes.push(<MarkdownAnswer key={block.id} text={block.text} />);
      index += 1;
      continue;
    }
    const turn = block.modelTurn;
    const tools: AgentToolBlock[] = [];
    while (index < blocks.length && blocks[index].type === "tool" && blocks[index].modelTurn === turn) tools.push(blocks[index++] as AgentToolBlock);
    nodes.push(<ToolGroup key={`tools-${turn}-${tools[0]?.id}`} blocks={tools} onConfirm={onConfirm} />);
  }
  return nodes;
}

export function CourseAgentDrawer(props: Props) {
  const [session, setSession] = useState<AgentSession | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [liveBlocks, setLiveBlocks] = useState<AgentContentBlock[]>([]);
  const draft = props.initialDraft ?? "";
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followTail = useRef(true);
  const stoppedByUser = useRef(false);
  const skipSessionBootstrap = useRef(false);
  const sessionPickerRef = useRef<HTMLButtonElement | null>(null);
  const sessionActionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusSessionId = useRef<string | null>(null);
  const [thinkingStarts, setThinkingStarts] = useState<Record<string, number>>({});
  const [clockMs, setClockMs] = useState(0);
  const [latestRun, setLatestRun] = useState<AgentRun | null>(null);
  const [contextInfo, setContextInfo] = useState<AgentContextInfo | null>(null);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [sessionActionsId, setSessionActionsId] = useState<string | null>(null);
  const [sessionActionPending, setSessionActionPending] = useState(false);
  const [sessionRenameId, setSessionRenameId] = useState<string | null>(null);
  const [sessionTitleDraft, setSessionTitleDraft] = useState("");
  const [sessionRenamePending, setSessionRenamePending] = useState(false);
  const [sessionDeleteTarget, setSessionDeleteTarget] = useState<AgentSession | null>(null);
  const drawerResize = useRef<{ pointerId: number; startX: number; startWidth: number; cursor: string; userSelect: string } | null>(null);

  const drawerOpen = props.open;
  const closeDrawer = props.onClose;
  const sessionLocked = running || session?.status === "running" || session?.status === "waiting_confirmation";

  /** 宽屏拖动侧栏左边缘时同步调整课堂留白，并限制在可读的工作区范围内。 */
  function beginDrawerResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (window.innerWidth < 1280) return;
    drawerResize.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: props.drawerWidth,
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function resizeDrawer(event: ReactPointerEvent<HTMLDivElement>) {
    const active = drawerResize.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const maxWidth = Math.min(680, Math.max(360, window.innerWidth - 720));
    props.onDrawerWidthChange(Math.round(Math.min(maxWidth, Math.max(360, active.startWidth + active.startX - event.clientX))));
  }

  function finishDrawerResize(event: ReactPointerEvent<HTMLDivElement>) {
    const active = drawerResize.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.style.cursor = active.cursor;
    document.body.style.userSelect = active.userSelect;
    drawerResize.current = null;
  }

  /** 读取当前课程的会话列表，供首次恢复和会话切换器使用。 */
  const loadSessionList = useCallback(async () => {
    const response = await fetch(`/api/courses/${props.courseId}/agent/sessions`);
    const payload = await response.json() as { data?: { sessions: AgentSession[] }; error?: { message?: string } };
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "无法读取对话会话");
    setSessions(payload.data.sessions);
    return payload.data.sessions;
  }, [props.courseId]);

  /** 读取会话消息、最近 run 和上下文裁剪信息，并替换当前时间线。 */
  const loadMessages = useCallback(async (sessionId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/courses/${props.courseId}/agent/sessions/${sessionId}`);
      const payload = await response.json() as { data?: { session: AgentSession; messages: AgentMessage[]; latestRun?: AgentRun | null; context?: AgentContextInfo }; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "无法恢复对话");
      setSession(payload.data.session);
      setMessages(payload.data.messages);
      setLatestRun(payload.data.latestRun ?? null);
      // 恢复会话时展示已持久化的最近失败原因。
      setError(payload.data.latestRun?.status === "failed" ? payload.data.latestRun.error ?? "上一轮请求失败" : null);
      setContextInfo(payload.data.context ?? null);
      setLiveBlocks([]);
    } finally {
      setLoading(false);
    }
  }, [props.courseId]);

  // 切换课程时清掉旧会话，避免不同课程的消息短暂混入当前侧栏。
  useEffect(() => {
    const reset = window.setTimeout(() => {
      setSession(null);
      setSessions([]);
      setMessages([]);
      setLiveBlocks([]);
      setLatestRun(null);
      setContextInfo(null);
      setLoading(true);
      setSessionMenuOpen(false);
      setSessionActionsId(null);
      setSessionRenameId(null);
      setSessionTitleDraft("");
      setSessionDeleteTarget(null);
      skipSessionBootstrap.current = false;
    }, 0);
    return () => window.clearTimeout(reset);
  }, [props.courseId]);

  // 只有课堂页面真正销毁时才取消请求；open=false 只是隐藏侧栏，组件仍保持挂载。
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!props.open || session) return;
    if (skipSessionBootstrap.current) {
      skipSessionBootstrap.current = false;
      return;
    }
    let cancelled = false;
    void (async () => {
      const listed = await loadSessionList();
      let selected = listed[0];
      if (!selected) {
        const createResponse = await fetch(`/api/courses/${props.courseId}/agent/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentSceneId: props.currentSceneId }) });
        const createPayload = await createResponse.json() as { data?: { session: AgentSession }; error?: { message?: string } };
        if (!createResponse.ok || !createPayload.data?.session) throw new Error(createPayload.error?.message ?? "无法创建对话会话");
        selected = createPayload.data.session;
        setSessions([selected]);
      }
      await loadMessages(selected.id);
    })().catch((reason) => {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : "对话初始化失败");
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [props.open, props.courseId, props.currentSceneId, session, loadMessages, loadSessionList]);

  // 浮层使用 Escape 逐层关闭；没有打开子菜单时再关闭整个侧栏。
  useEffect(() => {
    if (!drawerOpen) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (sessionDeleteTarget) {
        focusSessionId.current = sessionDeleteTarget.id;
        setSessionDeleteTarget(null);
        return;
      }
      if (sessionRenameId) {
        focusSessionId.current = sessionRenameId;
        setSessionRenameId(null);
        setSessionTitleDraft("");
        return;
      }
      if (sessionActionsId) {
        setSessionActionsId(null);
        return;
      }
      if (sessionMenuOpen) {
        setSessionMenuOpen(false);
        return;
      }
      closeDrawer();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closeDrawer, drawerOpen, sessionActionsId, sessionDeleteTarget, sessionMenuOpen, sessionRenameId]);

  // 内联操作结束后把焦点放回对应条目；最后一个会话被删掉时回到顶部选择器。
  useEffect(() => {
    if (!sessionMenuOpen || !focusSessionId.current) return;
    const targetId = focusSessionId.current;
    focusSessionId.current = null;
    window.requestAnimationFrame(() => {
      const target = sessionActionRefs.current[targetId];
      if (target) target.focus();
      else sessionPickerRef.current?.focus();
    });
  }, [sessionDeleteTarget, sessionMenuOpen, sessionRenameId, sessions]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setClockMs(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!followTail.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: running ? "auto" : "smooth" });
  }, [messages, liveBlocks, running]);

  /** 创建一条当前课程的新对话，不影响已有会话和课程内容。 */
  async function createSessionRecord() {
    const response = await fetch(`/api/courses/${props.courseId}/agent/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentSceneId: props.currentSceneId }) });
    const payload = await response.json() as { data?: { session: AgentSession }; error?: { message?: string } };
    if (!response.ok || !payload.data?.session) throw new Error(payload.error?.message ?? "无法创建对话会话");
    setSessions((items) => [payload.data!.session, ...items.filter((item) => item.id !== payload.data!.session.id)]);
    await loadMessages(payload.data.session.id);
    setSessionMenuOpen(false);
  }

  async function createSession() {
    if (sessionLocked || sessionActionPending) return;
    setSessionActionPending(true);
    setError(null);
    try {
      await createSessionRecord();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法创建对话会话");
    } finally {
      setSessionActionPending(false);
    }
  }

  /** 切换到当前课程的历史会话；运行或等待确认时由 UI 锁定入口。 */
  async function switchSession(next: AgentSession) {
    if (next.id === session?.id || sessionLocked || sessionActionPending) return;
    setSessionActionPending(true);
    setError(null);
    try {
      await loadMessages(next.id);
      setSessionMenuOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法切换对话会话");
    } finally {
      setSessionActionPending(false);
    }
  }

  /** 保存指定会话的显示名称，不触碰消息、运行和课程内容。 */
  async function renameSession(event: React.FormEvent, target: AgentSession) {
    event.preventDefault();
    if (!sessionTitleDraft.trim() || sessionRenamePending) return;
    setSessionRenamePending(true);
    setError(null);
    try {
      const response = await fetch(`/api/courses/${props.courseId}/agent/sessions/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: sessionTitleDraft.trim() }),
      });
      const payload = await response.json() as { data?: { session: AgentSession }; error?: { message?: string } };
      if (!response.ok || !payload.data?.session) throw new Error(payload.error?.message ?? "无法修改对话名称");
      setSession((item) => item?.id === payload.data!.session.id ? payload.data!.session : item);
      setSessions((items) => items.map((item) => item.id === payload.data!.session.id ? payload.data!.session : item));
      setSessionRenameId(null);
      setSessionTitleDraft("");
      focusSessionId.current = target.id;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法修改对话名称");
    } finally {
      setSessionRenamePending(false);
    }
  }

  /** 删除指定的空闲会话；当前会话删除后恢复最近的剩余会话。 */
  async function deleteSession() {
    const target = sessionDeleteTarget;
    if (!target || sessionActionPending) return;
    setSessionActionPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/courses/${props.courseId}/agent/sessions/${target.id}`, { method: "DELETE" });
      const payload = await response.json() as { data?: { sessionId: string }; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "无法删除对话会话");
      const remaining = sessions.filter((item) => item.id !== target.id);
      const deletingCurrent = session?.id === target.id;
      setSessions(remaining);
      setSessionDeleteTarget(null);
      setSessionActionsId(null);
      if (!deletingCurrent) {
        // 删除其他会话后仍把焦点留在当前会话条目，避免焦点落到已移除节点。
        focusSessionId.current = session?.id ?? null;
        return;
      }

      skipSessionBootstrap.current = true;
      setSession(null);
      setMessages([]);
      setLiveBlocks([]);
      setLatestRun(null);
      setContextInfo(null);
      const next = remaining[0];
      if (next) {
        focusSessionId.current = next.id;
        await loadMessages(next.id);
      } else {
        // 删除最后一个会话后保持侧栏可继续使用，创建一个空白会话。
        await createSessionRecord();
        window.requestAnimationFrame(() => sessionPickerRef.current?.focus());
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法删除对话会话");
    } finally {
      setSessionActionPending(false);
    }
  }

  function beginSessionRename(item: AgentSession) {
    setSessionActionsId(null);
    setSessionDeleteTarget(null);
    setSessionRenameId(item.id);
    setSessionTitleDraft(item.title);
    setError(null);
  }

  function requestSessionDelete(item: AgentSession) {
    if (item.status !== "idle") {
      setError("当前对话正在执行或等待确认，暂时不能删除");
      return;
    }
    setSessionDeleteTarget(item);
    // 保持当前操作菜单打开，让原“删除”按钮原位变成第二次确认。
    setSessionActionsId(item.id);
    setError(null);
  }

  /** 切换会话操作菜单；离开条目时清掉未完成的原位删除确认。 */
  function toggleSessionActions(item: AgentSession) {
    const nextId = sessionActionsId === item.id ? null : item.id;
    setSessionActionsId(nextId);
    if (nextId !== item.id && sessionDeleteTarget?.id === item.id) setSessionDeleteTarget(null);
    if (nextId === item.id && sessionDeleteTarget && sessionDeleteTarget.id !== item.id) setSessionDeleteTarget(null);
  }

  function applyEvent(event: AgentSseEvent) {
    if (event.type === "run_started") {
      setSession((item) => item ? { ...item, status: "running", updatedAt: Date.now() } : item);
    }
    else if (event.type === "thinking_started") {
      const startedAt = Date.now();
      setThinkingStarts((items) => ({ ...items, [event.blockId]: startedAt }));
      setClockMs(startedAt);
      setLiveBlocks((items) => [...items, { type: "thinking", id: event.blockId, text: "", durationMs: 0, modelTurn: items.filter((item) => item.type === "thinking").length }]);
    }
    else if (event.type === "thinking_delta") setLiveBlocks((items) => items.map((block) => block.id === event.blockId && block.type === "thinking" ? { ...block, text: block.text + event.delta } : block));
    else if (event.type === "thinking_finished") {
      setThinkingStarts((items) => {
        const next = { ...items };
        delete next[event.blockId];
        return next;
      });
      setLiveBlocks((items) => items.map((block) => block.id === event.blockId && block.type === "thinking" ? { ...block, durationMs: event.durationMs } : block));
    }
    else if (event.type === "text_started") setLiveBlocks((items) => [...items, { type: "text", id: event.blockId, text: "", modelTurn: items.filter((item) => item.type === "text").length }]);
    else if (event.type === "text_delta") setLiveBlocks((items) => items.map((block) => block.id === event.blockId && block.type === "text" ? { ...block, text: block.text + event.delta } : block));
    else if (event.type === "tool_started") setLiveBlocks((items) => [...items, event.block]);
    else if (event.type === "tool_finished" || event.type === "confirmation_required") setLiveBlocks((items) => items.map((block) => block.id === event.block.id ? event.block : block));
    else if (event.type === "course_updated") void props.onCourseUpdated(event).catch((reason) => setError(reason instanceof Error ? reason.message : "课程已保存，但课堂刷新失败"));
    else if (event.type === "run_finished") {
      if (event.error && !(event.status === "cancelled" && stoppedByUser.current)) setError(event.error);
      setSession((item) => item ? { ...item, status: event.status === "waiting_confirmation" ? "waiting_confirmation" : "idle", updatedAt: Date.now() } : item);
      setRunning(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!session || running || session.status !== "idle" || !draft.trim()) return;
    const text = draft.trim();
    const controller = new AbortController();
    request.current = controller;
    followTail.current = true;
    stoppedByUser.current = false;
    setThinkingStarts({});
    props.onDraftChange("");
    setError(null);
    setRunning(true);
    setSession((item) => item ? { ...item, status: "running", updatedAt: Date.now() } : item);
    setLiveBlocks([]);
    setMessages((items) => [...items, { id: `local-${Date.now()}`, sessionId: session.id, sequence: items.length + 1, role: "user", content: { text, currentSceneId: props.currentSceneId, courseRevision: props.courseRevision }, createdAt: Date.now() }]);
    try {
      const response = await fetch(`/api/courses/${props.courseId}/agent/sessions/${session.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, currentSceneId: props.currentSceneId, courseRevision: props.courseRevision }), signal: controller.signal });
      if (!response.ok || !response.body) {
        const payload = await response.json() as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? "消息发送失败");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split(/\r?\n/).find((item) => item.startsWith("data: "));
          if (line) applyEvent(JSON.parse(line.slice(6)) as AgentSseEvent);
        }
        if (done) break;
      }
      await loadMessages(session.id);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "消息发送失败");
      try { await loadMessages(session.id); } catch { /* 保留已经收到的流式块。 */ }
    } finally {
      request.current = null;
      setRunning(false);
      void loadSessionList().catch(() => undefined);
    }
  }

  async function confirm(block: AgentToolBlock, decision: "confirm" | "cancel") {
    if (!session || !block.confirmationId || request.current) return;
    setError(null);
    const controller = new AbortController();
    request.current = controller;
    setRunning(decision === "confirm" && block.confirmationKind === "regenerate_quiz");
    try {
      const response = await fetch(`/api/courses/${props.courseId}/agent/sessions/${session.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmationId: block.confirmationId, decision }), signal: controller.signal });
      if (response.headers.get("content-type")?.includes("text/event-stream") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.split(/\r?\n/).find((item) => item.startsWith("data: "));
            if (line) applyEvent(JSON.parse(line.slice(6)) as AgentSseEvent);
          }
          if (done) break;
        }
        await loadMessages(session.id);
        return;
      }
      const payload = await response.json() as { data?: { confirmation: { status: string; result?: { afterRevision?: number; affectedSceneIds?: string[]; removedSceneIds?: string[]; oldSceneId?: string; newSceneId?: string; outlineId?: string } } }; error?: { message?: string } };
      if (!response.ok || !payload.data) { setError(payload.error?.message ?? "确认处理失败"); return; }
      await loadMessages(session.id);
      void loadSessionList().catch(() => undefined);
      if (payload.data.confirmation.status === "completed") {
        const result = payload.data.confirmation.result;
        await props.onCourseUpdated({
          revision: result?.afterRevision ?? props.courseRevision,
          affectedSceneIds: result?.affectedSceneIds ?? (result?.newSceneId ? [result.newSceneId] : result?.oldSceneId ? [result.oldSceneId] : []),
          removedSceneIds: result?.removedSceneIds ?? (result?.oldSceneId ? [result.oldSceneId] : undefined),
          sceneReplacements: result?.oldSceneId && result.newSceneId && result.outlineId ? [{ oldSceneId: result.oldSceneId, newSceneId: result.newSceneId, outlineId: result.outlineId }] : undefined,
          contentChanged: true,
        });
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "确认处理失败");
    } finally {
      request.current = null;
      setRunning(false);
      void loadSessionList().catch(() => undefined);
    }
  }

  if (!props.open) return null;
  return (
    <div className="agent-drawer-layer">
      <button className="agent-drawer-scrim" type="button" aria-label="关闭课程对话" onClick={props.onClose} />
      <aside className="agent-drawer" aria-label="课程修订对话">
        <div
          className="agent-drawer-resize"
          title="拖动调整侧栏宽度，双击恢复默认宽度"
          onDoubleClick={() => props.onDrawerWidthChange(470)}
          onPointerDown={beginDrawerResize}
          onPointerMove={resizeDrawer}
          onPointerUp={finishDrawerResize}
          onPointerCancel={finishDrawerResize}
        />
        <header className="agent-drawer__head">
          <div className="agent-drawer__head-content">
            <div className="agent-drawer__title"><span className="agent-drawer__avatar" aria-hidden="true"><Bot /></span><div><h2>对话式修订</h2><small>AI 课程助手 · 先读取课程，再按你的意见修改</small></div></div>
            <div className="agent-session-area">
              <div className="agent-session-controls">
                <button ref={sessionPickerRef} type="button" className="agent-session-picker" disabled={!session || sessionActionPending} onClick={() => { setSessionMenuOpen((open) => !open); setSessionActionsId(null); setSessionDeleteTarget(null); }}>
                  <span>{session?.title ?? "正在加载会话"}</span><em>{session ? sessionStatus[session.status] : ""}<ChevronDown aria-hidden="true" /></em>
                </button>
                <button type="button" className="agent-session-new" disabled={sessionLocked || sessionActionPending} onClick={createSession}><Plus aria-hidden="true" />新建对话</button>
              </div>
              {sessionMenuOpen ? (
                <div className="agent-session-menu" role="list" aria-label="历史对话">
                  {sessions.map((item) => {
                    // 当前运行状态以侧栏实时状态为准，避免列表快照尚未刷新时误放开删除。
                    const canDelete = item.status === "idle" && !(item.id === session?.id && sessionLocked);
                    const pendingDelete = sessionDeleteTarget?.id === item.id;
                    const isRenaming = sessionRenameId === item.id;
                    return (
                      <div className={`agent-session-row${item.id === session?.id ? " is-current" : ""}`} key={item.id}>
                        {isRenaming ? (
                          <form className="agent-session-row-edit" onSubmit={(event) => void renameSession(event, item)}>
                            <input aria-label={`重命名：${item.title}`} value={sessionTitleDraft} maxLength={80} autoFocus onChange={(event) => setSessionTitleDraft(event.target.value)} />
                            <button type="submit" disabled={sessionRenamePending || !sessionTitleDraft.trim()}>保存</button>
                            <button type="button" disabled={sessionRenamePending} onClick={() => { focusSessionId.current = item.id; setSessionRenameId(null); setSessionTitleDraft(""); }}>取消</button>
                          </form>
                        ) : (
                          <>
                            <button type="button" className="agent-session-select" aria-current={item.id === session?.id ? "true" : undefined} disabled={sessionLocked || sessionActionPending} onClick={() => void switchSession(item)}>
                              <span>{item.title}</span><small>{sessionStatus[item.status]} · {formatSessionTime(item.updatedAt)}</small>
                            </button>
                            <button ref={(node) => { sessionActionRefs.current[item.id] = node; }} type="button" className="agent-session-actions" aria-label={`管理会话：${item.title}`} aria-expanded={sessionActionsId === item.id} onClick={() => toggleSessionActions(item)}><Ellipsis aria-hidden="true" /></button>
                            {sessionActionsId === item.id ? (
                              <div className="agent-session-actions-menu" role="menu">
                                <button type="button" role="menuitem" onClick={() => beginSessionRename(item)}>重命名</button>
                                <button type="button" role="menuitem" className={pendingDelete ? "is-delete-confirm" : undefined} disabled={!canDelete || sessionActionPending} onClick={() => pendingDelete ? void deleteSession() : requestSessionDelete(item)}>{pendingDelete ? "确认删除" : canDelete ? "删除" : "运行中不可删除"}</button>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    );
                  })}
                  {!sessions.length ? <p>暂无历史会话</p> : null}
                </div>
              ) : null}
            </div>
          </div>
          <button className="agent-drawer__close" type="button" aria-label="关闭" onClick={props.onClose}><X aria-hidden="true" /></button>
        </header>
        <div className="agent-drawer__messages" ref={scrollRef} onScroll={(event) => {
          const target = event.currentTarget;
          followTail.current = target.scrollHeight - target.scrollTop - target.clientHeight <= 56;
        }}>
          {loading ? <p className="agent-loading" role="status"><span className="spinner" aria-hidden="true" />正在恢复课程对话…</p> : null}
          {!loading && session?.status === "running" && !running ? <p className="agent-session-notice" role="status">上一轮请求仍在服务端执行；刷新不会自动续跑，请等待它结束后再继续。</p> : null}
          {!loading && latestRun?.status === "interrupted" ? <p className="agent-session-notice" role="status">上一轮请求已中断，历史消息仍保留；可以从当前课程状态继续讨论。</p> : null}
          {!loading && contextInfo && contextInfo.omittedMessageCount > 0 ? <p className="agent-context-notice" role="status">较早的 {contextInfo.omittedMessageCount} 轮对话本次未发送给模型，数据库历史仍保留。</p> : null}
          {!loading && latestRun && runSummary(latestRun) ? <p className="agent-run-summary">最近运行 · {runSummary(latestRun)} · {latestRun.metrics?.totalDurationMs ? `${(latestRun.metrics.totalDurationMs / 1000).toFixed(1)}s` : "耗时未知"}</p> : null}
          {!loading && messages.length === 0 && liveBlocks.length === 0 ? <div className="agent-empty"><span className="agent-empty__icon" aria-hidden="true"><MessagesSquare /></span><strong>从课程本身开始讨论</strong><p>可以询问内容，也可以要求对当前页做精确修改。助手会先读取真实课程，再决定是否调用工具。</p><div className="agent-suggestions">{agentSuggestions.map((item) => <button type="button" key={item} disabled={!session || session.status !== "idle"} onClick={() => props.onDraftChange(item)}>{item}</button>)}</div></div> : null}
          {messages.map((message) => {
            if (message.role === "user" && "text" in message.content) {
              const userContent = message.content as Extract<AgentMessage["content"], { text: string }>;
              const anchor = userContent.currentSceneId ? props.scenes.find((item) => item.id === userContent.currentSceneId) : undefined;
              return (
                <div className="agent-user" key={message.id}>
                  {userContent.currentSceneId ? (
                    <button type="button" className="agent-user__scene" disabled={!anchor} onClick={() => anchor && props.onSceneSelect(anchor.id)}>
                      <MapPin aria-hidden="true" />{anchor ? `第 ${anchor.order} 页 · ${anchor.title}` : "原场景已删除"}
                    </button>
                  ) : null}
                  <div>{userContent.text}</div>
                </div>
              );
            }
            if (message.role === "assistant" && "blocks" in message.content) return <div className="agent-assistant" key={message.id}><AssistantBlocks blocks={message.content.blocks} onConfirm={confirm} clockMs={clockMs} thinkingStarts={thinkingStarts} /></div>;
            return null;
          })}
          {liveBlocks.length ? <div className="agent-assistant agent-assistant--live"><AssistantBlocks blocks={liveBlocks} onConfirm={confirm} clockMs={clockMs} thinkingStarts={thinkingStarts} /></div> : null}
          {error ? <p className="agent-error" role="alert">{error}</p> : null}
        </div>
        <form className="agent-composer" onSubmit={send}>
          <textarea value={draft} maxLength={4000} disabled={running || !session || session.status !== "idle"} onChange={(event) => props.onDraftChange(event.target.value)} placeholder={session?.status === "running" ? "上一轮请求仍在服务端执行…" : session?.status === "waiting_confirmation" ? "请先处理上方确认…" : "继续讨论，或描述要修改的页面内容…"} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <div><small>REV.{props.courseRevision} · Enter 发送，Shift+Enter 换行</small>{running ? <button className="agent-composer__stop" type="button" onClick={() => { stoppedByUser.current = true; request.current?.abort(); }}><Square aria-hidden="true" />停止</button> : <button type="submit" disabled={!session || session.status !== "idle" || !draft.trim()}><SendHorizontal aria-hidden="true" />发送</button>}</div>
        </form>
      </aside>
    </div>
  );
}
