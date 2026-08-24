import { NextResponse } from "next/server";
import { z } from "zod";
import { createCourseDraft } from "@/lib/domain/fixture";
import { getCourseRepository } from "@/lib/repository";
import { createApiError, mapRepositoryError } from "@/lib/repository/error-response";

const CreateCourseInputSchema = z.object({
  topic: z.string().trim().min(2, "主题至少需要 2 个字符").max(500, "主题不能超过 500 个字符"),
  requestedSceneCount: z.number().int().min(3).max(5),
});

export async function GET() {
  try {
    return NextResponse.json({ courses: await getCourseRepository().list() });
  } catch (error) {
    const mapped = mapRepositoryError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

/** 创建只包含主题和场景数量的草稿；正式大纲由独立生成接口完成。 */
export async function POST(request: Request) {
  try {
    const input = CreateCourseInputSchema.parse(await request.json());
    const course = await getCourseRepository().create(createCourseDraft(input.topic, input.requestedSceneCount));
    return NextResponse.json({ course }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(createApiError("INVALID_INPUT", error.issues[0]?.message ?? "输入不合法", false), { status: 400 });
    }
    const mapped = mapRepositoryError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
