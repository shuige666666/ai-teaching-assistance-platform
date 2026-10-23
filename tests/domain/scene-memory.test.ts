import { describe, expect, it } from "vitest";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { buildSlideUserPrompt } from "@/lib/generation/prompts/scene-slide.v2";
import { CoursePatchService } from "@/lib/application/course-patch-service";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";
import { refreshPatchedSceneSummary } from "@/lib/application/scene-summary";
import type { Scene } from "@/lib/domain/schemas";

describe("课程记忆与当前页面一致", () => {
  it("互动源码变化明确作废旧摘要，不能继续使用旧玩法描述", () => {
    const base = materializeFixtureCourse(createFixtureCourse("互动修改", 4)).scenes[0];
    const original: Scene = { ...base, type: "interactive", content: {
      type: "interactive", widgetType: "diagram", runtimeContractVersion: 1,
      html: "<!doctype html><html><head></head><body>旧玩法</body></html>",
      fallback: { title: "旧玩法", description: "旧描述", steps: ["观察", "操作"] },
    } };
    const candidate = structuredClone(original);
    candidate.content.html = candidate.content.html.replace("旧玩法", "新玩法");
    expect(refreshPatchedSceneSummary(original, candidate)).toContain("旧摘要已失效");
    expect(refreshPatchedSceneSummary(original, candidate)).not.toContain("旧玩法");
  });

  it("后页只把已保存场景作为历史，不把失败页的大纲当成已讲内容", () => {
    const course = materializeFixtureCourse(createFixtureCourse("课程记忆", 4));
    const missing = course.outlines[1];
    missing.keyPoints = ["FAILED_KEYPOINT"];
    course.scenes = course.scenes.filter((scene) => scene.outlineId !== missing.id);
    course.scenes[0].summary = "实际保存的当前知识";
    const prompt = buildSlideUserPrompt(course, course.outlines[3]);
    expect(prompt).not.toContain("FAILED_KEYPOINT");
    const memory = JSON.parse(prompt.split("\n").find((line) => line.startsWith("已生成场景摘要 JSON："))!.split("JSON：")[1]);
    expect(memory).toHaveLength(2);
    expect(memory[0].summary).toBe("实际保存的当前知识");
    expect(memory.some((item: { order: number }) => item.order === missing.order)).toBe(false);
  });

  it("讲稿补丁与新摘要一次保存，下一页实际读取更新后的内容", async () => {
    const course = materializeFixtureCourse(createFixtureCourse("修订摘要", 4));
    const repository = new InMemoryCourseRepository();
    await repository.create(course);
    const service = new CoursePatchService(repository);
    const prepared = await service.prepareScenePatch(course.id, {
      sceneId: course.scenes[0].id, expectedRevision: course.revision, intent: "替换讲解",
      operations: [{ op: "set", path: "/actions/0/text", value: "新的知识：重传与拥塞控制需要分别理解。" }],
    });
    expect((await repository.get(course.id))!.scenes[0].summary).toBe(course.scenes[0].summary);
    await service.commitPrepared(prepared);
    const saved = (await repository.get(course.id))!;
    expect(saved.scenes[0].summary).toContain("新的知识");
    expect(saved.scenes[0].summary).not.toBe(course.scenes[0].summary);
    expect(buildSlideUserPrompt(saved, saved.outlines[1])).toContain("新的知识");
  });

  it("正文变化刷新摘要，但纯坐标或主题变化保留摘要", () => {
    const original = materializeFixtureCourse(createFixtureCourse("页面修订", 4)).scenes[0];
    const candidate = structuredClone(original);
    if (candidate.type !== "slide") throw new Error("fixture");
    candidate.content.canvas.elements[0].left += 1;
    expect(refreshPatchedSceneSummary(original, candidate)).toBe(original.summary);
    const element = candidate.content.canvas.elements.find((item) => item.type === "text")!;
    element.content = "修订后的新知识";
    const summary = refreshPatchedSceneSummary(original, candidate);
    expect(summary).toContain("修订后的新知识");
    expect(summary.length).toBeLessThanOrEqual(300);
  });
});
