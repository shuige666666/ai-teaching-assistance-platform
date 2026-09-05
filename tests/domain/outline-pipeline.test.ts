import { afterEach, describe, expect, it, vi } from "vitest";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { AIAdapterError, type AIAdapter } from "@/lib/ai/contracts";
import { generateOutline, OUTLINE_MAX_OUTPUT_TOKENS } from "@/lib/generation/outline-pipeline";
import { parseModelJson } from "@/lib/generation/parse-json";
import { createProvisionalCourseBrief } from "@/lib/domain/course-brief";

function validOutline(topic = "测试主题", detectedBrief: Record<string, unknown> = {}) {
  return JSON.stringify({
    courseTitle: `${topic}课程`,
    detectedBrief,
    warnings: [],
    outlines: [
      { type: "slide", role: "hook", title: "概念入口", teachingObjective: "建立问题背景", keyPoints: ["问题", "背景"], order: 1, estimatedMinutes: 4 },
      { type: "slide", role: "mechanism", title: "机制拆解", teachingObjective: "理解运行机制", keyPoints: ["结构", "过程"], order: 2, estimatedMinutes: 5 },
      { type: "slide", role: "worked_example", title: "案例连接", teachingObjective: "将机制应用到案例", keyPoints: ["案例", "边界"], order: 3, estimatedMinutes: 4 },
      { type: "quiz", role: "assessment", title: "理解检查", teachingObjective: "辨析概念误区", keyPoints: ["判断", "反馈"], assessmentFocus: "检查核心概念辨析", order: 4, estimatedMinutes: 3 },
    ],
  });
}

function outlineInput(requestId: string, overrides: Parameters<typeof createProvisionalCourseBrief>[1] = {}) {
  const provisional = createProvisionalCourseBrief("测试主题", overrides);
  return { topic: "测试主题", sceneCount: 4, provisionalBrief: provisional.brief, provisionalResolution: provisional.resolution, requestId, signal: new AbortController().signal };
}

afterEach(() => vi.restoreAllMocks());

