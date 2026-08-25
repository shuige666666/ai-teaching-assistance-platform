import { NextResponse } from "next/server";
import { createAIAdapter } from "@/lib/ai/factory";
import { GenerateOutlineInputSchema, mapOutlineError, readLimitedJson } from "@/lib/application/outline-api";
import { OutlineGenerationService } from "@/lib/application/outline-generation-service";
import { getCourseRepository } from "@/lib/repository";
import { resolveRequestId, startServerOperation } from "@/lib/observability/server-log";

type RouteContext = { params: Promise<{ courseId: string }> };

/** 通过正式模型管线生成大纲；成功响应只返回已经提交到 MySQL 的课程。 */
export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveRequestId(request);
  const { courseId } = await context.params;
  const operation = startServerOperation("outline.generate", { requestId, courseId, stage: "outline" });
  try {
    const input = GenerateOutlineInputSchema.parse(await readLimitedJson(request));
    const { adapter, timeoutMs } = createAIAdapter();
    const course = await new OutlineGenerationService(getCourseRepository(), adapter, timeoutMs).generate(courseId, input.expectedRevision, requestId, request.signal);
    const metadata = course.outlineGeneration!;
    operation.success({ provider: metadata.provider, model: metadata.model, upstreamCalls: metadata.upstreamCalls });
    return NextResponse.json({
      success: true,
      data: { course },
      meta: { requestId, provider: metadata.provider, model: metadata.model, attempts: metadata.upstreamCalls, upstreamCalls: metadata.upstreamCalls, repaired: metadata.repaired, durationMs: metadata.durationMs },
    });
  } catch (error) {
    operation.failure(error);
    const mapped = mapOutlineError(error, requestId);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
