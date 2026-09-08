import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";
import { AgentApplicationError, type AgentConfirmation, type AgentContentBlock, type AgentMessage, type AgentRun, type AgentRunStatus, type AgentSession } from "@/lib/agent/contracts";
import { getDatabasePool } from "@/lib/db/pool";
import { DatabaseUnavailableError } from "./course-repository";
import type { AgentSessionRepository } from "./agent-session-repository";

interface SessionRow extends RowDataPacket { id: string; course_id: string; title: string; status: AgentSession["status"]; created_at: string | number; updated_at: string | number }
interface MessageRow extends RowDataPacket { id: string; session_id: string; run_id: string | null; sequence_no: number; role: AgentMessage["role"]; content_json: unknown; created_at: string | number }
interface RunRow extends RowDataPacket { id: string; session_id: string; status: AgentRun["status"]; base_revision: string | number; final_revision: string | number | null; deadline_at: string | number; error_text: string | null; created_at: string | number; finished_at: string | number | null }
interface ConfirmationRow extends RowDataPacket { id: string; session_id: string; run_id: string; call_id: string; tool_name: string; status: AgentConfirmation["status"]; base_revision: string | number; payload_json: unknown; result_json: unknown | null; summary: string; expires_at: string | number; created_at: string | number; updated_at: string | number }
function json<T>(value: unknown): T { return (typeof value === "string" ? JSON.parse(value) : value) as T }
function session(row: SessionRow): AgentSession { return { id: row.id, courseId: row.course_id, title: row.title, status: row.status, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) } }
function message(row: MessageRow): AgentMessage { return { id: row.id, sessionId: row.session_id, runId: row.run_id ?? undefined, sequence: row.sequence_no, role: row.role, content: json(row.content_json), createdAt: Number(row.created_at) } }
function confirmation(row: ConfirmationRow): AgentConfirmation { return { id: row.id, sessionId: row.session_id, runId: row.run_id, callId: row.call_id, toolName: row.tool_name, status: row.status, baseRevision: Number(row.base_revision), payload: json(row.payload_json), result: row.result_json === null ? undefined : json(row.result_json), summary: row.summary, expiresAt: Number(row.expires_at), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) } }
function fail(error: unknown): never { if (error instanceof AgentApplicationError) throw error; throw new DatabaseUnavailableError({ cause: error }) }

export class MySQLAgentSessionRepository implements AgentSessionRepository {
  constructor(private readonly pool: Pool = getDatabasePool(), private readonly now: () => number = Date.now) {}
  async createSession(courseId: string, title: string): Promise<AgentSession> {
    const now = this.now(); const id = randomUUID();
    try { await this.pool.execute("INSERT INTO agent_sessions (id,course_id,title,status,created_at,updated_at) VALUES (?, ?, ?, 'idle', ?, ?)", [id, courseId, title, now, now]); return { id, courseId, title, status: "idle", createdAt: now, updatedAt: now }; } catch (error) { fail(error) }
  }
  async listSessions(courseId: string) {
    try { const [rows] = await this.pool.execute<SessionRow[]>("SELECT * FROM agent_sessions WHERE course_id = ? ORDER BY updated_at DESC", [courseId]); return rows.map(session); } catch (error) { fail(error) }
  }
  async getSession(courseId: string, sessionId: string) {
    try { const [rows] = await this.pool.execute<SessionRow[]>("SELECT * FROM agent_sessions WHERE id = ? AND course_id = ? LIMIT 1", [sessionId, courseId]); return rows[0] ? session(rows[0]) : null; } catch (error) { fail(error) }
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
  async finishRun(runId: string, status: Exclude<AgentRunStatus, "running">, finalRevision?: number, error?: string) {
    try { const now = this.now(); await this.pool.execute("UPDATE agent_runs r JOIN agent_sessions s ON s.id=r.session_id SET r.status=?,r.final_revision=?,r.error_text=?,r.finished_at=?,s.status=?,s.updated_at=? WHERE r.id=?", [status, finalRevision ?? null, error?.slice(0,1000) ?? null, now, status === "waiting_confirmation" ? "waiting_confirmation" : "idle", now, runId]); } catch (cause) { fail(cause) }
  }
  async createConfirmation(input: Omit<AgentConfirmation, "id" | "status" | "createdAt" | "updatedAt">): Promise<AgentConfirmation> {
    const now=this.now(), id=randomUUID();
    try { await this.pool.execute("INSERT INTO agent_confirmations (id,session_id,run_id,call_id,tool_name,status,base_revision,payload_json,summary,expires_at,created_at,updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)", [id,input.sessionId,input.runId,input.callId,input.toolName,input.baseRevision,JSON.stringify(input.payload),input.summary,input.expiresAt,now,now]); return { ...input,id,status:"pending",createdAt:now,updatedAt:now }; } catch(error){ fail(error) }
  }
  async getConfirmation(sessionId:string, confirmationId:string) {
    try { const [rows]=await this.pool.execute<ConfirmationRow[]>("SELECT * FROM agent_confirmations WHERE id=? AND session_id=? LIMIT 1",[confirmationId,sessionId]); return rows[0]?confirmation(rows[0]):null; } catch(error){ fail(error) }
  }
  async resolveConfirmation(confirmationId:string,status:"completed"|"cancelled"|"expired",result?:unknown) {
    const now=this.now();
    try { await this.pool.execute<ResultSetHeader>("UPDATE agent_confirmations c JOIN agent_sessions s ON s.id=c.session_id SET c.status=?,c.result_json=?,c.updated_at=?,s.status='idle',s.updated_at=? WHERE c.id=? AND c.status='pending'",[status,result===undefined?null:JSON.stringify(result),now,now,confirmationId]); const [rows]=await this.pool.execute<ConfirmationRow[]>("SELECT * FROM agent_confirmations WHERE id=? LIMIT 1",[confirmationId]); if(!rows[0]) throw new AgentApplicationError("NOT_FOUND","确认记录不存在",404); return confirmation(rows[0]); } catch(error){ fail(error) }
  }
}
