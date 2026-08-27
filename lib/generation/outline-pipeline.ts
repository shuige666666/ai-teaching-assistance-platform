import type { AIAdapter, GenerateTextInput, GenerateTextResult } from "@/lib/ai/contracts";
import { AIAdapterError, type AIErrorCode } from "@/lib/ai/contracts";
import type { GenerationMetadata, SceneOutline } from "@/lib/domain/schemas";
import { parseModelJson } from "./parse-json";
import { assembleSceneOutlines, InvalidOutlineError, validateAndNormalizeOutline } from "./outline-schema";
import { buildOutlineUserPrompt, OUTLINE_PROMPT_VERSION, OUTLINE_SYSTEM_PROMPT } from "./prompts/outline.v1";
import { buildRepairUserPrompt, REPAIR_SYSTEM_PROMPT } from "./prompts/repair.v1";
import { logUpstreamFailure, retryDelayMs, waitForRetry } from "./retry-policy";

export class OutlineGenerationError extends Error {
  constructor(
    public readonly code: "INVALID_MODEL_OUTPUT" | "GENERATION_BUDGET_EXHAUSTED" | AIErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly upstreamCalls: number,
    public readonly issues?: Array<{ path: string; message: string }>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OutlineGenerationError";
  }
}

export type OutlinePipelineResult = { courseTitle: string; outlines: SceneOutline[]; metadata: GenerationMetadata };

function mergeUsage(results: GenerateTextResult[]) {
  const inputTokens = results.reduce((sum, result) => sum + (result.usage?.inputTokens ?? 0), 0);
  const outputTokens = results.reduce((sum, result) => sum + (result.usage?.outputTokens ?? 0), 0);
  return results.some((result) => result.usage) ? { inputTokens, outputTokens } : undefined;
}

/** 执行大纲调用、受限传输重试、解析、语义门和最多一次模型修复。 */
export async function generateOutline(
  adapter: AIAdapter,
  input: { topic: string; sceneCount: number; requestId: string; signal: AbortSignal },
): Promise<OutlinePipelineResult> {
  const startedAt = Date.now();
  const successfulResults: GenerateTextResult[] = [];
  let upstreamCalls = 0;
  const maxCalls = 4;
  // 1. 用课程主题和场景数量拼出发给模型的提示词。
  const userPrompt = buildOutlineUserPrompt(input.topic, input.sceneCount);

  async function callAI(call: Omit<GenerateTextInput, "requestId" | "signal" | "maxOutputTokens">): Promise<GenerateTextResult> {
    let lastError: AIAdapterError | undefined;
    for (let attempt = 0; attempt < 3 && upstreamCalls < maxCalls; attempt += 1) {
      upstreamCalls += 1;
      try {
        // 2. 调用当前配置的模型，并拿到它返回的文本。
        const result = await adapter.generateText({ ...call, requestId: input.requestId, signal: input.signal, maxOutputTokens: 2_000 });
        successfulResults.push(result);
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
  let output;
  let repaired = false;
  try {
    output = validateAndNormalizeOutline(parseModelJson(first.text), input.sceneCount);
  } catch (error) {
    // 5. 把文本解析成 JSON，并检查大纲数量、测验数量、标题等是否正确。
    const invalid = error instanceof InvalidOutlineError ? error : new InvalidOutlineError([{ path: "", message: "无法验证模型输出" }], { cause: error });
    if (upstreamCalls >= maxCalls) throw new OutlineGenerationError("GENERATION_BUDGET_EXHAUSTED", "模型输出无效且已没有修复预算", true, upstreamCalls, invalid.issues);
    // 6. 第一次结果不合格时，把错误原因交给模型，请它修正一次。
    const repair = await callAI({ stage: "repair", systemPrompt: REPAIR_SYSTEM_PROMPT, userPrompt: buildRepairUserPrompt(userPrompt, first.text, invalid.issues) });
    repaired = true;
    try {
      output = validateAndNormalizeOutline(parseModelJson(repair.text), input.sceneCount);
    } catch (repairError) {
      const finalError = repairError instanceof InvalidOutlineError ? repairError : invalid;
      // 本次修复预算已经耗尽，但下一次请求会重新采样，仍允许用户显式重试。
      throw new OutlineGenerationError("INVALID_MODEL_OUTPUT", "模型输出修复后仍不符合课程大纲契约", true, upstreamCalls, finalError.issues, { cause: repairError });
    }
  }
  // 7. 记录本次生成使用的模型、耗时和调用次数。
  const successful = successfulResults.at(-1) ?? first;
  const now = Date.now();
  return {
    courseTitle: output.courseTitle,
    // 8. 给每一项大纲生成系统 ID，供后续生成场景时引用。
    outlines: assembleSceneOutlines(output),
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
