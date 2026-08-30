import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { getDatabasePool } from "@/lib/db/pool";
import { createCourseDraft, createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { MockAIAdapter } from "@/lib/ai/mock-adapter";
import { OutlineGenerationService } from "@/lib/application/outline-generation-service";
import { SceneGenerationService } from "@/lib/application/scene-generation-service";
import { QuizAttemptService } from "@/lib/application/quiz-attempt-service";
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
    const created = await firstRepository.create(createFixtureCourse(`进程恢复 ${crypto.randomUUID()}`, 3));
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

  it.each([1, 2])("列表隐藏 v%s 行，按 ID 访问时明确报告旧课程不支持", async (legacyVersion) => {
    const repository = new MySQLCourseRepository(pool);
    const created = await repository.create(createCourseDraft(`旧版课程 ${crypto.randomUUID()}`, 3));
    cleanupIds.push(created.id);
    await pool.execute("UPDATE courses SET schema_version = ? WHERE id = ?", [legacyVersion, created.id]);
    await expect(repository.get(created.id)).rejects.toBeInstanceOf(LegacyCourseUnsupportedError);
    expect((await repository.list()).some((course) => course.id === created.id)).toBe(false);
  });

  it("三个场景逐项提交后可恢复为包含 slide 与 quiz 的 ready 课程", async () => {
    const repository = new MySQLCourseRepository(pool);
    const draft = await repository.create(createCourseDraft(`场景持久化 ${crypto.randomUUID()}`, 3));
    cleanupIds.push(draft.id);
    let course = await new OutlineGenerationService(repository, new MockAIAdapter()).generate(draft.id, 0, "mysql-scene-outline");
    const sceneService = new SceneGenerationService(repository, new MockAIAdapter());
    for (const outline of course.outlines) course = await sceneService.generate(course.id, outline.id, course.revision, `mysql-scene-${outline.order}`);
    const recovered = await new MySQLCourseRepository(pool).get(draft.id);
    expect(course).toMatchObject({ status: "ready", revision: 8 });
    expect(recovered?.scenes.map((scene) => scene.type)).toEqual(["slide", "slide", "quiz"]);
    expect(recovered?.scenes.map((scene) => scene.generation.promptVersion)).toEqual(["scene-slide.v2.1", "scene-slide.v2.1", "scene-quiz.v1"]);
  });

  it("删除课程会级联删除 quiz_attempts", async () => {
    const repository = new MySQLCourseRepository(pool);
    const created = await repository.create(materializeFixtureCourse(createFixtureCourse(`级联删除 ${crypto.randomUUID()}`, 3)));
    const quizScene = created.scenes.find((scene) => scene.type === "quiz");
    if (!quizScene || quizScene.type !== "quiz") throw new Error("fixture quiz missing");
    const question = quizScene.content.questions[0];
    await pool.execute(
      "INSERT INTO quiz_attempts (id, course_id, scene_id, question_id, selected_option_id, correct, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), created.id, quizScene.id, question.id, question.correctOptionId, true, Date.now()],
    );
    await repository.delete(created.id);
    const [rows] = await pool.execute<Array<RowDataPacket & { count: number }>>("SELECT COUNT(*) AS count FROM quiz_attempts WHERE course_id = ?", [created.id]);
    expect(Number(rows[0].count)).toBe(0);
  });

  it("服务端判分后可由新作答仓储实例恢复记录", async () => {
    const courseRepository = new MySQLCourseRepository(pool);
    const course = await courseRepository.create(materializeFixtureCourse(createFixtureCourse(`作答恢复 ${crypto.randomUUID()}`, 3)));
    cleanupIds.push(course.id);
    const scene = course.scenes.find((item) => item.type === "quiz");
    if (!scene || scene.type !== "quiz") throw new Error("fixture quiz missing");
    const question = scene.content.questions[0];
    const attempt = await new QuizAttemptService(courseRepository, new MySQLQuizAttemptRepository(pool)).submit(course.id, {
      sceneId: scene.id,
      questionId: question.id,
      selectedOptionId: question.correctOptionId,
    });
    const recovered = await new MySQLQuizAttemptRepository(pool).listByCourse(course.id);
    expect(attempt.correct).toBe(true);
    expect(recovered).toEqual([attempt]);
    expect((await courseRepository.get(course.id))?.revision).toBe(course.revision);
  });

  it("读取损坏 JSON 聚合时返回 STORED_COURSE_INVALID", async () => {
    const repository = new MySQLCourseRepository(pool);
    const created = await repository.create(materializeFixtureCourse(createFixtureCourse(`损坏数据 ${crypto.randomUUID()}`, 3)));
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
