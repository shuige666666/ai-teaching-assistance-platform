import type { AIAdapter, GenerateTextInput, GenerateTextResult } from "@/lib/ai/contracts";
import { AIAdapterError, type AIErrorCode } from "@/lib/ai/contracts";
import { resolveCourseBrief } from "@/lib/domain/course-brief";
import type { CourseBrief, CourseBriefResolution, GenerationMetadata, SceneOutline } from "@/lib/domain/schemas";
import { writeServerEvent } from "@/lib/observability/server-log";
import { parseModelJson } from "./parse-json";
import { assembleSceneOutlines, InvalidOutlineError, validateAndNormalizeOutline, type OutlineValidationKind } from "./outline-schema";
import { buildOutlineUserPrompt, OUTLINE_PROMPT_VERSION, OUTLINE_SYSTEM_PROMPT } from "./prompts/outline.v2";
import { buildRepairUserPrompt, REPAIR_SYSTEM_PROMPT } from "./prompts/repair.v1";
import { logUpstreamFailure, logUpstreamSuccess, retryDelayMs, waitForRetry } from "./retry-policy";
import { buildAttemptMetrics, type GenerationAttemptMetrics } from "./attempt-metrics";

export class OutlineGenerationError extends Error {
  public readonly validationKind?: OutlineValidationKind;
  public readonly attemptMetrics?: GenerationAttemptMetrics;

  constructor(
    public readonly code: "INVALID_MODEL_OUTPUT" | "GENERATION_BUDGET_EXHAUSTED" | AIErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly upstreamCalls: number,
    public readonly issues?: Array<{ path: string; message: string }>,
    options?: ErrorOptions & { validationKind?: OutlineValidationKind; attemptMetrics?: GenerationAttemptMetrics },
  ) {
    super(message, options);
    this.name = "OutlineGenerationError";
    this.validationKind = options?.validationKind;
    this.attemptMetrics = options?.attemptMetrics;
  }
}

export type OutlinePipelineResult = {
  courseTitle: string;
  brief: CourseBrief;
  briefResolution: CourseBriefResolution;
  outlines: SceneOutline[];
  metadata: GenerationMetadata;
};

// outline.v2 需要同时返回 Brief 解析结果和完整场景计划，旧版 2,000 token 容量不足。
export const OUTLINE_MAX_OUTPUT_TOKENS = 8_000;

function mergeUsage(results: GenerateTextResult[]) {
  const inputTokens = results.reduce((sum, result) => sum + (result.usage?.inputTokens ?? 0), 0);
  const outputTokens = results.reduce((sum, result) => sum + (result.usage?.outputTokens ?? 0), 0);
  return results.some((result) => result.usage) ? { inputTokens, outputTokens } : undefined;
}

