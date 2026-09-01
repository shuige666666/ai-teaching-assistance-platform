import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InteractiveRenderer } from "@/components/interactive/interactive-renderer";
import type { InteractiveContent, SceneOutline } from "@/lib/domain/schemas";
import { InvalidInteractiveHtmlError, postProcessInteractiveHtml } from "@/lib/interactive/html-policy";
import { HostToWidgetMessageSchema, WidgetToHostMessageSchema } from "@/lib/interactive/runtime-contract";
import { assembleScene, parseSceneResponse, validateSceneOutput } from "@/lib/generation/scene-schema";
import { createCourseDraft } from "@/lib/domain/fixture";
import { buildInteractivePrompt } from "@/lib/generation/prompts/scene-interactive.v2";
import { WidgetTypeSchema } from "@/lib/interactive/widget-types";
import { createMockWidget } from "@/lib/interactive/mock-widgets";
import { getInteractiveImplementationExamples, getInteractiveLayoutTemplate } from "@/lib/interactive/layout-templates";

const rawHtml = `<!doctype html><html><head><meta charset="utf-8"><style>button{color:#222}</style></head><body><button id="done">完成</button><script>addEventListener('DOMContentLoaded',()=>parent.postMessage({type:'INTERACTIVE_READY',version:1},'*'));document.getElementById('done').addEventListener('click',()=>parent.postMessage({type:'INTERACTIVE_COMPLETED',version:1},'*'));addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='INTERACTIVE_RESET')document.body.dataset.reset='yes'})</script></body></html>`;

const fallback = { title: "机制关系图", description: "通过操作节点理解因果关系。", steps: ["先观察输入节点", "再追踪状态变化"] };

