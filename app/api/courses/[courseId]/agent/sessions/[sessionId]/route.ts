import { NextResponse } from "next/server";
import { mapAgentError } from "@/lib/agent/api";
import { buildAgentModelContext } from "@/lib/agent/context-builder";
import { firstUserMessageText, isDefaultAgentSessionTitle, summarizeAgentSessionTitle } from "@/lib/agent/session-title";
import { AgentSessionRenameInputSchema } from "@/lib/agent/contracts";
import { getAgentSessionRepository, getCourseRepository } from "@/lib/repository";

export async function GET(_request: Request, context: { params: Promise<{ courseId: string; sessionId: string }> }) {
  const { courseId, sessionId } = await context.params;
  try {
    const repository = getAgentSessionRepository();
    const session = await repository.getSession(courseId, sessionId);
    if (!session) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "对话会话不存在", retryable: false } }, { status: 404 });
    await repository.recoverExpiredRuns(sessionId, Date.now());
    const currentSession = await repository.getSession(courseId, sessionId);
    const messages = await repository.listMessages(sessionId);
    let displaySession = currentSession ?? session;
    const course = await getCourseRepository().get(courseId);
    const firstText = firstUserMessageText(messages);
    if (course && firstText && isDefaultAgentSessionTitle(displaySession.title, course.title)) {
      try { displaySession = await repository.renameSession(courseId, sessionId, summarizeAgentSessionTitle(firstText)); } catch { /* 标题补齐失败不影响历史恢复。 */ }
    }
    const pendingConfirmations = await repository.listPendingConfirmations(sessionId);
    return NextResponse.json({ success: true, data: {
      session: displaySession,
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

export async function PATCH(request: Request, context: { params: Promise<{ courseId: string; sessionId: string }> }) {
  const { courseId, sessionId } = await context.params;
  try {
    const input = AgentSessionRenameInputSchema.parse(await request.json());
    const session = await getAgentSessionRepository().renameSession(courseId, sessionId, input.title);
    return NextResponse.json({ success: true, data: { session } });
  } catch (error) {
    const mapped = mapAgentError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

/** 删除当前课程下的空闲 Agent 会话，子记录由数据库外键级联清理。 */
export async function DELETE(_request: Request, context: { params: Promise<{ courseId: string; sessionId: string }> }) {
  const { courseId, sessionId } = await context.params;
  try {
    await getAgentSessionRepository().deleteSession(courseId, sessionId);
    return NextResponse.json({ success: true, data: { sessionId } });
  } catch (error) {
    const mapped = mapAgentError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

