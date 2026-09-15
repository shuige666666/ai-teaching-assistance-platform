import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { getDatabasePool } from "@/lib/db/pool";
import { createCourseDraft, createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { OutlineGenerationService } from "@/lib/application/outline-generation-service";
import { SceneGenerationService } from "@/lib/application/scene-generation-service";
import { QuizAttemptService } from "@/lib/application/quiz-attempt-service";
import { QuizEditingService } from "@/lib/application/quiz-editing-service";
import { courseRepositoryContract } from "@/tests/domain/course-repository-contract";
import { DatabaseUnavailableError, LegacyCourseUnsupportedError, StoredCourseInvalidError } from "@/lib/repository/course-repository";
import { MySQLCourseRepository } from "@/lib/repository/mysql-course-repository";
import { MySQLQuizAttemptRepository } from "@/lib/repository/mysql-quiz-attempt-repository";
import { MySQLAgentSessionRepository } from "@/lib/repository/mysql-agent-session-repository";
import { CoursePatchService } from "@/lib/application/course-patch-service";
import { AgentApplicationError } from "@/lib/agent/contracts";
import { MySQLGenerationRunRepository } from "@/lib/repository/mysql-generation-run-repository";
import { MySQLCourseFolderRepository } from "@/lib/repository/mysql-course-folder-repository";

const pool = getDatabasePool();
courseRepositoryContract("MySQL", () => new MySQLCourseRepository(pool));

describe("MySQLCourseRepository integration", () => {
  const cleanupIds: string[] = [];

  afterAll(async () => {
    await Promise.all(cleanupIds.map((id) => pool.execute("DELETE FROM courses WHERE id = ?", [id])));
    await pool.end();
  });

  it("新仓储实例可以读取此前实例创建的课程", async () => {
    const firstRepository = new MySQLCourseRepository(pool);
    const created = await firstRepository.create(createFixtureCourse(`进程恢复 ${crypto.randomUUID()}`, 4));
    cleanupIds.push(created.id);
    const secondRepository = new MySQLCourseRepository(pool);
    expect((await secondRepository.get(created.id))?.topic).toBe(created.topic);
  });

  it("mock 大纲经过短事务管线后可由新仓储实例恢复", async () => {
    const repository = new MySQLCourseRepository(pool);
    const draft = await repository.create(createCourseDraft(`大纲持久化 ${crypto.randomUUID()}`, 4));
    cleanupIds.push(draft.id);
    const generated = await new OutlineGenerationService(repository, new MockAIAdapter()).generate(draft.id, 0, "mysql-outline-request");
    const recovered = await new MySQLCourseRepository(pool).get(draft.id);
    expect(generated).toMatchObject({ status: "outline_ready", revision: 2 });
    expect(recovered?.outlineGeneration).toMatchObject({ provider: "mock", requestId: "mysql-outline-request", upstreamCalls: 1 });
    expect(recovered?.briefResolution).toMatchObject({ status: "resolved" });
    expect(recovered?.outlines).toHaveLength(4);
  });

  it.each([1, 2, 3])("列表隐藏 v%s 行，按 ID 访问时明确报告旧课程不支持", async (legacyVersion) => {
    const repository = new MySQLCourseRepository(pool);
    const created = await repository.create(createCourseDraft(`旧版课程 ${crypto.randomUUID()}`, 4));
    cleanupIds.push(created.id);
    await pool.execute("UPDATE courses SET schema_version = ? WHERE id = ?", [legacyVersion, created.id]);
    await expect(repository.get(created.id)).rejects.toBeInstanceOf(LegacyCourseUnsupportedError);
    expect((await repository.list()).some((course) => course.id === created.id)).toBe(false);
  });

  it("四个场景逐项提交后可恢复为包含 slide 与 quiz 的 ready 课程", async () => {
    const repository = new MySQLCourseRepository(pool);
    const draft = await repository.create(createCourseDraft(`场景持久化 ${crypto.randomUUID()}`, 4));
    cleanupIds.push(draft.id);
    let course = await new OutlineGenerationService(repository, new MockAIAdapter()).generate(draft.id, 0, "mysql-scene-outline");
    const sceneService = new SceneGenerationService(repository, new MockAIAdapter());
    for (const outline of course.outlines) course = await sceneService.generate(course.id, outline.id, course.revision, `mysql-scene-${outline.order}`);
    const recovered = await new MySQLCourseRepository(pool).get(draft.id);
    expect(course).toMatchObject({ status: "ready", revision: 10 });
    expect(recovered?.scenes.map((scene) => scene.type)).toEqual(["slide", "slide", "slide", "quiz"]);
    expect(recovered?.scenes.map((scene) => scene.generation.promptVersion)).toEqual(["scene-slide.v2.4", "scene-slide.v2.4", "scene-slide.v2.4", "scene-quiz.v2"]);
  });

  it("互动 HTML、fallback 和生成元数据可从 MySQL 完整恢复", async () => {
    const repository = new MySQLCourseRepository(pool);
    const draft = await repository.create(createCourseDraft(`互动持久化 ${crypto.randomUUID()}`, 4, { interactionMode: "required" }));
    cleanupIds.push(draft.id);
    let course = await new OutlineGenerationService(repository, new MockAIAdapter()).generate(draft.id, draft.revision, "mysql-interactive-outline");
    const service = new SceneGenerationService(repository, new MockAIAdapter());
    for (const outline of course.outlines) course = await service.generate(course.id, outline.id, course.revision, `mysql-interactive-${outline.order}`);
    const recovered = await new MySQLCourseRepository(pool).get(draft.id);
    const interactive = recovered?.scenes.find((scene) => scene.type === "interactive");
    if (!interactive || interactive.type !== "interactive") throw new Error("interactive scene missing");
    expect(interactive.content.html).toContain("Content-Security-Policy");
    expect(interactive.content.fallback.steps.length).toBeGreaterThanOrEqual(2);
    expect(interactive.generation).toMatchObject({ promptVersion: "scene-diagram.v2.3", provider: "mock" });
    // 再生成仅替换目标 JSON，其他场景与大纲由同一短事务完整保留。
    const regenerated = await service.regenerateFailedInteractive(course.id, interactive.outlineId, course.revision, "mysql-interactive-regenerate", { runtimeError: "layout loop" });
    const refreshed = (await new MySQLCourseRepository(pool).get(course.id))!;
    expect(refreshed).toEqual(regenerated);
    expect(refreshed.scenes.find(s => s.outlineId === interactive.outlineId)?.id).not.toBe(interactive.id);
    expect(refreshed.scenes.filter(s => s.outlineId !== interactive.outlineId)).toEqual(course.scenes.filter(s => s.outlineId !== interactive.outlineId));
    expect(refreshed.outlines).toEqual(course.outlines);
  });

  it("读取时自动升级 v4 单选题，并在下次保存时将课程落成 v5", async () => {
    const repository = new MySQLCourseRepository(pool);
    const created = await repository.create(materializeFixtureCourse(createFixtureCourse(`v4 自动升级 ${crypto.randomUUID()}`, 4)));
    cleanupIds.push(created.id);
    const legacyScenes = created.scenes.map((scene) => {
      if (scene.type !== "quiz") return scene;
      return {
        ...scene,
        content: {
          ...scene.content,
          questions: scene.content.questions.map((question) => {
            const { correctOptionIds, ...rest } = question;
            return { ...rest, type: "single_choice", correctOptionId: correctOptionIds[0] };
          }),
        },
      };
    });
    await pool.execute("UPDATE courses SET schema_version = 4, scenes_json = ? WHERE id = ?", [JSON.stringify(legacyScenes), created.id]);

    const upgraded = await repository.get(created.id);
    expect(upgraded?.schemaVersion).toBe(5);
    expect((await repository.list()).some((course) => course.id === created.id)).toBe(true);
    const quiz = upgraded?.scenes.find((scene) => scene.type === "quiz");
    expect(quiz?.type === "quiz" && quiz.content.questions.every((question) => question.correctOptionIds.length === 1)).toBe(true);

    if (!upgraded) throw new Error("upgraded course missing");
    await repository.save(upgraded, upgraded.revision);
    const [rows] = await pool.execute<Array<RowDataPacket & { schema_version: number }>>("SELECT schema_version FROM courses WHERE id = ?", [created.id]);
    expect(Number(rows[0].schema_version)).toBe(5);
  });

  it("quiz 再生成与旧作答清理在同一 MySQL 提交中完成", async () => {
    const repository = new MySQLCourseRepository(pool);
    const created = await repository.create(materializeFixtureCourse(createFixtureCourse(`测验修订 ${crypto.randomUUID()}`, 4)));
    cleanupIds.push(created.id);
    const quiz = created.scenes.find((scene) => scene.type === "quiz");
    if (!quiz || quiz.type !== "quiz") throw new Error("fixture quiz missing");
    const question = quiz.content.questions[0];
    await pool.execute(
      "INSERT INTO quiz_attempts (id, course_id, scene_id, question_id, selected_option_ids_json, correct, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), created.id, quiz.id, question.id, JSON.stringify(question.correctOptionIds), true, Date.now()],
    );
    const regenerated = await new SceneGenerationService(repository, new MockAIAdapter()).revise(
      created.id, quiz.outlineId, created.revision, "mysql-quiz-regenerate", { instruction: "增加一个情境判断题", confirmQuizAttemptDeletion: true },
    );
    const replacement = regenerated.scenes.find((scene) => scene.outlineId === quiz.outlineId);
    const [rows] = await pool.execute<Array<RowDataPacket & { count: number }>>(
      "SELECT COUNT(*) AS count FROM quiz_attempts WHERE course_id = ? AND scene_id = ?", [created.id, quiz.id],
    );
    expect(replacement).toMatchObject({ type: "quiz" });
    expect(replacement?.id).not.toBe(quiz.id);
    expect(Number(rows[0].count)).toBe(0);
    expect((await new MySQLCourseRepository(pool).get(created.id))).toEqual(regenerated);
  });

  it("人工编辑 quiz 与旧作答清理在同一 MySQL 提交中完成", async () => {
    const repository = new MySQLCourseRepository(pool);
    const created = await repository.create(materializeFixtureCourse(createFixtureCourse(`测验手动编辑 ${crypto.randomUUID()}`, 4)));
    cleanupIds.push(created.id);
    const quiz = created.scenes.find((scene) => scene.type === "quiz");
    if (!quiz || quiz.type !== "quiz") throw new Error("fixture quiz missing");
    const question = quiz.content.questions[0];
    await pool.execute(
      "INSERT INTO quiz_attempts (id, course_id, scene_id, question_id, selected_option_ids_json, correct, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), created.id, quiz.id, question.id, JSON.stringify(question.correctOptionIds), true, Date.now()],
    );
    const edited = await new QuizEditingService(repository).edit(created.id, quiz.outlineId, {
      expectedRevision: created.revision,
      confirmQuizAttemptDeletion: true,
      questions: [{ type: "multiple_choice", prompt: "哪些属于事务特性？", options: ["原子性", "一致性", "随机性"], correctOptionIndexes: [0, 1], explanation: "原子性与一致性属于 ACID。" }],
    });
    const replacement = edited.scenes.find((scene) => scene.outlineId === quiz.outlineId);
    const [rows] = await pool.execute<Array<RowDataPacket & { count: number }>>("SELECT COUNT(*) AS count FROM quiz_attempts WHERE course_id = ? AND scene_id = ?", [created.id, quiz.id]);
    expect(replacement?.id).not.toBe(quiz.id);
    expect(replacement?.type === "quiz" && replacement.content.questions[0]).toMatchObject({ type: "multiple_choice", correctOptionIds: expect.any(Array) });
    expect(Number(rows[0].count)).toBe(0);
  });

  it.each([6, 8])("%s 场景课程可实际落库并恢复不同类型的互动", async (count) => {
    const repository = new MySQLCourseRepository(pool);
    const draft = await repository.create(createCourseDraft(`Agent 编程 ${count} 场景 ${crypto.randomUUID()}`, count, { interactionMode: "required" }));
    cleanupIds.push(draft.id);
    let course = await new OutlineGenerationService(repository, new MockAIAdapter()).generate(draft.id, 0, "diversity-outline");
    const service = new SceneGenerationService(repository, new MockAIAdapter());
    for (const outline of course.outlines) course = await service.generate(course.id, outline.id, course.revision, `diversity-${outline.order}`);
    const recovered = await new MySQLCourseRepository(pool).get(course.id);
    expect(recovered?.status).toBe("ready");
    const types = recovered?.scenes.filter(scene => scene.type === "interactive").map(scene => scene.content.widgetType);
    expect(types).toEqual(count === 6 ? ["diagram", "simulation"] : ["diagram", "simulation", "code"]);
  });

  it("删除课程会级联删除 quiz_attempts", async () => {
    const repository = new MySQLCourseRepository(pool);
    const created = await repository.create(materializeFixtureCourse(createFixtureCourse(`级联删除 ${crypto.randomUUID()}`, 4)));
    const quizScene = created.scenes.find((scene) => scene.type === "quiz");
    if (!quizScene || quizScene.type !== "quiz") throw new Error("fixture quiz missing");
    const question = quizScene.content.questions[0];
    await pool.execute(
      "INSERT INTO quiz_attempts (id, course_id, scene_id, question_id, selected_option_ids_json, correct, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), created.id, quizScene.id, question.id, JSON.stringify(question.correctOptionIds), true, Date.now()],
    );
    await repository.delete(created.id);
    const [rows] = await pool.execute<Array<RowDataPacket & { count: number }>>("SELECT COUNT(*) AS count FROM quiz_attempts WHERE course_id = ?", [created.id]);
    expect(Number(rows[0].count)).toBe(0);
  });

  it("服务端判分后可由新作答仓储实例恢复记录", async () => {
    const courseRepository = new MySQLCourseRepository(pool);
    const course = await courseRepository.create(materializeFixtureCourse(createFixtureCourse(`作答恢复 ${crypto.randomUUID()}`, 4)));
    cleanupIds.push(course.id);
    const scene = course.scenes.find((item) => item.type === "quiz");
    if (!scene || scene.type !== "quiz") throw new Error("fixture quiz missing");
    const question = scene.content.questions[0];
    const attempt = await new QuizAttemptService(courseRepository, new MySQLQuizAttemptRepository(pool)).submit(course.id, {
      sceneId: scene.id,
      questionId: question.id,
      selectedOptionIds: question.correctOptionIds,
    });
    const recovered = await new MySQLQuizAttemptRepository(pool).listByCourse(course.id);
    expect(attempt.correct).toBe(true);
    expect(recovered).toEqual([attempt]);
    expect((await courseRepository.get(course.id))?.revision).toBe(course.revision);
  });

  it("读取损坏 JSON 聚合时返回 STORED_COURSE_INVALID", async () => {
    const repository = new MySQLCourseRepository(pool);
    const created = await repository.create(materializeFixtureCourse(createFixtureCourse(`损坏数据 ${crypto.randomUUID()}`, 4)));
    cleanupIds.push(created.id);
    await pool.execute("UPDATE courses SET scenes_json = JSON_ARRAY() WHERE id = ?", [created.id]);
    await expect(repository.get(created.id)).rejects.toBeInstanceOf(StoredCourseInvalidError);
  });

  it("Agent 会话、消息和 run 可跨仓储实例恢复并互斥", async () => {
    const courseRepository = new MySQLCourseRepository(pool);
    const course = await courseRepository.create(materializeFixtureCourse(createFixtureCourse(`Agent 会话 ${crypto.randomUUID()}`, 4)));
    cleanupIds.push(course.id);
    const first = new MySQLAgentSessionRepository(pool);
    const session = await first.createSession(course.id, "课程修订");
    const run = await first.startRun(session.id, course.revision, Date.now() + 60_000);
    await first.appendMessage(session.id, { sessionId: session.id, runId: run.id, role: "user", content: { text: "检查课堂", courseRevision: course.revision } });
    await expect(new MySQLAgentSessionRepository(pool).startRun(session.id, course.revision, Date.now() + 60_000)).rejects.toBeInstanceOf(AgentApplicationError);
    await first.finishRun(run.id, "completed", course.revision);
    const recovered = new MySQLAgentSessionRepository(pool);
    expect((await recovered.getSession(course.id, session.id))?.status).toBe("idle");
    expect((await recovered.listMessages(session.id))[0].content).toMatchObject({ text: "检查课堂" });
  });

  it("Agent 删除空闲会话时级联清理子记录，运行中会话仍被保护", async () => {
    const courseRepository = new MySQLCourseRepository(pool);
    const course = await courseRepository.create(materializeFixtureCourse(createFixtureCourse(`Agent 会话删除 ${crypto.randomUUID()}`, 4)));
    cleanupIds.push(course.id);
    const repository = new MySQLAgentSessionRepository(pool);
    const idle = await repository.createSession(course.id, "可删除会话");
    const completedRun = await repository.startRun(idle.id, course.revision, Date.now() + 60_000);
    await repository.appendMessage(idle.id, { sessionId: idle.id, runId: completedRun.id, role: "user", content: { text: "保留历史后删除" } });
    await repository.finishRun(completedRun.id, "completed", course.revision);
    const running = await repository.createSession(course.id, "运行中会话");
    await repository.startRun(running.id, course.revision, Date.now() + 60_000);

    await expect(repository.deleteSession(course.id, running.id)).rejects.toMatchObject({ code: "RUN_IN_PROGRESS" });
    const revisionBeforeDelete = (await courseRepository.get(course.id))?.revision;
    await repository.deleteSession(course.id, idle.id);
    const [sessionRows] = await pool.execute<Array<RowDataPacket & { count: number }>>("SELECT COUNT(*) AS count FROM agent_sessions WHERE id = ?", [idle.id]);
    const [messageRows] = await pool.execute<Array<RowDataPacket & { count: number }>>("SELECT COUNT(*) AS count FROM agent_messages WHERE session_id = ?", [idle.id]);
    const [runRows] = await pool.execute<Array<RowDataPacket & { count: number }>>("SELECT COUNT(*) AS count FROM agent_runs WHERE session_id = ?", [idle.id]);
    expect(Number(sessionRows[0].count)).toBe(0);
    expect(Number(messageRows[0].count)).toBe(0);
    expect(Number(runRows[0].count)).toBe(0);
    expect((await courseRepository.get(course.id))?.revision).toBe(revisionBeforeDelete);
  });

  it("Agent 确认只能由一个仓储实例原子领取，收尾不覆盖仍在运行的会话", async () => {
    const courseRepository = new MySQLCourseRepository(pool);
    const course = await courseRepository.create(materializeFixtureCourse(createFixtureCourse(`Agent 确认并发 ${crypto.randomUUID()}`, 4)));
    cleanupIds.push(course.id);
    const first = new MySQLAgentSessionRepository(pool);
    const second = new MySQLAgentSessionRepository(pool);
    const session = await first.createSession(course.id, "确认并发");
    const run = await first.startRun(session.id, course.revision, Date.now() + 60_000);
    const pending = await first.createConfirmation({
      sessionId: session.id, runId: run.id, callId: "claim-once", toolName: "edit_deck", baseRevision: course.revision,
      payload: { kind: "delete" }, summary: "删除页面", expiresAt: Date.now() + 60_000,
    });

    const claims = await Promise.all([first.claimConfirmation(pending.id), second.claimConfirmation(pending.id)]);
    expect(claims.filter((item) => item.claimed)).toHaveLength(1);
    await first.resolveConfirmation(pending.id, "completed", { ok: true });
    expect((await first.getSession(course.id, session.id))?.status).toBe("running");
    await first.finishRun(run.id, "completed", course.revision);
    expect((await second.getSession(course.id, session.id))?.status).toBe("idle");
  });

  it("Agent quiz 补丁保持 Scene ID，并在同一课程事务清理旧作答", async () => {
    const repository = new MySQLCourseRepository(pool);
    const course = await repository.create(materializeFixtureCourse(createFixtureCourse(`Agent quiz ${crypto.randomUUID()}`, 4)));
    cleanupIds.push(course.id);
    const quiz = course.scenes.find((scene) => scene.type === "quiz");
    if (!quiz || quiz.type !== "quiz") throw new Error("fixture quiz missing");
    const question = quiz.content.questions[0];
    await pool.execute(
      "INSERT INTO quiz_attempts (id, course_id, scene_id, question_id, selected_option_ids_json, correct, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), course.id, quiz.id, question.id, JSON.stringify(question.correctOptionIds), true, Date.now()],
    );
    const service = new CoursePatchService(repository);
    const prepared = await service.prepareScenePatch(course.id, {
      sceneId: quiz.id,
      expectedRevision: course.revision,
      intent: "缩短题干并调整旁白",
      operations: [
        { op: "str_replace", path: "/content/questions/0/prompt", oldText: "课程内容的生成与展示", newText: "课程生成" },
        { op: "set", path: "/actions/0/text", value: "请认真阅读调整后的题目。" },
      ],
    });
    await service.commitPrepared(prepared);
    const saved = await repository.get(course.id);
    const savedQuiz = saved?.scenes.find((scene) => scene.id === quiz.id);
    const [rows] = await pool.execute<Array<RowDataPacket & { count: number }>>("SELECT COUNT(*) AS count FROM quiz_attempts WHERE course_id = ? AND scene_id = ?", [course.id, quiz.id]);
    expect(savedQuiz?.id).toBe(quiz.id);
    expect(savedQuiz?.actions[0]).toMatchObject({ text: "请认真阅读调整后的题目。" });
    expect(Number(rows[0].count)).toBe(0);
  });

  it("连接不可用时返回可诊断的 DATABASE_UNAVAILABLE", async () => {
    const unavailablePool = mysql.createPool({ host: "127.0.0.1", port: 3307, user: "invalid", password: "invalid", database: "invalid", connectTimeout: 300 });
    try {
      await expect(new MySQLCourseRepository(unavailablePool).list()).rejects.toBeInstanceOf(DatabaseUnavailableError);
    } finally {
      await unavailablePool.end();
    }
  });

  it("文件夹归属独立保存，并支持保留课程或连同课程删除", async () => {
    const courses = new MySQLCourseRepository(pool);
    const folders = new MySQLCourseFolderRepository(pool);
    const course = await courses.create(createFixtureCourse(`文件夹归属 ${crypto.randomUUID()}`, 4));
    cleanupIds.push(course.id);
    const folder = await folders.create(`课程分组 ${crypto.randomUUID()}`);
    let destructiveFolderId: string | undefined;
    try {
      await folders.moveCourse(course.id, folder.id);
      expect(await folders.listMemberships()).toContainEqual(expect.objectContaining({ courseId: course.id, folderId: folder.id }));
      const unchanged = await courses.get(course.id);
      expect(unchanged).toMatchObject({ revision: course.revision, updatedAt: course.updatedAt });
      expect((await folders.rename(folder.id, "课程分组已改名"))?.name).toBe("课程分组已改名");
      expect(await folders.delete(folder.id, "unfile")).toEqual({ folderId: folder.id, deletedCourseIds: [] });
      expect((await folders.listMemberships()).some((item) => item.courseId === course.id)).toBe(false);
      expect(await courses.get(course.id)).not.toBeNull();

      const destructiveFolder = await folders.create(`待删除课程 ${crypto.randomUUID()}`);
      destructiveFolderId = destructiveFolder.id;
      await folders.moveCourse(course.id, destructiveFolder.id);
      expect(await folders.delete(destructiveFolder.id, "delete_courses")).toEqual({ folderId: destructiveFolder.id, deletedCourseIds: [course.id] });
      expect(await courses.get(course.id)).toBeNull();
    } finally {
      await folders.delete(folder.id);
      if (destructiveFolderId) await folders.delete(destructiveFolderId);
    }
  });

  it("生成运行可以原子累计、查询，并随课程删除级联清理", async () => {
    const courses = new MySQLCourseRepository(pool);
    const course = await courses.create(createCourseDraft(`运行指标 ${crypto.randomUUID()}`, 4));
    const runs = new MySQLGenerationRunRepository(pool);
    const now = Date.now();
    const run = await runs.create({
      courseId: course.id,
      runType: "course_generation",
      status: "running",
      baseRevision: course.revision,
      requestedSceneCount: 4,
      rootRequestId: "mysql-generation-run",
      startedAt: now,
      updatedAt: now,
    });
    await Promise.all([
      runs.appendMetrics(run.id, { succeededSceneCount: 1, modelCalls: 1, inputTokens: 10, outputTokens: 5, usageStatus: "complete", activeDurationMs: 40, updatedAt: now + 1 }),
      runs.appendMetrics(run.id, { failedSceneCount: 1, modelCalls: 2, usageStatus: "unavailable", activeDurationMs: 60, updatedAt: now + 2 }),
    ]);
    const accumulated = await runs.get(run.id);
    expect(accumulated).toMatchObject({ succeededSceneCount: 1, failedSceneCount: 1, modelCalls: 3, inputTokens: 10, outputTokens: 5, usageStatus: "partial", activeDurationMs: 100 });
    expect((await runs.listForUsage(now - 1))[0]).toMatchObject({ id: run.id, courseTitle: course.title });
    await courses.delete(course.id);
    expect(await runs.get(run.id)).toBeNull();
  });
});
