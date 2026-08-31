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

export class OutlineGenerationError extends Error {
  public readonly validationKind?: OutlineValidationKind;

  constructor(
    public readonly code: "INVALID_MODEL_OUTPUT" | "GENERATION_BUDGET_EXHAUSTED" | AIErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly upstreamCalls: number,
    public readonly issues?: Array<{ path: string; message: string }>,
    options?: ErrorOptions & { validationKind?: OutlineValidationKind },
  ) {
    super(message, options);
    this.name = "OutlineGenerationError";
    this.validationKind = options?.validationKind;
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

/** 执行大纲调用、受限传输重试、解析、语义门和最多一次模型修复。 */
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
  const maxCalls = 4;
  // 1. 用课程主题和场景数量拼出发给模型的提示词。
  const userPrompt = buildOutlineUserPrompt(input);

  /** 校验模型大纲后，由服务端根据检测字段独占计算最终 Brief。 */
  function validateResponse(value: unknown) {
    const output = validateAndNormalizeOutline(value, input.sceneCount, input.provisionalBrief.interactionMode);
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

  async function callAI(call: Omit<GenerateTextInput, "requestId" | "signal" | "maxOutputTokens">): Promise<GenerateTextResult> {
    let lastError: AIAdapterError | undefined;
    for (let attempt = 0; attempt < 3 && upstreamCalls < maxCalls; attempt += 1) {
      upstreamCalls += 1;
      try {
        // 2. 调用当前配置的模型，并拿到它返回的文本。
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
          throw new OutlineGenerationError(mapped.code, mapped.message, mapped.retryable, upstreamCalls, undefined, { cause: mapped });
        }
        const delayMs = retryDelayMs(input.requestId, attempt);
        logUpstreamFailure(mapped, { requestId: input.requestId, stage: call.stage, upstreamAttempt: upstreamCalls, willRetry: true, retryDelayMs: delayMs });
        // 3. 网络、限流或偶发响应错误可以等待后重试。
        try {
          await waitForRetry(delayMs, input.signal);
        } catch (abortError) {
          const aborted = abortError instanceof AIAdapterError ? abortError : mapped;
          logUpstreamFailure(aborted, { requestId: input.requestId, stage: call.stage, upstreamAttempt: upstreamCalls, willRetry: false });
          throw new OutlineGenerationError(aborted.code, aborted.message, aborted.retryable, upstreamCalls, undefined, { cause: aborted });
        }
      }
    }
    throw new OutlineGenerationError("GENERATION_BUDGET_EXHAUSTED", "本次模型调用已达到预算上限", true, upstreamCalls, undefined, { cause: lastError });
  }

  // 4. 第一次调用模型，得到大纲文本。
  const first = await callAI({ stage: "outline", systemPrompt: OUTLINE_SYSTEM_PROMPT, userPrompt });
  let validated;
  let repaired = false;
  try {
    validated = validateResponse(parseModelJson(first.text));
  } catch (error) {
    // 5. 把文本解析成 JSON，并检查大纲数量、测验数量、标题等是否正确。
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
      throw new OutlineGenerationError("GENERATION_BUDGET_EXHAUSTED", "模型输出无效且已没有修复预算", true, upstreamCalls, invalid.issues, { validationKind: invalid.validationKind });
    }
    // 6. 第一次结果不合格时，把错误原因交给模型，请它修正一次。
    const repair = await callAI({ stage: "repair", systemPrompt: REPAIR_SYSTEM_PROMPT, userPrompt: buildRepairUserPrompt(userPrompt, first.text, invalid.issues) });
    repaired = true;
    try {
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
      throw new OutlineGenerationError("INVALID_MODEL_OUTPUT", "模型输出修复后仍不符合课程大纲契约", true, upstreamCalls, finalError.issues, {
        cause: repairError,
        validationKind: finalError.validationKind,
      });
    }
  }
  // 7. 记录本次生成使用的模型、耗时和调用次数。
  const successful = successfulResults.at(-1) ?? first;
  const now = Date.now();
  return {
    courseTitle: validated.output.courseTitle,
    brief: validated.resolved.brief,
    briefResolution: validated.resolved.resolution,
    // 8. 给每一项大纲生成系统 ID，供后续生成场景时引用。
    outlines: assembleSceneOutlines(validated.output),
    metadata: {
      provider: successful.provider,
      model: successful.model,
      promptVersion: OUTLINE_PROMPT_VERSION,
      requestId: input.requestId,
      durationMs: now - startedAt,
      upstreamCalls,
      repaired,
      usage: mergeUsage(successfulResults),
      generatedAt: now,
    },
  };
}
