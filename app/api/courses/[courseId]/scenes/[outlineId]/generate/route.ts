import { NextResponse } from "next/server";
import { createAIAdapter } from "@/lib/ai/factory";
import { GenerateSceneInputSchema, mapOutlineError, readLimitedJson } from "@/lib/application/outline-api";
import { SceneGenerationService } from "@/lib/application/scene-generation-service";
import { getCourseRepository } from "@/lib/repository";
import { resolveRequestId, startServerOperation } from "@/lib/observability/server-log";

type RouteContext = { params: Promise<{ courseId: string; outlineId: string }> };

/** 只生成 URL 指定的一个场景，成功时返回已完成短事务提交的完整课程。 */
export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveRequestId(request);
  const { courseId, outlineId } = await context.params;
  const operation = startServerOperation("scene.generate", { requestId, courseId, outlineId, stage: "scene" });
  try {
    const input = GenerateSceneInputSchema.parse(await readLimitedJson(request));
    const { adapter, sceneTimeoutMs } = createAIAdapter();
    const course = await new SceneGenerationService(getCourseRepository(), adapter, sceneTimeoutMs).generate(
      courseId,
      outlineId,
      input.expectedRevision,
      requestId,
      request.signal,
    );
    const scene = course.scenes.find((item) => item.outlineId === outlineId)!;
    operation.success({ provider: scene.generation.provider, model: scene.generation.model, upstreamCalls: scene.generation.upstreamCalls });
    return NextResponse.json({
      success: true,
      data: { course, scene },
      meta: {
        requestId,
        provider: scene.generation.provider,
        model: scene.generation.model,
        attempts: course.sceneProgress.find((item) => item.outlineId === outlineId)?.attempts ?? 1,
        upstreamCalls: scene.generation.upstreamCalls,
        repaired: scene.generation.repaired,
        durationMs: scene.generation.durationMs,
      },
    });
  } catch (error) {
    operation.failure(error);
    const mapped = mapOutlineError(error, requestId);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
