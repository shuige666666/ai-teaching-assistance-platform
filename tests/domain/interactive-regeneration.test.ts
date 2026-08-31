import { describe, expect, it, vi } from "vitest";
import { AIAdapterError, type AIAdapter } from "@/lib/ai/contracts";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { OutlineGenerationService } from "@/lib/application/outline-generation-service";
import { SceneGenerationService } from "@/lib/application/scene-generation-service";
import { RegenerateInteractiveInputSchema } from "@/lib/application/outline-api";
import { createCourseDraft } from "@/lib/domain/fixture";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";
import { CourseConflictError, DatabaseUnavailableError, type CourseRepository } from "@/lib/repository/course-repository";

/** 用正式 mock 管线准备可替换互动，避免手工绕过聚合约束。 */
async function setup() {
  const repository = new InMemoryCourseRepository(), mock = new MockAIAdapter();
  const draft = await repository.create(createCourseDraft("事务互动", 4, { interactionMode: "required" }));
  let course = await new OutlineGenerationService(repository, mock).generate(draft.id, 0, "outline");
  const service = new SceneGenerationService(repository, mock);
  for (const outline of course.outlines) course = await service.generate(course.id, outline.id, course.revision, "scene");
  const old = course.scenes.find((scene) => scene.type === "interactive")!;
  return { repository, mock, course, old };
}

