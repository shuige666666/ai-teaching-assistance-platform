import { AgentMessageInputSchema, type AgentSseEvent } from "@/lib/agent/contracts";
import { CourseAgentService } from "@/lib/agent/course-agent-service";
import { mapAgentError } from "@/lib/agent/api";
import { createAgentAdapter } from "@/lib/ai/agent-factory";
import { getAgentSessionRepository, getCourseRepository } from "@/lib/repository";

const encoder = new TextEncoder();

export async function POST(request: Request, context: { params: Promise<{ courseId: string; sessionId: string }> }) {
  const { courseId, sessionId } = await context.params;
  let input;
  try {
    input = AgentMessageInputSchema.parse(await request.json());
    const session = await getAgentSessionRepository().getSession(courseId, sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_NOT_FOUND") return Response.json({ success: false, error: { code: "NOT_FOUND", message: "对话会话不存在", retryable: false } }, { status: 404 });
    const mapped = mapAgentError(error);
    return Response.json(mapped.body, { status: mapped.status });
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const emit = (event: AgentSseEvent) => {
        if (!closed) controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      const { adapter, generationAdapter, timeoutMs, sceneTimeoutMs } = createAgentAdapter();
      void new CourseAgentService(getCourseRepository(), getAgentSessionRepository(), adapter, timeoutMs, Date.now, generationAdapter, sceneTimeoutMs)
        .run(courseId, sessionId, input, request.signal, emit)
        .catch((error) => {
          const mapped = mapAgentError(error);
          emit({ type: "run_finished", status: "failed", error: mapped.body.error.message });
        })
        .finally(() => { closed = true; controller.close(); });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

