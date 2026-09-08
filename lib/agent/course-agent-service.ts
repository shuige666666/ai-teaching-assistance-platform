import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CourseRepository } from "@/lib/repository/course-repository";
import { CourseConflictError } from "@/lib/repository/course-repository";
import type { AgentSessionRepository } from "@/lib/repository/agent-session-repository";
import type { AgentAdapter, AgentContentBlock, AgentSseEvent, AgentToolBlock } from "./contracts";
import { AgentApplicationError } from "./contracts";
import { buildAgentModelHistory } from "./context-builder";
import { buildCourseAgentSystemPrompt } from "./system-prompt";
import { CourseAgentToolRegistry } from "./tool-registry";
import { CoursePatchService, type PreparedCoursePatch } from "@/lib/application/course-patch-service";

type Emit = (event: AgentSseEvent) => void;
type AccumulatedCall = { id: string; name: string; arguments: string };

function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof CourseConflictError) return { code: "COURSE_CONFLICT", message: "课堂已被其他操作更新，请重新读取后再试" };
  if (error instanceof AgentApplicationError) return { code: error.code, message: error.message };
  if (error instanceof z.ZodError) return { code: "INVALID_ARGUMENT", message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；") };
  return { code: "TOOL_EXECUTION_FAILED", message: error instanceof Error ? error.message : "工具执行失败" };
}

export class CourseAgentService {
  private readonly tools: CourseAgentToolRegistry;
  constructor(
    private readonly courses: CourseRepository,
    private readonly sessions: AgentSessionRepository,
    private readonly adapter: AgentAdapter,
    private readonly timeoutMs = 300_000,
    private readonly now: () => number = Date.now,
  ) { this.tools = new CourseAgentToolRegistry(courses); }

