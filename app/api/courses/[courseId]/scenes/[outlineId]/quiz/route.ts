import { NextResponse } from "next/server";
import { mapOutlineError, readLimitedJson } from "@/lib/application/outline-api";
import { QuizEditingService } from "@/lib/application/quiz-editing-service";
import { EditQuizSceneInputSchema } from "@/lib/domain/quiz-edit";
import { resolveRequestId, startServerOperation } from "@/lib/observability/server-log";
import { getCourseRepository } from "@/lib/repository";

/** 保存人工编辑后的结构化题目；不调用模型，成功后返回新的 Quiz Scene。 */
export async function PATCH(request: Request, context: { params: Promise<{ courseId: string; outlineId: string }> }) {
  const requestId = resolveRequestId(request);
  const { courseId, outlineId } = await context.params;
  const operation = startServerOperation("quiz.edit", { requestId, courseId, outlineId, stage: "scene" });
  try {
    const input = EditQuizSceneInputSchema.parse(await readLimitedJson(request));
    const course = await new QuizEditingService(getCourseRepository()).edit(courseId, outlineId, input);
    const scene = course.scenes.find((item) => item.outlineId === outlineId)!;
    operation.success({ questionCount: scene.type === "quiz" ? scene.content.questions.length : 0 });
    return NextResponse.json({ success: true, data: { course, scene } });
  } catch (error) {
    operation.failure(error);
    const mapped = mapOutlineError(error, requestId);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
