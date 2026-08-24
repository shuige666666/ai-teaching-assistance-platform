import { describe, expect, it } from "vitest";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { generateOutline } from "@/lib/generation/outline-pipeline";
import { parseModelJson } from "@/lib/generation/parse-json";

function validOutline(topic = "测试主题") {
  return JSON.stringify({
    courseTitle: `${topic}课程`,
    outlines: [
      { type: "slide", title: "概念入口", teachingObjective: "建立问题背景", keyPoints: ["问题", "背景"], order: 1, estimatedMinutes: 4 },
      { type: "slide", title: "机制拆解", teachingObjective: "理解运行机制", keyPoints: ["结构", "过程"], order: 2, estimatedMinutes: 5 },
      { type: "quiz", title: "理解检查", teachingObjective: "辨析概念误区", keyPoints: ["判断", "反馈"], order: 3, estimatedMinutes: 3 },
    ],
  });
}

describe("outline generation pipeline", () => {
  it("可从代码围栏提取唯一 JSON 对象", () => {
    expect(parseModelJson(`说明\n\`\`\`json\n${validOutline()}\n\`\`\``)).toMatchObject({ courseTitle: "测试主题课程" });
  });

  it("mock 也经过正式校验、装配 ID 与元数据", async () => {
    const result = await generateOutline(new MockAIAdapter([validOutline()]), { topic: "测试主题", sceneCount: 3, requestId: "request-1", signal: new AbortController().signal });
    expect(result.outlines).toHaveLength(3);
    expect(new Set(result.outlines.map((item) => item.id)).size).toBe(3);
    expect(result.metadata).toMatchObject({ provider: "mock", upstreamCalls: 1, repaired: false, requestId: "request-1" });
  });

  it("首次语义失败只进行一次修复", async () => {
    const invalid = JSON.stringify({ courseTitle: "失败课程", outlines: [] });
    const result = await generateOutline(new MockAIAdapter([invalid, validOutline("修复后")]), { topic: "测试主题", sceneCount: 3, requestId: "request-2", signal: new AbortController().signal });
    expect(result.metadata).toMatchObject({ upstreamCalls: 2, repaired: true });
    expect(result.courseTitle).toBe("修复后课程");
  });

  it("修复后仍失败时停止，不静默写入", async () => {
    const invalid = JSON.stringify({ courseTitle: "失败课程", outlines: [] });
    await expect(generateOutline(new MockAIAdapter([invalid, invalid]), { topic: "测试主题", sceneCount: 3, requestId: "request-3", signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "INVALID_MODEL_OUTPUT", upstreamCalls: 2 });
  });
});
