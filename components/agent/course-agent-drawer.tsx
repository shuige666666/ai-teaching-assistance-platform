"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentContentBlock, AgentMessage, AgentSession, AgentSseEvent, AgentToolBlock } from "@/lib/agent/contracts";

type Props = {
  open: boolean;
  courseId: string;
  courseTitle: string;
  courseRevision: number;
  currentSceneId: string;
  currentSceneLabel: string;
  initialDraft?: string;
  onDraftChange(value: string): void;
  onClose(): void;
  onCourseUpdated(sceneId: string): Promise<void>;
};

const toolStatus = {
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  waiting_confirmation: "需要确认",
  not_executed: "未执行",
  cancelled: "已取消",
} as const;

function jsonText(value: unknown) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function ToolCard({ block, onConfirm }: { block: AgentToolBlock; onConfirm(block: AgentToolBlock, decision: "confirm" | "cancel"): void }) {
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
        {block.status === "waiting_confirmation" && block.confirmationId ? (
          <div className="agent-confirm-actions">
            <button type="button" onClick={() => onConfirm(block, "cancel")}>取消修改</button>
            <button type="button" onClick={() => onConfirm(block, "confirm")}>确认并清理旧作答</button>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function ToolGroup({ blocks, onConfirm }: { blocks: AgentToolBlock[]; onConfirm(block: AgentToolBlock, decision: "confirm" | "cancel"): void }) {
  const completed = blocks.every((block) => block.status === "completed");
  return (
    <details className="agent-tool-group">
      <summary><span>•••</span><strong>{blocks.length} 个工具调用</strong><em>{completed ? "已完成" : blocks.some((block) => block.status === "waiting_confirmation") ? "等待确认" : blocks.some((block) => block.status === "running") ? "执行中" : "已结束"}</em></summary>
      <div>{blocks.map((block) => <ToolCard key={block.id} block={block} onConfirm={onConfirm} />)}</div>
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
      nodes.push(<div className="agent-answer" key={block.id}>{block.text}</div>);
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
  const [thinkingStarts, setThinkingStarts] = useState<Record<string, number>>({});
  const [clockMs, setClockMs] = useState(0);

  const loadMessages = useCallback(async (sessionId: string) => {
    const response = await fetch(`/api/courses/${props.courseId}/agent/sessions/${sessionId}`);
    const payload = await response.json() as { data?: { messages: AgentMessage[] }; error?: { message?: string } };
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "无法恢复对话");
    setMessages(payload.data.messages);
    setLiveBlocks([]);
  }, [props.courseId]);

  // 只有课堂页面真正销毁时才取消请求；open=false 只是隐藏侧栏，组件仍保持挂载。
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!props.open || session) return;
    let cancelled = false;
    void (async () => {
      const listResponse = await fetch(`/api/courses/${props.courseId}/agent/sessions`);
      const listPayload = await listResponse.json() as { data?: { sessions: AgentSession[] }; error?: { message?: string } };
      if (!listResponse.ok) throw new Error(listPayload.error?.message ?? "无法读取对话会话");
      let selected = listPayload.data?.sessions[0];
      if (!selected) {
        const createResponse = await fetch(`/api/courses/${props.courseId}/agent/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentSceneId: props.currentSceneId }) });
        const createPayload = await createResponse.json() as { data?: { session: AgentSession }; error?: { message?: string } };
        if (!createResponse.ok || !createPayload.data?.session) throw new Error(createPayload.error?.message ?? "无法创建对话会话");
        selected = createPayload.data.session;
      }
      await loadMessages(selected.id);
      if (!cancelled) {
        // 同一次状态提交中先结束加载，再登记 session，避免 effect 清理留下永久 loading。
        setLoading(false);
        setSession(selected);
      }
    })().catch((reason) => {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : "对话初始化失败");
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [props.open, props.courseId, props.currentSceneId, session, loadMessages]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setClockMs(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!followTail.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: running ? "auto" : "smooth" });
  }, [messages, liveBlocks, running]);

  function applyEvent(event: AgentSseEvent) {
    if (event.type === "thinking_started") {
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
    else if (event.type === "course_updated") void props.onCourseUpdated(event.affectedSceneIds[0] ?? props.currentSceneId);
    else if (event.type === "run_finished") {
      if (event.error && !(event.status === "cancelled" && stoppedByUser.current)) setError(event.error);
      setRunning(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!session || running || !draft.trim()) return;
    const text = draft.trim();
    const controller = new AbortController();
    request.current = controller;
    followTail.current = true;
    stoppedByUser.current = false;
    setThinkingStarts({});
    props.onDraftChange("");
    setError(null);
    setRunning(true);
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
    } finally { request.current = null; setRunning(false); }
  }

  async function confirm(block: AgentToolBlock, decision: "confirm" | "cancel") {
    if (!session || !block.confirmationId) return;
    setError(null);
    const response = await fetch(`/api/courses/${props.courseId}/agent/sessions/${session.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmationId: block.confirmationId, decision }) });
    const payload = await response.json() as { data?: { confirmation: { status: string; result?: { affectedSceneIds?: string[] } } }; error?: { message?: string } };
    if (!response.ok || !payload.data) { setError(payload.error?.message ?? "确认处理失败"); return; }
    await loadMessages(session.id);
    if (payload.data.confirmation.status === "completed") await props.onCourseUpdated(payload.data.confirmation.result?.affectedSceneIds?.[0] ?? props.currentSceneId);
  }

  if (!props.open) return null;
  return (
    <div className="agent-drawer-layer">
      <button className="agent-drawer-scrim" type="button" aria-label="关闭课程对话" onClick={props.onClose} />
      <aside className="agent-drawer" aria-label="课程修订对话">
        <header className="agent-drawer__head">
          <div><span>COURSE REVISION AGENT</span><h2>对话式修订</h2><small>当前目标 · {props.currentSceneLabel}</small></div>
          <button type="button" aria-label="关闭" onClick={props.onClose}>×</button>
        </header>
        <div className="agent-drawer__messages" ref={scrollRef} onScroll={(event) => {
          const target = event.currentTarget;
          followTail.current = target.scrollHeight - target.scrollTop - target.clientHeight <= 56;
        }}>
          {loading ? <p className="agent-empty">正在恢复课程对话…</p> : null}
          {!loading && messages.length === 0 && liveBlocks.length === 0 ? <div className="agent-empty"><strong>从课程本身开始讨论</strong><p>可以询问内容，也可以要求对当前页做精确修改。Agent 会先读取真实课程，再决定是否调用工具。</p></div> : null}
          {messages.map((message) => message.role === "user" && "text" in message.content
            ? <div className="agent-user" key={message.id}>{message.content.text}</div>
            : message.role === "assistant" && "blocks" in message.content ? <div className="agent-assistant" key={message.id}><AssistantBlocks blocks={message.content.blocks} onConfirm={confirm} clockMs={clockMs} thinkingStarts={thinkingStarts} /></div> : null)}
          {liveBlocks.length ? <div className="agent-assistant agent-assistant--live"><AssistantBlocks blocks={liveBlocks} onConfirm={confirm} clockMs={clockMs} thinkingStarts={thinkingStarts} /></div> : null}
          {error ? <p className="agent-error" role="alert">{error}</p> : null}
        </div>
        <form className="agent-composer" onSubmit={send}>
          <textarea value={draft} maxLength={4000} disabled={running || !session} onChange={(event) => props.onDraftChange(event.target.value)} placeholder="继续讨论，或描述要修改的页面内容…" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <div><small>REV.{props.courseRevision} · Shift+Enter 换行</small>{running ? <button type="button" onClick={() => { stoppedByUser.current = true; request.current?.abort(); }}>停止</button> : <button type="submit" disabled={!session || !draft.trim()}>发送 ↗</button>}</div>
        </form>
      </aside>
    </div>
  );
}