/** 生成并校验课程大纲，必要时请求一次模型修复，并返回可持久化的结果。 */
export async function generateOutline(
  adapter: AIAdapter,
  input: {
    topic: string;
    sceneCount: number;
    provisionalBrief: CourseBrief;
    provisionalResolution: CourseBriefResolution;
    requestId: string;
    signal: AbortSignal;
  },
): Promise<OutlinePipelineResult> {
  const startedAt = Date.now();
  const successfulResults: GenerateTextResult[] = [];
  let upstreamCalls = 0;
  let repairAttempted = false;
  const maxCalls = 4;
  // 1. 用课程主题和场景数量拼出发给模型的提示词。
  const userPrompt = buildOutlineUserPrompt(input);

  function attemptOptions(options: ErrorOptions & { validationKind?: OutlineValidationKind } = {}) {
    return {
      ...options,
      attemptMetrics: buildAttemptMetrics({
        results: successfulResults,
        upstreamCalls,
        promptVersion: OUTLINE_PROMPT_VERSION,
        startedAt,
        repairAttempted,
      }),
    };
  }

  /**
   * 校验并规范化模型大纲，并由服务端根据 detectedBrief 生成最终 CourseBrief。
   * 返回通过校验的大纲结果和课程要求解析结果。
   */
  function validateResponse(value: unknown) {
    // 先检查模型输出的结构和课程级约束，再整理顺序与文本内容。
    const output = validateAndNormalizeOutline(value, input.sceneCount, input.provisionalBrief.interactionMode);
    // 再按显式设置、模型检测结果和默认值的优先级确定最终课程要求。
    const resolved = resolveCourseBrief({
      topic: input.topic,
      provisionalBrief: input.provisionalBrief,
      provisionalResolution: input.provisionalResolution,
      detectedBrief: output.detectedBrief,
      modelWarnings: output.warnings,
      resolvedAt: Date.now(),
    });
    return { output, resolved };
  }

  /** 在单次请求预算内调用模型，并重试可自动重试的上游错误。 */
  async function callAI(call: Omit<GenerateTextInput, "requestId" | "signal" | "maxOutputTokens">): Promise<GenerateTextResult> {
    let lastError: AIAdapterError | undefined;
    for (let attempt = 0; attempt < 3 && upstreamCalls < maxCalls; attempt += 1) {
      upstreamCalls += 1;
      try {
        // 调用当前配置的模型，并记录成功结果供后续生成元数据使用。
        const result = await adapter.generateText({ ...call, requestId: input.requestId, signal: input.signal, maxOutputTokens: OUTLINE_MAX_OUTPUT_TOKENS });
        successfulResults.push(result);
        logUpstreamSuccess(result, { requestId: input.requestId, stage: call.stage, upstreamAttempt: upstreamCalls });
        return result;
      } catch (error) {
        const mapped = error instanceof AIAdapterError ? error : new AIAdapterError("AI_UPSTREAM_ERROR", "模型调用失败", false, { cause: error });
        lastError = mapped;
        const willRetry = mapped.automaticRetryable && attempt < 2 && upstreamCalls < maxCalls;
        if (!willRetry) {
          logUpstreamFailure(mapped, { requestId: input.requestId, stage: call.stage, upstreamAttempt: upstreamCalls, willRetry: false });
          throw new OutlineGenerationError(mapped.code, mapped.message, mapped.retryable, upstreamCalls, undefined, attemptOptions({ cause: mapped }));
        }
        const delayMs = retryDelayMs(input.requestId, attempt);
        logUpstreamFailure(mapped, { requestId: input.requestId, stage: call.stage, upstreamAttempt: upstreamCalls, willRetry: true, retryDelayMs: delayMs });
        // 网络、限流或偶发响应错误可以等待后重试。
        try {
          await waitForRetry(delayMs, input.signal);
        } catch (abortError) {
          const aborted = abortError instanceof AIAdapterError ? abortError : mapped;
          logUpstreamFailure(aborted, { requestId: input.requestId, stage: call.stage, upstreamAttempt: upstreamCalls, willRetry: false });
          throw new OutlineGenerationError(aborted.code, aborted.message, aborted.retryable, upstreamCalls, undefined, attemptOptions({ cause: aborted }));
        }
      }
    }
    throw new OutlineGenerationError("GENERATION_BUDGET_EXHAUSTED", "本次模型调用已达到预算上限", true, upstreamCalls, undefined, attemptOptions({ cause: lastError }));
  }

  // 2. 第一次调用模型，得到大纲文本。
  const first = await callAI({ stage: "outline", systemPrompt: OUTLINE_SYSTEM_PROMPT, userPrompt });
  let validated;
  try {
    // 3. 解析模型文本，并校验大纲结构、数量和课程级约束。
    validated = validateResponse(parseModelJson(first.text));
  } catch (error) {
    // 4. 首次结果不合格时，记录校验问题并准备请求完整修复结果。
    const invalid = error instanceof InvalidOutlineError ? error : new InvalidOutlineError([{ path: "", message: "无法验证模型输出" }], { cause: error });
    const willRepair = upstreamCalls < maxCalls;
    writeServerEvent(willRepair ? "info" : "error", "outline.validation.failed", {
      requestId: input.requestId,
      stage: "outline",
      upstreamCalls,
      validationKind: invalid.validationKind,
      issueCount: invalid.issues.length,
      issues: invalid.issues.slice(0, 5),
      willRepair,
    });
    if (!willRepair) {
      throw new OutlineGenerationError("GENERATION_BUDGET_EXHAUSTED", "模型输出无效且已没有修复预算", true, upstreamCalls, invalid.issues, attemptOptions({ validationKind: invalid.validationKind }));
    }
    // 5. 把首次结果和具体校验问题交给模型，请它修正一次。
    repairAttempted = true;
    const repair = await callAI({ stage: "repair", systemPrompt: REPAIR_SYSTEM_PROMPT, userPrompt: buildRepairUserPrompt(userPrompt, first.text, invalid.issues) });
    try {
      // 6. 修复结果仍需经过与首次结果相同的解析和校验流程。
      validated = validateResponse(parseModelJson(repair.text));
    } catch (repairError) {
      const finalError = repairError instanceof InvalidOutlineError ? repairError : invalid;
      writeServerEvent("error", "outline.repair.failed", {
        requestId: input.requestId,
        stage: "repair",
        upstreamCalls,
        validationKind: finalError.validationKind,
        issueCount: finalError.issues.length,
        issues: finalError.issues.slice(0, 5),
      });
      // 本次修复预算已经耗尽，但下一次请求会重新采样，仍允许用户显式重试。
      throw new OutlineGenerationError("INVALID_MODEL_OUTPUT", "模型输出修复后仍不符合课程大纲契约", true, upstreamCalls, finalError.issues, attemptOptions({
        cause: repairError,
        validationKind: finalError.validationKind,
      }));
    }
  }
  // 7. 记录本次生成使用的模型、耗时和调用次数。
  const successful = successfulResults.at(-1) ?? first;
  const now = Date.now();
  return {
    courseTitle: validated.output.courseTitle,
    brief: validated.resolved.brief,
    briefResolution: validated.resolved.resolution,
    // 8. 为每一项通过校验的大纲生成系统 ID，供后续生成场景时引用。
    outlines: assembleSceneOutlines(validated.output),
    metadata: {
      provider: successful.provider,
      model: successful.model,
      promptVersion: OUTLINE_PROMPT_VERSION,
      requestId: input.requestId,
      durationMs: now - startedAt,
      upstreamCalls,
      repaired: repairAttempted,
      usage: mergeUsage(successfulResults),
      generatedAt: now,
    },
  };
}
