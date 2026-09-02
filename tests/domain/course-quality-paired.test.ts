import { describe, expect, it } from "vitest";
import {
  assertSlideQuizOnly,
  buildCourseQualityPairs,
  summarizeCourseQualityScores,
} from "@/eval/scripts/course-quality-lib.mjs";

const archive = (sceneOrder: number, sceneType: "slide" | "quiz") => ({
  sceneOrder,
  sceneType,
  filename: `${String(sceneOrder).padStart(2, "0")}-${sceneType}.mhtml`,
  format: "mhtml",
  viewport: { width: 1280, height: 720 },
});

type FixtureScene =
  | { type: "slide"; order: number; title: string }
  | { type: "quiz"; order: number; title: string }
  | { type: "interactive"; order: number; title: string };

function report(scenes: FixtureScene[]) {
  const pairableScenes = scenes.filter((scene): scene is Extract<FixtureScene, { type: "slide" | "quiz" }> => scene.type !== "interactive");
  return {
    datasetVersion: "course-quality.v1",
    frozenAt: "2026-08-27T13:24:42.566Z",
    server: { provider: "deepseek", model: "deepseek-v4-flash" },
    results: [{
      topicId: "topic-a",
      course: { scenes },
      sceneArchives: pairableScenes
        .map((scene) => archive(scene.order, scene.type)),
    }],
  };
}

describe("slide/quiz 配对评测", () => {
  it("按类型内序号配对，并忽略 interactive", () => {
    const baseline = report([
      { type: "slide", order: 1, title: "旧版 slide" },
      { type: "quiz", order: 2, title: "旧版 quiz" },
      { type: "interactive", order: 3, title: "旧版 interactive" },
    ]);
    const candidate = report([
      { type: "slide", order: 1, title: "新版 slide" },
      { type: "quiz", order: 3, title: "新版 quiz" },
    ]);

    expect(() => assertSlideQuizOnly(baseline, "baseline")).toThrow("interactive");
    expect(buildCourseQualityPairs(baseline, candidate).pairs.map((pair) => pair.pairId)).toEqual([
      "topic-a/quiz-01",
      "topic-a/slide-01",
    ]);
  });

  it("保留未配对场景，不强行补齐", () => {
    const baseline = report([
      { type: "slide", order: 1, title: "slide 1" },
      { type: "slide", order: 2, title: "slide 2" },
    ]);
    const candidate = report([{ type: "slide", order: 1, title: "slide 1" }]);
    const result = buildCourseQualityPairs(baseline, candidate);

    expect(result.pairs).toHaveLength(1);
    expect(result.unmatched.baseline.map((scene) => scene.pairId)).toEqual(["topic-a/slide-02"]);
  });

  it("只汇总三个视觉分数和总体偏好", () => {
    const pairs = buildCourseQualityPairs(
      report([{ type: "slide", order: 1, title: "旧版 slide" }]),
      report([{ type: "slide", order: 1, title: "新版 slide" }]),
    ).pairs;
    const summary = summarizeCourseQualityScores(pairs, [{
      pairId: "topic-a/slide-01",
      baseline: { readability: 3, layoutHierarchy: 3, renderingCompleteness: 4 },
      candidate: { readability: 4, layoutHierarchy: 5, renderingCompleteness: 4 },
      preference: "candidate",
    }]);

    expect(summary).toMatchObject({
      pairCount: 1,
      scoredPairCount: 1,
      preference: { baseline: 0, tie: 0, candidate: 1 },
      dimensions: {
        readability: { baselineMean: 3, candidateMean: 4, difference: 1 },
        layoutHierarchy: { baselineMean: 3, candidateMean: 5, difference: 2 },
        renderingCompleteness: { baselineMean: 4, candidateMean: 4, difference: 0 },
      },
    });
  });
});
