import { afterEach, describe, expect, it, vi } from "vitest";
import { AIAdapterError } from "@/lib/ai/contracts";
import { logUpstreamFailure, retryDelayMs, waitForRetry } from "@/lib/generation/retry-policy";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("remote retry policy", () => {
  it("同一 requestId 的指数退避与抖动可复现", () => {
    expect(retryDelayMs("request-123", 0)).toBe(retryDelayMs("request-123", 0));
    expect(retryDelayMs("request-123", 0)).toBeGreaterThanOrEqual(100);
    expect(retryDelayMs("request-123", 0)).toBeLessThanOrEqual(150);
    expect(retryDelayMs("request-123", 1)).toBeGreaterThanOrEqual(200);
    expect(retryDelayMs("request-123", 1)).toBeLessThanOrEqual(250);
  });

  it("退避期间取消后立即停止", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitForRetry(500, controller.signal);
    controller.abort();

    await expect(waiting).rejects.toMatchObject({
      code: "AI_TIMEOUT",
      retryable: true,
      automaticRetryable: false,
      diagnostics: { responseKind: "aborted" },
    });
  });

  it("重试日志只包含脱敏元数据", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = new AIAdapterError("AI_UPSTREAM_ERROR", "远端响应异常", true, {
      cause: new Error("secret raw model output"),
      diagnostics: {
        providerStatus: 200,
        responseKind: "invalid_envelope",
        contentType: "application/json",
        responseBytes: 128,
      },
    });

    logUpstreamFailure(error, {
      requestId: "request-123",
      stage: "scene",
      upstreamAttempt: 1,
      willRetry: true,
      retryDelayMs: 120,
    });

    const line = String(info.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      event: "ai.upstream.retrying",
      requestId: "request-123",
      responseKind: "invalid_envelope",
      responseBytes: 128,
      willRetry: true,
    });
    expect(line).not.toContain("secret raw model output");
  });
});
