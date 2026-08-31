import { NextResponse } from "next/server";
import { z } from "zod";
import { createCourseDraft } from "@/lib/domain/fixture";
import { CourseBriefOverridesSchema } from "@/lib/domain/course-brief";
import { resolveRequestId, startServerOperation } from "@/lib/observability/server-log";
import { getCourseRepository } from "@/lib/repository";
import { createApiError, mapRepositoryError } from "@/lib/repository/error-response";

const CreateCourseInputSchema = z.object({
  topic: z.string().trim().min(2, "主题至少需要 2 个字符").max(500, "主题不能超过 500 个字符"),
  requestedSceneCount: z.number().int().min(4).max(8),
  briefOverrides: CourseBriefOverridesSchema.optional(),
}).strict();

export async function GET() {
  try {
    return NextResponse.json({ courses: await getCourseRepository().list() });
  } catch (error) {
    const mapped = mapRepositoryError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

/** 创建包含 provisional Brief 的课程草稿；模型解析结果在大纲生成成功后再固化。 */
export async function POST(request: Request) {
  const requestId = resolveRequestId(request);
  const operation = startServerOperation("course.create", { requestId, stage: "course" });
  try {
    const input = CreateCourseInputSchema.parse(await request.json());
    const course = await getCourseRepository().create(createCourseDraft(input.topic, input.requestedSceneCount, input.briefOverrides));
    operation.success({ courseId: course.id, sceneCount: course.requestedSceneCount });
    return NextResponse.json({ course, meta: { requestId } }, { status: 201 });
  } catch (error) {
    operation.failure(error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(createApiError("INVALID_INPUT", error.issues[0]?.message ?? "输入不合法", false, requestId), { status: 400 });
    }
    const mapped = mapRepositoryError(error, requestId);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
