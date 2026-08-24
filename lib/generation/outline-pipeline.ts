import type { AIAdapter, GenerateTextInput, GenerateTextResult } from "@/lib/ai/contracts";
import { AIAdapterError, type AIErrorCode } from "@/lib/ai/contracts";
import type { GenerationMetadata, SceneOutline } from "@/lib/domain/schemas";
import { parseModelJson } from "./parse-json";
import { assembleSceneOutlines, InvalidOutlineError, validateAndNormalizeOutline } from "./outline-schema";
import { buildOutlineUserPrompt, OUTLINE_PROMPT_VERSION, OUTLINE_SYSTEM_PROMPT } from "./prompts/outline.v1";
import { buildRepairUserPrompt, REPAIR_SYSTEM_PROMPT } from "./prompts/repair.v1";

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

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new AIAdapterError("AI_TIMEOUT", "模型请求超时或被取消", true));
    }, { once: true });
  });
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
  const userPrompt = buildOutlineUserPrompt(input.topic, input.sceneCount);

  async function callAI(call: Omit<GenerateTextInput, "requestId" | "signal" | "maxOutputTokens">): Promise<GenerateTextResult> {
    let lastError: AIAdapterError | undefined;
    for (let attempt = 0; attempt < 3 && upstreamCalls < maxCalls; attempt += 1) {
      upstreamCalls += 1;
      try {
        const result = await adapter.generateText({ ...call, requestId: input.requestId, signal: input.signal, maxOutputTokens: 2_000 });
        successfulResults.push(result);
        return result;
      } catch (error) {
        const mapped = error instanceof AIAdapterError ? error : new AIAdapterError("AI_UPSTREAM_ERROR", "模型调用失败", false, { cause: error });
        lastError = mapped;
        if (!mapped.retryable || attempt === 2 || upstreamCalls >= maxCalls) {
          throw new OutlineGenerationError(mapped.code, mapped.message, mapped.retryable, upstreamCalls, undefined, { cause: mapped });
        }
        await delay(100 * (2 ** attempt), input.signal);
      }
    }
    throw new OutlineGenerationError("GENERATION_BUDGET_EXHAUSTED", "本次模型调用已达到预算上限", true, upstreamCalls, undefined, { cause: lastError });
  }

  const first = await callAI({ stage: "outline", systemPrompt: OUTLINE_SYSTEM_PROMPT, userPrompt });
  let output;
  let repaired = false;
  try {
    output = validateAndNormalizeOutline(parseModelJson(first.text), input.sceneCount);
  } catch (error) {
    const invalid = error instanceof InvalidOutlineError ? error : new InvalidOutlineError([{ path: "", message: "无法验证模型输出" }], { cause: error });
    if (upstreamCalls >= maxCalls) throw new OutlineGenerationError("GENERATION_BUDGET_EXHAUSTED", "模型输出无效且已没有修复预算", true, upstreamCalls, invalid.issues);
    const repair = await callAI({ stage: "repair", systemPrompt: REPAIR_SYSTEM_PROMPT, userPrompt: buildRepairUserPrompt(userPrompt, first.text, invalid.issues) });
    repaired = true;
    try {
      output = validateAndNormalizeOutline(parseModelJson(repair.text), input.sceneCount);
    } catch (repairError) {
      const finalError = repairError instanceof InvalidOutlineError ? repairError : invalid;
      throw new OutlineGenerationError("INVALID_MODEL_OUTPUT", "模型输出修复后仍不符合课程大纲契约", false, upstreamCalls, finalError.issues, { cause: repairError });
    }
  }
  const successful = successfulResults.at(-1) ?? first;
  const now = Date.now();
  return {
    courseTitle: output.courseTitle,
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
