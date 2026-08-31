import type { AIAdapter, GenerateTextInput, GenerateTextResult } from "./contracts";
import { createMockWidget, escapeWidgetText } from "@/lib/interactive/mock-widgets";
import type { CourseBrief, SceneOutline } from "@/lib/domain/schemas";

type MockOutline = {
  courseTitle: string;
  detectedBrief: Record<string, never>;
  warnings: [];
  outlines: Array<Omit<SceneOutline, "id">>;
};
type MockScene = {
  type: "slide" | "quiz" | "interactive";
  title?: string;
  content: unknown;
  narration: string;
  summary: string;
};

function readPromptValue(prompt: string, label: string): string | undefined {
  return prompt.split("\n").find((line) => line.startsWith(`${label}：`))?.slice(label.length + 1).trim();
}

function readPromptJson<T>(prompt: string, label: string): T | undefined {
  const value = readPromptValue(prompt, label);
  if (value === undefined) return undefined;
  try { return JSON.parse(value) as T; } catch { return undefined; }
}

function createMockScene(prompt: string): MockScene {
  const topic = readPromptJson<string>(prompt, "课程描述 JSON") ?? readPromptValue(prompt, "教学主题") ?? "示例主题";
  const outline = readPromptJson<Pick<SceneOutline, "type" | "title" | "keyPoints" | "widgetType">>(prompt, "当前 SceneOutline JSON");
  const title = outline?.title ?? readPromptValue(prompt, "场景标题") ?? "示例场景";
  const type = outline?.type ?? (readPromptValue(prompt, "场景类型") === "quiz" ? "quiz" : "slide");
  const keyPoints = outline?.keyPoints ?? (readPromptValue(prompt, "关键点") ?? "核心概念；实际应用").split("；").filter(Boolean);
  if (type === "interactive" && outline?.widgetType && outline.widgetType !== "diagram") {
    return { type, content: { type, widgetType: outline.widgetType, runtimeContractVersion: 1, html: createMockWidget(outline.widgetType, title), fallback: { title, description: "通过操作、观察反馈和重试理解当前知识。", steps: keyPoints } }, narration: "请阅读任务说明，操作控件观察结果，完成后可重置重试。", summary: `${title}通过操作与反馈帮助理解知识。` };
  }
  if (type === "interactive") {
    const first = keyPoints[0] ?? "问题输入";
    const second = keyPoints[1] ?? "关键机制";
    const third = keyPoints[2] ?? "结果反馈";
    return {
      type,
      content: {
        type: "interactive",
        widgetType: "diagram",
        runtimeContractVersion: 1,
        html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f4f0e7;color:#242621;font-family:"Microsoft YaHei",sans-serif}.shell{min-height:100vh;padding:28px 34px}.eyebrow{font:12px monospace;letter-spacing:.18em;color:#a33b25}.nodes{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:36px 0 22px}.node{border:1px solid #8d887e;background:#fff;padding:26px 14px;font-size:18px;cursor:pointer;transition:.2s}.node:hover,.node.active{background:#dce8d9;border-color:#335d45;transform:translateY(-3px)}.detail{min-height:92px;border-left:5px solid #d14424;background:#fff;padding:18px 22px}.actions{display:flex;justify-content:space-between;margin-top:20px}.actions button{border:0;background:#242621;color:#fff;padding:12px 20px;cursor:pointer}.actions button:disabled{opacity:.35}</style></head><body><main class="shell"><p class="eyebrow">INTERACTIVE DIAGRAM</p><h1>${escapeWidgetText(title)}</h1><div class="nodes"><button class="node" data-index="0">${escapeWidgetText(first)}</button><button class="node" data-index="1">${escapeWidgetText(second)}</button><button class="node" data-index="2">${escapeWidgetText(third)}</button></div><section class="detail" id="detail">请依次点击三个节点，观察概念如何连接。</section><div class="actions"><button id="reset">重置</button><button id="complete" disabled>完成探索</button></div></main><script>(()=>{const labels=${JSON.stringify([first, second, third]).replaceAll("<", "\\u003c")};const visited=new Set();const detail=document.getElementById('detail');const complete=document.getElementById('complete');let sent=false;function reset(){visited.clear();sent=false;document.querySelectorAll('.node').forEach(n=>n.classList.remove('active'));detail.textContent='请依次点击三个节点，观察概念如何连接。';complete.disabled=true}document.querySelectorAll('.node').forEach(node=>node.addEventListener('click',()=>{const i=Number(node.dataset.index);visited.add(i);node.classList.add('active');detail.textContent='已探索：'+labels[i]+'。当前进度 '+visited.size+'/3。';complete.disabled=visited.size<3}));document.getElementById('reset').addEventListener('click',reset);complete.addEventListener('click',()=>{if(visited.size===3&&!sent){sent=true;detail.textContent='已完成全部节点探索。';parent.postMessage({type:'INTERACTIVE_COMPLETED',version:1},'*')}});addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='INTERACTIVE_RESET'&&event.data?.version===1)reset()});addEventListener('DOMContentLoaded',()=>parent.postMessage({type:'INTERACTIVE_READY',version:1},'*'))})();</script></body></html>`,
        fallback: { title, description: `这个互动图说明了${topic}的三个相关部分。`, steps: [first, second, third] },
      },
      narration: `请依次点击图中节点，观察${topic}的关键关系，全部探索后完成本场。`,
      summary: `${title}通过三个可操作节点串联了${topic}的核心关系。`,
    };
  }
  if (type === "quiz") {
    return {
      type,
      title,
      content: { questions: [{
        type: "single_choice",
        prompt: `关于“${topic}”与本场关键点，下列哪项最符合课程内容？`,
        options: [{ label: keyPoints[0] ?? "理解核心概念" }, { label: "跳过结构化校验" }, { label: "执行任意模型代码" }],
        correctOptionIndex: 0,
        explanation: `本题检查学习者是否掌握“${keyPoints[0] ?? topic}”。`,
      }] },
      narration: `下面通过一道单选题检查你对${topic}的理解。`,
      summary: `本场检查了学习者对${topic}关键概念的理解。`,
    };
  }
  return {
    type,
    content: {
      background: { type: "gradient", gradient: { type: "linear", rotate: 135, colors: [{ pos: 0, color: "#f6f1e7" }, { pos: 100, color: "#e8eef2" }] } },
      elements: [
        { type: "shape", left: 56, top: 46, width: 10, height: 70, path: "M 0 0 L 1 0 L 1 1 L 0 1 Z", viewBox: [1, 1], fill: "#d14424" },
        { type: "text", left: 82, top: 48, width: 850, height: 70, content: `<p style="font-size:34px;font-weight:bold;color:#242621">${title}</p>`, textType: "title", vAlign: "middle" },
        { type: "text", left: 82, top: 118, width: 790, height: 48, content: `<p style="font-size:17px;color:#68716b">${topic} · 从问题到可执行理解</p>`, textType: "subtitle" },
        { type: "shape", left: 64, top: 188, width: 274, height: 230, path: "M 0 0 L 1 0 L 1 1 L 0 1 Z", viewBox: [1, 1], fill: "#ffffff", outline: { style: "solid", width: 1, color: "#d6d2c8" } },
        { type: "shape", left: 363, top: 188, width: 274, height: 230, path: "M 0 0 L 1 0 L 1 1 L 0 1 Z", viewBox: [1, 1], fill: "#edf2eb", outline: { style: "solid", width: 1, color: "#ccd8c8" } },
        { type: "text", left: 84, top: 210, width: 230, height: 170, content: `<p style="font-size:18px;font-weight:bold;color:#d14424">01 · 问题</p><p style="font-size:18px;color:#333333">${keyPoints[0] ?? "核心概念"}</p>`, textType: "content", lineHeight: 1.5 },
        { type: "text", left: 383, top: 210, width: 230, height: 170, content: `<p style="font-size:18px;font-weight:bold;color:#4472c4">02 · 机制</p><p style="font-size:18px;color:#333333">${keyPoints[1] ?? "关键机制"}</p>`, textType: "content", lineHeight: 1.5 },
        { type: "line", left: 330, top: 300, width: 3, start: [0, 0], end: [42, 0], style: "solid", color: "#4472c4", points: ["", "arrow"] },
        { type: "code", left: 662, top: 188, width: 278, height: 230, language: "typescript", fileName: "lesson.ts", showLineNumbers: true, fontSize: 14, lines: ["const input = modelOutput;", "const slide = schema.parse(input);", "return render(slide);"] },
        { type: "text", left: 82, top: 456, width: 850, height: 50, content: `<p style="font-size:18px;color:#333333"><strong>结论：</strong>${keyPoints[2] ?? "把概念、机制与实践边界连接起来"}</p>`, textType: "notes", vAlign: "middle" },
      ],
    },
    narration: `现在进入${title}。请先建立问题背景，再理解关键机制，最后联系实际应用。`,
    summary: `${title}介绍了${topic}的核心概念、运行机制和应用边界。`,
  };
}

