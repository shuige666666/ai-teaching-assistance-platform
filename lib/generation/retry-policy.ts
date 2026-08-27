import { AIAdapterError, type GenerationStage } from "@/lib/ai/contracts";
import { writeServerEvent } from "@/lib/observability/server-log";

/** 使用 requestId 生成稳定抖动，既避免同时重试，也保持测试可复现。 */
export function retryDelayMs(requestId: string, attempt: number): number {
  let hash = attempt + 17;
  for (const character of requestId) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return (100 * (2 ** attempt)) + (hash % 51);
}

/** 在退避期间尊重 AbortSignal，避免用户离页后继续发起上游请求。 */
export function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new AIAdapterError("AI_TIMEOUT", "模型请求超时或被取消", true, {
      automaticRetryable: false,
      diagnostics: { responseKind: "aborted" },
    }));
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AIAdapterError("AI_TIMEOUT", "模型请求超时或被取消", true, {
        automaticRetryable: false,
        diagnostics: { responseKind: "aborted" },
      }));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** 只输出脱敏响应元数据，不记录 Prompt 或模型原文。 */
export function logUpstreamFailure(
  error: AIAdapterError,
  fields: {
    requestId: string;
    stage: GenerationStage;
    upstreamAttempt: number;
    willRetry: boolean;
    retryDelayMs?: number;
  },
) {
  writeServerEvent(fields.willRetry ? "info" : "error", fields.willRetry ? "ai.upstream.retrying" : "ai.upstream.rejected", {
    requestId: fields.requestId,
    stage: fields.stage,
    upstreamAttempt: fields.upstreamAttempt,
    code: error.code,
    retryable: error.retryable,
    automaticRetryable: error.automaticRetryable,
    willRetry: fields.willRetry,
    retryDelayMs: fields.retryDelayMs,
    providerStatus: error.diagnostics?.providerStatus,
    responseKind: error.diagnostics?.responseKind,
    contentType: error.diagnostics?.contentType,
    responseBytes: error.diagnostics?.responseBytes,
    finishReason: error.diagnostics?.finishReason,
  });
}
