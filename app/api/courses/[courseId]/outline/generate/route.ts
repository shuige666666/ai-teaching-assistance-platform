import { NextResponse } from "next/server";
import { createAIAdapter } from "@/lib/ai/factory";
import { GenerateOutlineInputSchema, mapOutlineError, readLimitedJson } from "@/lib/application/outline-api";
import { OutlineGenerationService } from "@/lib/application/outline-generation-service";
import { getCourseRepository, getGenerationRunTracker } from "@/lib/repository";
import { resolveRequestId, startServerOperation } from "@/lib/observability/server-log";

type RouteContext = { params: Promise<{ courseId: string }> };

/** 通过正式模型管线生成大纲；成功响应只返回已经提交到 MySQL 的课程。 */
export async function POST(request: Request, context: RouteContext) {
  // 1. 读取本次请求编号，用于查看日志。
  const requestId = resolveRequestId(request);
  // 2. 从 URL 读取要生成大纲的课程 ID。
  const { courseId } = await context.params;
  // 3. 开始记录本次生成日志。
  const operation = startServerOperation("outline.generate", { requestId, courseId, stage: "outline" });
  try {
    // 4. 读取课程当前版本号。
    const input = GenerateOutlineInputSchema.parse(await readLimitedJson(request));
    // 5. 创建模型调用对象：mock 或远端模型由服务端配置决定。
    const { adapter, timeoutMs } = createAIAdapter();
    // 6. 调用 generate()：读取课程、生成大纲、校验内容，然后保存到 MySQL。
    // 这里 OutlineGenerationService 的括号里面的参数主要是用于创建一个 OutlineGenerationService 对象，并把它依赖的工具传进去
    // generate 后面的括号里的参数就是常规的方法调用要携带的参数
    const course = await new OutlineGenerationService(getCourseRepository(), adapter, timeoutMs, Date.now, getGenerationRunTracker()).generate(
      courseId,
      input.expectedRevision,
      requestId,
      request.signal,
    );
    const metadata = course.outlineGeneration!;
    // 7. 记录成功日志，并把已保存的课程返回给浏览器。
    operation.success({
      provider: metadata.provider,
      model: metadata.model,
      upstreamCalls: metadata.upstreamCalls,
    });
    return NextResponse.json({
      success: true,
      data: { course },
      meta: {
        requestId,
        provider: metadata.provider,
        model: metadata.model,
        attempts: metadata.upstreamCalls,
        upstreamCalls: metadata.upstreamCalls,
        repaired: metadata.repaired,
        durationMs: metadata.durationMs,
      },
    });
  } catch (error) {
    // 8. 记录失败日志，并返回页面可以显示的错误信息。
    operation.failure(error);
    const mapped = mapOutlineError(error, requestId);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
