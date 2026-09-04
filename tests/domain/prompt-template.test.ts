import { describe, expect, it } from "vitest";
import type { SceneOutline } from "@/lib/domain/schemas";
import { createFixtureCourse } from "@/lib/domain/fixture";
import { buildInteractivePrompt } from "@/lib/generation/prompts/scene-interactive.v2";
import { loadPromptTemplate, PROMPT_TEMPLATE_FILES, type PromptTemplateId } from "@/lib/generation/prompts/loader";

describe("prompt templates", () => {
  it("所有注册的 Markdown 模板都可以读取", () => {
    for (const id of Object.keys(PROMPT_TEMPLATE_FILES) as PromptTemplateId[]) {
      expect(loadPromptTemplate(id)).not.toHaveLength(0);
    }
  });

  it("互动代码 Prompt 仍包含公共规则、类型规则和代码辅助要求", () => {
    const course = createFixtureCourse("Prompt 模板测试", 4);
    const outline: SceneOutline = {
      id: "interactive-outline",
      type: "interactive",
      widgetType: "code",
      widgetOutline: { designIdea: "学生编写代码并通过测试完成实验", language: "python" },
      role: "practice",
      title: "代码实验",
      teachingObjective: "通过编程练习理解核心概念",
      keyPoints: ["编写代码", "运行测试"],
      order: 2,
      estimatedMinutes: 5,
    };
    const prompt = buildInteractivePrompt(course, outline);

    expect(prompt.system).toContain("只返回一份完整 HTML5 文档");
    expect(prompt.system).toContain("本次 widgetType 必须为 code");
    expect(prompt.system).toContain('id="copy-solution"');
    expect(prompt.user).toContain("当前 SceneOutline JSON");
  });
});
