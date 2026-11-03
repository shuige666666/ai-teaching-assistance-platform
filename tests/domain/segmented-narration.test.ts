import { describe, expect, it } from "vitest";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { CoursePatchService } from "@/lib/application/course-patch-service";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { CourseSchema, SceneSchema } from "@/lib/domain/schemas";
import { generateScene } from "@/lib/generation/scene-pipeline";
import { assembleScene, validateSceneOutput } from "@/lib/generation/scene-schema";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";
import { normalizeGeneratedSlideScene } from "@/lib/slides/normalize-slide";

const title = { ref: "title", type: "text", left: 60, top: 50, width: 800, height: 70, textType: "title", content: "课程标题" };
const body = { ref: "body", type: "text", left: 60, top: 160, width: 400, height: 160, content: "关键机制" };
const segmented = {
  type: "slide",
  content: { elements: [title, body] },
  narrationSegments: [{ text: "先建立背景。", targetRefs: [] }, { text: "再解释关键机制。", targetRefs: ["body"] }],
  summary: "介绍背景与关键机制。",
};

describe("分段讲解生成与引用", () => {
  it("过滤坏元素后仍按临时 ref 绑定正确元素，并只保存正式 ID", () => {
    const output = normalizeGeneratedSlideScene({ ...segmented, content: { elements: [title, { ...body, ref: "bad", left: 2000 }, body] } });
    expect(output.content.elements).toHaveLength(2);
    const targetId = output.content.elements[1].id;
    expect(output.narrationSegments[1].focusElementIds).toEqual([targetId]);
    expect(targetId).not.toBe("body");
    const course = createFixtureCourse("分段讲解", 4);
    const scene = assembleScene({ output, courseId: course.id, outline: course.outlines[0], metadata: { provider: "mock", model: "test", promptVersion: "test", requestId: "segments", durationMs: 1, upstreamCalls: 1, repaired: false, generatedAt: 1 }, now: 1 });
    expect(scene.actions).toMatchObject([{ type: "speech", text: "先建立背景。", focusElementIds: [] }, { type: "speech", text: "再解释关键机制。", focusElementIds: [targetId] }]);
    expect(JSON.stringify(scene)).not.toContain('"targetRefs"');
    expect(JSON.stringify(scene)).not.toContain('"ref"');
    expect(JSON.stringify(scene)).not.toContain('"narration"');
  });

  it("重复、缺失与被过滤引用只取消对应聚焦，不猜测目标", () => {
    const output = normalizeGeneratedSlideScene({
      ...segmented,
      content: { elements: [title, body, { ...body, left: 500 }, { ...body, ref: "outside", top: 900 }] },
      narrationSegments: [{ text: "保留完整讲稿。", targetRefs: ["body", "missing", "outside", "title"] }],
    });
    expect(output.narrationSegments).toEqual([{ text: "保留完整讲稿。", focusElementIds: [output.content.elements[0].id] }]);
    expect(output.normalizationIssues.filter((issue) => issue.path.startsWith("narrationSegments"))).toHaveLength(3);
  });

  it("超过画布元素上限的目标不能进入持久化引用", () => {
    const elements = Array.from({ length: 41 }, (_, index) => ({ ...title, ref: `item_${index}` }));
    const output = normalizeGeneratedSlideScene({ ...segmented, content: { elements }, narrationSegments: [{ text: "讲解保留。", targetRefs: ["item_39", "item_40"] }] });
    expect(output.content.elements).toHaveLength(40);
    expect(output.narrationSegments[0].focusElementIds).toEqual([output.content.elements[39].id]);
  });

  it("历史 narration 兼容为单段，历史课程无需补写字段", () => {
    const output = normalizeGeneratedSlideScene({ type: "slide", content: segmented.content, narration: "旧讲稿。", summary: "旧摘要。" });
    expect(output.narrationSegments).toEqual([{ text: "旧讲稿。", focusElementIds: [] }]);
    const course = materializeFixtureCourse(createFixtureCourse("历史课程", 4));
    expect(CourseSchema.parse(course).scenes[0].actions).toEqual(course.scenes[0].actions);
  });

  it("校验分段总预算与纯文本边界，同时允许没有聚焦的过渡段", () => {
    expect(() => normalizeGeneratedSlideScene({ ...segmented, narrationSegments: [] })).toThrow();
    expect(() => normalizeGeneratedSlideScene({ ...segmented, narrationSegments: [{ text: "甲".repeat(800) }, { text: "乙".repeat(800) }] })).toThrow();
    const course = createFixtureCourse("分段安全", 4);
    expect(() => validateSceneOutput({ ...segmented, narrationSegments: [{ text: "<script>alert(1)</script>", targetRefs: [] }] }, course.outlines[0])).toThrow();
    expect(normalizeGeneratedSlideScene({ ...segmented, narrationSegments: [{ text: "我们进入下一个问题。" }] }).narrationSegments[0].focusElementIds).toEqual([]);
  });

  it("mock 完整生成一次返回三段讲稿和本页有效元素关联", async () => {
    const course = createFixtureCourse("讲解联动", 4);
    const scene = await generateScene(new MockAIAdapter(), { course, outline: course.outlines[0], requestId: "segmented-mock", signal: new AbortController().signal });
    expect(scene.generation).toMatchObject({ upstreamCalls: 1, repaired: false, promptVersion: "scene-slide.v2.6" });
    expect(scene.actions).toHaveLength(3);
    expect(scene.actions.every((action) => action.type === "speech" && action.focusElementIds?.length === 1)).toBe(true);
    expect(() => SceneSchema.parse(scene)).not.toThrow();
  });

  it("分段结构无效时沿用一次修复预算，并重新映射有效目标", async () => {
    const course = createFixtureCourse("分段修复", 4);
    const scene = await generateScene(new MockAIAdapter([
      JSON.stringify({ ...segmented, narrationSegments: [] }),
      JSON.stringify(segmented),
    ]), { course, outline: course.outlines[0], requestId: "segmented-repair", signal: new AbortController().signal });
    expect(scene.generation).toMatchObject({ upstreamCalls: 2, repaired: true });
    if (scene.type !== "slide") throw new Error("slide expected");
    expect(scene.actions[1]).toMatchObject({ text: "再解释关键机制。", focusElementIds: [scene.content.canvas.elements[1].id] });
  });
});

