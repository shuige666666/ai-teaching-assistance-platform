import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";
import { CourseSchema, CURRENT_SCHEMA_VERSION, type Course, type CourseSummary } from "@/lib/domain/schemas";
import { getDatabasePool } from "@/lib/db/pool";
import {
  CourseConflictError,
  DatabaseUnavailableError,
  FutureCourseSchemaVersionError,
  LegacyCourseUnsupportedError,
  StoredCourseInvalidError,
  type CourseSaveOptions,
  type CourseRepository,
} from "./course-repository";

interface CourseRow extends RowDataPacket {
  id: string;
  schema_version: number;
  revision: string | number;
  topic: string;
  title: string;
  status: Course["status"];
  requested_scene_count: number;
  brief_json: unknown | null;
  outlines_json: unknown;
  scenes_json: unknown;
  scene_progress_json: unknown;
  outline_generation_json: unknown | null;
  active_operation_json: unknown | null;
  last_error_json: unknown | null;
  created_at: string | number;
  updated_at: string | number;
}

function decodeJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

/** 将数据库行恢复成 Course，并在返回业务层之前重新执行完整 Schema。 */
function mapCourseRow(row: CourseRow): Course {
  const schemaVersion = Number(row.schema_version);
  if (schemaVersion < CURRENT_SCHEMA_VERSION) throw new LegacyCourseUnsupportedError();
  if (schemaVersion > CURRENT_SCHEMA_VERSION) throw new FutureCourseSchemaVersionError();
  try {
    // 1. 把数据库中的 JSON 还原成课程对象，并检查字段是否完整。
    const briefDocument = decodeJson<{ brief: Course["brief"]; resolution: Course["briefResolution"] }>(row.brief_json);
    return CourseSchema.parse({
      schemaVersion,
      id: row.id,
      topic: row.topic,
      title: row.title,
      requestedSceneCount: Number(row.requested_scene_count),
      status: row.status,
      revision: Number(row.revision),
      brief: briefDocument?.brief,
      briefResolution: briefDocument?.resolution,
      outlines: decodeJson(row.outlines_json),
      scenes: decodeJson(row.scenes_json),
      sceneProgress: decodeJson(row.scene_progress_json),
      outlineGeneration: row.outline_generation_json === null ? undefined : decodeJson(row.outline_generation_json),
      activeOperation: row.active_operation_json === null ? undefined : decodeJson(row.active_operation_json),
      lastError: row.last_error_json === null ? undefined : decodeJson(row.last_error_json),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    });
  } catch (error) {
    throw new StoredCourseInvalidError({ cause: error });
  }
}

function valuesForCourse(course: Course): Array<string | number | null> {
  // 2. 把课程中的数组和对象转成 MySQL 可以保存的 JSON。
  return [
    course.id,
    course.schemaVersion,
    course.revision,
    course.topic,
    course.title,
    course.status,
    course.requestedSceneCount,
    JSON.stringify({ brief: course.brief, resolution: course.briefResolution }),
    JSON.stringify(course.outlines),
    JSON.stringify(course.scenes),
    JSON.stringify(course.sceneProgress),
    course.outlineGeneration ? JSON.stringify(course.outlineGeneration) : null,
    course.activeOperation ? JSON.stringify(course.activeOperation) : null,
    course.lastError ? JSON.stringify(course.lastError) : null,
    course.createdAt,
    course.updatedAt,
  ];
}

function isMysqlError(error: unknown): error is { code?: string } {
  return typeof error === "object" && error !== null && "code" in error;
}

function rethrowQueryError(error: unknown): never {
  if (error instanceof CourseConflictError || error instanceof StoredCourseInvalidError || error instanceof LegacyCourseUnsupportedError || error instanceof FutureCourseSchemaVersionError) throw error;
  if (isMysqlError(error) && error.code === "ER_DUP_ENTRY") throw new CourseConflictError();
  throw new DatabaseUnavailableError({ cause: error });
}

