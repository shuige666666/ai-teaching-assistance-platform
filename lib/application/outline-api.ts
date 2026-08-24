import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AIAdapterError } from "@/lib/ai/contracts";
import { SceneOutlineSchema } from "@/lib/domain/schemas";
import { InvalidOutlineError } from "@/lib/generation/outline-schema";
import { OutlineGenerationError } from "@/lib/generation/outline-pipeline";
import { SceneGenerationError } from "@/lib/generation/scene-pipeline";
import { CourseConflictError, DatabaseUnavailableError, StoredCourseInvalidError } from "@/lib/repository/course-repository";
import { OutlineApplicationError } from "./outline-generation-service";
import { SceneApplicationError } from "./scene-generation-service";

export const GenerateOutlineInputSchema = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();
export const GenerateSceneInputSchema = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();
export const EditOutlineInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  courseTitle: z.string().trim().min(1).max(120),
  outlines: z.array(SceneOutlineSchema).min(3).max(5),
}).strict();

export async function readLimitedJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 64 * 1024) throw new z.ZodError([{ code: "custom", path: [], message: "请求体不能超过 64KB" }]);
  return JSON.parse(text);
}

export function mapOutlineError(error: unknown, requestId = randomUUID()) {
  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "服务端处理失败";
  let retryable = true;
  let upstreamCalls = 0;
  let issues: Array<{ path: string; message: string }> | undefined;
  if (error instanceof z.ZodError || error instanceof SyntaxError) { status = 400; code = "INVALID_REQUEST"; message = error instanceof z.ZodError ? error.issues[0]?.message ?? "请求不合法" : "请求体必须是合法 JSON"; retryable = false; }
  else if (error instanceof OutlineApplicationError) { status = error.code === "COURSE_NOT_FOUND" ? 404 : 409; code = error.code; message = error.message; retryable = false; }
  else if (error instanceof SceneApplicationError) { status = error.code === "COURSE_NOT_FOUND" || error.code === "OUTLINE_NOT_FOUND" ? 404 : 409; code = error.code; message = error.message; retryable = false; }
  else if (error instanceof CourseConflictError) { status = 409; code = "COURSE_CONFLICT"; message = "课程已被其他操作更新，请刷新后重试"; }
  else if (error instanceof DatabaseUnavailableError) { status = 503; code = "DATABASE_UNAVAILABLE"; message = "数据库暂时不可用，请检查 MySQL 服务和连接配置"; }
  else if (error instanceof StoredCourseInvalidError) { code = "STORED_COURSE_INVALID"; message = "数据库中的课程不符合当前数据契约"; retryable = false; }
  else if (error instanceof OutlineGenerationError) { status = error.code === "AI_AUTH_FAILED" || error.code === "AI_NOT_CONFIGURED" ? 503 : 502; code = error.code; message = error.message; retryable = error.retryable; upstreamCalls = error.upstreamCalls; issues = error.issues; }
  else if (error instanceof SceneGenerationError) { status = error.code === "AI_AUTH_FAILED" || error.code === "AI_NOT_CONFIGURED" ? 503 : 502; code = error.code; message = error.message; retryable = error.retryable; upstreamCalls = error.upstreamCalls; issues = error.issues; }
  else if (error instanceof AIAdapterError) { status = 503; code = error.code; message = error.message; retryable = error.retryable; }
  else if (error instanceof InvalidOutlineError) { status = 400; code = "INVALID_REQUEST"; message = "编辑后的大纲不符合课程约束"; retryable = false; issues = error.issues; }
  return { status, body: { success: false as const, error: { code, message, retryable, requestId, upstreamCalls, issues } } };
}
