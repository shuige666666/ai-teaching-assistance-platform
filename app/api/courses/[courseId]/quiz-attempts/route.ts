import { NextResponse } from "next/server";
import { QuizAttemptService, QuizAttemptRequestError } from "@/lib/application/quiz-attempt-service";
import { QuizAttemptInputSchema } from "@/lib/domain/quiz-attempt";
import { getCourseRepository, getQuizAttemptRepository } from "@/lib/repository";
import { createApiError, mapRepositoryError } from "@/lib/repository/error-response";

type RouteContext = { params: Promise<{ courseId: string }> };

const requestErrors = {
  COURSE_NOT_FOUND: [404, "课程不存在或已经被删除"],
  QUIZ_NOT_FOUND: [404, "指定场景不是当前课程中的测验"],
  QUESTION_NOT_FOUND: [404, "指定题目不存在"],
  OPTION_NOT_FOUND: [400, "选择项不属于指定题目"],
} as const;

/** 接收选择项并由服务端判分，响应不信任客户端提供的正确性。 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { courseId } = await context.params;
    const payload = QuizAttemptInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(createApiError("INVALID_QUIZ_ATTEMPT", "测验提交参数不符合契约", false), { status: 400 });
    }
    const attempt = await new QuizAttemptService(getCourseRepository(), getQuizAttemptRepository()).submit(courseId, payload.data);
    return NextResponse.json({ attempt }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(createApiError("INVALID_JSON", "请求体必须是合法 JSON", false), { status: 400 });
    }
    if (error instanceof QuizAttemptRequestError) {
      const [status, message] = requestErrors[error.code];
      return NextResponse.json(createApiError(error.code, message, false), { status });
    }
    const mapped = mapRepositoryError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