/** 根据 Prompt 中的正式输入确定性生成大纲或场景，确保 mock 与远端模型共用后续边界。 */
export class MockAIAdapter implements AIAdapter {
  constructor(private readonly responses: string[] = []) {}

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const injected = this.responses.shift();
    if (injected !== undefined) return { text: injected, provider: "mock", model: `mock-${input.stage}-v1` };

    if (input.stage === "scene" || input.userPrompt.includes("场景类型：") || input.userPrompt.includes("修复对象：scene")) {
      return { text: JSON.stringify(createMockScene(input.userPrompt)), provider: "mock", model: "mock-scene-v2", usage: { inputTokens: 0, outputTokens: 0 } };
    }

    const topic = readPromptJson<string>(input.userPrompt, "课程描述 JSON") ?? readPromptValue(input.userPrompt, "教学主题") ?? "示例主题";
    const count = Number(readPromptValue(input.userPrompt, "场景数量") ?? 4);
    const defaultBrief = readPromptJson<CourseBrief>(input.userPrompt, "默认 Brief JSON");
    const explicitBrief = readPromptJson<Partial<CourseBrief>>(input.userPrompt, "显式设置 JSON") ?? {};
    if (!defaultBrief) throw new Error("mock outline prompt missing default brief");
    // mock 不猜测原文字段，因此用同一优先级确定性合并显式设置与默认值。
    const resolvedBrief = { ...defaultBrief, ...explicitBrief };
    const titles = ["建立问题地图", "拆解核心机制", "探索概念关系", "检验关键理解", "连接工程实践", "分析边界条件", "整合应用路径", "形成复习闭环"];
    const interactiveIndexes = resolvedBrief.interactionMode === "required"
      ? count === 4 ? new Set([2]) : count <= 6 ? new Set([2, 4].filter((index) => index < count - 1)) : new Set([2, 4, 6].filter((index) => index < count - 1))
      : new Set<number>();
    const output: MockOutline = {
      courseTitle: `${topic}：从概念到实践`,
      detectedBrief: {},
      warnings: [],
      outlines: Array.from({ length: count }, (_, index) => {
        const type = index === count - 1 ? "quiz" as const : interactiveIndexes.has(index) ? "interactive" as const : "slide" as const;
        const role: SceneOutline["role"] = type === "quiz"
          ? "assessment"
          : type === "interactive"
            ? "mechanism"
          : index === 0
            ? "hook"
            : index === count - 1
              ? "summary"
              : index === 1
                ? "mechanism"
                : "worked_example";
        return {
          type,
          ...(type === "interactive" ? { widgetType: (["diagram", "simulation", /代码|编程|Agent/i.test(topic) ? "code" : "game"] as const)[Math.floor((index - 2) / 2)], widgetOutline: { designIdea: "操作参数或工具，观察结果、比较反馈并完成任务。" } } : {}),
          role,
          title: `${titles[index]}：${topic}`,
          teachingObjective: type === "quiz"
            ? `检查${resolvedBrief.audience}能否围绕“${resolvedBrief.learningGoal}”辨析核心概念与常见误区`
            : type === "interactive"
              ? `通过操作关系图，帮助${resolvedBrief.audience}建立${topic}的节点、流程与因果联系`
            : index === 0
              ? `帮助${resolvedBrief.audience}建立${topic}的问题背景，并进入目标“${resolvedBrief.learningGoal}”`
              : `围绕“${resolvedBrief.learningGoal}”理解${topic}在第 ${index + 1} 个学习层次中的作用与边界`,
          keyPoints: type === "quiz" ? ["核心概念辨析", "常见误区判断"] : [`${topic}的核心概念`, "机制之间的因果关系", "实际应用边界"],
          order: index + 1,
          estimatedMinutes: type === "quiz" ? 3 : 5,
          ...(type === "quiz" ? { assessmentFocus: `检查是否达到学习目标：${resolvedBrief.learningGoal}` } : {}),
        };
      }),
    };
    return { text: JSON.stringify(output), provider: "mock", model: "mock-outline-v2", usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
