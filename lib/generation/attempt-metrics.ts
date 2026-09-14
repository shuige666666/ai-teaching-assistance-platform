import type { GenerateTextResult } from "@/lib/ai/contracts";
import type { GenerationMetadata } from "@/lib/domain/schemas";
import type { UsageStatus } from "@/lib/domain/generation-run";

export type GenerationAttemptMetrics = {
  provider?: GenerationMetadata["provider"];
  model?: string;
  promptVersion?: string;
  durationMs: number;
  upstreamCalls: number;
  repairAttempted: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
  usageStatus: UsageStatus;
};

function mergeUsage(results: GenerateTextResult[]) {
  if (!results.some((result) => result.usage)) return undefined;
  return {
    inputTokens: results.reduce((sum, result) => sum + (result.usage?.inputTokens ?? 0), 0),
    outputTokens: results.reduce((sum, result) => sum + (result.usage?.outputTokens ?? 0), 0),
  };
}

/** 汇总本次管线已经拿到的安全用量；缺失值保持 unknown，不按零次调用处理。 */
export function buildAttemptMetrics(input: {
  results: GenerateTextResult[];
  upstreamCalls: number;
  promptVersion?: string;
  startedAt: number;
  repairAttempted: boolean;
}): GenerationAttemptMetrics {
  const last = input.results.at(-1);
  const complete = input.upstreamCalls > 0
    && input.results.length === input.upstreamCalls
    && input.results.every((result) => result.usage?.inputTokens !== undefined && result.usage.outputTokens !== undefined);
  const hasUsage = input.results.some((result) => result.usage?.inputTokens !== undefined || result.usage?.outputTokens !== undefined);
  return {
    provider: last?.provider,
    model: last?.model,
    promptVersion: input.promptVersion,
    durationMs: Date.now() - input.startedAt,
    upstreamCalls: input.upstreamCalls,
    repairAttempted: input.repairAttempted,
    usage: mergeUsage(input.results),
    usageStatus: complete ? "complete" : hasUsage ? "partial" : "unavailable",
  };
}

/** 成功产物已有 GenerationMetadata，把它转换为运行表需要的增量口径。 */
export function metadataAttemptMetrics(metadata: GenerationMetadata): GenerationAttemptMetrics {
  const complete = metadata.usage?.inputTokens !== undefined && metadata.usage.outputTokens !== undefined;
  const hasUsage = metadata.usage?.inputTokens !== undefined || metadata.usage?.outputTokens !== undefined;
  return {
    provider: metadata.provider,
    model: metadata.model,
    promptVersion: metadata.promptVersion,
    durationMs: metadata.durationMs,
    upstreamCalls: metadata.upstreamCalls,
    repairAttempted: metadata.repaired,
    usage: metadata.usage,
    usageStatus: complete ? "complete" : hasUsage ? "partial" : "unavailable",
  };
}
