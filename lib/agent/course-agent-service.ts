import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CourseRepository } from "@/lib/repository/course-repository";
import { CourseConflictError } from "@/lib/repository/course-repository";
import type { AgentSessionRepository } from "@/lib/repository/agent-session-repository";
import type { AgentAdapter, AgentContentBlock, AgentRun, AgentRunMetrics, AgentSseEvent, AgentToolBlock } from "./contracts";
import { AgentApplicationError } from "./contracts";
import { buildAgentModelContext } from "./context-builder";
import { firstUserMessageText, isDefaultAgentSessionTitle, summarizeAgentSessionTitle } from "./session-title";
import { buildCourseAgentSystemPrompt } from "./system-prompt";
import { CourseAgentToolRegistry, type AgentConfirmationPayload, type PreparedQuizRegeneration } from "./tool-registry";
import { CourseDeckService } from "@/lib/application/course-deck-service";
import { CoursePatchService } from "@/lib/application/course-patch-service";
import { SceneGenerationService } from "@/lib/application/scene-generation-service";
import type { AIAdapter } from "@/lib/ai/contracts";

type Emit = (event: AgentSseEvent) => void;
type AccumulatedCall = { id: string; name: string; arguments: string };

function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof CourseConflictError) return { code: "COURSE_CONFLICT", message: "课堂已被其他操作更新，请重新读取后再试" };
  if (error instanceof AgentApplicationError) return { code: error.code, message: error.message };
  if (error instanceof z.ZodError) return { code: "INVALID_ARGUMENT", message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；") };
  return { code: "TOOL_EXECUTION_FAILED", message: error instanceof Error ? error.message : "工具执行失败" };
}

function resultRevision(result: unknown) {
  return typeof result === "object" && result !== null && "afterRevision" in result && typeof result.afterRevision === "number" ? result.afterRevision : undefined;
}

export class CourseAgentService {
  private readonly tools: CourseAgentToolRegistry;
  private readonly generationAdapter?: AIAdapter;
  private readonly sceneTimeoutMs: number;
  constructor(
    private readonly courses: CourseRepository,
    private readonly sessions: AgentSessionRepository,
    private readonly adapter: AgentAdapter,
    private readonly timeoutMs = 300_000,
    private readonly now: () => number = Date.now,
    generationAdapter?: AIAdapter,
    sceneTimeoutMs = 120_000,
  ) {
    this.generationAdapter = generationAdapter;
    this.sceneTimeoutMs = sceneTimeoutMs;
    this.tools = new CourseAgentToolRegistry(courses, generationAdapter, sceneTimeoutMs);
  }

