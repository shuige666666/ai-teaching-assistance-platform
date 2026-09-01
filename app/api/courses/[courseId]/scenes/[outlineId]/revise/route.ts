import { NextResponse } from "next/server";
import { createAIAdapter } from "@/lib/ai/factory";
import { ReviseSceneInputSchema, mapOutlineError, readLimitedJson } from "@/lib/application/outline-api";
import { SceneGenerationService } from "@/lib/application/scene-generation-service";
import { getCourseRepository } from "@/lib/repository";
import { resolveRequestId, startServerOperation } from "@/lib/observability/server-log";

/** 依据当前已保存场景和用户意见生成完整替代品，成功后才原子提交。 */
export async function POST(request: Request, context: { params: Promise<{ courseId: string; outlineId: string }> }) {
  const requestId = resolveRequestId(request);
  const { courseId, outlineId } = await context.params;
  const operation = startServerOperation("scene.revise", { requestId, courseId, outlineId, stage: "scene" });
  try {
    const input = ReviseSceneInputSchema.parse(await readLimitedJson(request));
    const { adapter, sceneTimeoutMs } = createAIAdapter();
    const course = await new SceneGenerationService(getCourseRepository(), adapter, sceneTimeoutMs)
      .revise(courseId, outlineId, input.expectedRevision, requestId, {
        instruction: input.instruction,
        confirmQuizAttemptDeletion: input.confirmQuizAttemptDeletion,
        requestSignal: request.signal,
      });
    const scene = course.scenes.find((item) => item.outlineId === outlineId)!;
    operation.success({ provider: scene.generation.provider, model: scene.generation.model, upstreamCalls: scene.generation.upstreamCalls });
    return NextResponse.json({ success: true, data: { course, scene }, meta: scene.generation });
  } catch (error) {
    operation.failure(error);
    const mapped = mapOutlineError(error, requestId);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
