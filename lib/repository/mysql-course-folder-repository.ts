import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";
import { CourseFolderNameSchema, CourseFolderSchema, CourseFolderMembershipSchema } from "@/lib/domain/course-folder";
import { getDatabasePool } from "@/lib/db/pool";
import { DatabaseUnavailableError } from "./course-repository";
import { CourseFolderNameConflictError, CourseFolderNotFoundError, type CourseFolderDeleteMode, type CourseFolderRepository } from "./course-folder-repository";

interface FolderRow extends RowDataPacket {
  id: string;
  name: string;
  sort_order: number;
  created_at: number | string;
  updated_at: number | string;
}

interface MembershipRow extends RowDataPacket {
  course_id: string;
  folder_id: string;
  moved_at: number | string;
}

function mapFolder(row: FolderRow) {
  return CourseFolderSchema.parse({ id: row.id, name: row.name, order: Number(row.sort_order), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) });
}

function mapMembership(row: MembershipRow) {
  return CourseFolderMembershipSchema.parse({ courseId: row.course_id, folderId: row.folder_id, movedAt: Number(row.moved_at) });
}

function isMysqlError(error: unknown): error is { code?: string } {
  return typeof error === "object" && error !== null && "code" in error;
}

function rethrowFolderError(error: unknown): never {
  if (error instanceof CourseFolderNameConflictError || error instanceof CourseFolderNotFoundError) throw error;
  if (isMysqlError(error) && error.code === "ER_DUP_ENTRY") throw new CourseFolderNameConflictError();
  throw new DatabaseUnavailableError({ cause: error });
}

export class MySQLCourseFolderRepository implements CourseFolderRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  /** 创建文件夹，新文件夹按当前最大顺序追加到末尾。 */
  async create(name: string) {
    const normalizedName = CourseFolderNameSchema.parse(name);
    const id = randomUUID();
    const now = Date.now();
    try {
      const [rows] = await this.pool.query<(RowDataPacket & { next_order: number | string })[]>("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM course_folders");
      const folder = CourseFolderSchema.parse({ id, name: normalizedName, order: Number(rows[0]?.next_order ?? 0), createdAt: now, updatedAt: now });
      await this.pool.execute<ResultSetHeader>("INSERT INTO course_folders (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [folder.id, folder.name, folder.order, folder.createdAt, folder.updatedAt]);
      return folder;
    } catch (error) {
      rethrowFolderError(error);
    }
  }

  async get(id: string) {
    try {
      const [rows] = await this.pool.execute<FolderRow[]>("SELECT * FROM course_folders WHERE id = ? LIMIT 1", [id]);
      return rows[0] ? mapFolder(rows[0]) : null;
    } catch (error) {
      rethrowFolderError(error);
    }
  }

  async list() {
    try {
      const [rows] = await this.pool.query<FolderRow[]>("SELECT * FROM course_folders ORDER BY sort_order ASC, created_at ASC");
      return rows.map(mapFolder);
    } catch (error) {
      rethrowFolderError(error);
    }
  }

  async rename(id: string, name: string) {
    const normalizedName = CourseFolderNameSchema.parse(name);
    const now = Date.now();
    try {
      const [result] = await this.pool.execute<ResultSetHeader>("UPDATE course_folders SET name = ?, updated_at = ? WHERE id = ?", [normalizedName, now, id]);
      if (result.affectedRows === 0) return null;
      return (await this.get(id))!;
    } catch (error) {
      rethrowFolderError(error);
    }
  }

  /** 删除文件夹；可选择仅解除归属，或在同一事务内连同所属课程一并删除。 */
  async delete(id: string, mode: CourseFolderDeleteMode = "unfile") {
    let connection: PoolConnection | undefined;
    try {
      connection = await this.pool.getConnection();
      await connection.beginTransaction();
      const [rows] = await connection.execute<Array<RowDataPacket & { course_id: string }>>(
        "SELECT course_id FROM course_folder_memberships WHERE folder_id = ? FOR UPDATE",
        [id],
      );
      const [result] = await connection.execute<ResultSetHeader>("DELETE FROM course_folders WHERE id = ?", [id]);
      if (result.affectedRows !== 1) {
        await connection.rollback();
        return null;
      }
      const courseIds = rows.map((row) => row.course_id);
      if (mode === "delete_courses" && courseIds.length > 0) {
        const placeholders = courseIds.map(() => "?").join(", ");
        await connection.execute<ResultSetHeader>(`DELETE FROM courses WHERE id IN (${placeholders})`, courseIds);
      }
      await connection.commit();
      return { folderId: id, deletedCourseIds: mode === "delete_courses" ? courseIds : [] };
    } catch (error) {
      await connection?.rollback();
      rethrowFolderError(error);
    } finally {
      connection?.release();
    }
  }

  async listMemberships() {
    try {
      const [rows] = await this.pool.query<MembershipRow[]>("SELECT course_id, folder_id, moved_at FROM course_folder_memberships");
      return rows.map(mapMembership);
    } catch (error) {
      rethrowFolderError(error);
    }
  }

  /** 用单条 upsert 移动课程；folderId 为空时移回未分类。 */
  async moveCourse(courseId: string, folderId: string | null) {
    try {
      if (folderId === null) {
        await this.pool.execute<ResultSetHeader>("DELETE FROM course_folder_memberships WHERE course_id = ?", [courseId]);
        return null;
      }
      const movedAt = Date.now();
      const [result] = await this.pool.execute<ResultSetHeader>(
        `INSERT INTO course_folder_memberships (course_id, folder_id, moved_at)
         SELECT ?, id, ? FROM course_folders WHERE id = ?
         ON DUPLICATE KEY UPDATE folder_id = VALUES(folder_id), moved_at = VALUES(moved_at)`,
        [courseId, movedAt, folderId],
      );
      if (result.affectedRows === 0) throw new CourseFolderNotFoundError();
      return CourseFolderMembershipSchema.parse({ courseId, folderId, movedAt });
    } catch (error) {
      rethrowFolderError(error);
    }
  }

  async removeCourse(courseId: string) {
    try {
      await this.pool.execute<ResultSetHeader>("DELETE FROM course_folder_memberships WHERE course_id = ?", [courseId]);
    } catch (error) {
      rethrowFolderError(error);
    }
  }
}
