import { NextResponse } from "next/server";
import { z } from "zod";
import { getCourseFolderRepository, getCourseRepository } from "@/lib/repository";
import { createApiError, mapRepositoryError } from "@/lib/repository/error-response";

type RouteContext = { params: Promise<{ courseId: string }> };
const MoveCourseInputSchema = z.object({ folderId: z.string().uuid().nullable() }).strict();

/** 移动只更新课程库归属，不改变课程 revision、内容和最近修改时间。 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { courseId } = await context.params;
    const input = MoveCourseInputSchema.parse(await request.json());
    const course = await getCourseRepository().get(courseId);
    if (!course) return NextResponse.json(createApiError("COURSE_NOT_FOUND", "课程不存在或已经被删除", false), { status: 404 });
    const membership = await getCourseFolderRepository().moveCourse(courseId, input.folderId);
    return NextResponse.json({ data: { courseId, folderId: membership?.folderId ?? null } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json(createApiError("INVALID_INPUT", error.issues[0]?.message ?? "输入不合法", false), { status: 400 });
    const mapped = mapRepositoryError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
