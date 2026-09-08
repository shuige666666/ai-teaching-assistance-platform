import { describe, expect, it } from "vitest";
import { CourseAgentService } from "@/lib/agent/course-agent-service";
import type { AgentSseEvent } from "@/lib/agent/contracts";
import { MockAgentAdapter } from "@/lib/ai/mock-agent-adapter";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { InMemoryAgentSessionRepository } from "@/lib/repository/in-memory-agent-session-repository";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";

async function setup(count = 5) {
  const courses = new InMemoryCourseRepository();
  const course = materializeFixtureCourse(createFixtureCourse("M12.2 Agent", count));
  await courses.create(course);
  const sessions = new InMemoryAgentSessionRepository();
  const session = await sessions.createSession(course.id, "M12.2 测试");
  return { courses, course, sessions, session };
}

describe("M12.2 Agent tools", () => {
  it("通过 edit_deck 调整页序并返回课程更新事件", async () => {
    const { courses, course, sessions, session } = await setup();
    const target = course.scenes[0];
    const adapter = new MockAgentAdapter([
      { toolCalls: [{ name: "edit_deck", arguments: { operation: "move", sceneId: target.id, expectedRevision: course.revision, toPosition: 4 } }] },
      { text: "已调整页序。" },
    ]);
    const events: AgentSseEvent[] = [];
    await new CourseAgentService(courses, sessions, adapter, 300_000, Date.now, new MockAIAdapter(), 10_000).run(course.id, session.id, { text: "把第 1 页移动到第 4 页", currentSceneId: target.id, courseRevision: course.revision }, new AbortController().signal, (event) => events.push(event));
    const saved = await courses.get(course.id);
    expect(saved?.outlines[3].id).toBe(target.outlineId);
    expect(events.some((event) => event.type === "course_updated" && event.contentChanged === false)).toBe(true);
  });

  it("删除页先等待确认，确认后才提交", async () => {
    const { courses, course, sessions, session } = await setup();
    const target = course.scenes[0];
    const adapter = new MockAgentAdapter([{ toolCalls: [{ name: "edit_deck", arguments: { operation: "delete", sceneId: target.id, expectedRevision: course.revision } }] }]);
    const events: AgentSseEvent[] = [];
    const service = new CourseAgentService(courses, sessions, adapter, 300_000, Date.now, new MockAIAdapter(), 10_000);
    await service.run(course.id, session.id, { text: "删除第 1 页", currentSceneId: target.id, courseRevision: course.revision }, new AbortController().signal, (event) => events.push(event));
    const required = events.find((event) => event.type === "confirmation_required");
    expect(required?.type).toBe("confirmation_required");
    if (!required || required.type !== "confirmation_required" || !required.block.confirmationId) throw new Error("missing delete confirmation");
    expect((await courses.get(course.id))?.requestedSceneCount).toBe(5);
    await service.confirm(course.id, session.id, required.block.confirmationId, "confirm");
    expect((await courses.get(course.id))?.requestedSceneCount).toBe(4);
  });

  it("generate_scene add 使用真实场景生成链并插入新页", async () => {
    const { courses, course, sessions, session } = await setup(4);
    const source = course.outlines[1];
    const outline = structuredClone(source) as Record<string, unknown>;
    delete outline.id;
    delete outline.order;
    const adapter = new MockAgentAdapter([
      { toolCalls: [{ name: "generate_scene", arguments: { mode: "add", expectedRevision: course.revision, position: 2, outline, instruction: "补充一个实践示例" } }] },
      { text: "新页面已生成。" },
    ]);
    const events: AgentSseEvent[] = [];
    await new CourseAgentService(courses, sessions, adapter, 300_000, Date.now, new MockAIAdapter(), 10_000).run(course.id, session.id, { text: "新增一个实践页", currentSceneId: course.scenes[0].id, courseRevision: course.revision }, new AbortController().signal, (event) => events.push(event));
    const saved = await courses.get(course.id);
    expect(saved?.requestedSceneCount).toBe(5);
    expect(saved?.scenes).toHaveLength(5);
    expect(events.some((event) => event.type === "course_updated" && event.contentChanged === true)).toBe(true);
  });

  it("quiz 重生成确认通过 SSE 执行并替换旧 sceneId", async () => {
    const { courses, course, sessions, session } = await setup(5);
    const quiz = course.scenes.find((scene) => scene.type === "quiz");
    if (!quiz) throw new Error("fixture quiz missing");
    const adapter = new MockAgentAdapter([{ toolCalls: [{ name: "generate_scene", arguments: { mode: "regenerate", sceneId: quiz.id, expectedRevision: course.revision, instruction: "重新组织题目" } }] }]);
    const service = new CourseAgentService(courses, sessions, adapter, 300_000, Date.now, new MockAIAdapter(), 10_000);
    const events: AgentSseEvent[] = [];
    await service.run(course.id, session.id, { text: "重新生成当前测验", currentSceneId: quiz.id, courseRevision: course.revision }, new AbortController().signal, (event) => events.push(event));
    const required = events.find((event) => event.type === "confirmation_required");
    if (!required || required.type !== "confirmation_required" || !required.block.confirmationId) throw new Error("missing quiz confirmation");
    const streamEvents: AgentSseEvent[] = [];
    await service.confirmStream(course.id, session.id, required.block.confirmationId, new AbortController().signal, (event) => streamEvents.push(event));
    const saved = await courses.get(course.id);
    const replacement = saved?.scenes.find((scene) => scene.outlineId === quiz.outlineId);
    expect(replacement?.id).not.toBe(quiz.id);
    expect(streamEvents.at(-1)).toMatchObject({ type: "run_finished", status: "completed" });
  });
});
