import { NextResponse } from "next/server";
import { z } from "zod";
import { CourseFolderNameSchema } from "@/lib/domain/course-folder";
import { getCourseFolderRepository, getGenerationRunTracker } from "@/lib/repository";
import { createApiError, mapRepositoryError } from "@/lib/repository/error-response";

type RouteContext = { params: Promise<{ folderId: string }> };
const FolderInputSchema = z.object({ name: CourseFolderNameSchema }).strict();
const FolderDeleteModeSchema = z.enum(["unfile", "delete_courses"]);

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { folderId } = await context.params;
    const input = FolderInputSchema.parse(await request.json());
    const folder = await getCourseFolderRepository().rename(folderId, input.name);
    if (!folder) return NextResponse.json(createApiError("COURSE_FOLDER_NOT_FOUND", "文件夹不存在或已经被删除", false), { status: 404 });
    return NextResponse.json({ data: { folder } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json(createApiError("INVALID_INPUT", error.issues[0]?.message ?? "输入不合法", false), { status: 400 });
    const mapped = mapRepositoryError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { folderId } = await context.params;
    const mode = FolderDeleteModeSchema.parse(new URL(request.url).searchParams.get("mode") ?? "unfile");
    const deleted = await getCourseFolderRepository().delete(folderId, mode);
    if (!deleted) return NextResponse.json(createApiError("COURSE_FOLDER_NOT_FOUND", "文件夹不存在或已经被删除", false), { status: 404 });
    for (const courseId of deleted.deletedCourseIds) await getGenerationRunTracker().deleteCourseRuns(courseId);
    return NextResponse.json({ data: deleted });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json(createApiError("INVALID_INPUT", "不支持的文件夹删除方式", false), { status: 400 });
    const mapped = mapRepositoryError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
