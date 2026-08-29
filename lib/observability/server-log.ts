import { randomUUID } from "node:crypto";

type LogValue = string | number | boolean | null | undefined | LogValue[] | { [key: string]: LogValue };
type LogFields = Record<string, LogValue>;

/** 从受控业务异常中提取脱敏诊断字段，不记录 cause、Prompt 或模型原文。 */
function structuredErrorFields(error: unknown): LogFields {
  if (!error || typeof error !== "object") return {};
  const candidate = error as Record<string, unknown>;
  // 只展开带 retryable 的受控业务错误，避免把 Node/MySQL 原生错误消息中的路径或连接信息写入日志。
  if (typeof candidate.code !== "string" || typeof candidate.retryable !== "boolean") return {};
  const allIssues = Array.isArray(candidate.issues)
    ? candidate.issues.filter((issue): issue is { path: string; message: string } => Boolean(
      issue && typeof issue === "object" && typeof (issue as { path?: unknown }).path === "string" && typeof (issue as { message?: unknown }).message === "string",
    ))
    : [];
  return {
    code: candidate.code,
    message: error instanceof Error ? error.message : undefined,
    retryable: typeof candidate.retryable === "boolean" ? candidate.retryable : undefined,
    upstreamCalls: typeof candidate.upstreamCalls === "number" ? candidate.upstreamCalls : undefined,
    validationKind: typeof candidate.validationKind === "string" ? candidate.validationKind : undefined,
    issueCount: allIssues.length || undefined,
    issues: allIssues.length > 0 ? allIssues.slice(0, 5) : undefined,
  };
}

/** 接受浏览器生成的安全 requestId，非法或缺失时由服务端重新生成。 */
export function resolveRequestId(request: Request): string {
  const candidate = request.headers.get("x-request-id")?.trim();
  return candidate && /^[a-zA-Z0-9_-]{8,80}$/.test(candidate) ? candidate : randomUUID();
}

export function writeServerEvent(level: "info" | "error", event: string, fields: LogFields) {
  const payload = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(payload);
  else console.info(payload);
}

/** 为可能持续较久的数据库或模型操作输出开始、心跳和结束日志。 */
export function startServerOperation(event: string, fields: LogFields, heartbeatMs = 10_000) {
  const startedAt = Date.now();
  writeServerEvent("info", `${event}.started`, fields);
  const heartbeat = setInterval(() => writeServerEvent("info", `${event}.running`, { ...fields, elapsedMs: Date.now() - startedAt }), heartbeatMs);
  heartbeat.unref?.();

  return {
    success(extra: LogFields = {}) {
      clearInterval(heartbeat);
      writeServerEvent("info", `${event}.succeeded`, { ...fields, ...extra, durationMs: Date.now() - startedAt });
    },
    failure(error: unknown, extra: LogFields = {}) {
      clearInterval(heartbeat);
      writeServerEvent("error", `${event}.failed`, {
        ...fields,
        ...extra,
        ...structuredErrorFields(error),
        durationMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    },
  };
}
