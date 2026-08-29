import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRequestId, startServerOperation } from "@/lib/observability/server-log";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("server operation log", () => {
  it("沿用浏览器传入的安全 requestId，拒绝非法值", () => {
    expect(resolveRequestId(new Request("http://local.test", { headers: { "x-request-id": "browser_request-123" } }))).toBe("browser_request-123");
    expect(resolveRequestId(new Request("http://local.test", { headers: { "x-request-id": "bad id with spaces" } }))).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("长操作输出开始、心跳和成功结束日志", () => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const operation = startServerOperation("outline.generate", { requestId: "request-123", stage: "outline" }, 1_000);
    vi.advanceTimersByTime(1_000);
    operation.success({ upstreamCalls: 1 });

    const events = info.mock.calls.map(([line]) => JSON.parse(String(line)).event);
    expect(events).toEqual(["outline.generate.started", "outline.generate.running", "outline.generate.succeeded"]);
  });

  it("失败结束日志输出受控错误字段但不展开 cause", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const operation = startServerOperation("outline.generate", { requestId: "request-failed", stage: "outline" });
    const error = Object.assign(new Error("模型输出修复后仍不符合课程大纲契约", { cause: new Error("raw upstream body") }), {
      name: "OutlineGenerationError",
      code: "INVALID_MODEL_OUTPUT",
      retryable: true,
      upstreamCalls: 2,
      validationKind: "schema",
      issues: [{ path: "outlines.1.role", message: "无效枚举值" }],
    });

    operation.failure(error);

    const payload = JSON.parse(String(errorLog.mock.calls[0][0]));
    expect(payload).toMatchObject({
      event: "outline.generate.failed",
      code: "INVALID_MODEL_OUTPUT",
      retryable: true,
      upstreamCalls: 2,
      validationKind: "schema",
      issueCount: 1,
      issues: [{ path: "outlines.1.role", message: "无效枚举值" }],
    });
    expect(JSON.stringify(payload)).not.toContain("raw upstream body");
  });
});