  /** 执行一轮有界模型/工具循环，并把可恢复的内容块同时写入会话。 */
  async run(courseId: string, sessionId: string, input: { text: string; currentSceneId?: string; courseRevision: number }, requestSignal: AbortSignal, emit: Emit) {
    const session = await this.sessions.getSession(courseId, sessionId);
    if (!session) throw new AgentApplicationError("NOT_FOUND", "对话会话不存在或不属于当前课程", 404);
    const course = await this.courses.get(courseId);
    if (!course) throw new AgentApplicationError("NOT_FOUND", "课程不存在", 404);
    const startedAt = this.now();
    const deadlineAt = startedAt + this.timeoutMs;
    const run = await this.sessions.startRun(sessionId, course.revision, deadlineAt);
    const metrics: AgentRunMetrics = { modelCalls: 0, toolCalls: 0, toolCompleted: 0, toolFailed: 0, toolWaitingConfirmation: 0, toolCancelled: 0 };
    const finishWithMetrics = (status: Parameters<AgentSessionRepository["finishRun"]>[1], finalRevision?: number, error?: string) => this.sessions.finishRun(run.id, status, finalRevision, error, { ...metrics, totalDurationMs: Math.max(0, this.now() - startedAt) });
    emit({ type: "run_started", runId: run.id, sessionId });
    const previousMessages = await this.sessions.listMessages(sessionId);
    await this.sessions.appendMessage(sessionId, { sessionId, runId: run.id, role: "user", content: input });
    // 首条消息到达后自动生成短标题；已有手动标题和后续消息不再被覆盖。
    if (!firstUserMessageText(previousMessages) && isDefaultAgentSessionTitle(session.title, course.title)) {
      try {
        await this.sessions.renameSession(courseId, sessionId, summarizeAgentSessionTitle(input.text));
      } catch {
        // 标题只是会话导航信息，命名失败不能影响本轮课程修订。
      }
    }
    const history = buildAgentModelContext(await this.sessions.listMessages(sessionId)).messages;
    const blocks: AgentContentBlock[] = [];
    const controller = new AbortController();
    const cancel = () => controller.abort(requestSignal.reason);
    requestSignal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Agent run timeout")), this.timeoutMs);
    let currentRevision = course.revision;
    try {
      for (let modelTurn = 0, toolCount = 0; modelTurn < 20; modelTurn += 1) {
        metrics.modelCalls += 1;
        const calls = new Map<number, AccumulatedCall>();
        let reasoning = "", answer = "";
        let finishReason: string | undefined;
        let turnUsage: { inputTokens?: number; outputTokens?: number } | undefined;
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
          } else if (event.type === "finish") {
            if (event.finishReason) finishReason = event.finishReason;
            if (event.usage) turnUsage = event.usage;
          }
        }
        if (turnUsage?.inputTokens !== undefined) metrics.inputTokens = (metrics.inputTokens ?? 0) + turnUsage.inputTokens;
        if (turnUsage?.outputTokens !== undefined) metrics.outputTokens = (metrics.outputTokens ?? 0) + turnUsage.outputTokens;
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
          await finishWithMetrics("completed", currentRevision);
          emit({ type: "run_finished", status: "completed" });
          return;
        }
        if (toolCount + toolCalls.length > 32) throw new AgentApplicationError("TOOL_EXECUTION_FAILED", "本轮工具调用次数已达到上限");
        history.push({ role: "assistant", content: answer || null, toolCalls: toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })) });
        for (let index = 0; index < toolCalls.length; index += 1) {
          toolCount += 1;
          metrics.toolCalls += 1;
          const call = toolCalls[index];
          const started = this.now();
          let args: unknown = {};
          try { args = JSON.parse(call.arguments || "{}"); } catch { args = { invalidJson: call.arguments }; }
          const block: AgentToolBlock = { type: "tool", id: randomUUID(), modelTurn, callId: call.id || randomUUID(), name: call.name, label: this.tools.label(call.name), status: "running", arguments: args, targetSceneId: typeof args === "object" && args !== null && "sceneId" in args ? String((args as { sceneId: unknown }).sceneId) : undefined };
          blocks.push(block); emit({ type: "tool_started", block: structuredClone(block) });
          try {
            if (!call.name) throw new AgentApplicationError("INVALID_ARGUMENT", "模型返回了不完整的工具调用");
            if (typeof args === "object" && args !== null && "invalidJson" in args) throw new AgentApplicationError("INVALID_ARGUMENT", "工具参数不是合法 JSON");
            const outcome = await this.tools.execute(call.name, courseId, args, { signal: controller.signal, runId: run.id, deadlineAt });
            if (outcome.kind === "confirmation") {
              const confirmation = await this.sessions.createConfirmation({ sessionId, runId: run.id, callId: block.callId, toolName: call.name, baseRevision: outcome.payload.baseRevision, payload: outcome.payload, summary: outcome.summary, expiresAt: this.now() + 30 * 60_000 });
              Object.assign(block, { status: "waiting_confirmation", confirmationId: confirmation.id, confirmationKind: outcome.confirmationKind, result: { status: "waiting_confirmation", confirmationId: confirmation.id, summary: outcome.summary, kind: outcome.confirmationKind }, durationMs: this.now() - started });
              metrics.toolWaitingConfirmation += 1;
              emit({ type: "confirmation_required", block: structuredClone(block), summary: outcome.summary });
              for (const remaining of toolCalls.slice(index + 1)) {
                const skipped: AgentToolBlock = { type: "tool", id: randomUUID(), modelTurn, callId: remaining.id || randomUUID(), name: remaining.name, label: this.tools.label(remaining.name), status: "not_executed", arguments: remaining.arguments, result: { reason: "同批前序工具等待用户确认" } };
                blocks.push(skipped); emit({ type: "tool_finished", block: structuredClone(skipped) });
              }
              await this.sessions.appendMessage(sessionId, { sessionId, runId: run.id, role: "assistant", content: { blocks } });
              await finishWithMetrics("waiting_confirmation", currentRevision);
              emit({ type: "run_finished", status: "waiting_confirmation" });
              return;
            }
            Object.assign(block, { status: "completed", result: outcome.result, durationMs: this.now() - started });
            metrics.toolCompleted += 1;
            emit({ type: "tool_finished", block: structuredClone(block) });
            if (outcome.courseUpdate) { currentRevision = outcome.courseUpdate.revision; emit({ type: "course_updated", ...outcome.courseUpdate }); }
          } catch (error) {
            const detail = safeError(error);
            // 生成租约失败清理也可能推进 revision；把实际版本回传给下一轮模型。
            const latest = await this.courses.get(courseId);
            if (latest && latest.revision !== currentRevision) {
              currentRevision = latest.revision;
              emit({ type: "course_updated", revision: currentRevision, affectedSceneIds: [], contentChanged: false });
            }
            Object.assign(block, { status: "failed", result: { ...detail, revision: latest?.revision }, durationMs: this.now() - started });
            metrics.toolFailed += 1;
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
      if (cancelled) metrics.toolCancelled += 1;
      await finishWithMetrics(cancelled ? "cancelled" : "failed", currentRevision, detail.message);
      emit({ type: "run_finished", status: cancelled ? "cancelled" : "failed", error: detail.message });
    } finally {
      clearTimeout(timer); requestSignal.removeEventListener("abort", cancel);
    }
  }

  /** 查找待确认工具卡；确认只更新原卡，不伪造新的用户消息。 */
  private async confirmationContext(courseId: string, sessionId: string, confirmationId: string) {
    const session = await this.sessions.getSession(courseId, sessionId);
    if (!session) throw new AgentApplicationError("NOT_FOUND", "对话会话不存在或不属于当前课程", 404);
    const confirmation = await this.sessions.getConfirmation(sessionId, confirmationId);
    if (!confirmation) throw new AgentApplicationError("NOT_FOUND", "确认记录不存在", 404);
    const messages = await this.sessions.listMessages(sessionId);
    const assistant = messages.find((message) => message.role === "assistant" && "blocks" in message.content && message.content.blocks.some((block) => block.type === "tool" && block.callId === confirmation.callId));
    if (!assistant || !("blocks" in assistant.content)) throw new AgentApplicationError("NOT_FOUND", "找不到原工具记录", 404);
    const block = assistant.content.blocks.find((item): item is AgentToolBlock => item.type === "tool" && item.callId === confirmation.callId);
    if (!block) throw new AgentApplicationError("NOT_FOUND", "找不到原工具记录", 404);
    return { confirmation, assistant: { ...assistant, content: assistant.content as { blocks: AgentContentBlock[] } }, block };
  }

  /** 收尾等待确认的原始 run，避免确认处理后历史一直停在 waiting_confirmation。 */
  private async finishRunSnapshot(run: AgentRun | null, status: Exclude<AgentRun["status"], "running">, finalRevision?: number, error?: string, metricKey?: "toolCompleted" | "toolFailed" | "toolCancelled") {
    if (!run) return;
    const metrics = run.metrics
      ? { ...run.metrics, ...(metricKey ? { [metricKey]: run.metrics[metricKey] + 1 } : {}) }
      : undefined;
    await this.sessions.finishRun(run.id, status, finalRevision, error, metrics);
  }

  private async finishConfirmationRun(confirmation: { sessionId: string; runId: string }, status: Exclude<AgentRun["status"], "running">, finalRevision?: number, error?: string, metricKey?: "toolCompleted" | "toolFailed" | "toolCancelled") {
    const run = await this.sessions.getLatestRun(confirmation.sessionId);
    if (!run || run.id !== confirmation.runId) return;
    await this.finishRunSnapshot(run, status, finalRevision, error, metricKey);
  }

  /** 处理删除和 quiz/补丁的短确认；长生成由 confirmStream 单独执行。 */
  async confirm(courseId: string, sessionId: string, confirmationId: string, decision: "confirm" | "cancel") {
    const { confirmation, assistant, block } = await this.confirmationContext(courseId, sessionId, confirmationId);
    if (confirmation.status !== "pending") return confirmation;
    const payload = confirmation.payload as AgentConfirmationPayload;
    if (decision === "cancel") {
      const message = payload.kind === "delete" ? "用户取消了页面删除，课程未变化" : payload.kind === "regenerate_quiz" ? "用户取消了测验重生成，课程未变化" : "用户取消了测验修改，课程未变化";
      const result = { status: "cancelled", message };
      Object.assign(block, { status: "cancelled", result });
      const resolved = await this.sessions.resolveConfirmation(confirmation.id, "cancelled", result);
      await this.sessions.replaceAssistantBlocks(sessionId, confirmation.callId, assistant.content.blocks);
      await this.finishConfirmationRun(confirmation, "cancelled", undefined, message, "toolCancelled");
      return resolved;
    }
    if (confirmation.expiresAt <= this.now()) {
      const result = { status: "expired", message: "确认已过期，请重新读取课堂后再修改" };
      Object.assign(block, { status: "failed", result });
      const resolved = await this.sessions.resolveConfirmation(confirmation.id, "expired", result);
      await this.sessions.replaceAssistantBlocks(sessionId, confirmation.callId, assistant.content.blocks);
      await this.finishConfirmationRun(confirmation, "failed", undefined, result.message, "toolFailed");
      return resolved;
    }
    if (payload.kind === "regenerate_quiz") throw new AgentApplicationError("CONFIRMATION_REQUIRED", "测验整页重生成需要使用流式确认请求");
    if (payload.courseId !== courseId || payload.baseRevision !== confirmation.baseRevision) throw new AgentApplicationError("INVALID_ARGUMENT", "确认记录与当前课程不匹配");
    try {
      const result = payload.kind === "patch"
        ? await new CoursePatchService(this.courses).commitPrepared(payload)
        : await new CourseDeckService(this.courses).commitDelete(payload);
      Object.assign(block, { status: "completed", result });
      const resolved = await this.sessions.resolveConfirmation(confirmation.id, "completed", result);
      await this.sessions.replaceAssistantBlocks(sessionId, confirmation.callId, assistant.content.blocks);
      await this.finishConfirmationRun(confirmation, "completed", resultRevision(result), undefined, "toolCompleted");
      return resolved;
    } catch (error) {
      const detail = safeError(error);
      const result = { status: "failed", ...detail };
      Object.assign(block, { status: "failed", result });
      await this.sessions.resolveConfirmation(confirmation.id, "failed", result);
      await this.sessions.replaceAssistantBlocks(sessionId, confirmation.callId, assistant.content.blocks);
      await this.finishConfirmationRun(confirmation, "failed", undefined, detail.message, "toolFailed");
      throw error;
    }
  }

  /** 运行 quiz 长确认；只更新原工具卡并通过 SSE 反馈真实生成阶段。 */
  async confirmStream(courseId: string, sessionId: string, confirmationId: string, requestSignal: AbortSignal, emit: Emit) {
    const { confirmation, assistant, block } = await this.confirmationContext(courseId, sessionId, confirmationId);
    if (confirmation.status !== "pending") {
      emit({ type: "run_finished", status: confirmation.status === "completed" ? "completed" : confirmation.status === "cancelled" ? "cancelled" : "failed" });
      return;
    }
    if (confirmation.expiresAt <= this.now()) {
      await this.confirm(courseId, sessionId, confirmationId, "confirm");
      emit({ type: "run_finished", status: "failed", error: "确认已过期" });
      return;
    }
    const payload = confirmation.payload as PreparedQuizRegeneration;
    if (payload.kind !== "regenerate_quiz" || payload.courseId !== courseId || payload.baseRevision !== confirmation.baseRevision) throw new AgentApplicationError("INVALID_ARGUMENT", "确认记录与当前课程不匹配");
    if (!this.generationAdapter) throw new AgentApplicationError("TOOL_EXECUTION_FAILED", "当前环境未配置场景生成模型");
    const course = await this.courses.get(courseId);
    if (!course) throw new AgentApplicationError("NOT_FOUND", "课程不存在", 404);
    const waitingRun = await this.sessions.getLatestRun(sessionId);
    const run = await this.sessions.startRun(sessionId, course.revision, this.now() + this.timeoutMs);
    const controller = new AbortController();
    const cancel = () => controller.abort(requestSignal.reason);
    requestSignal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Agent run timeout")), this.timeoutMs);
    const started = this.now();
    const metrics: AgentRunMetrics = { modelCalls: 0, toolCalls: 1, toolCompleted: 0, toolFailed: 0, toolWaitingConfirmation: 0, toolCancelled: 0 };
    Object.assign(block, { status: "running", result: { status: "running", confirmationId } });
    await this.sessions.replaceAssistantBlocks(sessionId, confirmation.callId, assistant.content.blocks);
    emit({ type: "run_started", runId: run.id, sessionId });
    emit({ type: "tool_started", block: structuredClone(block) });
    try {
      const saved = await new SceneGenerationService(this.courses, this.generationAdapter, this.sceneTimeoutMs).revise(courseId, payload.outlineId, payload.baseRevision, run.id, { instruction: payload.instruction, confirmQuizAttemptDeletion: true, requestSignal: controller.signal });
      const replacement = saved.scenes.find((item) => item.outlineId === payload.outlineId);
      if (!replacement) throw new AgentApplicationError("TOOL_EXECUTION_FAILED", "测验重生成已保存，但没有找到替换页面");
      const result = { mode: "regenerate", oldSceneId: payload.sceneId, newSceneId: replacement.id, outlineId: payload.outlineId, beforeRevision: payload.baseRevision, afterRevision: saved.revision, contentChanged: true, message: "测验题目与 actions 已整页替换，旧作答已清理" };
      Object.assign(block, { status: "completed", result, durationMs: this.now() - started });
      metrics.toolCompleted = 1;
      await this.sessions.resolveConfirmation(confirmation.id, "completed", result);
      await this.sessions.replaceAssistantBlocks(sessionId, confirmation.callId, assistant.content.blocks);
      await this.finishRunSnapshot(waitingRun?.id === confirmation.runId ? waitingRun : null, "completed", saved.revision, undefined, "toolCompleted");
      emit({ type: "tool_finished", block: structuredClone(block) });
      emit({ type: "course_updated", revision: saved.revision, affectedSceneIds: [replacement.id], removedSceneIds: [payload.sceneId], sceneReplacements: [{ oldSceneId: payload.sceneId, newSceneId: replacement.id, outlineId: payload.outlineId }], contentChanged: true });
      await this.sessions.finishRun(run.id, "completed", saved.revision, undefined, { ...metrics, totalDurationMs: Math.max(0, this.now() - started) });
      emit({ type: "run_finished", status: "completed" });
    } catch (error) {
      const detail = safeError(error);
      const latest = await this.courses.get(courseId);
      const cancelled = controller.signal.aborted;
      const result = { status: cancelled ? "cancelled" : "failed", ...detail, revision: latest?.revision };
      Object.assign(block, { status: cancelled ? "cancelled" : "failed", result, durationMs: this.now() - started });
      if (cancelled) metrics.toolCancelled = 1; else metrics.toolFailed = 1;
      await this.sessions.resolveConfirmation(confirmation.id, cancelled ? "cancelled" : "failed", result);
      await this.sessions.replaceAssistantBlocks(sessionId, confirmation.callId, assistant.content.blocks);
      await this.finishRunSnapshot(waitingRun?.id === confirmation.runId ? waitingRun : null, cancelled ? "cancelled" : "failed", latest?.revision, detail.message, cancelled ? "toolCancelled" : "toolFailed");
      emit({ type: "tool_finished", block: structuredClone(block) });
      await this.sessions.finishRun(run.id, cancelled ? "cancelled" : "failed", latest?.revision, detail.message, { ...metrics, totalDurationMs: Math.max(0, this.now() - started) });
      emit({ type: "run_finished", status: cancelled ? "cancelled" : "failed", error: detail.message });
    } finally {
      clearTimeout(timer);
      requestSignal.removeEventListener("abort", cancel);
    }
  }
}
