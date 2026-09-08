import { NextResponse } from "next/server";
import { AgentConfirmationInputSchema } from "@/lib/agent/contracts";
import { CourseAgentService } from "@/lib/agent/course-agent-service";
import { mapAgentError } from "@/lib/agent/api";
import { createAgentAdapter } from "@/lib/ai/agent-factory";
import { getAgentSessionRepository, getCourseRepository } from "@/lib/repository";

export async function POST(request: Request, context: { params: Promise<{ courseId: string; sessionId: string }> }) {
  const { courseId, sessionId } = await context.params;
  try {
    const input = AgentConfirmationInputSchema.parse(await request.json());
    const { adapter, timeoutMs } = createAgentAdapter();
    const confirmation = await new CourseAgentService(getCourseRepository(), getAgentSessionRepository(), adapter, timeoutMs)
      .confirm(courseId, sessionId, input.confirmationId, input.decision);
    return NextResponse.json({ success: true, data: { confirmation } });
  } catch (error) {
    const mapped = mapAgentError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

