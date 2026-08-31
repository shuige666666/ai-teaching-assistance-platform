import { NextResponse } from "next/server";
import { createAIAdapter } from "@/lib/ai/factory";
import { RegenerateInteractiveInputSchema, mapOutlineError, readLimitedJson } from "@/lib/application/outline-api";
import { SceneGenerationService } from "@/lib/application/scene-generation-service";
import { getCourseRepository } from "@/lib/repository";
import { resolveRequestId, startServerOperation } from "@/lib/observability/server-log";

/** 用户主动再生成指定互动，只有事务替换成功才向课堂返回新课程。 */
export async function POST(request: Request, context: { params: Promise<{ courseId: string; outlineId: string }> }) {
  const requestId = resolveRequestId(request);
  const { courseId, outlineId } = await context.params;
  const operation = startServerOperation("scene.regenerate", { requestId, courseId, outlineId, stage: "scene" });
  try {
    const input = RegenerateInteractiveInputSchema.parse(await readLimitedJson(request));
    const { adapter, sceneTimeoutMs } = createAIAdapter();
    const course = await new SceneGenerationService(getCourseRepository(), adapter, sceneTimeoutMs)
      .regenerateInteractive(courseId, outlineId, input.expectedRevision, requestId, input.runtimeError, request.signal);
    const scene = course.scenes.find((item) => item.outlineId === outlineId)!;
    operation.success({ provider: scene.generation.provider, model: scene.generation.model, upstreamCalls: scene.generation.upstreamCalls });
    return NextResponse.json({ success: true, data: { course, scene }, meta: scene.generation });
  } catch (error) {
    operation.failure(error);
    const mapped = mapOutlineError(error, requestId);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
