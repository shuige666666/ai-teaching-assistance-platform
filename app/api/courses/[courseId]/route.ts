import { NextResponse } from "next/server";
import { z } from "zod";
import { getCourseFolderRepository, getCourseRepository, getGenerationRunTracker } from "@/lib/repository";
import { createApiError, mapRepositoryError } from "@/lib/repository/error-response";

type RouteContext = { params: Promise<{ courseId: string }> };

const RenameCourseInputSchema = z.object({
  title: z.string().trim().min(1, "课程名称不能为空").max(120, "课程名称不能超过 120 个字符"),
  expectedRevision: z.number().int().nonnegative(),
}).strict();

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { courseId } = await context.params;
    const course = await getCourseRepository().get(courseId);
    if (!course) return NextResponse.json(createApiError("COURSE_NOT_FOUND", "课程不存在或已经被删除", false), { status: 404 });
    return NextResponse.json({ course });
  } catch (error) {
    const mapped = mapRepositoryError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { courseId } = await context.params;
    await getCourseRepository().delete(courseId);
    // MySQL 由外键级联；内存演示仓储通过同一入口清理运行历史。
    await getGenerationRunTracker().deleteCourseRuns(courseId);
    await getCourseFolderRepository().removeCourse(courseId).catch(() => undefined);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const mapped = mapRepositoryError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

/** 编辑课程名称属于课程元数据变更，继续使用 revision 防止覆盖并发修订。 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { courseId } = await context.params;
    const input = RenameCourseInputSchema.parse(await request.json());
    const repository = getCourseRepository();
    const current = await repository.get(courseId);
    if (!current) return NextResponse.json(createApiError("COURSE_NOT_FOUND", "课程不存在或已经被删除", false), { status: 404 });
    const course = await repository.save({ ...current, title: input.title }, input.expectedRevision);
    return NextResponse.json({ course });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json(createApiError("INVALID_INPUT", error.issues[0]?.message ?? "输入不合法", false), { status: 400 });
    const mapped = mapRepositoryError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
