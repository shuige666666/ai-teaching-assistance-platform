import type { AgentConfirmation, AgentContentBlock, AgentMessage, AgentRun, AgentRunStatus, AgentSession } from "@/lib/agent/contracts";

export interface AgentSessionRepository {
  createSession(courseId: string, title: string): Promise<AgentSession>;
  listSessions(courseId: string): Promise<AgentSession[]>;
  getSession(courseId: string, sessionId: string): Promise<AgentSession | null>;
  listMessages(sessionId: string): Promise<AgentMessage[]>;
  appendMessage(sessionId: string, message: Omit<AgentMessage, "id" | "sequence" | "createdAt">): Promise<AgentMessage>;
  replaceAssistantBlocks(sessionId: string, callId: string, blocks: AgentContentBlock[]): Promise<void>;
  startRun(sessionId: string, baseRevision: number, deadlineAt: number): Promise<AgentRun>;
  finishRun(runId: string, status: Exclude<AgentRunStatus, "running">, finalRevision?: number, error?: string): Promise<void>;
  createConfirmation(input: Omit<AgentConfirmation, "id" | "status" | "createdAt" | "updatedAt">): Promise<AgentConfirmation>;
  getConfirmation(sessionId: string, confirmationId: string): Promise<AgentConfirmation | null>;
  resolveConfirmation(confirmationId: string, status: "completed" | "cancelled" | "expired", result?: unknown): Promise<AgentConfirmation>;
}

