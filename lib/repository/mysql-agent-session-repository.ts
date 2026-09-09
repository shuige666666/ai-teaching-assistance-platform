import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";
import { AgentApplicationError, type AgentConfirmation, type AgentContentBlock, type AgentMessage, type AgentRun, type AgentRunMetrics, type AgentRunStatus, type AgentSession } from "@/lib/agent/contracts";
import { getDatabasePool } from "@/lib/db/pool";
import { DatabaseUnavailableError } from "./course-repository";
import type { AgentSessionRepository } from "./agent-session-repository";

interface SessionRow extends RowDataPacket { id: string; course_id: string; title: string; status: AgentSession["status"]; created_at: string | number; updated_at: string | number }
interface MessageRow extends RowDataPacket { id: string; session_id: string; run_id: string | null; sequence_no: number; role: AgentMessage["role"]; content_json: unknown; created_at: string | number }
interface RunRow extends RowDataPacket { id: string; session_id: string; status: AgentRun["status"]; base_revision: string | number; final_revision: string | number | null; deadline_at: string | number; error_text: string | null; metrics_json: unknown | null; created_at: string | number; finished_at: string | number | null }
interface ConfirmationRow extends RowDataPacket { id: string; session_id: string; run_id: string; call_id: string; tool_name: string; status: AgentConfirmation["status"]; base_revision: string | number; payload_json: unknown; result_json: unknown | null; summary: string; expires_at: string | number; created_at: string | number; updated_at: string | number }
function json<T>(value: unknown): T { return (typeof value === "string" ? JSON.parse(value) : value) as T }
function session(row: SessionRow): AgentSession { return { id: row.id, courseId: row.course_id, title: row.title, status: row.status, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) } }
function message(row: MessageRow): AgentMessage { return { id: row.id, sessionId: row.session_id, runId: row.run_id ?? undefined, sequence: row.sequence_no, role: row.role, content: json(row.content_json), createdAt: Number(row.created_at) } }
function run(row: RunRow): AgentRun { return { id: row.id, sessionId: row.session_id, status: row.status, baseRevision: Number(row.base_revision), finalRevision: row.final_revision === null ? undefined : Number(row.final_revision), deadlineAt: Number(row.deadline_at), error: row.error_text ?? undefined, metrics: row.metrics_json === null ? undefined : json<AgentRunMetrics>(row.metrics_json), createdAt: Number(row.created_at), finishedAt: row.finished_at === null ? undefined : Number(row.finished_at) } }
function confirmation(row: ConfirmationRow): AgentConfirmation { return { id: row.id, sessionId: row.session_id, runId: row.run_id, callId: row.call_id, toolName: row.tool_name, status: row.status, baseRevision: Number(row.base_revision), payload: json(row.payload_json), result: row.result_json === null ? undefined : json(row.result_json), summary: row.summary, expiresAt: Number(row.expires_at), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) } }
function fail(error: unknown): never { if (error instanceof AgentApplicationError) throw error; throw new DatabaseUnavailableError({ cause: error }) }

