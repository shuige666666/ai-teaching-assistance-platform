import { NextResponse } from "next/server";
import { z } from "zod";
import { CourseFolderNameSchema } from "@/lib/domain/course-folder";
import { getCourseFolderRepository } from "@/lib/repository";
import { createApiError, mapRepositoryError } from "@/lib/repository/error-response";

const FolderInputSchema = z.object({ name: CourseFolderNameSchema }).strict();

export async function GET() {
  try {
    const repository = getCourseFolderRepository();
    const [folders, memberships] = await Promise.all([repository.list(), repository.listMemberships()]);
    return NextResponse.json({ data: { folders, memberships } });
  } catch (error) {
    const mapped = mapRepositoryError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(request: Request) {
  try {
    const input = FolderInputSchema.parse(await request.json());
    const folder = await getCourseFolderRepository().create(input.name);
    return NextResponse.json({ data: { folder } }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json(createApiError("INVALID_INPUT", error.issues[0]?.message ?? "输入不合法", false), { status: 400 });
    const mapped = mapRepositoryError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
