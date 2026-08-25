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
});
