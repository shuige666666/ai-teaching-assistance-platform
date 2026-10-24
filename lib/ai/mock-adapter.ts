import type { AIAdapter, GenerateTextInput, GenerateTextResult } from "./contracts";
import { createMockWidget, escapeWidgetText } from "@/lib/interactive/mock-widgets";
import type { CourseBrief, SceneOutline } from "@/lib/domain/schemas";
import type { MaterialContextBlock } from "@/lib/materials/types";

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
  const outline = readPromptJson<Pick<SceneOutline, "type" | "role" | "title" | "keyPoints" | "widgetType"> & { order?: number }>(prompt, "当前 SceneOutline JSON");
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
        html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f3fafb;color:#143f59;font-family:"Microsoft YaHei",sans-serif}.shell{min-height:100vh;padding:28px 34px}.eyebrow{font:12px monospace;letter-spacing:.18em;color:#498ba6}.nodes{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:36px 0 22px}.node{border:1px solid #b7d0d7;background:#fff;padding:26px 14px;font-size:18px;cursor:pointer;transition:.2s}.node:hover,.node.active{background:#e4faf7;border-color:#14d9c5;transform:translateY(-3px)}.detail{min-height:92px;border-left:5px solid #bf545d;background:#fff;padding:18px 22px}.actions{display:flex;justify-content:space-between;margin-top:20px}.actions button{border:0;background:#143f59;color:#fff;padding:12px 20px;cursor:pointer}.actions button:disabled{opacity:.35}</style></head><body><main class="shell"><p class="eyebrow">INTERACTIVE DIAGRAM</p><h1>${escapeWidgetText(title)}</h1><div class="nodes"><button class="node" data-index="0">${escapeWidgetText(first)}</button><button class="node" data-index="1">${escapeWidgetText(second)}</button><button class="node" data-index="2">${escapeWidgetText(third)}</button></div><section class="detail" id="detail">请依次点击三个节点，观察概念如何连接。</section><div class="actions"><button id="reset">重置</button><button id="complete" disabled>完成探索</button></div></main><script>(()=>{const labels=${JSON.stringify([first, second, third]).replaceAll("<", "\\u003c")};const visited=new Set();const detail=document.getElementById('detail');const complete=document.getElementById('complete');let sent=false;function reset(){visited.clear();sent=false;document.querySelectorAll('.node').forEach(n=>n.classList.remove('active'));detail.textContent='请依次点击三个节点，观察概念如何连接。';complete.disabled=true}document.querySelectorAll('.node').forEach(node=>node.addEventListener('click',()=>{const i=Number(node.dataset.index);visited.add(i);node.classList.add('active');detail.textContent='已探索：'+labels[i]+'。当前进度 '+visited.size+'/3。';complete.disabled=visited.size<3}));document.getElementById('reset').addEventListener('click',reset);complete.addEventListener('click',()=>{if(visited.size===3&&!sent){sent=true;detail.textContent='已完成全部节点探索。';parent.postMessage({type:'INTERACTIVE_COMPLETED',version:1},'*')}});addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='INTERACTIVE_RESET'&&event.data?.version===1)reset()});addEventListener('DOMContentLoaded',()=>parent.postMessage({type:'INTERACTIVE_READY',version:1},'*'))})();</script></body></html>`,
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
        correctOptionIndexes: [0],
        explanation: `本题检查学习者是否掌握“${keyPoints[0] ?? topic}”。`,
      }, {
        type: "multiple_choice",
        prompt: "以下哪些做法有助于形成可靠的学习闭环？",
        options: [{ label: "围绕目标组织内容" }, { label: "提供反馈与解析" }, { label: "忽略学习者作答" }],
        correctOptionIndexes: [0, 1],
        explanation: "目标组织和及时反馈共同构成可靠的学习闭环。",
      }] },
      narration: `下面通过单选题和多选题检查你对${topic}的理解。`,
      summary: `本场检查了学习者对${topic}关键概念的理解。`,
    };
  }
  // mock slide 覆盖全部渲染器：hook 场在右列叠加图表与表格，mechanism 场展示连线与代码块，
  // 其余角色展示图表；卡片使用 pathFormula 圆角矩形和线性渐变，经同一规范化边界后进入课堂。
  // 颜色消费 User Prompt 注入的本场主题 JSON，与真实模型一样只使用当前课程的主题色。
  const theme = readPromptJson<{ fontColor?: string; themeColors?: string[]; accent?: string; cards?: Array<{ bg: string; text: string }> }>(prompt, "本场主题 JSON");
  const fontColor = theme?.fontColor ?? "#143f59";
  const accent = theme?.accent ?? "#bf545d";
  const soft = theme?.themeColors?.[2] ?? "#498ba6";
  const cardBg = theme?.cards?.[0]?.bg ?? "#e4faf7";
  const labelColor = theme?.cards?.[0]?.text ?? "#bf545d";
  const labelColor2 = theme?.cards?.[1]?.text ?? "#498ba6";
  const labelColor3 = theme?.cards?.[2]?.text ?? "#14d9c5";
  const isMechanism = outline?.role === "mechanism";
  const isHook = outline?.role === "hook";
  const rightVisual = isHook
    ? [
        {
          type: "chart", left: 516, top: 178, width: 420, height: 180, chartType: "column",
          data: {
            labels: ["概念理解", "机制拆解", "实践应用"],
            series: [{ name: "掌握度", values: [60, 75, 90] }],
          },
          themeColors: theme?.themeColors ?? ["#498ba6", "#bf545d", "#14d9c5"],
        },
        {
          type: "table", left: 516, top: 370, width: 420, height: 132, header: true, colWidths: [1, 2],
          rows: [
            ["对比维度", "核心要点"],
            ["核心概念", keyPoints[0] ?? "理解关键定义"],
            ["实践边界", keyPoints[2] ?? "明确适用范围"],
          ],
        },
      ]
    : [
        { type: "line", left: 486, top: 306, width: 3, start: [0, 0], end: [28, 0], style: "solid", color: soft, points: ["", "arrow"] },
        isMechanism
          ? { type: "code", left: 516, top: 190, width: 420, height: 240, language: "typescript", fileName: "lesson.ts", showLineNumbers: true, fontSize: 14, lines: ["const input = modelOutput;", "const slide = schema.parse(input);", "return render(slide);"] }
          : {
              type: "chart", left: 516, top: 190, width: 420, height: 240, chartType: "column",
              data: {
                labels: ["概念理解", "机制拆解", "实践应用"],
                series: [{ name: "掌握度", values: [60, 75, 90] }],
              },
              themeColors: theme?.themeColors ?? ["#498ba6", "#bf545d", "#14d9c5"],
            },
      ];
  const hookElements = isHook
    ? [
        {
          type: "shape", left: 64, top: 178, width: 420, height: 324, pathFormula: "roundRect",
          gradient: { type: "linear", rotate: 90, colors: [{ pos: 0, color: "#ffffff" }, { pos: 100, color: cardBg }] },
          outline: { style: "solid", width: 1, color: "#b7d0d7" },
        },
        { type: "text", left: 88, top: 200, width: 372, height: 280, content: `<p style="font-size:20px;font-weight:bold;color:${labelColor}">01 · 问题</p><p style="font-size:18px;color:${fontColor}">${keyPoints[0] ?? "核心概念"}</p><p style="font-size:18px;font-weight:bold;color:${labelColor2}">02 · 机制</p><p style="font-size:18px;color:${fontColor}">${keyPoints[1] ?? "关键机制"}</p><p style="font-size:18px;font-weight:bold;color:${labelColor3}">03 · 应用</p><p style="font-size:18px;color:${fontColor}">${keyPoints[2] ?? "实践边界"}</p>`, textType: "content", lineHeight: 1.6 },
      ]
    : [
        {
          type: "shape", left: 64, top: 190, width: 420, height: 240, pathFormula: "roundRect",
          gradient: { type: "linear", rotate: 90, colors: [{ pos: 0, color: "#ffffff" }, { pos: 100, color: cardBg }] },
          outline: { style: "solid", width: 1, color: "#b7d0d7" },
        },
        { type: "text", left: 88, top: 212, width: 372, height: 200, content: `<p style="font-size:18px;font-weight:bold;color:${labelColor}">01 · 问题</p><p style="font-size:18px;color:${fontColor}">${keyPoints[0] ?? "核心概念"}</p><p style="font-size:16px;color:${soft}">结合机制理解应用边界。</p>`, textType: "content", lineHeight: 1.5 },
      ];
  const hookNotes = isHook ? [] : [
    { type: "text", left: 82, top: 462, width: 850, height: 50, content: `<p style="font-size:18px;color:${fontColor}"><strong>结论：</strong>${keyPoints[2] ?? "把概念、机制与实践边界连接起来"}</p>`, textType: "notes", vAlign: "middle" },
  ];
  return {
    type,
    content: {
      background: { type: "gradient", gradient: { type: "linear", rotate: 135, colors: [{ pos: 0, color: "#f3fafb" }, { pos: 100, color: "#eaf6f8" }] } },
      elements: [
        { type: "shape", left: 56, top: 48, width: 10, height: 70, pathFormula: "rect", fill: accent },
        { type: "text", left: 82, top: 48, width: 850, height: 70, content: `<p style="font-size:34px;font-weight:bold;color:${fontColor}">${title}</p>`, textType: "title", vAlign: "middle" },
        { type: "text", left: 82, top: 122, width: 760, height: 44, content: `<p style="font-size:17px;color:${soft}">${topic} · 从问题到可执行理解</p>`, textType: "subtitle" },
        ...hookElements,
        ...rightVisual,
        ...hookNotes,
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
    const materials = readPromptJson<MaterialContextBlock[]>(input.userPrompt, "教学材料 JSON") ?? [];
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
          ...(materials.length ? { sourceBlockIds: [materials[index % materials.length].id] } : {}),
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
          keyPoints: materials.length ? [materials[index % materials.length].text.slice(0, 150), "联系原文理解适用条件"] : type === "quiz" ? ["核心概念辨析", "常见误区判断"] : [`${topic}的核心概念`, "机制之间的因果关系", "实际应用边界"],
          order: index + 1,
          estimatedMinutes: type === "quiz" ? 3 : 5,
          ...(type === "quiz" ? { assessmentFocus: `检查是否达到学习目标：${resolvedBrief.learningGoal}` } : {}),
        };
      }),
    };
    return { text: JSON.stringify(output), provider: "mock", model: "mock-outline-v2", usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
