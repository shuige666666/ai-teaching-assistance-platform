import type { AIAdapter, GenerateTextInput, GenerateTextResult } from "@/lib/ai/contracts";
import { AIAdapterError, type AIErrorCode } from "@/lib/ai/contracts";
import type { Course, GenerationMetadata, Scene, SceneOutline } from "@/lib/domain/schemas";
import { parseModelJson } from "./parse-json";
import { assembleScene, InvalidSceneError, validateSceneOutput } from "./scene-schema";
import { buildQuizUserPrompt, QUIZ_PROMPT_VERSION, QUIZ_SYSTEM_PROMPT } from "./prompts/scene-quiz.v1";
import { buildSceneRepairPrompt, SCENE_REPAIR_SYSTEM_PROMPT } from "./prompts/scene-repair.v1";
import { buildSlideUserPrompt, SLIDE_PROMPT_VERSION, SLIDE_SYSTEM_PROMPT } from "./prompts/scene-slide.v1";

export class SceneGenerationError extends Error {
  constructor(
    public readonly code: "INVALID_MODEL_OUTPUT" | "GENERATION_BUDGET_EXHAUSTED" | AIErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly upstreamCalls: number,
    public readonly issues?: Array<{ path: string; message: string }>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SceneGenerationError";
  }
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

function mergeUsage(results: GenerateTextResult[]) {
  const inputTokens = results.reduce((sum, result) => sum + (result.usage?.inputTokens ?? 0), 0);
  const outputTokens = results.reduce((sum, result) => sum + (result.usage?.outputTokens ?? 0), 0);
  return results.some((result) => result.usage) ? { inputTokens, outputTokens } : undefined;
}

function previousSceneSummary(course: Course, outline: SceneOutline): string | undefined {
  return course.scenes.filter((scene) => scene.order < outline.order).sort((a, b) => b.order - a.order)[0]?.summary;
}

/** 生成单个场景；课程计划与前页摘要只从当前 MySQL Course 聚合构造。 */
export async function generateScene(
  adapter: AIAdapter,
  input: { course: Course; outline: SceneOutline; requestId: string; signal: AbortSignal },
): Promise<Scene> {
  const startedAt = Date.now();
  const successfulResults: GenerateTextResult[] = [];
  let upstreamCalls = 0;
  const maxCalls = 4;
  const previousSummary = previousSceneSummary(input.course, input.outline);
  const isSlide = input.outline.type === "slide";
  const promptVersion = isSlide ? SLIDE_PROMPT_VERSION : QUIZ_PROMPT_VERSION;
  const systemPrompt = isSlide ? SLIDE_SYSTEM_PROMPT : QUIZ_SYSTEM_PROMPT;
  const userPrompt = isSlide
    ? buildSlideUserPrompt(input.course, input.outline, previousSummary)
    : buildQuizUserPrompt(input.course, input.outline, previousSummary);

  async function callAI(call: Omit<GenerateTextInput, "requestId" | "signal" | "maxOutputTokens">): Promise<GenerateTextResult> {
    let lastError: AIAdapterError | undefined;
    for (let attempt = 0; attempt < 3 && upstreamCalls < maxCalls; attempt += 1) {
      upstreamCalls += 1;
      try {
        const result = await adapter.generateText({ ...call, requestId: input.requestId, signal: input.signal, maxOutputTokens: 3_500 });
        successfulResults.push(result);
        return result;
      } catch (error) {
        const mapped = error instanceof AIAdapterError ? error : new AIAdapterError("AI_UPSTREAM_ERROR", "模型调用失败", false, { cause: error });
        lastError = mapped;
        if (!mapped.retryable || attempt === 2 || upstreamCalls >= maxCalls) {
          throw new SceneGenerationError(mapped.code, mapped.message, mapped.retryable, upstreamCalls, undefined, { cause: mapped });
        }
        await delay(100 * (2 ** attempt), input.signal);
      }
    }
    throw new SceneGenerationError("GENERATION_BUDGET_EXHAUSTED", "本次场景调用已达到预算上限", true, upstreamCalls, undefined, { cause: lastError });
  }

  const first = await callAI({ stage: "scene", systemPrompt, userPrompt });
  let output;
  let repaired = false;
  try {
    output = validateSceneOutput(parseModelJson(first.text), input.outline);
  } catch (error) {
    const invalid = error instanceof InvalidSceneError ? error : new InvalidSceneError([{ path: "", message: "无法验证场景输出" }], { cause: error });
    if (upstreamCalls >= maxCalls) throw new SceneGenerationError("GENERATION_BUDGET_EXHAUSTED", "场景输出无效且已没有修复预算", true, upstreamCalls, invalid.issues);
    const repair = await callAI({ stage: "repair", systemPrompt: SCENE_REPAIR_SYSTEM_PROMPT, userPrompt: buildSceneRepairPrompt(userPrompt, first.text, invalid.issues) });
    repaired = true;
    try {
      output = validateSceneOutput(parseModelJson(repair.text), input.outline);
    } catch (repairError) {
      const finalError = repairError instanceof InvalidSceneError ? repairError : invalid;
      // 本次修复预算已经耗尽，但下一次请求会重新采样，仍允许用户显式重试。
      throw new SceneGenerationError("INVALID_MODEL_OUTPUT", "模型输出修复后仍不符合场景契约", true, upstreamCalls, finalError.issues, { cause: repairError });
    }
  }

  const successful = successfulResults.at(-1) ?? first;
  const now = Date.now();
  const metadata: GenerationMetadata = {
    provider: successful.provider,
    model: successful.model,
    promptVersion,
    requestId: input.requestId,
    durationMs: now - startedAt,
    upstreamCalls,
    repaired,
    usage: mergeUsage(successfulResults),
    generatedAt: now,
  };
  return assembleScene({ output, courseId: input.course.id, outline: input.outline, metadata, now });
}
