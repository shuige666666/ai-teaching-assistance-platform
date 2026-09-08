import { describe, expect, it } from "vitest";
import { SceneGenerationService } from "@/lib/application/scene-generation-service";
import type { AIAdapter } from "@/lib/ai/contracts";
import { AIAdapterError } from "@/lib/ai/contracts";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { CourseSchema } from "@/lib/domain/schemas";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";

describe("M12.2 scene generation", () => {
  it("新增页面成功后才插入完整 outline/scene/progress，不留下占位页", async () => {
    const repository = new InMemoryCourseRepository();
    const course = materializeFixtureCourse(createFixtureCourse("新增页测试", 4));
    await repository.create(course);
    const outline = CourseSchema.shape.outlines.element.parse({
      ...course.outlines[1], id: "inserted-outline", order: 2, title: "新增实践页",
    });
    const saved = await new SceneGenerationService(repository, new MockAIAdapter(), 10_000).insert(course.id, course.revision, "insert-run", outline, 2, "补充一个实践示例");
    expect(saved.status).toBe("ready");
    expect(saved.requestedSceneCount).toBe(5);
    expect(saved.outlines[1]).toMatchObject({ id: "inserted-outline", order: 2, title: "新增实践页" });
    expect(saved.scenes.find((scene) => scene.outlineId === "inserted-outline")).toMatchObject({ order: 2 });
    expect(saved.sceneProgress).toHaveLength(5);
    expect(saved.activeOperation).toBeUndefined();
  });

  it("新增页生成失败时保留原课程数组，不写入半成品", async () => {
    const repository = new InMemoryCourseRepository();
    const course = materializeFixtureCourse(createFixtureCourse("新增失败测试", 4));
    await repository.create(course);
    const outline = CourseSchema.shape.outlines.element.parse({ ...course.outlines[1], id: "failed-outline", order: 2, title: "失败页" });
    const failing: AIAdapter = { async generateText() { throw new AIAdapterError("AI_UPSTREAM_ERROR", "模拟上游失败", true); } };
    await expect(new SceneGenerationService(repository, failing, 10_000).insert(course.id, course.revision, "insert-fail", outline, 2, "补充内容")).rejects.toThrow();
    const saved = await repository.get(course.id);
    expect(saved?.requestedSceneCount).toBe(course.requestedSceneCount);
    expect(saved?.outlines.map((item) => item.id)).toEqual(course.outlines.map((item) => item.id));
    expect(saved?.scenes.map((scene) => scene.id)).toEqual(course.scenes.map((scene) => scene.id));
    expect(saved?.activeOperation).toBeUndefined();
  });

  it("已有页面重生成成功时替换 sceneId 并保留 outlineId", async () => {
    const repository = new InMemoryCourseRepository();
    const course = materializeFixtureCourse(createFixtureCourse("整页重生成测试", 4));
    await repository.create(course);
    const old = course.scenes[0];
    const saved = await new SceneGenerationService(repository, new MockAIAdapter(), 10_000).revise(course.id, old.outlineId, course.revision, "regenerate-run", { instruction: "重新组织页面结构" });
    const replacement = saved.scenes.find((scene) => scene.outlineId === old.outlineId);
    expect(replacement?.id).not.toBe(old.id);
    expect(replacement?.outlineId).toBe(old.outlineId);
    expect(saved.scenes).toHaveLength(course.scenes.length);
    expect(saved.sceneProgress.find((item) => item.outlineId === old.outlineId)?.status).toBe("ready");
  });
});
