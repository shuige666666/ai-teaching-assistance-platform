import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { EditOutlineInputSchema, mapOutlineError, readLimitedJson } from "@/lib/application/outline-api";
import { OutlineGenerationService } from "@/lib/application/outline-generation-service";
import { getCourseRepository } from "@/lib/repository";

type RouteContext = { params: Promise<{ courseId: string }> };

/** 保存人工审核后的大纲文案；Provider 配置与模型调用不参与该接口。 */
export async function PATCH(request: Request, context: RouteContext) {
  const requestId = randomUUID();
  try {
    const { courseId } = await context.params;
    const input = EditOutlineInputSchema.parse(await readLimitedJson(request));
    const course = await new OutlineGenerationService(getCourseRepository(), new MockAIAdapter()).edit(
      courseId,
      input.expectedRevision,
      input.courseTitle,
      input.outlines,
    );
    return NextResponse.json({ success: true, data: { course }, meta: { requestId } });
  } catch (error) {
    const mapped = mapOutlineError(error, requestId);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
