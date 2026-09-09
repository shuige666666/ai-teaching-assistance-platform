import { describe, expect, it } from "vitest";
import { buildAgentModelContext } from "@/lib/agent/context-builder";
import type { AgentMessage } from "@/lib/agent/contracts";
import { CourseAgentService } from "@/lib/agent/course-agent-service";
import { MockAgentAdapter } from "@/lib/ai/mock-agent-adapter";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { InMemoryAgentSessionRepository } from "@/lib/repository/in-memory-agent-session-repository";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";

function userMessage(sessionId: string, sequence: number, text: string): AgentMessage {
  return { id: `u-${sequence}`, sessionId, sequence, role: "user", content: { text, courseRevision: 1 }, createdAt: sequence };
}

describe("M12.3 会话体验与轻量上下文", () => {
  it("按完整用户轮次裁剪，不留下孤立 tool result", () => {
    const messages: AgentMessage[] = [
      userMessage("s", 1, "第一轮"),
      { id: "a-1", sessionId: "s", sequence: 2, role: "assistant", content: { blocks: [{ type: "tool", id: "b-1", modelTurn: 0, callId: "c-1", name: "read_stage", label: "读取课堂", status: "completed", arguments: { path: "/outline" }, result: { title: "旧课程" } }] }, createdAt: 2 },
      userMessage("s", 3, "第二轮"),
      { id: "a-2", sessionId: "s", sequence: 4, role: "assistant", content: { blocks: [{ type: "text", id: "b-2", modelTurn: 0, text: "已完成" }] }, createdAt: 4 },
    ];

    const context = buildAgentModelContext(messages, { maxTurns: 1, maxCharacters: 100 });
    expect(context.info.omittedMessageCount).toBe(1);
    expect(context.messages[0]).toEqual({ role: "user", content: "第二轮" });
    expect(context.messages.some((message) => message.role === "tool")).toBe(false);
  });

  it("保留旧 not_executed 工具的原始 JSON 参数，不做二次字符串编码", () => {
    const messages: AgentMessage[] = [
      userMessage("s", 1, "检查后修改"),
      { id: "a-raw", sessionId: "s", sequence: 2, role: "assistant", content: { blocks: [{
        type: "tool", id: "b-raw", modelTurn: 0, callId: "c-raw", name: "patch_stage", label: "编辑课堂",
        status: "not_executed", arguments: '{"sceneId":"scene-1"}', result: { reason: "前序工具等待确认" },
      }] }, createdAt: 2 },
    ];

    const assistant = buildAgentModelContext(messages).messages.find((message) => message.role === "assistant");
    expect(assistant?.role === "assistant" && assistant.toolCalls?.[0].arguments).toBe('{"sceneId":"scene-1"}');
  });

  it("刷新时把过期运行标记为中断，并保存本轮轻量指标", async () => {
    const courses = new InMemoryCourseRepository();
    const course = materializeFixtureCourse(createFixtureCourse("M12.3 指标", 4));
    await courses.create(course);
    const clock = { value: 200 };
    const sessions = new InMemoryAgentSessionRepository(() => clock.value);
    const session = await sessions.createSession(course.id, "指标会话");
    const run = await sessions.startRun(session.id, course.revision, 100);
    await sessions.recoverExpiredRuns(session.id, 200);
    expect((await sessions.getLatestRun(session.id))?.status).toBe("interrupted");
    expect((await sessions.getSession(course.id, session.id))?.status).toBe("idle");

    clock.value = 201;
    const service = new CourseAgentService(courses, sessions, new MockAgentAdapter([
      { toolCalls: [{ name: "list_scenes", arguments: {} }] },
      { text: "共有 4 页。" },
    ]));
    await service.run(course.id, session.id, { text: "有几页？", courseRevision: course.revision }, new AbortController().signal, () => undefined);
    const latest = await sessions.getLatestRun(session.id);
    expect(latest?.id).not.toBe(run.id);
    expect(latest?.metrics).toMatchObject({ modelCalls: 2, toolCalls: 1, toolCompleted: 1, toolFailed: 0 });
    expect(latest?.metrics?.totalDurationMs).toBeDefined();
  });
});
