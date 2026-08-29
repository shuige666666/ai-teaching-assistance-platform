import { describe, expect, it } from "vitest";
import type { AIAdapter, GenerateTextInput } from "@/lib/ai/contracts";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { OutlineGenerationService } from "@/lib/application/outline-generation-service";
import { createCourseDraft } from "@/lib/domain/fixture";
import { CourseConflictError } from "@/lib/repository/course-repository";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";

describe("OutlineGenerationService", () => {
  it("用两个 revision 提交登记和成功结果，并允许审核后编辑", async () => {
    const repository = new InMemoryCourseRepository();
    const draft = await repository.create(createCourseDraft("TCP 拥塞控制", 4));
    const service = new OutlineGenerationService(repository, new MockAIAdapter());
    const generated = await service.generate(draft.id, 0, "request-service");
    expect(generated).toMatchObject({ status: "outline_ready", revision: 2 });
    expect(generated.activeOperation).toBeUndefined();
    const edited = await service.edit(generated.id, generated.revision, "编辑后的课程标题", generated.outlines.map((item, index) => index === 0 ? { ...item, title: "编辑后的第一场" } : item));
    expect(edited).toMatchObject({ title: "编辑后的课程标题", revision: 3 });
  });

  it("迟到模型结果不能覆盖模型调用期间发生的新 revision", async () => {
    const repository = new InMemoryCourseRepository();
    const draft = await repository.create(createCourseDraft("并发保护课程", 3));
    const mock = new MockAIAdapter();
    const racingAdapter: AIAdapter = {
      async generateText(input: GenerateTextInput) {
        const registered = await repository.get(draft.id);
        if (!registered) throw new Error("registered course missing");
        await repository.save({ ...registered, title: "并发请求已经更新" }, registered.revision);
        return mock.generateText(input);
      },
    };
    await expect(new OutlineGenerationService(repository, racingAdapter).generate(draft.id, 0, "request-race"))
      .rejects.toBeInstanceOf(CourseConflictError);
    expect((await repository.get(draft.id))?.title).toBe("并发请求已经更新");
  });

  it("失败课程保存 requestId、调用次数、校验阶段和问题", async () => {
    const repository = new InMemoryCourseRepository();
    const draft = await repository.create(createCourseDraft("失败诊断课程", 3));
    const service = new OutlineGenerationService(repository, new MockAIAdapter(["{}", "{}"]));

    await expect(service.generate(draft.id, 0, "outline-diagnostic-request")).rejects.toMatchObject({
      code: "INVALID_MODEL_OUTPUT",
      upstreamCalls: 2,
      validationKind: "schema",
    });

    const failed = await repository.get(draft.id);
    expect(failed?.lastError).toMatchObject({
      code: "INVALID_MODEL_OUTPUT",
      details: {
        requestId: "outline-diagnostic-request",
        upstreamCalls: 2,
        validationKind: "schema",
        issues: expect.any(Array),
      },
    });
  });
});
