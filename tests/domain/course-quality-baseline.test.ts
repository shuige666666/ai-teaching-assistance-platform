import { describe, expect, it } from "vitest";
import dataset from "@/eval/config/course-quality.v1.json";
import { createRunSummary, parseEvaluationDataset } from "@/eval/scripts/course-quality-lib.mjs";

describe("M7.0 质量基线", () => {
  it("固定六个公开主题并覆盖三类课程", () => {
    const parsed = parseEvaluationDataset(dataset);
    expect(parsed.topics).toHaveLength(6);
    expect(Object.fromEntries(["concept_explanation", "mechanism_process", "programming_practice"].map((category) => [category, parsed.topics.filter((topic) => topic.category === category).length]))).toEqual({
      concept_explanation: 2,
      mechanism_process: 2,
      programming_practice: 2,
    });
    expect(parsed.topics.every((topic) => topic.publicTopic && !topic.containsPersonalData)).toBe(true);
  });

  it("只有冻结的六题输入才能触发正式付费基线", () => {
    expect(() => parseEvaluationDataset(dataset, true)).not.toThrow();
    const candidateDataset = { ...structuredClone(dataset), status: "candidate", frozenAt: null };
    expect(() => parseEvaluationDataset(candidateDataset, true)).toThrow("付费基线只能使用开发者已经确认并冻结的评价集");
  });

  it("摘要只统计生成事实和场景归档，不提前创建人工评分", () => {
    const report = {
      results: [{
        topicId: "concept-http-cache",
        durationMs: 100,
        course: {
          courseId: "course-1",
          title: "HTTP 缓存",
          status: "partial_failed",
          requestedSceneCount: 5,
          outlineGeneration: { upstreamCalls: 1, usage: { inputTokens: 10, outputTokens: 20 } },
          scenes: [{ order: 1, generation: { upstreamCalls: 1, usage: { inputTokens: 30, outputTokens: 40 } } }],
        },
        collectionErrors: [{ stage: "scene", details: { upstreamCalls: 2 } }],
        sceneArchives: [{ sceneOrder: 1, format: "mhtml" }],
      }],
    };
    expect(createRunSummary(report)).toMatchObject({
      partialFailedCourses: 1,
      savedScenes: 1,
      requestedScenes: 5,
      archivedScenes: 1,
      totalUpstreamCalls: 4,
      recordedInputTokens: 40,
      recordedOutputTokens: 60,
    });
  });
});
