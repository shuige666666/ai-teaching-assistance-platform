import { NextResponse } from "next/server";
import { createAIAdapter } from "@/lib/ai/factory";
import { GenerateSceneInputSchema, mapOutlineError, readLimitedJson } from "@/lib/application/outline-api";
import { SceneGenerationService } from "@/lib/application/scene-generation-service";
import { getCourseRepository, getGenerationRunTracker } from "@/lib/repository";
import { resolveRequestId, startServerOperation } from "@/lib/observability/server-log";

type RouteContext = { params: Promise<{ courseId: string; outlineId: string }> };

/** 只生成 URL 指定的一个场景，成功时返回已完成短事务提交的完整课程。 */
export async function POST(request: Request, context: RouteContext) {
  // 1. 读取本次场景生成的请求编号。
  const requestId = resolveRequestId(request);
  // 2. 从 URL 读取课程 ID 和要生成的那一项大纲 ID。
  const { courseId, outlineId } = await context.params;
  // 3. 开始记录本次场景生成日志。
  const operation = startServerOperation("scene.generate", { requestId, courseId, outlineId, stage: "scene" });
  try {
    // 4. 读取课程当前版本号。
    const input = GenerateSceneInputSchema.parse(await readLimitedJson(request));
    // 5. 创建模型调用对象。
    const { adapter, sceneTimeoutMs } = createAIAdapter();
    // 6. 调用 generate()：生成这一场内容并保存到课程中。
    const course = await new SceneGenerationService(getCourseRepository(), adapter, sceneTimeoutMs, Date.now, getGenerationRunTracker()).generate(
      courseId,
      outlineId,
      input.expectedRevision,
      requestId,
      request.signal,
    );
    // 7. 从保存后的课程中取出刚生成的场景。
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
    // 8. 记录失败日志，并返回页面可以显示的错误信息。
    operation.failure(error);
    const mapped = mapOutlineError(error, requestId);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
