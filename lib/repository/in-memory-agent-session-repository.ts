import { randomUUID } from "node:crypto";
import { AgentApplicationError, type AgentConfirmation, type AgentContentBlock, type AgentMessage, type AgentRun, type AgentRunMetrics, type AgentRunStatus, type AgentSession } from "@/lib/agent/contracts";
import type { AgentSessionRepository } from "./agent-session-repository";

export class InMemoryAgentSessionRepository implements AgentSessionRepository {
  private sessions = new Map<string, AgentSession>();
  private messages = new Map<string, AgentMessage[]>();
  private runs = new Map<string, AgentRun>();
  private confirmations = new Map<string, AgentConfirmation>();
  constructor(private readonly now: () => number = Date.now) {}

  /** 根据仍在执行的 run 和确认记录刷新会话状态，避免旧操作收尾覆盖新操作。 */
  private refreshSessionStatus(sessionId: string, now: number) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const hasRunning = [...this.runs.values()].some((run) => run.sessionId === sessionId && run.status === "running");
    const hasConfirmation = [...this.confirmations.values()].some((item) => item.sessionId === sessionId && ["pending", "executing"].includes(item.status));
    const nextStatus: AgentSession["status"] = hasRunning ? "running" : hasConfirmation ? "waiting_confirmation" : "idle";
    // 列表/详情读取会调用状态恢复；状态没有变化时不能把读取时间冒充最近活动时间。
    if (session.status === nextStatus) return;
    this.sessions.set(sessionId, { ...session, status: nextStatus, updatedAt: now });
  }

  async createSession(courseId: string, title: string) {
    const now = this.now();
    const session: AgentSession = { id: randomUUID(), courseId, title, status: "idle", createdAt: now, updatedAt: now };
    this.sessions.set(session.id, session);
    return structuredClone(session);
  }
  /** 修改会话显示名称，不改变消息、运行或课程内容。 */
  async renameSession(courseId: string, sessionId: string, title: string) {
    const current = this.sessions.get(sessionId);
    if (!current || current.courseId !== courseId) throw new AgentApplicationError("NOT_FOUND", "对话会话不存在", 404);
    const nextTitle = title.trim();
    if (!nextTitle) throw new AgentApplicationError("INVALID_ARGUMENT", "对话名称不能为空");
    // 重命名是会话元数据操作，不应把没有新消息的会话伪装成最近活跃。
    const next = { ...current, title: nextTitle };
    this.sessions.set(sessionId, next);
    return structuredClone(next);
  }
  /** 删除空闲会话及其在内存仓储中的消息、运行和确认记录。 */
  async deleteSession(courseId: string, sessionId: string) {
    const current = this.sessions.get(sessionId);
    if (!current || current.courseId !== courseId) throw new AgentApplicationError("NOT_FOUND", "对话会话不存在", 404);
    const now = this.now();
    await this.recoverExpiredRuns(sessionId, now);
    const hasRunning = [...this.runs.values()].some((run) => run.sessionId === sessionId && run.status === "running");
    const hasConfirmation = [...this.confirmations.values()].some((item) => item.sessionId === sessionId && ["pending", "executing"].includes(item.status) && item.expiresAt > now);
    if (hasRunning || hasConfirmation) throw new AgentApplicationError("RUN_IN_PROGRESS", "当前对话仍在执行或等待确认，无法删除", 409);
    this.sessions.delete(sessionId);
    this.messages.delete(sessionId);
    for (const [id, run] of this.runs) if (run.sessionId === sessionId) this.runs.delete(id);
    for (const [id, item] of this.confirmations) if (item.sessionId === sessionId) this.confirmations.delete(id);
  }
  async listSessions(courseId: string): Promise<AgentSession[]> {
    return [...this.sessions.values()].filter((item) => item.courseId === courseId).sort((a, b) => b.updatedAt - a.updatedAt).map((item) => structuredClone(item));
  }
  async getSession(courseId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    return session?.courseId === courseId ? structuredClone(session) : null;
  }
  /** 返回会话最近一次运行，供刷新后的状态提示和指标展示使用。 */
  async getLatestRun(sessionId: string) {
    const run = [...this.runs.values()].filter((item) => item.sessionId === sessionId).sort((a, b) => b.createdAt - a.createdAt)[0];
    return run ? structuredClone(run) : null;
  }
  /** 将已经超过 deadline 的运行收尾，避免刷新后一直显示“执行中”。 */
  async recoverExpiredRuns(sessionId: string, now: number) {
    for (const [id, run] of this.runs) {
      if (run.sessionId !== sessionId || run.status !== "running" || run.deadlineAt > now) continue;
      this.runs.set(id, { ...run, status: "interrupted", finishedAt: now, error: "运行超过截止时间，刷新时已标记为中断" });
    }
    for (const [id, item] of this.confirmations) {
      if (item.sessionId !== sessionId || item.status !== "executing" || item.expiresAt > now) continue;
      // 进程若在领取后退出，恢复为可点击状态；真正点击时再按原确认流程标记过期并更新工具卡。
      this.confirmations.set(id, { ...item, status: "pending", updatedAt: now });
    }
    this.refreshSessionStatus(sessionId, now);
  }
  /** 返回仍可操作的确认记录，不暴露给其他课程会话。 */
  async listPendingConfirmations(sessionId: string) {
    return [...this.confirmations.values()].filter((item) => item.sessionId === sessionId && item.status === "pending").sort((a, b) => b.createdAt - a.createdAt).map((item) => structuredClone(item));
  }
  async listMessages(sessionId: string) { return structuredClone(this.messages.get(sessionId) ?? []); }
  async appendMessage(sessionId: string, input: Omit<AgentMessage, "id" | "sequence" | "createdAt">) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new AgentApplicationError("NOT_FOUND", "对话会话不存在", 404);
    const items = this.messages.get(sessionId) ?? [];
    const message: AgentMessage = { ...structuredClone(input), id: randomUUID(), sequence: items.length + 1, createdAt: this.now() };
    items.push(message);
    this.messages.set(sessionId, items);
    this.sessions.set(sessionId, { ...session, updatedAt: message.createdAt });
    return structuredClone(message);
  }
  async replaceAssistantBlocks(sessionId: string, callId: string, blocks: AgentContentBlock[]) {
    const items = this.messages.get(sessionId) ?? [];
    const message = items.find((item) => item.role === "assistant" && "blocks" in item.content && item.content.blocks.some((block) => block.type === "tool" && block.callId === callId));
    if (!message) throw new AgentApplicationError("NOT_FOUND", "找不到待更新的工具记录", 404);
    message.content = { blocks: structuredClone(blocks) };
  }
  async startRun(sessionId: string, baseRevision: number, deadlineAt: number) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new AgentApplicationError("NOT_FOUND", "对话会话不存在", 404);
    const now = this.now();
    for (const [id, run] of this.runs) {
      if (run.sessionId !== sessionId || run.status !== "running") continue;
      if (run.deadlineAt > now) throw new AgentApplicationError("RUN_IN_PROGRESS", "当前对话仍有请求正在执行", 409);
      this.runs.set(id, { ...run, status: "interrupted", finishedAt: now, error: "运行超时后已释放" });
    }
    const run: AgentRun = { id: randomUUID(), sessionId, status: "running", baseRevision, deadlineAt, createdAt: now };
    this.runs.set(run.id, run);
    this.sessions.set(sessionId, { ...session, status: "running", updatedAt: now });
    return structuredClone(run);
  }
  async finishRun(runId: string, status: Exclude<AgentRunStatus, "running">, finalRevision?: number, error?: string, metrics?: AgentRunMetrics) {
    const run = this.runs.get(runId);
    if (!run) return;
    const now = this.now();
    this.runs.set(runId, { ...run, status, finalRevision, error, metrics: structuredClone(metrics), finishedAt: now });
    this.refreshSessionStatus(run.sessionId, now);
  }
  async createConfirmation(input: Omit<AgentConfirmation, "id" | "status" | "createdAt" | "updatedAt">) {
    const now = this.now();
    const confirmation: AgentConfirmation = { ...structuredClone(input), id: randomUUID(), status: "pending", createdAt: now, updatedAt: now };
    this.confirmations.set(confirmation.id, confirmation);
    return structuredClone(confirmation);
  }
  async getConfirmation(sessionId: string, confirmationId: string) {
    const item = this.confirmations.get(confirmationId);
    return item?.sessionId === sessionId ? structuredClone(item) : null;
  }
  /** 原子领取一次确认；只有 pending 到 executing 的调用者可以执行课程写入。 */
  async claimConfirmation(confirmationId: string) {
    const current = this.confirmations.get(confirmationId);
    if (!current) throw new AgentApplicationError("NOT_FOUND", "确认记录不存在", 404);
    if (current.status !== "pending") return { confirmation: structuredClone(current), claimed: false };
    const now = this.now();
    const next: AgentConfirmation = { ...current, status: "executing", updatedAt: now };
    this.confirmations.set(confirmationId, next);
    this.refreshSessionStatus(current.sessionId, now);
    return { confirmation: structuredClone(next), claimed: true };
  }
  async resolveConfirmation(confirmationId: string, status: "completed" | "cancelled" | "expired" | "failed", result?: unknown) {
    const current = this.confirmations.get(confirmationId);
    if (!current) throw new AgentApplicationError("NOT_FOUND", "确认记录不存在", 404);
    if (!["pending", "executing"].includes(current.status)) return structuredClone(current);
    const next = { ...current, status, result: structuredClone(result), updatedAt: this.now() };
    this.confirmations.set(confirmationId, next);
    this.refreshSessionStatus(current.sessionId, next.updatedAt);
    return structuredClone(next);
  }
}
