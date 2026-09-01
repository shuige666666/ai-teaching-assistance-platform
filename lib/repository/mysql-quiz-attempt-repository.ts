import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import { getDatabasePool } from "@/lib/db/pool";
import { QuizAttemptSchema, type QuizAttempt } from "@/lib/domain/quiz-attempt";
import { DatabaseUnavailableError } from "./course-repository";
import type { QuizAttemptRepository } from "./quiz-attempt-repository";

interface QuizAttemptRow extends RowDataPacket {
  id: string;
  course_id: string;
  scene_id: string;
  question_id: string;
  selected_option_ids_json: string | string[];
  correct: number | boolean;
  submitted_at: string | number;
}

function mapRow(row: QuizAttemptRow): QuizAttempt {
  return QuizAttemptSchema.parse({
    id: row.id,
    courseId: row.course_id,
    sceneId: row.scene_id,
    questionId: row.question_id,
    selectedOptionIds: typeof row.selected_option_ids_json === "string" ? JSON.parse(row.selected_option_ids_json) : row.selected_option_ids_json,
    correct: Boolean(row.correct),
    submittedAt: Number(row.submitted_at),
  });
}

export class MySQLQuizAttemptRepository implements QuizAttemptRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  /** 单独写入作答记录，避免学习行为改变课程内容的 revision。 */
  async create(attempt: QuizAttempt): Promise<QuizAttempt> {
    const parsed = QuizAttemptSchema.parse(attempt);
    try {
      await this.pool.execute<ResultSetHeader>(
        `INSERT INTO quiz_attempts (
          id, course_id, scene_id, question_id, selected_option_ids_json, correct, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [parsed.id, parsed.courseId, parsed.sceneId, parsed.questionId, JSON.stringify(parsed.selectedOptionIds), parsed.correct, parsed.submittedAt],
      );
      return structuredClone(parsed);
    } catch (error) {
      throw new DatabaseUnavailableError({ cause: error });
    }
  }

  /** 提供验收和后续学习分析所需的课程作答历史。 */
  async listByCourse(courseId: string): Promise<QuizAttempt[]> {
    try {
      const [rows] = await this.pool.execute<QuizAttemptRow[]>(
        "SELECT * FROM quiz_attempts WHERE course_id = ? ORDER BY submitted_at ASC, id ASC",
        [courseId],
      );
      return rows.map(mapRow);
    } catch (error) {
      throw new DatabaseUnavailableError({ cause: error });
    }
  }
}