  /** 执行一轮有界模型/工具循环，并把可恢复的内容块同时写入会话。 */
  async run(courseId: string, sessionId: string, input: { text: string; currentSceneId?: string; courseRevision: number }, requestSignal: AbortSignal, emit: Emit) {
    const session = await this.sessions.getSession(courseId, sessionId);
    if (!session) throw new AgentApplicationError("NOT_FOUND", "对话会话不存在或不属于当前课程", 404);
    const course = await this.courses.get(courseId);
    if (!course) throw new AgentApplicationError("NOT_FOUND", "课程不存在", 404);
    const startedAt = this.now();
    const deadlineAt = startedAt + this.timeoutMs;
    const run = await this.sessions.startRun(sessionId, course.revision, deadlineAt);
    emit({ type: "run_started", runId: run.id, sessionId });
    await this.sessions.appendMessage(sessionId, { sessionId, runId: run.id, role: "user", content: input });
    const history = buildAgentModelHistory(await this.sessions.listMessages(sessionId));
    const blocks: AgentContentBlock[] = [];
    const controller = new AbortController();
    const cancel = () => controller.abort(requestSignal.reason);
    requestSignal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Agent run timeout")), this.timeoutMs);
    let currentRevision = course.revision;
    try {
      for (let modelTurn = 0, toolCount = 0; modelTurn < 20; modelTurn += 1) {
        const calls = new Map<number, AccumulatedCall>();
        let reasoning = "", answer = "";
        let finishReason: string | undefined;
        let thinkingId: string | undefined, textId: string | undefined, thinkingStartedAt = 0;
        for await (const event of this.adapter.streamTurn({
          requestId: run.id,
          systemPrompt: buildCourseAgentSystemPrompt({ courseTitle: course.title, courseRevision: currentRevision, currentSceneId: input.currentSceneId }),
          messages: history,
          tools: this.tools.definitions(),
          signal: controller.signal,
          // 可见思考、正文和工具参数共享这一预算；不单独限制思考长度。
          maxOutputTokens: 16_384,
        })) {
          if (event.type === "reasoning_delta") {
            if (!thinkingId) { thinkingId = randomUUID(); thinkingStartedAt = this.now(); emit({ type: "thinking_started", blockId: thinkingId }); }
            reasoning += event.text; emit({ type: "thinking_delta", blockId: thinkingId, delta: event.text });
          } else if (event.type === "text_delta") {
            if (!textId) { textId = randomUUID(); emit({ type: "text_started", blockId: textId }); }
            answer += event.text; emit({ type: "text_delta", blockId: textId, delta: event.text });
          } else if (event.type === "tool_call_delta") {
            const current = calls.get(event.index) ?? { id: event.id ?? "", name: event.name ?? "", arguments: "" };
            calls.set(event.index, { id: event.id ?? current.id, name: event.name ?? current.name, arguments: current.arguments + (event.argumentsDelta ?? "") });
          } else if (event.type === "finish" && event.finishReason) finishReason = event.finishReason;
        }
        if (thinkingId) {
          const durationMs = Math.max(0, this.now() - thinkingStartedAt);
          blocks.push({ type: "thinking", id: thinkingId, text: reasoning, durationMs, modelTurn });
          emit({ type: "thinking_finished", blockId: thinkingId, durationMs });
        }
        if (textId) { blocks.push({ type: "text", id: textId, text: answer, modelTurn }); emit({ type: "text_finished", blockId: textId }); }
        const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => ({ ...call, id: call.id || randomUUID() }));
        if (toolCalls.length === 0) {
          if (!answer.trim()) {
            const message = finishReason === "length"
              ? "模型本轮输出达到长度上限，思考结束前尚未形成正文或工具调用，请重试"
              : "模型没有返回正文或工具调用";
            throw new AgentApplicationError("TOOL_EXECUTION_FAILED", message);
          }
          await this.sessions.appendMessage(sessionId, { sessionId, runId: run.id, role: "assistant", content: { blocks } });
          await this.sessions.finishRun(run.id, "completed", currentRevision);
          emit({ type: "run_finished", status: "completed" });
          return;
        }
        if (toolCount + toolCalls.length > 32) throw new AgentApplicationError("TOOL_EXECUTION_FAILED", "本轮工具调用次数已达到上限");
        history.push({ role: "assistant", content: answer || null, toolCalls: toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })) });
        for (let index = 0; index < toolCalls.length; index += 1) {
          toolCount += 1;
          const call = toolCalls[index];
          const started = this.now();
          let args: unknown = {};
          try { args = JSON.parse(call.arguments || "{}"); } catch { args = { invalidJson: call.arguments }; }
          const block: AgentToolBlock = { type: "tool", id: randomUUID(), modelTurn, callId: call.id || randomUUID(), name: call.name, label: this.tools.label(call.name), status: "running", arguments: args, targetSceneId: typeof args === "object" && args !== null && "sceneId" in args ? String((args as { sceneId: unknown }).sceneId) : undefined };
          blocks.push(block); emit({ type: "tool_started", block: structuredClone(block) });
          try {
            if (!call.name) throw new AgentApplicationError("INVALID_ARGUMENT", "模型返回了不完整的工具调用");
            if (typeof args === "object" && args !== null && "invalidJson" in args) throw new AgentApplicationError("INVALID_ARGUMENT", "工具参数不是合法 JSON");
            const outcome = await this.tools.execute(call.name, courseId, args);
            if (outcome.kind === "confirmation") {
              const confirmation = await this.sessions.createConfirmation({ sessionId, runId: run.id, callId: block.callId, toolName: call.name, baseRevision: outcome.prepared.baseRevision, payload: outcome.prepared, summary: outcome.summary, expiresAt: this.now() + 30 * 60_000 });
              Object.assign(block, { status: "waiting_confirmation", confirmationId: confirmation.id, result: { status: "waiting_confirmation", confirmationId: confirmation.id, summary: outcome.summary }, durationMs: this.now() - started });
              emit({ type: "confirmation_required", block: structuredClone(block), summary: outcome.summary });
              for (const remaining of toolCalls.slice(index + 1)) {
                const skipped: AgentToolBlock = { type: "tool", id: randomUUID(), modelTurn, callId: remaining.id || randomUUID(), name: remaining.name, label: this.tools.label(remaining.name), status: "not_executed", arguments: remaining.arguments, result: { reason: "同批前序工具等待用户确认" } };
                blocks.push(skipped); emit({ type: "tool_finished", block: structuredClone(skipped) });
              }
              await this.sessions.appendMessage(sessionId, { sessionId, runId: run.id, role: "assistant", content: { blocks } });
              await this.sessions.finishRun(run.id, "waiting_confirmation", currentRevision);
              emit({ type: "run_finished", status: "waiting_confirmation" });
              return;
            }
            Object.assign(block, { status: "completed", result: outcome.result, durationMs: this.now() - started });
            emit({ type: "tool_finished", block: structuredClone(block) });
            if (outcome.courseUpdate) { currentRevision = outcome.courseUpdate.revision; emit({ type: "course_updated", revision: currentRevision, affectedSceneIds: outcome.courseUpdate.affectedSceneIds }); }
          } catch (error) {
            const detail = safeError(error);
            Object.assign(block, { status: "failed", result: detail, durationMs: this.now() - started });
            emit({ type: "tool_finished", block: structuredClone(block) });
          }
          history.push({ role: "tool", toolCallId: block.callId, content: JSON.stringify({ status: block.status, result: block.result }) });
        }
      }
      throw new AgentApplicationError("TOOL_EXECUTION_FAILED", "本轮模型调用次数已达到上限");
    } catch (error) {
      if (blocks.length) await this.sessions.appendMessage(sessionId, { sessionId, runId: run.id, role: "assistant", content: { blocks } });
      const cancelled = controller.signal.aborted;
      const detail = safeError(error);
      await this.sessions.finishRun(run.id, cancelled ? "cancelled" : "failed", currentRevision, detail.message);
      emit({ type: "run_finished", status: cancelled ? "cancelled" : "failed", error: detail.message });
    } finally {
      clearTimeout(timer); requestSignal.removeEventListener("abort", cancel);
    }
  }

  /** 处理 quiz 二次确认；原工具卡在数据库中原位更新，首版不自动续跑模型。 */
  async confirm(courseId: string, sessionId: string, confirmationId: string, decision: "confirm" | "cancel") {
    const session = await this.sessions.getSession(courseId, sessionId);
    if (!session) throw new AgentApplicationError("NOT_FOUND", "对话会话不存在或不属于当前课程", 404);
    const confirmation = await this.sessions.getConfirmation(sessionId, confirmationId);
    if (!confirmation) throw new AgentApplicationError("NOT_FOUND", "确认记录不存在", 404);
    if (confirmation.status !== "pending") return confirmation;
    const messages = await this.sessions.listMessages(sessionId);
    const assistant = messages.find((message) => message.role === "assistant" && "blocks" in message.content && message.content.blocks.some((block) => block.type === "tool" && block.callId === confirmation.callId));
    if (!assistant || !("blocks" in assistant.content)) throw new AgentApplicationError("NOT_FOUND", "找不到原工具记录", 404);
    const block = assistant.content.blocks.find((item): item is AgentToolBlock => item.type === "tool" && item.callId === confirmation.callId)!;
    if (decision === "cancel") {
      const result = { status: "cancelled", message: "用户取消了测验修改，课程未变化" };
      Object.assign(block, { status: "cancelled", result });
      const resolved = await this.sessions.resolveConfirmation(confirmation.id, "cancelled", result);
      await this.sessions.replaceAssistantBlocks(sessionId, confirmation.callId, assistant.content.blocks);
      return resolved;
    }
    if (confirmation.expiresAt <= this.now()) {
      const result = { status: "expired", message: "确认已过期，请重新读取课堂后再修改" };
      Object.assign(block, { status: "failed", result });
      const resolved = await this.sessions.resolveConfirmation(confirmation.id, "expired", result);
      await this.sessions.replaceAssistantBlocks(sessionId, confirmation.callId, assistant.content.blocks);
      return resolved;
    }
    const prepared = confirmation.payload as PreparedCoursePatch;
    if (prepared.courseId !== courseId || prepared.baseRevision !== confirmation.baseRevision) throw new AgentApplicationError("INVALID_ARGUMENT", "确认记录与当前课程不匹配");
    const result = await new CoursePatchService(this.courses).commitPrepared(prepared);
    Object.assign(block, { status: "completed", result });
    const resolved = await this.sessions.resolveConfirmation(confirmation.id, "completed", result);
    await this.sessions.replaceAssistantBlocks(sessionId, confirmation.callId, assistant.content.blocks);
    return resolved;
  }
}
