import { describe, expect, it } from "vitest";
import dataset from "@/eval/config/course-quality.v1.json";
import density from "@/eval/config/slide-density.v1.json";
import { analyzeLegacySlide, createHumanScoreTemplate, parseEvaluationInputs } from "@/eval/scripts/course-quality-lib.mjs";

describe("M7.0 质量基线", () => {
  it("固定六个公开主题并覆盖三类课程", () => {
    const parsed = parseEvaluationInputs(dataset, density);
    expect(parsed.dataset.topics).toHaveLength(6);
    expect(Object.fromEntries(["concept_explanation", "mechanism_process", "programming_practice"].map((category) => [category, parsed.dataset.topics.filter((topic) => topic.category === category).length]))).toEqual({ concept_explanation: 2, mechanism_process: 2, programming_practice: 2 });
    expect(parsed.dataset.topics.every((topic) => topic.publicTopic && !topic.containsPersonalData)).toBe(true);
  });

  it("只有同步冻结的协议才能触发正式基线", () => {
    expect(() => parseEvaluationInputs(dataset, density, true)).not.toThrow();
    const candidateDataset = { ...structuredClone(dataset), status: "candidate", frozenAt: null };
    const candidateDensity = { ...structuredClone(density), status: "candidate", frozenAt: null };
    expect(() => parseEvaluationInputs(candidateDataset, candidateDensity, true)).toThrow("付费基线只能使用开发者已经确认并冻结的评价协议");
  });

  it("统计可见文字时排除代码原文和讲解稿", () => {
    const scene = {
      title: "状态更新",
      content: {
        type: "slide",
        subtitle: "函数式更新",
        blocks: [
          { type: "paragraph", text: "根据前一个状态计算下一个状态" },
          { type: "code", caption: "示例", code: "<button>不会作为可见字符预算统计</button>\nsetCount((value) => value + 1);" },
        ],
      },
    };
    const report = analyzeLegacySlide(scene, density);
    expect(report.visibleCharCount).toBe("状态更新函数式更新根据前一个状态计算下一个状态示例".length);
    expect(report.codeLineCount).toBe(2);
    expect(report.template).toBe("legacy_stack");
    expect(report.enforcement).toBe("observe_only");
  });

  it("为七个维度生成独立的人工评分空表", () => {
    const template = createHumanScoreTemplate("run-1", dataset.topics);
    expect(Object.keys(template.courses[0].scores)).toHaveLength(7);
    expect(Object.values(template.courses[0].scores).every((score) => score === null)).toBe(true);
    expect(template.courses).toHaveLength(6);
  });
});