describe("M9 interactive boundary", () => {
  it("原始 HTML 不需要整页 JSON 转义，缺少讲解元数据时使用大纲", () => {
    const outline: SceneOutline = { id: "raw-html", type: "interactive", widgetType: "simulation", role: "practice", title: "状态实验", teachingObjective: "观察状态变化", keyPoints: ["改变参数", "比较结果"], order: 3 };
    const parsed = parseSceneResponse(rawHtml, outline);
    expect(validateSceneOutput(parsed, outline)).toMatchObject({ narration: outline.teachingObjective, content: { widgetType: "simulation", fallback: { steps: outline.keyPoints } } });
    const withMeta = rawHtml.replace("<head>", '<head><script type="application/json" id="scene-meta">{"narration":"实验讲解","summary":"实验摘要"}</script>');
    expect(parseSceneResponse(withMeta, outline)).toMatchObject({ narration: "实验讲解", summary: "实验摘要" });
    expect(() => parseSceneResponse(rawHtml.replace("<head>", '<head><script id="scene-meta">{bad}</script>'), outline)).toThrow();
  });

  it("注入 CSP 与错误转发脚本，保留原始互动协议", () => {
    const html = postProcessInteractiveHtml(rawHtml.replace("<body>", '<body><svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("connect-src https: http:");
    expect(html).toContain("frame-src 'none'");
    expect(html).toContain("data-interactive-runtime=\"4\"");
    expect(html).toContain("INTERACTIVE_COMPLETED");
  });

  it.each([
    ["external script", rawHtml.replace("<script>", '<script src="https://example.com/a.js"></script><script>')],
    ["nested iframe", rawHtml.replace("<body>", "<body><iframe></iframe>")],
    ["network call", rawHtml.replace("<script>", "<script>fetch('/leak');")],
    ["host access", rawHtml.replace("<script>", "<script>parent.document.body.innerHTML='x';")],
    ["dynamic execution", rawHtml.replace("<script>", "<script>new Function('return 1')();")],
  ])("不再用源码正则限制能力，运行时仍注入隔离策略：%s", (_name, html) => {
    expect(postProcessInteractiveHtml(html)).toContain("form-action 'none'");
  });

  it("拒绝残缺文档与超出实际 UTF-8 字节预算的 HTML", () => {
    expect(() => postProcessInteractiveHtml("<div>残片</div>")).toThrow(InvalidInteractiveHtmlError);
    expect(() => postProcessInteractiveHtml(rawHtml.replace("<body>", `<body>${"中".repeat(100_000)}`))).toThrow(InvalidInteractiveHtmlError);
  });

  it.each(WidgetTypeSchema.options)("按 %s 分流并保留设计意图，不混用其他类型", (widgetType) => {
    const course = createCourseDraft("Agent 开发", 4, { interactionMode: "required" });
    const outline: SceneOutline = { id: "interactive-1", type: "interactive", widgetType, widgetOutline: { designIdea: "选择工具改变结果并获得反馈", language: "python" }, role: "practice", title: "操作实验", teachingObjective: "理解运行过程", keyPoints: ["观察", "验证"], order: 3 };
    const prompt = buildInteractivePrompt(course, outline);
    expect(prompt.version).toBe(`scene-${widgetType}.v2.3`);
    expect(prompt.user).toContain(outline.widgetOutline!.designIdea);
    expect(prompt.system).toContain(`本次 widgetType 必须为 ${widgetType}`);
    expect(prompt.system).toContain("min-height:0");
    expect(prompt.system).toContain("16:9 单屏可见");
    expect(prompt.system).toContain("禁止用 body/html 的“min-height:100vh”");
    expect(prompt.system).toContain("InteractiveRuntime.onReset");
    const dto = { type: "interactive", content: { type: "interactive", widgetType, runtimeContractVersion: 1, html: widgetType === "diagram" ? rawHtml : createMockWidget(widgetType, "操作实验"), fallback }, narration: "观察操作反馈", summary: "理解运行过程" };
    expect(validateSceneOutput(dto, outline).type).toBe("interactive");
    expect(() => validateSceneOutput({ ...dto, content: { ...dto.content, widgetType: widgetType === "game" ? "code" : "game" } }, outline)).toThrow();
  });

  it("只接受声明过的消息和诊断字段，额外字段仍被拒绝", () => {
    expect(WidgetToHostMessageSchema.parse({ type: "INTERACTIVE_READY", version: 1 })).toEqual({ type: "INTERACTIVE_READY", version: 1 });
    expect(HostToWidgetMessageSchema.safeParse({ type: "INTERACTIVE_RESET", version: 1, target: "parent" }).success).toBe(false);
    expect(WidgetToHostMessageSchema.safeParse({ type: "INTERACTIVE_COMPLETED", version: 2 }).success).toBe(false);
  });

  it("装配互动场景时使用服务端标题并追加 learner pause", () => {
    const outline: SceneOutline = { id: "outline-interactive", type: "interactive", widgetType: "diagram", role: "mechanism", title: "事务状态迁移", teachingObjective: "理解提交与回滚", keyPoints: ["提交", "回滚"], order: 2 };
    const output = validateSceneOutput({ type: "interactive", content: { type: "interactive", widgetType: "diagram", runtimeContractVersion: 1, html: rawHtml, fallback }, narration: "请操作节点。", summary: "说明了事务的状态转换。" }, outline);
    const scene = assembleScene({ output, courseId: "course-1", outline, metadata: { provider: "mock", model: "test", promptVersion: "scene-diagram.v1", requestId: "request-1", durationMs: 1, upstreamCalls: 1, repaired: false, generatedAt: 1 }, now: 1 });
    expect(scene.type).toBe("interactive");
    expect(scene.actions.at(-1)).toMatchObject({ type: "pause", reason: "learner" });
    if (scene.type !== "interactive") throw new Error("interactive scene expected");
    expect(scene.content.html).toContain("Content-Security-Policy");
  });

  it("首屏先显示 React fallback，iframe 只开放 allow-scripts", () => {
    const content: InteractiveContent = { type: "interactive", widgetType: "diagram", runtimeContractVersion: 1, html: postProcessInteractiveHtml(rawHtml), fallback };
    const html = renderToStaticMarkup(<InteractiveRenderer content={content} />);
    expect(html).toContain("LOADING INTERACTIVE");
    expect(html).toContain("data-testid=\"interactive-viewport\"");
    expect(html).toContain("sandbox=\"allow-scripts\"");
    expect(html).not.toContain("allow-same-origin");
  });

  it("为四类互动提供可改写的布局骨架和对应实现示例", () => {
    expect(getInteractiveLayoutTemplate("diagram")).toContain("widget-main--split");
    expect(getInteractiveLayoutTemplate("simulation")).toContain("widget-main--bottom");
    expect(getInteractiveLayoutTemplate("game")).toContain("widget-main--bottom");
    expect(getInteractiveLayoutTemplate("code")).toContain("widget-main--editor");
    expect(getInteractiveImplementationExamples("diagram")).toContain("fitSvgToContent");
    expect(getInteractiveImplementationExamples("simulation")).toContain("ResizeObserver");
    expect(getInteractiveImplementationExamples("code")).toContain("InteractiveRuntime.onReset");
  });
});
