import { NextResponse } from "next/server";
import { getCourseRepository, getGenerationRunTracker } from "@/lib/repository";
import { createApiError, mapRepositoryError } from "@/lib/repository/error-response";

type RouteContext = { params: Promise<{ courseId: string }> };

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
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const mapped = mapRepositoryError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