export class MySQLCourseRepository implements CourseRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  /** 将通过 CourseSchema 的完整聚合写入 courses 主表。 */
  async create(course: Course): Promise<Course> {
    // 3. 写入前先检查课程数据。
    const parsed = CourseSchema.parse(course);
    try {
      await this.pool.execute<ResultSetHeader>(
        `INSERT INTO courses (
          id, schema_version, revision, topic, title, status, requested_scene_count,
          brief_json, outlines_json, scenes_json, scene_progress_json, outline_generation_json,
          active_operation_json, last_error_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        valuesForCourse(parsed),
      );
      return structuredClone(parsed);
    } catch (error) {
      rethrowQueryError(error);
    }
  }

  /** 按主键读取课程；数据库不存在该课程时明确返回 null。 */
  async get(id: string): Promise<Course | null> {
    let rows: CourseRow[];
    try {
      [rows] = await this.pool.execute<CourseRow[]>("SELECT * FROM courses WHERE id = ? LIMIT 1", [id]);
    } catch (error) {
      rethrowQueryError(error);
    }
    return rows.length === 0 ? null : mapCourseRow(rows[0]);
  }

  /** 读取并校验课程后生成首页摘要，避免 JSON 列绕开领域边界。 */
  async list(): Promise<CourseSummary[]> {
    let rows: CourseRow[];
    try {
      [rows] = await this.pool.query<CourseRow[]>("SELECT * FROM courses WHERE schema_version = ? ORDER BY updated_at DESC", [CURRENT_SCHEMA_VERSION]);
    } catch (error) {
      rethrowQueryError(error);
    }
    return rows.map(mapCourseRow).map((course) => ({
      id: course.id,
      topic: course.topic,
      title: course.title,
      status: course.status,
      requestedSceneCount: course.requestedSceneCount,
      readySceneCount: course.sceneProgress.filter((item) => item.status === "ready").length,
      revision: course.revision,
      updatedAt: course.updatedAt,
    }));
  }

  /** 在短事务中用 revision 条件更新完整聚合，防止迟到响应覆盖新结果。 */
  async save(course: Course, expectedRevision: number, options: CourseSaveOptions = {}): Promise<Course> {
    if (course.revision !== expectedRevision) throw new CourseConflictError();
    // 4. 保存时把课程版本号加一。
    const nextCourse = CourseSchema.parse({
      ...course,
      revision: expectedRevision + 1,
      updatedAt: Math.max(Date.now(), course.updatedAt),
    });
    let connection: PoolConnection | undefined;
    try {
      connection = await this.pool.getConnection();
      await connection.beginTransaction();
      // 5. 只有数据库版本号仍等于 expectedRevision 时才更新。
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE courses SET
          schema_version = ?, revision = ?, topic = ?, title = ?, status = ?, requested_scene_count = ?,
          brief_json = ?, outlines_json = ?, scenes_json = ?, scene_progress_json = ?, outline_generation_json = ?,
          active_operation_json = ?, last_error_json = ?, created_at = ?, updated_at = ?
        WHERE id = ? AND revision = ?`,
        [
          nextCourse.schemaVersion,
          nextCourse.revision,
          nextCourse.topic,
          nextCourse.title,
          nextCourse.status,
          nextCourse.requestedSceneCount,
          JSON.stringify({ brief: nextCourse.brief, resolution: nextCourse.briefResolution }),
          JSON.stringify(nextCourse.outlines),
          JSON.stringify(nextCourse.scenes),
          JSON.stringify(nextCourse.sceneProgress),
          nextCourse.outlineGeneration ? JSON.stringify(nextCourse.outlineGeneration) : null,
          nextCourse.activeOperation ? JSON.stringify(nextCourse.activeOperation) : null,
          nextCourse.lastError ? JSON.stringify(nextCourse.lastError) : null,
          nextCourse.createdAt,
          nextCourse.updatedAt,
          nextCourse.id,
          expectedRevision,
        ],
      );
      if (result.affectedRows !== 1) throw new CourseConflictError();
      // quiz 场景正式替换后，旧题目的作答必须与课程更新在同一事务清理。
      if (options.clearQuizAttemptsForSceneId) {
        await connection.execute<ResultSetHeader>(
          "DELETE FROM quiz_attempts WHERE course_id = ? AND scene_id = ?",
          [nextCourse.id, options.clearQuizAttemptsForSceneId],
        );
      }
      await connection.commit();
      return structuredClone(nextCourse);
    } catch (error) {
      if (connection) await connection.rollback();
      rethrowQueryError(error);
    } finally {
      connection?.release();
    }
    throw new DatabaseUnavailableError();
  }

  /** 删除聚合根；quiz_attempts 由数据库外键级联清理。 */
  async delete(id: string): Promise<void> {
    try {
      await this.pool.execute<ResultSetHeader>("DELETE FROM courses WHERE id = ?", [id]);
    } catch (error) {
      rethrowQueryError(error);
    }
  }
}