describe("outline generation pipeline", () => {
  it("接受互动设计 description 别名但保存统一的 designIdea", async () => {
    const value = JSON.parse(validOutline());
    value.outlines[2] = { ...value.outlines[2], type: "interactive", widgetType: "game", widgetOutline: { description: "调度工具救回数据", ignored: true } };
    const result = await generateOutline(new MockAIAdapter([JSON.stringify(value)]), outlineInput("widget-alias", { interactionMode: "required" }));
    expect(result.outlines[2].widgetOutline).toEqual({ designIdea: "调度工具救回数据" });
    expect(result.metadata.upstreamCalls).toBe(1);
  });

  it.each([4, 5, 6, 7, 8])("%i 场景按用户选择生成分档互动数量，关闭时不生成", async (sceneCount) => {
    const maxInteractive = sceneCount === 4 ? 1 : sceneCount <= 6 ? 2 : 3;
    for (const interactionMode of ["off", "required"] as const) {
      const result = await generateOutline(new MockAIAdapter(), { ...outlineInput(`count-${sceneCount}-${interactionMode}`, { interactionMode }), sceneCount });
      const interactiveCount = result.outlines.filter((item) => item.type === "interactive").length;
      expect(result.outlines).toHaveLength(sceneCount);
      expect(result.brief.interactionMode).toBe(interactionMode);
      expect(interactiveCount).toBeGreaterThanOrEqual(interactionMode === "required" ? 1 : 0);
      expect(interactiveCount).toBeLessThanOrEqual(interactionMode === "required" ? maxInteractive : 0);
      expect(result.outlines[0].type).toBe("slide");
      expect(result.outlines.filter((item) => item.type === "slide").length).toBeGreaterThanOrEqual(2);
      expect(result.outlines.some((item, index) => item.type === "interactive" && result.outlines[index - 1]?.type === "interactive")).toBe(false);
    }
  });

  it("可从代码围栏提取唯一 JSON 对象", () => {
    expect(parseModelJson(`说明\n\`\`\`json\n${validOutline()}\n\`\`\``)).toMatchObject({ courseTitle: "测试主题课程" });
  });

  it("mock 也经过正式校验、装配 ID 与元数据", async () => {
    const result = await generateOutline(new MockAIAdapter([validOutline()]), outlineInput("request-1"));
    expect(result.outlines).toHaveLength(4);
    expect(new Set(result.outlines.map((item) => item.id)).size).toBe(4);
    expect(result.metadata).toMatchObject({ provider: "mock", upstreamCalls: 1, repaired: false, requestId: "request-1" });
  });

  it("一次生成时确定性清理冗余字段、缺省数组和 optional null", async () => {
    const value = JSON.parse(validOutline("JSON Prompt 工程"));
    delete value.detectedBrief;
    delete value.warnings;
    value.resolvedBrief = { shouldBeIgnored: true };
    value.explanation = "不进入领域对象";
    value.outlines[0].misconceptions = null;
    value.outlines[0].assessmentFocus = null;
    value.outlines[0].estimatedMinutes = null;
    value.outlines[0].rationale = "不进入领域对象";

    const result = await generateOutline(new MockAIAdapter([JSON.stringify(value)]), outlineInput("deterministic-normalization"));

    expect(result.metadata).toMatchObject({ upstreamCalls: 1, repaired: false });
    expect(result.courseTitle).toBe("JSON Prompt 工程课程");
    expect(result.outlines[0]).not.toHaveProperty("rationale");
    expect(result.outlines[0].misconceptions).toBeUndefined();
    expect(result.outlines[0].estimatedMinutes).toBeUndefined();
  });

  it("outline.v2 使用能够容纳 Brief 与完整场景计划的输出预算", async () => {
    let receivedMaxOutputTokens = 0;
    const adapter: AIAdapter = {
      async generateText(input) {
        receivedMaxOutputTokens = input.maxOutputTokens;
        return { text: validOutline(), provider: "deepseek", model: "test" };
      },
    };

    await generateOutline(adapter, outlineInput("token-budget"));

    expect(receivedMaxOutputTokens).toBe(OUTLINE_MAX_OUTPUT_TOKENS);
    expect(OUTLINE_MAX_OUTPUT_TOKENS).toBe(8_000);
  });

  it("首次语义失败只进行一次修复", async () => {
    const invalid = JSON.stringify({ courseTitle: "失败课程", outlines: [] });
    const result = await generateOutline(new MockAIAdapter([invalid, validOutline("修复后")]), outlineInput("request-2"));
    expect(result.metadata).toMatchObject({ upstreamCalls: 2, repaired: true });
    expect(result.courseTitle).toBe("修复后课程");
  });

  it("服务端独占合并检测字段与显式设置，不要求模型回传 resolvedBrief", async () => {
    const input = outlineInput("brief-resolution", { audience: "显式受众" });
    const result = await generateOutline(
      new MockAIAdapter([validOutline("一次生成", { audience: "描述受众", learnerLevel: "intermediate" })]),
      input,
    );
    expect(result.metadata).toMatchObject({ upstreamCalls: 1, repaired: false, promptVersion: "outline.v2.4" });
    expect(result.brief.audience).toBe("显式受众");
    expect(result.brief.learnerLevel).toBe("intermediate");
    expect(result.briefResolution.sources.audience).toBe("explicit_setting");
    expect(result.briefResolution.sources.learnerLevel).toBe("prompt");
    expect(result.briefResolution.warnings[0]?.code).toBe("SETTING_PROMPT_CONFLICT");
  });

  it("修复后仍失败时停止，不静默写入", async () => {
    const invalid = JSON.stringify({ courseTitle: "失败课程", outlines: [] });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(generateOutline(new MockAIAdapter([invalid, invalid]), outlineInput("request-3")))
      .rejects.toMatchObject({ code: "INVALID_MODEL_OUTPUT", retryable: true, upstreamCalls: 2, validationKind: "schema" });
    const events = [...info.mock.calls, ...error.mock.calls].map(([line]) => JSON.parse(String(line)).event);
    expect(events).toContain("outline.validation.failed");
    expect(events).toContain("outline.repair.failed");
  });

  it("首次远端响应异常时在预算内自动恢复", async () => {
    let calls = 0;
    const adapter: AIAdapter = {
      async generateText() {
        calls += 1;
        if (calls === 1) {
          throw new AIAdapterError("AI_UPSTREAM_ERROR", "模型服务返回了空响应", true, {
            diagnostics: { providerStatus: 200, responseKind: "empty_body", responseBytes: 0 },
          });
        }
        return { text: validOutline("自动恢复"), provider: "deepseek", model: "test" };
      },
    };

    const result = await generateOutline(adapter, outlineInput("retry-request"));

    expect(result.courseTitle).toBe("自动恢复课程");
    expect(result.metadata.upstreamCalls).toBe(2);
  });

  it("认证错误不发起第二次调用", async () => {
    let calls = 0;
    const adapter: AIAdapter = {
      async generateText() {
        calls += 1;
        throw new AIAdapterError("AI_AUTH_FAILED", "认证失败", false, {
          diagnostics: { providerStatus: 401, responseKind: "http_error" },
        });
      },
    };

    await expect(generateOutline(adapter, outlineInput("auth-request"))).rejects.toMatchObject({ code: "AI_AUTH_FAILED", retryable: false, upstreamCalls: 1 });
    expect(calls).toBe(1);
  });

  it("响应重试与 repair 共享四次上游调用硬上限", async () => {
    let calls = 0;
    const adapter: AIAdapter = {
      async generateText() {
        calls += 1;
        if (calls <= 2) {
          throw new AIAdapterError("AI_UPSTREAM_ERROR", "偶发远端响应异常", true, {
            diagnostics: { providerStatus: 200, responseKind: "invalid_envelope", responseBytes: 32 },
          });
        }
        if (calls === 3) return { text: JSON.stringify({ courseTitle: "待修复", outlines: [] }), provider: "deepseek", model: "test" };
        return { text: validOutline("预算内修复"), provider: "deepseek", model: "test" };
      },
    };

    const result = await generateOutline(adapter, outlineInput("budget-request"));

    expect(calls).toBe(4);
    expect(result.metadata).toMatchObject({ upstreamCalls: 4, repaired: true });
  });
});
