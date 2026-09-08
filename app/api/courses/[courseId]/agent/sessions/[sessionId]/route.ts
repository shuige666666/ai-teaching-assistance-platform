import { NextResponse } from "next/server";
import { mapAgentError } from "@/lib/agent/api";
import { getAgentSessionRepository } from "@/lib/repository";

export async function GET(_request: Request, context: { params: Promise<{ courseId: string; sessionId: string }> }) {
  const { courseId, sessionId } = await context.params;
  try {
    const repository = getAgentSessionRepository();
    const session = await repository.getSession(courseId, sessionId);
    if (!session) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "对话会话不存在", retryable: false } }, { status: 404 });
    const messages = await repository.listMessages(sessionId);
    return NextResponse.json({ success: true, data: { session, messages } });
  } catch (error) {
    const mapped = mapAgentError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