export class MySQLAgentSessionRepository implements AgentSessionRepository {
  constructor(private readonly pool: Pool = getDatabasePool(), private readonly now: () => number = Date.now) {}
  /** 从真实未完成记录推导会话状态，旧 run/确认收尾时不会覆盖较新的运行。 */
  private async refreshSessionStatus(connection: PoolConnection, sessionId: string, now: number) {
    const [sessions] = await connection.execute<Array<RowDataPacket & { status: AgentSession["status"] }>>("SELECT status FROM agent_sessions WHERE id=? FOR UPDATE", [sessionId]);
    if (!sessions[0]) return;
    const [runningRows] = await connection.execute<RowDataPacket[]>("SELECT 1 AS active FROM agent_runs WHERE session_id=? AND status='running' LIMIT 1", [sessionId]);
    const [confirmationRows] = await connection.execute<RowDataPacket[]>("SELECT 1 AS active FROM agent_confirmations WHERE session_id=? AND status IN ('pending','executing') LIMIT 1", [sessionId]);
    const nextStatus: AgentSession["status"] = runningRows[0] ? "running" : confirmationRows[0] ? "waiting_confirmation" : "idle";
    // 列表/详情读取也会触发恢复；只有状态真正变化时才更新最近活动时间。
    if (sessions[0].status === nextStatus) return;
    await connection.execute("UPDATE agent_sessions SET status=?, updated_at=? WHERE id=?", [nextStatus, now, sessionId]);
  }
  async createSession(courseId: string, title: string): Promise<AgentSession> {
    const now = this.now(); const id = randomUUID();
    try { await this.pool.execute("INSERT INTO agent_sessions (id,course_id,title,status,created_at,updated_at) VALUES (?, ?, ?, 'idle', ?, ?)", [id, courseId, title, now, now]); return { id, courseId, title, status: "idle", createdAt: now, updatedAt: now }; } catch (error) { fail(error) }
  }
  /** 修改会话显示名称，不改变消息、运行或课程内容。 */
  async renameSession(courseId: string, sessionId: string, title: string) {
    const nextTitle = title.trim();
    if (!nextTitle) throw new AgentApplicationError("INVALID_ARGUMENT", "对话名称不能为空");
    try {
      const [rows] = await this.pool.execute<SessionRow[]>("SELECT * FROM agent_sessions WHERE id = ? AND course_id = ? LIMIT 1", [sessionId, courseId]);
      if (!rows[0]) throw new AgentApplicationError("NOT_FOUND", "对话会话不存在", 404);
      // 重命名只更新元数据，保留最后一条消息或运行写入的活动时间。
      await this.pool.execute("UPDATE agent_sessions SET title = ? WHERE id = ? AND course_id = ?", [nextTitle, sessionId, courseId]);
      return session({ ...rows[0], title: nextTitle });
    } catch (error) { fail(error) }
  }
  /** 在同一事务内删除空闲会话，依靠外键级联清理 Agent 子记录。 */
  async deleteSession(courseId: string, sessionId: string) {
    let connection: PoolConnection | undefined;
    try {
      connection = await this.pool.getConnection(); await connection.beginTransaction();
      const [sessions] = await connection.execute<SessionRow[]>("SELECT * FROM agent_sessions WHERE id = ? AND course_id = ? FOR UPDATE", [sessionId, courseId]);
      if (!sessions[0]) throw new AgentApplicationError("NOT_FOUND", "对话会话不存在", 404);
      const now = this.now();
      // 先释放已经超过期限的旧记录，避免过期请求阻塞正常删除。
      await connection.execute("UPDATE agent_runs SET status = 'interrupted', finished_at = ?, error_text = '运行超过截止时间，删除会话前已标记为中断' WHERE session_id = ? AND status = 'running' AND deadline_at <= ?", [now, sessionId, now]);
      await connection.execute("UPDATE agent_confirmations SET status = 'expired', updated_at = ? WHERE session_id = ? AND status IN ('pending','executing') AND expires_at <= ?", [now, sessionId, now]);
      const [activeRuns] = await connection.execute<RowDataPacket[]>("SELECT 1 AS active FROM agent_runs WHERE session_id = ? AND status = 'running' LIMIT 1", [sessionId]);
      const [activeConfirmations] = await connection.execute<RowDataPacket[]>("SELECT 1 AS active FROM agent_confirmations WHERE session_id = ? AND status IN ('pending','executing') LIMIT 1", [sessionId]);
      if (activeRuns[0] || activeConfirmations[0]) throw new AgentApplicationError("RUN_IN_PROGRESS", "当前对话仍在执行或等待确认，无法删除", 409);
      await connection.execute("DELETE FROM agent_sessions WHERE id = ? AND course_id = ?", [sessionId, courseId]);
      await connection.commit();
    } catch (error) { if (connection) await connection.rollback(); fail(error) } finally { connection?.release() }
  }
  async listSessions(courseId: string) {
    try { const [rows] = await this.pool.execute<SessionRow[]>("SELECT * FROM agent_sessions WHERE course_id = ? ORDER BY updated_at DESC", [courseId]); return rows.map(session); } catch (error) { fail(error) }
  }
  async getSession(courseId: string, sessionId: string) {
    try { const [rows] = await this.pool.execute<SessionRow[]>("SELECT * FROM agent_sessions WHERE id = ? AND course_id = ? LIMIT 1", [sessionId, courseId]); return rows[0] ? session(rows[0]) : null; } catch (error) { fail(error) }
  }
  /** 从数据库读取最近一次运行，恢复完成/失败/中断和轻量指标。 */
  async getLatestRun(sessionId: string) {
    try { const [rows] = await this.pool.execute<RunRow[]>("SELECT * FROM agent_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1", [sessionId]); return rows[0] ? run(rows[0]) : null; } catch (error) { fail(error) }
  }
  /** 刷新会话时收尾已超过 deadline 的运行，保留“中断”事实而不自动续跑。 */
  async recoverExpiredRuns(sessionId: string, now: number) {
    let connection: PoolConnection | undefined;
    try {
      connection = await this.pool.getConnection(); await connection.beginTransaction();
      await connection.execute("UPDATE agent_runs SET status = 'interrupted', finished_at = ?, error_text = '运行超过截止时间，刷新时已标记为中断' WHERE session_id = ? AND status = 'running' AND deadline_at <= ?", [now, sessionId, now]);
      await connection.execute("UPDATE agent_confirmations SET status='pending', updated_at=? WHERE session_id=? AND status='executing' AND expires_at<=?", [now, sessionId, now]);
      await this.refreshSessionStatus(connection, sessionId, now);
      await connection.commit();
    } catch (error) { if (connection) await connection.rollback(); fail(error) } finally { connection?.release() }
  }
  /** 只读取当前会话尚未处理的确认状态，payload 仍由服务端执行链保管。 */
  async listPendingConfirmations(sessionId: string) {
    try { const [rows] = await this.pool.execute<ConfirmationRow[]>("SELECT * FROM agent_confirmations WHERE session_id = ? AND status = 'pending' ORDER BY created_at DESC", [sessionId]); return rows.map(confirmation); } catch (error) { fail(error) }
  }
  async listMessages(sessionId: string) {
    try { const [rows] = await this.pool.execute<MessageRow[]>("SELECT * FROM agent_messages WHERE session_id = ? ORDER BY sequence_no", [sessionId]); return rows.map(message); } catch (error) { fail(error) }
  }
  async appendMessage(sessionId: string, input: Omit<AgentMessage, "id" | "sequence" | "createdAt">) {
    let connection: PoolConnection | undefined;
    try {
      connection = await this.pool.getConnection(); await connection.beginTransaction();
      const [sessions] = await connection.execute<SessionRow[]>("SELECT * FROM agent_sessions WHERE id = ? FOR UPDATE", [sessionId]);
      if (!sessions[0]) throw new AgentApplicationError("NOT_FOUND", "对话会话不存在", 404);
      const [rows] = await connection.execute<Array<RowDataPacket & { next_sequence: number }>>("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_sequence FROM agent_messages WHERE session_id = ?", [sessionId]);
      const now = this.now(); const id = randomUUID(); const sequence = Number(rows[0].next_sequence);
      await connection.execute("INSERT INTO agent_messages (id,session_id,run_id,sequence_no,role,content_json,created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, sessionId, input.runId ?? null, sequence, input.role, JSON.stringify(input.content), now]);
      await connection.execute("UPDATE agent_sessions SET updated_at = ? WHERE id = ?", [now, sessionId]); await connection.commit();
      return { ...input, id, sequence, createdAt: now };
    } catch (error) { if (connection) await connection.rollback(); fail(error) } finally { connection?.release() }
    throw new DatabaseUnavailableError();
  }
  async replaceAssistantBlocks(sessionId: string, callId: string, blocks: AgentContentBlock[]) {
    try {
      const [rows] = await this.pool.execute<MessageRow[]>("SELECT * FROM agent_messages WHERE session_id = ? AND role = 'assistant' ORDER BY sequence_no DESC", [sessionId]);
      const row = rows.find((item) => { const content = json<{ blocks?: AgentContentBlock[] }>(item.content_json); return content.blocks?.some((block) => block.type === "tool" && block.callId === callId) });
      if (!row) throw new AgentApplicationError("NOT_FOUND", "找不到待更新的工具记录", 404);
      await this.pool.execute("UPDATE agent_messages SET content_json = ? WHERE id = ?", [JSON.stringify({ blocks }), row.id]);
    } catch (error) { fail(error) }
  }
  async startRun(sessionId: string, baseRevision: number, deadlineAt: number): Promise<AgentRun> {
    let connection: PoolConnection | undefined;
    try {
      connection = await this.pool.getConnection(); await connection.beginTransaction();
      const [sessions] = await connection.execute<SessionRow[]>("SELECT * FROM agent_sessions WHERE id = ? FOR UPDATE", [sessionId]);
      if (!sessions[0]) throw new AgentApplicationError("NOT_FOUND", "对话会话不存在", 404);
      const now = this.now();
      await connection.execute("UPDATE agent_runs SET status = 'interrupted', finished_at = ?, error_text = '运行超时后已释放' WHERE session_id = ? AND status = 'running' AND deadline_at <= ?", [now, sessionId, now]);
      const [active] = await connection.execute<RunRow[]>("SELECT * FROM agent_runs WHERE session_id = ? AND status = 'running' LIMIT 1", [sessionId]);
      if (active[0]) throw new AgentApplicationError("RUN_IN_PROGRESS", "当前对话仍有请求正在执行", 409);
      const id = randomUUID();
      await connection.execute("INSERT INTO agent_runs (id,session_id,status,base_revision,deadline_at,created_at) VALUES (?, ?, 'running', ?, ?, ?)", [id, sessionId, baseRevision, deadlineAt, now]);
      await connection.execute("UPDATE agent_sessions SET status = 'running', updated_at = ? WHERE id = ?", [now, sessionId]); await connection.commit();
      return { id, sessionId, status: "running", baseRevision, deadlineAt, createdAt: now };
    } catch (error) { if (connection) await connection.rollback(); fail(error) } finally { connection?.release() }
    throw new DatabaseUnavailableError();
  }
  async finishRun(runId: string, status: Exclude<AgentRunStatus, "running">, finalRevision?: number, error?: string, metrics?: AgentRunMetrics) {
    let connection: PoolConnection | undefined;
    try {
      connection = await this.pool.getConnection(); await connection.beginTransaction();
      const [rows] = await connection.execute<RunRow[]>("SELECT * FROM agent_runs WHERE id=? FOR UPDATE", [runId]);
      if (rows[0]) {
        const now = this.now();
        await connection.execute("UPDATE agent_runs SET status=?,final_revision=?,error_text=?,metrics_json=?,finished_at=? WHERE id=?", [status, finalRevision ?? null, error?.slice(0,1000) ?? null, metrics === undefined ? null : JSON.stringify(metrics), now, runId]);
        await this.refreshSessionStatus(connection, rows[0].session_id, now);
      }
      await connection.commit();
    } catch (cause) { if (connection) await connection.rollback(); fail(cause) } finally { connection?.release() }
  }
  async createConfirmation(input: Omit<AgentConfirmation, "id" | "status" | "createdAt" | "updatedAt">): Promise<AgentConfirmation> {
    const now=this.now(), id=randomUUID();
    try { await this.pool.execute("INSERT INTO agent_confirmations (id,session_id,run_id,call_id,tool_name,status,base_revision,payload_json,summary,expires_at,created_at,updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)", [id,input.sessionId,input.runId,input.callId,input.toolName,input.baseRevision,JSON.stringify(input.payload),input.summary,input.expiresAt,now,now]); return { ...input,id,status:"pending",createdAt:now,updatedAt:now }; } catch(error){ fail(error) }
  }
  async getConfirmation(sessionId:string, confirmationId:string) {
    try { const [rows]=await this.pool.execute<ConfirmationRow[]>("SELECT * FROM agent_confirmations WHERE id=? AND session_id=? LIMIT 1",[confirmationId,sessionId]); return rows[0]?confirmation(rows[0]):null; } catch(error){ fail(error) }
  }
  /** 使用行锁把 pending 原子推进为 executing，防止双击确认重复执行写工具。 */
  async claimConfirmation(confirmationId: string) {
    let connection: PoolConnection | undefined;
    try {
      connection = await this.pool.getConnection(); await connection.beginTransaction();
      const [rows] = await connection.execute<ConfirmationRow[]>("SELECT * FROM agent_confirmations WHERE id=? FOR UPDATE", [confirmationId]);
      if (!rows[0]) throw new AgentApplicationError("NOT_FOUND", "确认记录不存在", 404);
      if (rows[0].status !== "pending") {
        await connection.commit();
        return { confirmation: confirmation(rows[0]), claimed: false };
      }
      const now = this.now();
      await connection.execute("UPDATE agent_confirmations SET status='executing',updated_at=? WHERE id=? AND status='pending'", [now, confirmationId]);
      await connection.execute("UPDATE agent_sessions SET status='running',updated_at=? WHERE id=?", [now, rows[0].session_id]);
      const claimed = confirmation({ ...rows[0], status: "executing", updated_at: now });
      await connection.commit();
      return { confirmation: claimed, claimed: true };
    } catch (error) { if (connection) await connection.rollback(); fail(error) } finally { connection?.release() }
    throw new DatabaseUnavailableError();
  }
  async resolveConfirmation(confirmationId:string,status:"completed"|"cancelled"|"expired"|"failed",result?:unknown) {
    let connection: PoolConnection | undefined;
    try {
      connection = await this.pool.getConnection(); await connection.beginTransaction();
      const [rows] = await connection.execute<ConfirmationRow[]>("SELECT * FROM agent_confirmations WHERE id=? FOR UPDATE", [confirmationId]);
      if (!rows[0]) throw new AgentApplicationError("NOT_FOUND", "确认记录不存在", 404);
      const now = this.now();
      await connection.execute<ResultSetHeader>("UPDATE agent_confirmations SET status=?,result_json=?,updated_at=? WHERE id=? AND status IN ('pending','executing')", [status, result===undefined?null:JSON.stringify(result), now, confirmationId]);
      await this.refreshSessionStatus(connection, rows[0].session_id, now);
      const [updated] = await connection.execute<ConfirmationRow[]>("SELECT * FROM agent_confirmations WHERE id=? LIMIT 1", [confirmationId]);
      await connection.commit();
      return confirmation(updated[0]);
    } catch(error){ if (connection) await connection.rollback(); fail(error) } finally { connection?.release() }
    throw new DatabaseUnavailableError();
  }
}
