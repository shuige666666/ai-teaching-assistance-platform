import { describe, expect, it } from "vitest";
import { CourseAgentQueryService } from "@/lib/application/course-agent-query-service";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";

async function setup() {
  const repository = new InMemoryCourseRepository();
  const course = materializeFixtureCourse(createFixtureCourse("Agent 工具测试", 4));
  await repository.create(course);
  return { repository, course };
}

describe("CourseAgentQueryService", () => {
  it("列出稳定页面身份且不修改 revision", async () => {
    const { repository, course } = await setup();
    const result = await new CourseAgentQueryService(repository).listScenes(course.id);
    expect(result.courseRevision).toBe(course.revision);
    expect(result.scenes).toHaveLength(4);
    expect(result.scenes[0]).toMatchObject({ sceneId: course.scenes[0].id, order: 1, type: "slide" });
    expect((await repository.get(course.id))?.revision).toBe(course.revision);
  });

  it("source 分页并为当前类型返回结构说明", async () => {
    const { repository, course } = await setup();
    const result = await new CourseAgentQueryService(repository).readStage(course.id, { path: `/scenes/${course.scenes[0].id}`, detail: "source", offset: 0 });
    expect(result).toMatchObject({ sceneId: course.scenes[0].id, offset: 0 });
    expect("content" in result && result.content).toContain('"canvas"');
    expect("structureGuide" in result && result.structureGuide).toContain("add_element");
  });

  it("在可见文本中做有界字面量搜索", async () => {
    const { repository, course } = await setup();
    const result = await new CourseAgentQueryService(repository).grepStage(course.id, "核心关系");
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].sceneId).toBe(course.scenes[0].id);
  });
});

