import { describe, expect, it } from "vitest";
import { CourseDeckService } from "@/lib/application/course-deck-service";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";

async function setup(count = 5) {
  const repository = new InMemoryCourseRepository();
  const course = materializeFixtureCourse(createFixtureCourse("页序工具测试", count));
  await repository.create(course);
  return { repository, course, service: new CourseDeckService(repository, () => course.updatedAt + 10) };
}

describe("CourseDeckService", () => {
  it("rename 同步目录和 Scene 标题但不修改画布文本", async () => {
    const { repository, course, service } = await setup();
    const scene = course.scenes[0];
    const oldCanvas = scene.type === "slide" ? scene.content.canvas.elements.find((element) => element.type === "text" && element.textType === "title") : undefined;
    const result = await service.rename(course.id, course.revision, scene.id, "新的目录标题");
    const saved = await repository.get(course.id);
    expect(result.changed).toBe(true);
    expect(saved?.outlines[0].title).toBe("新的目录标题");
    expect(saved?.scenes[0].title).toBe("新的目录标题");
    expect(saved?.scenes[0].type === "slide" && oldCanvas && saved.scenes[0].content.canvas.elements.some((element) => element.id === oldCanvas.id && element.type === "text" && element.content.includes(course.outlines[0].title))).toBe(true);
  });

  it("move 重排 outlines、scenes 和 progress，并保留稳定 ID", async () => {
    const { repository, course, service } = await setup();
    const moved = course.scenes[0];
    const result = await service.move(course.id, course.revision, moved.id, 4);
    const saved = await repository.get(course.id);
    expect(result.afterPosition).toBe(4);
    expect(saved?.outlines.map((item) => item.order)).toEqual([1, 2, 3, 4, 5]);
    expect(saved?.outlines[3].id).toBe(moved.outlineId);
    expect(saved?.scenes[3].id).toBe(moved.id);
    expect(saved?.sceneProgress.map((item) => item.outlineId)).toEqual(saved?.outlines.map((item) => item.id));
  });

  it("delete 先冻结确认，再按 sceneId 删除并重排", async () => {
    const { repository, course, service } = await setup();
    const target = course.scenes[0];
    const prepared = await service.prepareDelete(course.id, course.revision, target.id);
    expect(prepared.kind).toBe("delete");
    const result = await service.commitDelete(prepared);
    const saved = await repository.get(course.id);
    expect(result.removedSceneIds).toEqual([target.id]);
    expect(saved?.requestedSceneCount).toBe(4);
    expect(saved?.scenes.some((scene) => scene.id === target.id)).toBe(false);
    expect(saved?.outlines.map((item) => item.order)).toEqual([1, 2, 3, 4]);
  });

  it("移动到原位置和重命名原值不增长 revision", async () => {
    const { repository, course, service } = await setup();
    const scene = course.scenes[1];
    const moved = await service.move(course.id, course.revision, scene.id, scene.order);
    expect(moved.changed).toBe(false);
    const renamed = await service.rename(course.id, course.revision, scene.id, scene.title);
    expect(renamed.changed).toBe(false);
    expect((await repository.get(course.id))?.revision).toBe(course.revision);
  });
});
