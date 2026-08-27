import { describe, expect, it } from "vitest";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { AIAdapterError, type AIAdapter } from "@/lib/ai/contracts";
import { createFixtureCourse } from "@/lib/domain/fixture";
import { generateScene } from "@/lib/generation/scene-pipeline";
import { assembleScene, InvalidSceneError, validateSceneOutput } from "@/lib/generation/scene-schema";

const validSlide = {
  type: "slide" as const,
  title: "可靠的场景边界",
  content: { blocks: [
    { type: "paragraph" as const, text: "模型只负责可见教学内容，程序负责实体标识与状态。" },
    { type: "code" as const, language: "typescript", code: "const safe = schema.parse(output);", caption: "结构化边界" },
  ] },
  narration: "这一场解释模型输出如何经过契约后进入固定渲染器。",
  summary: "场景内容通过契约后再由程序装配领域实体。",
};

const validQuiz = {
  type: "quiz" as const,
  title: "场景生成理解检查",
  content: { questions: [{
    type: "single_choice" as const,
    prompt: "模型应该直接返回哪个答案字段？",
    options: [{ label: "correctOptionIndex" }, { label: "correctOptionId" }, { label: "任意 HTML" }],
    correctOptionIndex: 0,
    explanation: "模型只返回索引，答案 ID 由装配器生成。",
  }] },
  narration: "请完成这道单选题。",
  summary: "检查模型 DTO 与领域实体的责任边界。",
};

describe("scene generation boundary", () => {
  it("slide DTO 不含 ID，装配器补齐 Scene、Block 和 Action ID", () => {
    const course = createFixtureCourse("场景契约测试", 3);
    const outline = course.outlines[0];
    const output = validateSceneOutput(validSlide, outline);
    const scene = assembleScene({
      output,
      courseId: course.id,
      outline,
      metadata: { provider: "mock", model: "test", promptVersion: "test", requestId: "req", durationMs: 1, upstreamCalls: 1, repaired: false, generatedAt: 1 },
      now: 1,
    });
    expect(scene).toMatchObject({ type: "slide", courseId: course.id, outlineId: outline.id, order: 1 });
    if (scene.type !== "slide") throw new Error("slide expected");
    expect(scene.content.blocks.every((block) => Boolean(block.id))).toBe(true);
    expect(scene.actions).toHaveLength(1);
  });

  it("quiz 用正确答案索引装配服务端 option id 和 learner pause", () => {
    const course = createFixtureCourse("测验契约测试", 3);
    const outline = course.outlines[2];
    const output = validateSceneOutput(validQuiz, outline);
    const scene = assembleScene({
      output,
      courseId: course.id,
      outline,
      metadata: { provider: "mock", model: "test", promptVersion: "test", requestId: "req", durationMs: 1, upstreamCalls: 1, repaired: false, generatedAt: 1 },
      now: 1,
    });
    if (scene.type !== "quiz") throw new Error("quiz expected");
    expect(scene.content.questions[0].correctOptionId).toBe(scene.content.questions[0].options[0].id);
    expect(scene.actions.at(-1)).toMatchObject({ type: "pause", reason: "learner" });
  });

  it("拒绝模型注入 ID、越界答案、重复选项和 HTML", () => {
    const course = createFixtureCourse("非法场景测试", 3);
    expect(() => validateSceneOutput({ ...validSlide, id: "model-id" }, course.outlines[0])).toThrowError(InvalidSceneError);
    expect(() => validateSceneOutput({ ...validQuiz, content: { questions: [{ ...validQuiz.content.questions[0], options: [{ label: "重复" }, { label: "重复" }], correctOptionIndex: 3 }] } }, course.outlines[2])).toThrowError(InvalidSceneError);
    expect(() => validateSceneOutput({ ...validSlide, narration: "请执行 <script>bad()</script>" }, course.outlines[0])).toThrowError(InvalidSceneError);
  });

  it("允许 code 字段包含只读 JSX，同时继续拒绝普通文本中的标签和链接", () => {
    const course = createFixtureCourse("React 场景契约测试", 3);
    const output = validateSceneOutput({
      ...validSlide,
      content: { blocks: [{
        type: "code",
        language: "tsx",
        code: "export function App() { return <main><h1>Hello</h1></main>; }",
        caption: "只读 JSX 示例",
      }] },
    }, course.outlines[0]);

    if (output.type !== "slide") throw new Error("slide expected");
    expect(output.content.blocks[0]).toMatchObject({ type: "code", language: "tsx" });
    expect(() => validateSceneOutput({ ...validSlide, summary: "访问 https://example.com" }, course.outlines[0])).toThrowError(InvalidSceneError);
  });

  it("mock 场景也经过解析、校验、装配和一次修复", async () => {
    const course = createFixtureCourse("场景修复测试", 3);
    const scene = await generateScene(new MockAIAdapter(["{}", JSON.stringify(validSlide)]), {
      course,
      outline: course.outlines[0],
      requestId: "scene-repair-request",
      signal: new AbortController().signal,
    });
    expect(scene.generation).toMatchObject({ repaired: true, upstreamCalls: 2, requestId: "scene-repair-request" });
  });

  it("场景首次返回空 content 时在预算内恢复", async () => {
    const course = createFixtureCourse("场景远端恢复测试", 3);
    let calls = 0;
    const adapter: AIAdapter = {
      async generateText() {
        calls += 1;
        if (calls === 1) {
          throw new AIAdapterError("AI_UPSTREAM_ERROR", "模型服务本次没有返回可用内容", true, {
            diagnostics: { providerStatus: 200, responseKind: "empty_content", responseBytes: 80 },
          });
        }
        return { text: JSON.stringify(validSlide), provider: "deepseek", model: "test" };
      },
    };

    const scene = await generateScene(adapter, {
      course,
      outline: course.outlines[0],
      requestId: "scene-upstream-retry",
      signal: new AbortController().signal,
    });

    expect(scene.generation).toMatchObject({ provider: "deepseek", upstreamCalls: 2, repaired: false });
  });
});
