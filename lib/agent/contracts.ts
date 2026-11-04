import { z } from "zod";

export const AgentMessageInputSchema = z.object({
  text: z.string().trim().min(1).max(4_000),
  currentSceneId: z.string().min(1).optional(),
  courseRevision: z.number().int().nonnegative(),
}).strict();

export const AgentSessionCreateInputSchema = z.object({ currentSceneId: z.string().min(1).optional() }).strict();
export const AgentSessionRenameInputSchema = z.object({ title: z.string().trim().min(1).max(80) }).strict();
export const AgentConfirmationInputSchema = z.object({ confirmationId: z.string().uuid(), decision: z.enum(["confirm", "cancel"]) }).strict();

export type AgentToolCall = { id: string; name: string; arguments: string };
export type AgentModelMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: AgentToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };
export type AgentToolDefinition = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type AgentModelEvent =
  | { type: "reasoning_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call_delta"; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: "finish"; finishReason?: string; usage?: { inputTokens?: number; outputTokens?: number } };
export interface AgentTurnInput { requestId: string; systemPrompt: string; messages: AgentModelMessage[]; tools: AgentToolDefinition[]; signal: AbortSignal }
export interface AgentAdapter { streamTurn(input: AgentTurnInput): AsyncIterable<AgentModelEvent> }

export type AgentThinkingBlock = { type: "thinking"; id: string; text: string; durationMs: number; modelTurn: number };
export type AgentTextBlock = { type: "text"; id: string; text: string; modelTurn: number };
export type AgentToolBlock = {
  type: "tool"; id: string; modelTurn: number; callId: string; name: string; label: string;
  status: "running" | "completed" | "failed" | "waiting_confirmation" | "not_executed" | "cancelled";
  arguments: unknown; result?: unknown; durationMs?: number; targetSceneId?: string; confirmationId?: string;
  confirmationKind?: "patch" | "delete" | "regenerate_quiz";
};

export type AgentSceneReplacement = { oldSceneId: string; newSceneId: string; outlineId: string };
export type AgentCourseUpdate = {
  revision: number;
  affectedSceneIds: string[];
  removedSceneIds?: string[];
  sceneReplacements?: AgentSceneReplacement[];
  contentChanged?: boolean;
};
export type AgentContentBlock = AgentThinkingBlock | AgentTextBlock | AgentToolBlock;
export type AgentSseEvent =
  | { type: "run_started"; runId: string; sessionId: string }
  | { type: "thinking_started"; blockId: string }
  | { type: "thinking_delta"; blockId: string; delta: string }
  | { type: "thinking_finished"; blockId: string; durationMs: number }
  | { type: "text_started"; blockId: string }
  | { type: "text_delta"; blockId: string; delta: string }
  | { type: "text_finished"; blockId: string }
  | { type: "tool_started"; block: AgentToolBlock }
  | { type: "tool_finished"; block: AgentToolBlock }
  | { type: "confirmation_required"; block: AgentToolBlock; summary: string }
  | ({ type: "course_updated" } & AgentCourseUpdate)
  | { type: "run_finished"; status: "completed" | "failed" | "cancelled" | "waiting_confirmation" | "interrupted"; error?: string };

export type AgentSessionStatus = "idle" | "running" | "waiting_confirmation";
export type AgentRunStatus = "running" | "completed" | "failed" | "cancelled" | "waiting_confirmation" | "interrupted";
export type AgentSession = { id: string; courseId: string; title: string; status: AgentSessionStatus; createdAt: number; updatedAt: number };
export type AgentRunMetrics = {
  modelCalls: number;
  toolCalls: number;
  toolCompleted: number;
  toolFailed: number;
  toolWaitingConfirmation: number;
  toolCancelled: number;
  totalDurationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
};
export type AgentMessage = {
  id: string; sessionId: string; runId?: string; sequence: number; role: "user" | "assistant";
  content: { text: string; currentSceneId?: string; courseRevision?: number } | { blocks: AgentContentBlock[] };
  createdAt: number;
};
export type AgentRun = {
  id: string; sessionId: string; status: AgentRunStatus; baseRevision: number; finalRevision?: number;
  deadlineAt: number; error?: string; createdAt: number; finishedAt?: number; metrics?: AgentRunMetrics;
};
export type AgentContextInfo = { omittedMessageCount: number; includedTurnCount: number; usedCharacters: number; maxCharacters: number };
export type AgentConfirmation = {
  id: string; sessionId: string; runId: string; callId: string; toolName: string;
  status: "pending" | "executing" | "completed" | "cancelled" | "expired" | "failed"; baseRevision: number; payload: unknown;
  result?: unknown; summary: string; expiresAt: number; createdAt: number; updatedAt: number;
};

export class AgentApplicationError extends Error {
  constructor(
    public readonly code: "INVALID_ARGUMENT" | "NOT_FOUND" | "COURSE_CONFLICT" | "RUN_IN_PROGRESS" | "CONFIRMATION_REQUIRED" | "TOOL_EXECUTION_FAILED" | "INVALID_COURSE_STATE",
    message: string,
    public readonly status = 400,
  ) { super(message); this.name = "AgentApplicationError"; }
}

