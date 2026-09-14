import { describe, expect, it } from "vitest";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { GenerationRunTracker } from "@/lib/application/generation-run-tracker";
import { OutlineGenerationService } from "@/lib/application/outline-generation-service";
import { SceneGenerationService } from "@/lib/application/scene-generation-service";
import { buildUsageResponse } from "@/lib/domain/generation-run";
import { createCourseDraft } from "@/lib/domain/fixture";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";
import { InMemoryGenerationRunRepository } from "@/lib/repository/in-memory-generation-run-repository";

function services() {
  const courses = new InMemoryCourseRepository();
  const runs = new InMemoryGenerationRunRepository();
  const tracker = new GenerationRunTracker(runs);
  return {
    courses,
    runs,
    outline: new OutlineGenerationService(courses, new MockAIAdapter(), 90_000, Date.now, tracker),
    scenes: new SceneGenerationService(courses, new MockAIAdapter(), 120_000, Date.now, tracker),
  };
}

describe("GenerationRunTracker", () => {
  it("把大纲和首次场景累计为一条完整整课运行", async () => {
    const setup = services();
    const draft = await setup.courses.create(createCourseDraft("运行指标完整课程", 4));
    setup.runs.setCourseTitle(draft.id, draft.title);
    let course = await setup.outline.generate(draft.id, draft.revision, "metrics-outline");
    expect((await setup.runs.findOpen(course.id, ["course_generation"]))?.status).toBe("awaiting_review");

    for (const outline of course.outlines) {
      course = await setup.scenes.generate(course.id, outline.id, course.revision, `metrics-scene-${outline.order}`);
    }

    const allRuns = await setup.runs.listForUsage();
    expect(allRuns).toHaveLength(1);
    expect(allRuns[0]).toMatchObject({
      runType: "course_generation",
      status: "completed",
      requestedSceneCount: 4,
      succeededSceneCount: 4,
      failedSceneCount: 0,
      firstPassSucceededCount: 4,
      modelCalls: 5,
      usageStatus: "complete",
      inputTokens: 0,
      outputTokens: 0,
      finalRevision: course.revision,
    });
    const usage = buildUsageResponse(allRuns);
    expect(usage.totals).toMatchObject({ runs: 1, completedRuns: 1, succeededScenes: 4, modelCalls: 5, usageStatus: "complete" });
  });

  it("保留首次部分失败，并把后来成功记录成独立场景重试", async () => {
    const setup = services();
    const draft = await setup.courses.create(createCourseDraft("运行指标失败课程", 4));
    let course = await setup.outline.generate(draft.id, draft.revision, "failure-outline");
    course = await setup.scenes.generate(course.id, course.outlines[0].id, course.revision, "scene-first");
    const failedId = course.outlines[1].id;
    await expect(new SceneGenerationService(
      setup.courses,
      new MockAIAdapter(["{}", "{}"]),
      120_000,
      Date.now,
      new GenerationRunTracker(setup.runs),
    ).generate(course.id, failedId, course.revision, "scene-failed")).rejects.toMatchObject({ code: "INVALID_MODEL_OUTPUT" });
    course = (await setup.courses.get(course.id))!;
    course = await setup.scenes.generate(course.id, course.outlines[2].id, course.revision, "scene-third");
    course = await setup.scenes.generate(course.id, course.outlines[3].id, course.revision, "scene-fourth");

    const initial = (await setup.runs.listForUsage()).find((run) => run.runType === "course_generation")!;
    expect(initial).toMatchObject({ status: "partial_failed", succeededSceneCount: 3, failedSceneCount: 1, repairCount: 1, repairSucceededCount: 0 });

    course = await setup.scenes.generate(course.id, failedId, course.revision, "scene-retry");
    const runs = await setup.runs.listForUsage();
    expect(course.status).toBe("ready");
    expect(runs.find((run) => run.id === initial.id)?.status).toBe("partial_failed");
    expect(runs.find((run) => run.runType === "scene_retry")).toMatchObject({ status: "completed", succeededSceneCount: 1, requestedSceneCount: 1 });
  });

  it("终态运行不会被再次累计，未知 token 保持 unavailable", async () => {
    const runs = new InMemoryGenerationRunRepository();
    const now = Date.now();
    const run = await runs.create({
      courseId: crypto.randomUUID(), runType: "scene_retry", status: "running", baseRevision: 1,
      requestedSceneCount: 1, startedAt: now, updatedAt: now,
    });
    await runs.appendMetrics(run.id, { failedSceneCount: 1, modelCalls: 1, usageStatus: "unavailable", activeDurationMs: 120, updatedAt: now + 1 });
    await runs.transition(run.id, "failed", { errorCode: "AI_TIMEOUT", finishedAt: now + 2, updatedAt: now + 2 });
    await runs.appendMetrics(run.id, { succeededSceneCount: 1, modelCalls: 1, inputTokens: 10, usageStatus: "complete", updatedAt: now + 3 });
    expect(await runs.get(run.id)).toMatchObject({ status: "failed", failedSceneCount: 1, succeededSceneCount: 0, modelCalls: 1, usageStatus: "unavailable", inputTokens: undefined });
  });
});
