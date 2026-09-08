import { describe, expect, it } from "vitest";
import { CourseAgentService } from "@/lib/agent/course-agent-service";
import type { AgentAdapter, AgentSseEvent } from "@/lib/agent/contracts";
import { MockAgentAdapter } from "@/lib/ai/mock-agent-adapter";
import { OpenAICompatibleAgentAdapter } from "@/lib/ai/openai-compatible-agent-adapter";
import type { ProviderConfig } from "@/lib/ai/config";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { InMemoryAgentSessionRepository } from "@/lib/repository/in-memory-agent-session-repository";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";

describe("Agent runtime", () => {
  it("拼接 DeepSeek 可见思考、正文和分片工具参数", async () => {
    const frames = [
      { choices: [{ delta: { reasoning_content: "先读取", tool_calls: [{ index: 0, id: "call-1", function: { name: "read_stage", arguments: "{\"path\":" } }] }, finish_reason: null }] },
      { choices: [{ delta: { content: "处理中", tool_calls: [{ index: 0, function: { arguments: "\"/outline\"}" } }] }, finish_reason: "tool_calls" }] },
    ].map((item) => `data: ${JSON.stringify(item)}\n\n`).join("");
    const fetcher = async () => new Response(frames, { status: 200, headers: { "content-type": "text/event-stream" } });
    const config: ProviderConfig = { mode: "remote", provider: "deepseek", apiKey: "test", baseUrl: "https://example.com", model: "deepseek-chat", timeoutMs: 120000, sceneTimeoutMs: 120000 };
    const events = [];
    for await (const event of new OpenAICompatibleAgentAdapter(config, fetcher as typeof fetch).streamTurn({
      requestId: "r", systemPrompt: "s", messages: [{ role: "user", content: "读课程" }], tools: [], signal: new AbortController().signal, maxOutputTokens: 100,
    })) events.push(event);
    expect(events).toContainEqual({ type: "reasoning_delta", text: "先读取" });
    expect(events).toContainEqual({ type: "text_delta", text: "处理中" });
    expect(events.filter((event) => event.type === "tool_call_delta").map((event) => event.type === "tool_call_delta" ? event.argumentsDelta : "").join("")).toBe('{"path":"/outline"}');
  });

  it("完成读工具循环并持久化可折叠内容块", async () => {
    const courses = new InMemoryCourseRepository();
    const course = materializeFixtureCourse(createFixtureCourse("只读 Agent", 4));
    await courses.create(course);
    const sessions = new InMemoryAgentSessionRepository();
    const session = await sessions.createSession(course.id, "测试会话");
    const adapter = new MockAgentAdapter([
      { reasoning: "需要读取目录", toolCalls: [{ id: "read-1", name: "list_scenes", arguments: {} }] },
      { text: "当前课程共有 4 个页面。" },
    ]);
    const events: AgentSseEvent[] = [];
    await new CourseAgentService(courses, sessions, adapter).run(course.id, session.id, { text: "有几页？", currentSceneId: course.scenes[0].id, courseRevision: course.revision }, new AbortController().signal, (event) => events.push(event));
    expect(events.some((event) => event.type === "tool_finished")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "run_finished", status: "completed" });
    const messages = await sessions.listMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[1].role === "assistant" && "blocks" in messages[1].content && messages[1].content.blocks.some((block) => block.type === "thinking")).toBe(true);
    expect((await courses.get(course.id))?.revision).toBe(course.revision);
  });

  it("为可见思考保留较大单轮输出预算，并明确报告长度截断", async () => {
    const courses = new InMemoryCourseRepository();
    const course = materializeFixtureCourse(createFixtureCourse("输出预算", 4));
    await courses.create(course);
    const sessions = new InMemoryAgentSessionRepository();
    const session = await sessions.createSession(course.id, "预算会话");
    let receivedBudget = 0;
    const adapter: AgentAdapter = {
      async *streamTurn(input) {
        receivedBudget = input.maxOutputTokens;
        yield { type: "reasoning_delta", text: "仍在分析页面" };
        yield { type: "finish", finishReason: "length" };
      },
    };
    const events: AgentSseEvent[] = [];

    await new CourseAgentService(courses, sessions, adapter).run(
      course.id,
      session.id,
      { text: "调整当前页", currentSceneId: course.scenes[0].id, courseRevision: course.revision },
      new AbortController().signal,
      (event) => events.push(event),
    );

    expect(receivedBudget).toBe(16_384);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", status: "failed", error: expect.stringContaining("长度上限") });
  });

  it("完成 read → patch → read，并只增长一次课程 revision", async () => {
    const courses = new InMemoryCourseRepository();
    const course = materializeFixtureCourse(createFixtureCourse("写入 Agent", 4));
    await courses.create(course);
    const sessions = new InMemoryAgentSessionRepository();
    const session = await sessions.createSession(course.id, "写入会话");
    const scene = course.scenes[0];
    const adapter = new MockAgentAdapter([
      { toolCalls: [{ name: "read_stage", arguments: { path: `/scenes/${scene.id}`, detail: "source" } }] },
      { toolCalls: [{ name: "patch_stage", arguments: { sceneId: scene.id, expectedRevision: course.revision, intent: "缩短旁白", operations: [{ op: "set", path: "/actions/0/text", value: "这是精简后的讲解。" }] } }] },
      { toolCalls: [{ name: "read_stage", arguments: { path: `/scenes/${scene.id}/actions`, detail: "source" } }] },
      { text: "已保存并重新读取旁白。" },
    ]);
    const events: AgentSseEvent[] = [];
    await new CourseAgentService(courses, sessions, adapter).run(course.id, session.id, { text: "缩短当前页旁白", currentSceneId: scene.id, courseRevision: course.revision }, new AbortController().signal, (event) => events.push(event));
    const saved = await courses.get(course.id);
    expect(saved?.revision).toBe(course.revision + 1);
    expect(saved?.scenes[0].actions[0]).toMatchObject({ text: "这是精简后的讲解。" });
    expect(events.filter((event) => event.type === "course_updated")).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "run_finished", status: "completed" });
  });

  it("quiz 写工具等待确认，确认后再保存并更新原工具块", async () => {
    const courses = new InMemoryCourseRepository();
    const course = materializeFixtureCourse(createFixtureCourse("确认 Agent", 4));
    await courses.create(course);
    const quiz = course.scenes.find((scene) => scene.type === "quiz");
    if (!quiz || quiz.type !== "quiz") throw new Error("fixture");
    const sessions = new InMemoryAgentSessionRepository();
    const session = await sessions.createSession(course.id, "确认会话");
    const adapter = new MockAgentAdapter([{ toolCalls: [{
      name: "patch_stage",
      arguments: { sceneId: quiz.id, expectedRevision: course.revision, intent: "缩短题干", operations: [{ op: "str_replace", path: "/content/questions/0/prompt", oldText: "课程内容的生成与展示", newText: "课程生成" }] },
    }] }]);
    const service = new CourseAgentService(courses, sessions, adapter);
    const events: AgentSseEvent[] = [];
    await service.run(course.id, session.id, { text: "缩短题干", currentSceneId: quiz.id, courseRevision: course.revision }, new AbortController().signal, (event) => events.push(event));
    const required = events.find((event) => event.type === "confirmation_required");
    expect(required?.type).toBe("confirmation_required");
    expect((await courses.get(course.id))?.revision).toBe(course.revision);
    if (!required || required.type !== "confirmation_required" || !required.block.confirmationId) throw new Error("confirmation missing");
    const confirmation = await service.confirm(course.id, session.id, required.block.confirmationId, "confirm");
    expect(confirmation.status).toBe("completed");
    expect((await courses.get(course.id))?.revision).toBe(course.revision + 1);
    const messages = await sessions.listMessages(session.id);
    const block = messages.flatMap((message) => "blocks" in message.content ? message.content.blocks : []).find((item) => item.type === "tool");
    expect(block?.status).toBe("completed");
  });
});
