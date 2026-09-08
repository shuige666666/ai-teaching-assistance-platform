import { NextResponse } from "next/server";
import { AgentConfirmationInputSchema, type AgentSseEvent } from "@/lib/agent/contracts";
import { CourseAgentService } from "@/lib/agent/course-agent-service";
import { mapAgentError } from "@/lib/agent/api";
import { createAgentAdapter } from "@/lib/ai/agent-factory";
import { getAgentSessionRepository, getCourseRepository } from "@/lib/repository";

const encoder = new TextEncoder();

export async function POST(request: Request, context: { params: Promise<{ courseId: string; sessionId: string }> }) {
  const { courseId, sessionId } = await context.params;
  try {
    const input = AgentConfirmationInputSchema.parse(await request.json());
    const sessions = getAgentSessionRepository();
    const pending = await sessions.getConfirmation(sessionId, input.confirmationId);
    const payload = pending?.payload as { kind?: string } | undefined;
    const { adapter, generationAdapter, timeoutMs, sceneTimeoutMs } = createAgentAdapter();
    const service = new CourseAgentService(getCourseRepository(), sessions, adapter, timeoutMs, Date.now, generationAdapter, sceneTimeoutMs);
    if (input.decision === "confirm" && payload?.kind === "regenerate_quiz") {
      const stream = new ReadableStream({
        start(controller) {
          let closed = false;
          const emit = (event: AgentSseEvent) => { if (!closed) controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)); };
          void service.confirmStream(courseId, sessionId, input.confirmationId, request.signal, emit)
            .catch((error) => {
              const mapped = mapAgentError(error);
              emit({ type: "run_finished", status: "failed", error: mapped.body.error.message });
            })
            .finally(() => { closed = true; controller.close(); });
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
    }
    const confirmation = await service.confirm(courseId, sessionId, input.confirmationId, input.decision);
    return NextResponse.json({ success: true, data: { confirmation } });
  } catch (error) {
    const mapped = mapAgentError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

