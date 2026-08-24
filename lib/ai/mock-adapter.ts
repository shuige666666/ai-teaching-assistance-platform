import type { AIAdapter, GenerateTextInput, GenerateTextResult } from "./contracts";

type MockOutline = { courseTitle: string; outlines: Array<{ type: "slide" | "quiz"; title: string; teachingObjective: string; keyPoints: string[]; order: number; estimatedMinutes: number }> };
type MockScene = {
  type: "slide" | "quiz";
  title: string;
  content: unknown;
  narration: string;
  summary: string;
};

function readPromptValue(prompt: string, label: string): string | undefined {
  return prompt.split("\n").find((line) => line.startsWith(`${label}：`))?.slice(label.length + 1).trim();
}

function createMockScene(prompt: string): MockScene {
  const topic = readPromptValue(prompt, "教学主题") ?? "示例主题";
  const title = readPromptValue(prompt, "场景标题") ?? "示例场景";
  const type = readPromptValue(prompt, "场景类型") === "quiz" ? "quiz" : "slide";
  const keyPoints = (readPromptValue(prompt, "关键点") ?? "核心概念；实际应用").split("；").filter(Boolean);
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
    title,
    content: {
      subtitle: `${topic} · 结构化讲解`,
      blocks: [
        { type: "paragraph", text: `本场从问题、机制和应用三个层次解释${topic}。` },
        { type: "bullet_list", items: keyPoints.length >= 2 ? keyPoints.slice(0, 6) : [keyPoints[0] ?? "核心概念", "实际应用"] },
        { type: "callout", tone: "example", title: "学习提示", text: "先说明它解决什么问题，再追踪关键机制和使用边界。" },
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

    if (input.stage === "scene" || input.userPrompt.includes("场景类型：")) {
      return { text: JSON.stringify(createMockScene(input.userPrompt)), provider: "mock", model: "mock-scene-v1", usage: { inputTokens: 0, outputTokens: 0 } };
    }

    const topic = readPromptValue(input.userPrompt, "教学主题") ?? "示例主题";
    const count = Number(readPromptValue(input.userPrompt, "场景数量") ?? 4);
    const titles = ["建立问题地图", "拆解核心机制", "检验关键理解", "连接工程实践", "形成复习路径"];
    const output: MockOutline = {
      courseTitle: `${topic}：从概念到实践`,
      outlines: Array.from({ length: count }, (_, index) => {
        const type = index === 2 ? "quiz" as const : "slide" as const;
        return {
          type,
          title: `${titles[index]}：${topic}`,
          teachingObjective: type === "quiz" ? `检查学习者能否辨析${topic}的核心概念与常见误区` : `理解${topic}在第 ${index + 1} 个学习层次中的作用与边界`,
          keyPoints: type === "quiz" ? ["核心概念辨析", "常见误区判断"] : [`${topic}的核心概念`, "机制之间的因果关系", "实际应用边界"],
          order: index + 1,
          estimatedMinutes: type === "quiz" ? 3 : 5,
        };
      }),
    };
    return { text: JSON.stringify(output), provider: "mock", model: "mock-outline-v1", usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