describe("互动单场景再生成", () => {
  it("生成中保留原 HTML，成功只替换一个场景并使用原摘要及错误背景", async () => {
    const { repository, mock, course, old } = await setup();
    const adapter: AIAdapter = { generateText: vi.fn(async (input) => {
      const pending = await repository.get(course.id);
      expect(pending?.scenes).toEqual(course.scenes);
      expect(pending?.activeOperation?.outlineId).toBe(old.outlineId);
      expect(input.userPrompt).toContain(old.summary);
      expect(input.userPrompt).toContain("ResizeObserver");
      return mock.generateText(input);
    }) };
    const next = await new SceneGenerationService(repository, adapter).regenerateInteractive(course.id, old.outlineId, course.revision, "regen", "ResizeObserver");
    expect(next.status).toBe("ready");
    expect(next.revision).toBe(course.revision + 2);
    expect(next.activeOperation).toBeUndefined();
    expect(next.scenes.find((s) => s.outlineId === old.outlineId)?.id).not.toBe(old.id);
    expect(next.scenes.filter((s) => s.outlineId !== old.outlineId)).toEqual(course.scenes.filter((s) => s.outlineId !== old.outlineId));
    expect(next.outlines).toEqual(course.outlines);
    expect(adapter.generateText).toHaveBeenCalledTimes(1);
  });

  it("上游失败后保留原场景、ready 进度并释放租约，允许下一次显式重试", async () => {
    const { repository, course, old, mock } = await setup();
    const adapter: AIAdapter = { generateText: async () => { throw new AIAdapterError("AI_AUTH_FAILED", "test failure", false); } };
    await expect(new SceneGenerationService(repository, adapter).regenerateInteractive(course.id, old.outlineId, course.revision, "fail")).rejects.toThrow();
    const kept = (await repository.get(course.id))!;
    expect(kept.scenes).toEqual(course.scenes);
    expect(kept.status).toBe("ready");
    expect(kept.activeOperation).toBeUndefined();
    expect(kept.sceneProgress.find((p) => p.outlineId === old.outlineId)).toMatchObject({ status: "ready", attempts: 2, lastError: { code: "AI_AUTH_FAILED" } });
    await expect(new SceneGenerationService(repository, mock).regenerateInteractive(course.id, old.outlineId, kept.revision, "retry")).resolves.toMatchObject({ status: "ready" });
  });

  it("非法输出即使 repair 仍失败也不替换旧场景", async () => {
    const { repository, course, old } = await setup();
    const adapter: AIAdapter = { generateText: vi.fn(async () => ({ text: "broken", provider: "mock" as const, model: "test" })) };
    await expect(new SceneGenerationService(repository, adapter).regenerateInteractive(course.id, old.outlineId, course.revision, "invalid")).rejects.toThrow();
    expect(adapter.generateText).toHaveBeenCalledTimes(2);
    expect((await repository.get(course.id))?.scenes).toEqual(course.scenes);
  });

  it("取消发生在候选返回后也不能提交替换", async () => {
    const { repository, mock, course, old } = await setup();
    const controller = new AbortController();
    const adapter: AIAdapter = { generateText: async (input) => { const result = await mock.generateText(input); controller.abort(); return result; } };
    await expect(new SceneGenerationService(repository, adapter).regenerateInteractive(course.id, old.outlineId, course.revision, "cancel", undefined, controller.signal)).rejects.toThrow();
    expect((await repository.get(course.id))?.scenes).toEqual(course.scenes);
    expect((await repository.get(course.id))?.activeOperation).toBeUndefined();
  });

  it("过期版本和非互动场景在调用模型前拒绝", async () => {
    const { repository, course, old, mock } = await setup();
    const generateText = vi.fn(mock.generateText.bind(mock));
    const service = new SceneGenerationService(repository, { generateText });
    await expect(service.regenerateInteractive(course.id, old.outlineId, course.revision - 1, "stale")).rejects.toBeInstanceOf(CourseConflictError);
    await expect(service.regenerateInteractive(course.id, course.scenes[0].outlineId, course.revision, "slide")).rejects.toThrow("只能重新生成");
    expect(generateText).not.toHaveBeenCalled();
    expect(RegenerateInteractiveInputSchema.safeParse({ expectedRevision: 1, runtimeError: "x".repeat(501) }).success).toBe(false);
  });

  it("租约挡住重复请求，提交冲突不会覆盖另一个写入", async () => {
    const { repository, mock, course, old } = await setup();
    const adapter: AIAdapter = { generateText: async (input) => {
      const latest = (await repository.get(course.id))!;
      await expect(new SceneGenerationService(repository, mock).regenerateInteractive(course.id, old.outlineId, latest.revision, "duplicate")).rejects.toThrow("已有生成操作");
      await repository.save({ ...latest, title: "并发更新", activeOperation: undefined, status: "ready" }, latest.revision);
      return mock.generateText(input);
    } };
    await expect(new SceneGenerationService(repository, adapter).regenerateInteractive(course.id, old.outlineId, course.revision, "conflict")).rejects.toBeInstanceOf(CourseConflictError);
    const latest = (await repository.get(course.id))!;
    expect(latest.title).toBe("并发更新");
    expect(latest.scenes).toEqual(course.scenes);
  });

  it("最终保存失败后不丢旧场景，过期租约可以由显式请求恢复", async () => {
    const { repository, course, old, mock } = await setup();
    let saves = 0;
    const failing: CourseRepository = { create: c => repository.create(c), get: id => repository.get(id), list: () => repository.list(), delete: id => repository.delete(id), save: (c, revision) => { if (++saves === 2) throw new DatabaseUnavailableError(); return repository.save(c, revision); } };
    await expect(new SceneGenerationService(failing, mock).regenerateInteractive(course.id, old.outlineId, course.revision, "save-failure")).rejects.toBeInstanceOf(DatabaseUnavailableError);
    const kept = (await repository.get(course.id))!;
    expect(kept.scenes).toEqual(course.scenes);
    const expired = await repository.save({ ...kept, status: "generating", activeOperation: { id: "expired", stage: "scene", outlineId: old.outlineId, startedAt: 1, expiresAt: 2 } }, kept.revision);
    await expect(new SceneGenerationService(repository, mock).regenerateInteractive(course.id, old.outlineId, expired.revision, "recover")).resolves.toMatchObject({ status: "ready", activeOperation: undefined });
  });
});
