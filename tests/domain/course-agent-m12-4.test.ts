import { describe, expect, it } from "vitest";
import { AgentApplicationError } from "@/lib/agent/contracts";
import { InMemoryAgentSessionRepository } from "@/lib/repository/in-memory-agent-session-repository";

describe("M12.4 会话生命周期", () => {
  it("删除空闲会话时清理消息和运行记录，重命名不刷新最近活动时间", async () => {
    const clock = { value: 100 };
    const repository = new InMemoryAgentSessionRepository(() => clock.value);
    const session = await repository.createSession("course-a", "未命名对话");

    clock.value = 120;
    const run = await repository.startRun(session.id, 1, 1_000);
    const message = await repository.appendMessage(session.id, {
      sessionId: session.id,
      runId: run.id,
      role: "user",
      content: { text: "检查第 2 页", currentSceneId: "scene-2", courseRevision: 1 },
    });
    await repository.finishRun(run.id, "completed", 1);
    const activityAt = (await repository.getSession("course-a", session.id))?.updatedAt;

    clock.value = 900;
    await repository.recoverExpiredRuns(session.id, clock.value);
    expect((await repository.getSession("course-a", session.id))?.updatedAt).toBe(activityAt);
    const renamed = await repository.renameSession("course-a", session.id, "课堂检查");
    expect(renamed.title).toBe("课堂检查");
    expect(renamed.updatedAt).toBe(activityAt);

    await repository.deleteSession("course-a", session.id);
    expect(await repository.getSession("course-a", session.id)).toBeNull();
    expect(await repository.listMessages(session.id)).toEqual([]);
    expect(await repository.getLatestRun(session.id)).toBeNull();
    expect(message.content).toMatchObject({ text: "检查第 2 页" });
  });

  it("拒绝跨课程、运行中和等待确认的会话删除", async () => {
    const repository = new InMemoryAgentSessionRepository(() => 500);
    const running = await repository.createSession("course-a", "运行中");
    await repository.startRun(running.id, 1, 2_000);
    await expect(repository.deleteSession("course-a", running.id)).rejects.toMatchObject({ code: "RUN_IN_PROGRESS" });

    const waiting = await repository.createSession("course-a", "待确认");
    const confirmation = await repository.createConfirmation({
      sessionId: waiting.id,
      runId: "run-waiting",
      callId: "call-waiting",
      toolName: "edit_deck",
      baseRevision: 1,
      payload: { kind: "delete" },
      summary: "删除页面",
      expiresAt: 2_000,
    });
    expect((await repository.claimConfirmation(confirmation.id)).claimed).toBe(true);
    await expect(repository.deleteSession("course-a", waiting.id)).rejects.toBeInstanceOf(AgentApplicationError);

    const idle = await repository.createSession("course-a", "空闲");
    await expect(repository.deleteSession("course-b", idle.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
