import { NextResponse } from "next/server";
import { AgentSessionCreateInputSchema } from "@/lib/agent/contracts";
import { mapAgentError } from "@/lib/agent/api";
import { getAgentSessionRepository, getCourseRepository } from "@/lib/repository";

export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  try {
    const course = await getCourseRepository().get(courseId);
    if (!course) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "课程不存在", retryable: false } }, { status: 404 });
    const sessions = await getAgentSessionRepository().listSessions(courseId);
    return NextResponse.json({ success: true, data: { sessions } });
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

