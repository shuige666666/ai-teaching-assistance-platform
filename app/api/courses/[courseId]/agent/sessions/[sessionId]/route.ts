import { NextResponse } from "next/server";
import { mapAgentError } from "@/lib/agent/api";
import { buildAgentModelContext } from "@/lib/agent/context-builder";
import { getAgentSessionRepository } from "@/lib/repository";

export async function GET(_request: Request, context: { params: Promise<{ courseId: string; sessionId: string }> }) {
  const { courseId, sessionId } = await context.params;
  try {
    const repository = getAgentSessionRepository();
    const session = await repository.getSession(courseId, sessionId);
    if (!session) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "对话会话不存在", retryable: false } }, { status: 404 });
    await repository.recoverExpiredRuns(sessionId, Date.now());
    const currentSession = await repository.getSession(courseId, sessionId);
    const messages = await repository.listMessages(sessionId);
    const pendingConfirmations = await repository.listPendingConfirmations(sessionId);
    return NextResponse.json({ success: true, data: {
      session: currentSession ?? session,
      messages,
      latestRun: await repository.getLatestRun(sessionId),
      // 待确认列表只返回 UI 状态，真实 payload 仍只留在服务端确认链中。
      pendingConfirmations: pendingConfirmations.map((item) => ({ id: item.id, runId: item.runId, callId: item.callId, toolName: item.toolName, status: item.status, baseRevision: item.baseRevision, summary: item.summary, expiresAt: item.expiresAt })),
      context: buildAgentModelContext(messages).info,
    } });
  } catch (error) {
    const mapped = mapAgentError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

