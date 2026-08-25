import {
  CourseConflictError,
  DatabaseUnavailableError,
  RepositoryConfigurationError,
  StoredCourseInvalidError,
} from "./course-repository";

export type RepositoryErrorResponse = {
  status: number;
  body: { success: false; error: { code: string; message: string; retryable: boolean; requestId: string } };
};

export function createApiError(code: string, message: string, retryable: boolean, requestId: string = randomUUID()) {
  return { success: false as const, error: { code, message, retryable, requestId } };
}

/** 把服务端仓储异常映射为不泄露连接信息的统一 API 错误。 */
export function mapRepositoryError(error: unknown, requestId?: string): RepositoryErrorResponse {
  if (error instanceof CourseConflictError) {
    return { status: 409, body: createApiError("COURSE_CONFLICT", "课程已被其他操作更新，请刷新后重试", true, requestId) };
  }
  if (error instanceof DatabaseUnavailableError) {
    return { status: 503, body: createApiError("DATABASE_UNAVAILABLE", "数据库暂时不可用，请检查 MySQL 服务和连接配置", true, requestId) };
  }
  if (error instanceof StoredCourseInvalidError) {
    return { status: 500, body: createApiError("STORED_COURSE_INVALID", "数据库中的课程不符合当前数据契约", false, requestId) };
  }
  if (error instanceof RepositoryConfigurationError) {
    return { status: 500, body: createApiError("REPOSITORY_CONFIGURATION_INVALID", "服务端课程仓储配置无效", false, requestId) };
  }
  return { status: 500, body: createApiError("INTERNAL_ERROR", "服务端处理失败", true, requestId) };
}
import { randomUUID } from "node:crypto";
