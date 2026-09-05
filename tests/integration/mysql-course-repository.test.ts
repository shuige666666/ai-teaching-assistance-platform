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

  it("连接不可用时返回可诊断的 DATABASE_UNAVAILABLE", async () => {
    const unavailablePool = mysql.createPool({ host: "127.0.0.1", port: 3307, user: "invalid", password: "invalid", database: "invalid", connectTimeout: 300 });
    try {
      await expect(new MySQLCourseRepository(unavailablePool).list()).rejects.toBeInstanceOf(DatabaseUnavailableError);
    } finally {
      await unavailablePool.end();
    }
  });
});
