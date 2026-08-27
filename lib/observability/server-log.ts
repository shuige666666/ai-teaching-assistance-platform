import { randomUUID } from "node:crypto";

type LogValue = string | number | boolean | null | undefined;
type LogFields = Record<string, LogValue>;

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
        durationMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    },
  };
}
