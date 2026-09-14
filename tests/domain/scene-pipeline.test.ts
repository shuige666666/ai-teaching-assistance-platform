import { describe, expect, it } from "vitest";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { AIAdapterError, type AIAdapter } from "@/lib/ai/contracts";
import { createFixtureCourse } from "@/lib/domain/fixture";
import { generateScene, SLIDE_MAX_OUTPUT_TOKENS } from "@/lib/generation/scene-pipeline";
import { assembleScene, InvalidSceneError, validateSceneOutput } from "@/lib/generation/scene-schema";

const validSlide = {
  type: "slide" as const,
  content: {
    background: { type: "solid" as const, color: "#ffffff" },
    elements: [
      { type: "text" as const, left: 60, top: 50, width: 880, height: 76, content: "<p style=\"font-size:32px;font-weight:bold\">可靠的场景边界</p>", textType: "title" as const },
      { type: "shape" as const, left: 60, top: 160, width: 360, height: 180, path: "M 0 0 L 1 0 L 1 1 L 0 1 Z", viewBox: [1, 1] as [number, number], fill: "#eaf1f8" },
      { type: "line" as const, left: 420, top: 250, width: 3, start: [0, 0] as [number, number], end: [100, 0] as [number, number], curve: [50, 40] as [number, number], points: ["", "arrow"] as ["", "arrow"] },
      { type: "code" as const, left: 540, top: 160, width: 400, height: 250, language: "typescript", lines: ["const safe = schema.parse(output);"], fileName: "boundary.ts" },
    ],
  },
  narration: "这一场解释模型输出如何经过契约后进入固定渲染器。",
  summary: "场景内容通过契约后再由程序装配领域实体。",
};

const validQuiz = {
  type: "quiz" as const,
  title: "场景生成理解检查",
  content: { questions: [{
    type: "single_choice" as const,
    prompt: "模型应该直接返回哪个答案字段？",
    options: [{ label: "correctOptionIndexes" }, { label: "correctOptionIds" }, { label: "任意 HTML" }],
    correctOptionIndexes: [0],
    explanation: "模型只返回索引，答案 ID 由装配器生成。",
  }] },
  narration: "请完成这道单选题。",
  summary: "检查模型 DTO 与领域实体的责任边界。",
};

describe("scene generation boundary", () => {
  it("slide DTO 不含 ID，规范化和装配器补齐 Slide、元素、代码行与 Action ID", () => {
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
    expect(scene.content.canvas.elements.every((element) => Boolean(element.id))).toBe(true);
    expect(scene.content.canvas.elements.find((element) => element.type === "line")).toMatchObject({ curve: [50, 40] });
    const code = scene.content.canvas.elements.find((element) => element.type === "code");
    expect(code?.type === "code" && code.lines.every((line) => Boolean(line.id))).toBe(true);
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
    expect(scene.content.questions[0].correctOptionIds).toEqual([scene.content.questions[0].options[0].id]);
    expect(scene.actions.at(-1)).toMatchObject({ type: "pause", reason: "learner" });
  });

  it("忽略模型元素 ID，并继续拒绝越界答案、重复选项和讲稿 HTML", () => {
    const course = createFixtureCourse("非法场景测试", 3);
    const output = validateSceneOutput({
      ...validSlide,
      content: { ...validSlide.content, elements: validSlide.content.elements.map((element) => ({ ...element, id: "model-id" })) },
    }, course.outlines[0]);
    expect(output.type === "slide" && output.content.elements.every((element) => element.id !== "model-id")).toBe(true);
    expect(() => validateSceneOutput({ ...validQuiz, content: { questions: [{ ...validQuiz.content.questions[0], options: [{ label: "重复" }, { label: "重复" }], correctOptionIndexes: [3] }] } }, course.outlines[2])).toThrowError(InvalidSceneError);
    expect(() => validateSceneOutput({ ...validSlide, narration: "请执行 <script>bad()</script>" }, course.outlines[0])).toThrowError(InvalidSceneError);
  });

  it("multiple_choice 将多个答案下标装配为正确选项 ID", () => {
    const course = createFixtureCourse("多选契约测试", 3);
    const outline = course.outlines[2];
    const output = validateSceneOutput({ ...validQuiz, content: { questions: [{ ...validQuiz.content.questions[0], type: "multiple_choice", correctOptionIndexes: [0, 1] }] } }, outline);
    const scene = assembleScene({ output, courseId: course.id, outline, metadata: { provider: "mock", model: "test", promptVersion: "test", requestId: "req", durationMs: 1, upstreamCalls: 1, repaired: false, generatedAt: 1 }, now: 1 });
    if (scene.type !== "quiz") throw new Error("quiz expected");
    expect(scene.content.questions[0].type).toBe("multiple_choice");
    expect(scene.content.questions[0].correctOptionIds).toEqual(scene.content.questions[0].options.slice(0, 2).map((option) => option.id));
  });

  it("净化 text 富文本并允许 code lines 保存只读 JSX", () => {
    const course = createFixtureCourse("React 场景契约测试", 3);
    const output = validateSceneOutput({
      ...validSlide,
      content: { ...validSlide.content, elements: [
        { ...validSlide.content.elements[0], content: "<p onclick=\"bad()\" style=\"font-size:32px;font-family:Microsoft YaHei;position:fixed\"><strong>安全标题</strong><script>bad()</script></p>" },
        { type: "code", left: 80, top: 170, width: 840, height: 260, language: "tsx", lines: ["export function App() { return <main><h1>Hello</h1></main>; }"] },
      ] },
    }, course.outlines[0]);

    if (output.type !== "slide") throw new Error("slide expected");
    const text = output.content.elements.find((element) => element.type === "text");
    const code = output.content.elements.find((element) => element.type === "code");
    expect(text?.type === "text" && text.content).toContain("<strong>安全标题</strong>");
    expect(text?.type === "text" && text.content).toContain("font-family:Microsoft YaHei");
    expect(text?.type === "text" && text.content).not.toContain("onclick");
    expect(text?.type === "text" && text.content).not.toContain("position");
    expect(code).toMatchObject({ type: "code", language: "tsx" });
    expect(code?.type === "code" && code.lines[0].content).toContain("<main>");
  });

  it("只丢弃损坏或未支持元素，全部无效时才让场景失败", () => {
    const course = createFixtureCourse("元素降级测试", 3);
    const output = validateSceneOutput({
      ...validSlide,
      content: { ...validSlide.content, elements: [
        validSlide.content.elements[0],
        { type: "image", left: 0, top: 0, width: 100, height: 100, src: "bad" },
        { type: "shape", left: 2_000, top: 0, width: 100, height: 100, path: "M 0 0", viewBox: [1, 1] },
      ] },
    }, course.outlines[0]);
    expect(output.type === "slide" && output.content.elements).toHaveLength(1);
    expect(() => validateSceneOutput({
      ...validSlide,
      content: { elements: [{ type: "image", left: 0, top: 0, width: 100, height: 100 }] },
    }, course.outlines[0])).toThrowError(InvalidSceneError);
  });

  it("slide 使用独立的较大输出预算", async () => {
    const course = createFixtureCourse("场景预算测试", 3);
    let capturedBudget = 0;
    const adapter: AIAdapter = {
      async generateText(input) {
        capturedBudget = input.maxOutputTokens;
        return { text: JSON.stringify(validSlide), provider: "mock", model: "budget-test" };
      },
    };
    await generateScene(adapter, {
      course, outline: course.outlines[0], requestId: "slide-budget", signal: new AbortController().signal,
    });
    expect(capturedBudget).toBe(SLIDE_MAX_OUTPUT_TOKENS);
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