describe("修订时维护讲稿聚焦", () => {
  it("移动目标保留关联，删除目标清理关联并记录讲稿复查提示", async () => {
    const course = materializeFixtureCourse(createFixtureCourse("修订聚焦", 4));
    const scene = course.scenes[0];
    if (scene.type !== "slide" || scene.actions[0].type !== "speech") throw new Error("fixture");
    const target = scene.content.canvas.elements.find((element) => element.type === "text" && element.textType !== "title")!;
    scene.actions[0].focusElementIds = [target.id];
    const repository = new InMemoryCourseRepository();
    await repository.create(course);
    const service = new CoursePatchService(repository);
    const index = scene.content.canvas.elements.indexOf(target);
    const moved = await service.prepareScenePatch(course.id, { sceneId: scene.id, expectedRevision: course.revision, intent: "移动内容", operations: [{ op: "set", path: `/content/canvas/elements/${index}/left`, value: target.left + 5 }] });
    expect(moved.candidateScene.actions[0]).toMatchObject({ focusElementIds: [target.id] });
    const deleted = await service.prepareScenePatch(course.id, { sceneId: scene.id, expectedRevision: course.revision, intent: "移除内容", operations: [{ op: "delete_element", elementId: target.id }] });
    expect(deleted.candidateScene.actions[0]).toMatchObject({ focusElementIds: [] });
    expect(deleted.warnings.join(" ")).toContain("复查对应讲稿");
    expect(deleted.changedPaths).toContain("/actions/0/focusElementIds");
    await service.commitPrepared(deleted);
    expect((await repository.get(course.id))?.scenes[0].actions[0]).toMatchObject({ focusElementIds: [] });
  });

  it("拒绝 Agent 新增跨页或不存在的目标，失败不写入课程", async () => {
    const course = materializeFixtureCourse(createFixtureCourse("非法聚焦", 4));
    const repository = new InMemoryCourseRepository();
    await repository.create(course);
    const service = new CoursePatchService(repository);
    await expect(service.prepareScenePatch(course.id, { sceneId: course.scenes[0].id, expectedRevision: course.revision, intent: "非法目标", operations: [{ op: "set", path: "/actions", value: [{ type: "speech", text: "新的讲解", focusElementIds: ["another-page-element"] }] }] })).rejects.toThrow("本页幻灯片");
    expect((await repository.get(course.id))?.revision).toBe(course.revision);
  });
});
