import { describe, expect, it } from "vitest";
import { CoursePatchService } from "@/lib/application/course-patch-service";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";

async function setup() {
  const repository = new InMemoryCourseRepository();
  const course = materializeFixtureCourse(createFixtureCourse("原子补丁测试", 4));
  await repository.create(course);
  return { repository, course, service: new CoursePatchService(repository, () => course.updatedAt + 10) };
}

describe("CoursePatchService", () => {
  it("用最小字符串补丁一次保存并保留场景身份", async () => {
    const { repository, course, service } = await setup();
    const scene = course.scenes[0];
    if (scene.type !== "slide") throw new Error("fixture");
    const index = scene.content.canvas.elements.findIndex((element) => element.type === "text" && element.content.includes("核心关系"));
    const prepared = await service.prepareScenePatch(course.id, {
      sceneId: scene.id,
      expectedRevision: course.revision,
      intent: "突出关键结论",
      operations: [{ op: "str_replace", path: `/content/canvas/elements/${index}/content`, oldText: "核心关系", newText: "关键结论" }],
    });
    expect(prepared.quizQuestionsChanged).toBe(false);
    const result = await service.commitPrepared(prepared);
    const saved = await repository.get(course.id);
    expect(result.afterRevision).toBe(course.revision + 1);
    expect(saved?.scenes[0].id).toBe(scene.id);
    expect(JSON.stringify(saved?.scenes[0].content)).toContain("关键结论");
  });

  it("任一 operation 失败时不留下部分修改", async () => {
    const { repository, course, service } = await setup();
    const scene = course.scenes[0];
    await expect(service.prepareScenePatch(course.id, {
      sceneId: scene.id,
      expectedRevision: course.revision,
      intent: "原子失败",
      operations: [
        { op: "set", path: "/actions/0/text", value: "这一步不应落库" },
        { op: "set", path: "/content/not-found", value: "x" },
      ],
    })).rejects.toThrow("路径不存在");
    expect((await repository.get(course.id))?.revision).toBe(course.revision);
    expect((await repository.get(course.id))?.scenes[0].actions[0]).toEqual(scene.actions[0]);
  });

  it("quiz 题目变化进入确认，提交后 Scene ID 保持且题目 ID 重建", async () => {
    const { repository, course, service } = await setup();
    const scene = course.scenes.find((item) => item.type === "quiz");
    if (!scene || scene.type !== "quiz") throw new Error("fixture");
    const oldQuestionId = scene.content.questions[0].id;
    const prepared = await service.prepareScenePatch(course.id, {
      sceneId: scene.id,
      expectedRevision: course.revision,
      intent: "缩短题干",
      operations: [{ op: "str_replace", path: "/content/questions/0/prompt", oldText: "课程内容的生成与展示", newText: "课程生成" }],
    });
    expect(prepared.quizQuestionsChanged).toBe(true);
    await service.commitPrepared(prepared);
    const savedScene = (await repository.get(course.id))?.scenes.find((item) => item.id === scene.id);
    expect(savedScene?.id).toBe(scene.id);
    expect(savedScene?.type === "quiz" && savedScene.content.questions[0].id).not.toBe(oldQuestionId);
  });

  it("只修改 quiz actions 不触发题目确认", async () => {
    const { course, service } = await setup();
    const scene = course.scenes.find((item) => item.type === "quiz");
    if (!scene) throw new Error("fixture");
    const prepared = await service.prepareScenePatch(course.id, {
      sceneId: scene.id,
      expectedRevision: course.revision,
      intent: "调整旁白",
      operations: [{ op: "set", path: "/actions/0/text", value: "请先阅读题干，再选择答案。" }],
    });
    expect(prepared.quizQuestionsChanged).toBe(false);
  });
});

