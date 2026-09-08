import { NextResponse } from "next/server";
import { AgentSessionCreateInputSchema } from "@/lib/agent/contracts";
import { mapAgentError } from "@/lib/agent/api";
import { getAgentSessionRepository, getCourseRepository } from "@/lib/repository";

export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  try {
    const course = await getCourseRepository().get(courseId);
    if (!course) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "课程不存在", retryable: false } }, { status: 404 });
    const repository = getAgentSessionRepository();
    const sessions = await repository.listSessions(courseId);
    // 会话列表也顺便释放已过期运行，避免旧状态在切换器中永久显示“执行中”。
    for (const session of sessions) await repository.recoverExpiredRuns(session.id, Date.now());
    return NextResponse.json({ success: true, data: { sessions: await repository.listSessions(courseId) } });
  } catch (error) {
    const mapped = mapAgentError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  try {
    AgentSessionCreateInputSchema.parse(await request.json());
    const course = await getCourseRepository().get(courseId);
    if (!course) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "课程不存在", retryable: false } }, { status: 404 });
    const session = await getAgentSessionRepository().createSession(courseId, `${course.title} · 课程修订`);
    return NextResponse.json({ success: true, data: { session } }, { status: 201 });
  } catch (error) {
    const mapped = mapAgentError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

