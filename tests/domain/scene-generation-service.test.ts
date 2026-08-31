import { describe, expect, it } from "vitest";
import type { AIAdapter, GenerateTextInput } from "@/lib/ai/contracts";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { OutlineGenerationService } from "@/lib/application/outline-generation-service";
import { SceneGenerationService } from "@/lib/application/scene-generation-service";
import { createCourseDraft } from "@/lib/domain/fixture";
import { CourseConflictError, DatabaseUnavailableError, type CourseRepository } from "@/lib/repository/course-repository";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";

async function createOutlineReady(repository: InMemoryCourseRepository, count = 4) {
  const draft = await repository.create(createCourseDraft(`M4 服务测试 ${crypto.randomUUID()}`, count));
  return new OutlineGenerationService(repository, new MockAIAdapter()).generate(draft.id, 0, "outline-request");
}

describe("SceneGenerationService", () => {
  it("开启互动后四场景课程生成一个可持久化 diagram", async () => {
    const repository = new InMemoryCourseRepository();
    const draft = await repository.create(createCourseDraft("事务状态机制", 4, { interactionMode: "required" }));
    let course = await new OutlineGenerationService(repository, new MockAIAdapter()).generate(draft.id, draft.revision, "interactive-outline");
    expect(course.outlines.filter((outline) => outline.type === "interactive")).toHaveLength(1);
    const service = new SceneGenerationService(repository, new MockAIAdapter());
    for (const outline of course.outlines) course = await service.generate(course.id, outline.id, course.revision, `interactive-${outline.order}`);
    const interactive = course.scenes.find((scene) => scene.type === "interactive");
    expect(course.status).toBe("ready");
    expect(interactive?.generation.promptVersion).toBe("scene-diagram.v2.1");
    if (!interactive || interactive.type !== "interactive") throw new Error("interactive scene expected");
    expect(interactive.content.html).toContain("Content-Security-Policy");
  });

  it("逐场景使用两个短事务，全部完成后才进入 ready", async () => {
    const repository = new InMemoryCourseRepository();
    let course = await createOutlineReady(repository);
    const service = new SceneGenerationService(repository, new MockAIAdapter());
    for (const outline of course.outlines) course = await service.generate(course.id, outline.id, course.revision, `scene-${outline.order}`);
    expect(course).toMatchObject({ status: "ready", revision: 10 });
    expect(course.scenes).toHaveLength(4);
    expect(course.sceneProgress.every((item) => item.status === "ready" && item.attempts === 1)).toBe(true);
  });

  it("中间场景失败时保留首场并继续末场，重试后替换为完整课程", async () => {
    const repository = new InMemoryCourseRepository();
    let course = await createOutlineReady(repository);
    course = await new SceneGenerationService(repository, new MockAIAdapter()).generate(course.id, course.outlines[0].id, course.revision, "scene-first");
    const failedOutlineId = course.outlines[1].id;
    await expect(new SceneGenerationService(repository, new MockAIAdapter(["{}", "{}"])).generate(course.id, failedOutlineId, course.revision, "scene-failed"))
      .rejects.toMatchObject({ code: "INVALID_MODEL_OUTPUT", retryable: true });
    course = (await repository.get(course.id))!;
    expect(course).toMatchObject({ status: "partial_failed", revision: 6 });
    expect(course.sceneProgress.find((item) => item.outlineId === failedOutlineId)?.lastError).toMatchObject({ code: "INVALID_MODEL_OUTPUT", retryable: true });
    expect(course.scenes).toHaveLength(1);

    course = await new SceneGenerationService(repository, new MockAIAdapter()).generate(course.id, course.outlines[2].id, course.revision, "scene-third");
    expect(course.status).toBe("partial_failed");
    expect(course.scenes).toHaveLength(2);

    course = await new SceneGenerationService(repository, new MockAIAdapter()).generate(course.id, course.outlines[3].id, course.revision, "scene-last");
    expect(course.status).toBe("partial_failed");
    expect(course.scenes).toHaveLength(3);

    course = await new SceneGenerationService(repository, new MockAIAdapter()).generate(course.id, failedOutlineId, course.revision, "scene-retry");
    expect(course).toMatchObject({ status: "ready", revision: 12 });
    expect(course.scenes).toHaveLength(4);
    expect(course.sceneProgress.find((item) => item.outlineId === failedOutlineId)?.attempts).toBe(2);
  });

  it("模型调用期间出现的新 revision 会让迟到场景提交冲突", async () => {
    const repository = new InMemoryCourseRepository();
    const course = await createOutlineReady(repository);
    const mock = new MockAIAdapter();
    const racingAdapter: AIAdapter = {
      async generateText(input: GenerateTextInput) {
        const registered = await repository.get(course.id);
        if (!registered) throw new Error("registered course missing");
        await repository.save({ ...registered, title: "并发请求已经更新课程" }, registered.revision);
        return mock.generateText(input);
      },
    };
    await expect(new SceneGenerationService(repository, racingAdapter).generate(course.id, course.outlines[0].id, course.revision, "scene-race"))
      .rejects.toBeInstanceOf(CourseConflictError);
    expect((await repository.get(course.id))?.title).toBe("并发请求已经更新课程");
  });

  it("模型成功但最终事务失败时不会返回成功，且目标场景可恢复为失败状态", async () => {
    const repository = new InMemoryCourseRepository();
    const course = await createOutlineReady(repository);
    let saveCalls = 0;
    const failingRepository: CourseRepository = {
      create: (value) => repository.create(value),
      get: (id) => repository.get(id),
      list: () => repository.list(),
      delete: (id) => repository.delete(id),
      save: (value, expectedRevision) => {
        saveCalls += 1;
        if (saveCalls === 2) throw new DatabaseUnavailableError();
        return repository.save(value, expectedRevision);
      },
    };
    await expect(new SceneGenerationService(failingRepository, new MockAIAdapter()).generate(course.id, course.outlines[0].id, course.revision, "scene-storage-failure"))
      .rejects.toBeInstanceOf(DatabaseUnavailableError);
    const recovered = await repository.get(course.id);
    expect(recovered?.status).toBe("partial_failed");
    expect(recovered?.scenes).toHaveLength(0);
    expect(recovered?.sceneProgress[0]).toMatchObject({ status: "failed", attempts: 1 });
  });
});
