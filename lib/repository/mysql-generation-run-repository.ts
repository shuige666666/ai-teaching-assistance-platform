import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import {
  GenerationRunSchema,
  type GenerationMetricDelta,
  type GenerationRun,
  type GenerationRunCreateInput,
  type GenerationRunStatus,
  type GenerationRunType,
  type GenerationRunWithCourse,
} from "@/lib/domain/generation-run";
import { getDatabasePool } from "@/lib/db/pool";
import { DatabaseUnavailableError } from "./course-repository";
import type { GenerationRunRepository } from "./generation-run-repository";

interface GenerationRunRow extends RowDataPacket {
  id: string;
  course_id: string;
  run_type: GenerationRun["runType"];
  status: GenerationRun["status"];
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  method_version: string | null;
  root_request_id: string | null;
  base_revision: string | number;
  final_revision: string | number | null;
  requested_scene_count: number;
  succeeded_scene_count: number;
  failed_scene_count: number;
  first_pass_succeeded_count: number;
  model_calls: number;
  repair_count: number;
  repair_succeeded_count: number;
  input_tokens: string | number | null;
  output_tokens: string | number | null;
  usage_status: GenerationRun["usageStatus"];
  active_duration_ms: string | number;
  error_code: string | null;
  config_json: unknown | null;
  started_at: string | number;
  finished_at: string | number | null;
  updated_at: string | number;
  course_title?: string;
}

function optionalNumber(value: string | number | null) { return value === null ? undefined : Number(value); }
function optionalString(value: string | null) { return value === null ? undefined : value; }
function decodeJson(value: unknown) { return typeof value === "string" ? JSON.parse(value) : value; }

function mapRow(row: GenerationRunRow): GenerationRun {
  return GenerationRunSchema.parse({
    id: row.id,
    courseId: row.course_id,
    runType: row.run_type,
    status: row.status,
    provider: optionalString(row.provider),
    model: optionalString(row.model),
    promptVersion: optionalString(row.prompt_version),
    methodVersion: optionalString(row.method_version),
    rootRequestId: optionalString(row.root_request_id),
    baseRevision: Number(row.base_revision),
    finalRevision: optionalNumber(row.final_revision),
    requestedSceneCount: Number(row.requested_scene_count),
    succeededSceneCount: Number(row.succeeded_scene_count),
    failedSceneCount: Number(row.failed_scene_count),
    firstPassSucceededCount: Number(row.first_pass_succeeded_count),
    modelCalls: Number(row.model_calls),
    repairCount: Number(row.repair_count),
    repairSucceededCount: Number(row.repair_succeeded_count),
    inputTokens: optionalNumber(row.input_tokens),
    outputTokens: optionalNumber(row.output_tokens),
    usageStatus: row.usage_status,
    activeDurationMs: Number(row.active_duration_ms),
    errorCode: optionalString(row.error_code),
    config: row.config_json === null ? undefined : decodeJson(row.config_json),
    startedAt: Number(row.started_at),
    finishedAt: optionalNumber(row.finished_at),
    updatedAt: Number(row.updated_at),
  });
}

function rethrow(error: unknown): never {
  throw error instanceof DatabaseUnavailableError ? error : new DatabaseUnavailableError({ cause: error });
}

const terminalStatuses = ["completed", "partial_failed", "failed", "cancelled", "interrupted", "superseded"];

export class MySQLGenerationRunRepository implements GenerationRunRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  /** 新建一次运行事实；正文和 Prompt 不进入运行表。 */
  async create(input: GenerationRunCreateInput): Promise<GenerationRun> {
    const run = GenerationRunSchema.parse({
      ...input,
      id: crypto.randomUUID(),
      succeededSceneCount: 0,
      failedSceneCount: 0,
      firstPassSucceededCount: 0,
      modelCalls: 0,
      repairCount: 0,
      repairSucceededCount: 0,
      usageStatus: "unavailable",
      activeDurationMs: 0,
    });
    try {
      await this.pool.execute<ResultSetHeader>(
        `INSERT INTO generation_runs (
          id, course_id, run_type, status, provider, model, prompt_version, method_version, root_request_id,
          base_revision, final_revision, requested_scene_count, succeeded_scene_count, failed_scene_count,
          first_pass_succeeded_count, model_calls, repair_count, repair_succeeded_count, input_tokens,
          output_tokens, usage_status, active_duration_ms, error_code, config_json, started_at, finished_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, NULL, NULL, 'unavailable', 0, NULL, ?, ?, NULL, ?)`,
        [
          run.id, run.courseId, run.runType, run.status, run.provider ?? null, run.model ?? null,
          run.promptVersion ?? null, run.methodVersion ?? null, run.rootRequestId ?? null, run.baseRevision,
          run.finalRevision ?? null, run.requestedSceneCount, run.config ? JSON.stringify(run.config) : null,
          run.startedAt, run.updatedAt,
        ],
      );
      return run;
    } catch (error) { rethrow(error); }
  }

  async get(id: string) {
    try {
      const [rows] = await this.pool.execute<GenerationRunRow[]>("SELECT * FROM generation_runs WHERE id = ? LIMIT 1", [id]);
      return rows[0] ? mapRow(rows[0]) : null;
    } catch (error) { rethrow(error); }
  }

  async findOpen(courseId: string, runTypes: GenerationRunType[]) {
    if (runTypes.length === 0) return null;
    const placeholders = runTypes.map(() => "?").join(", ");
    try {
      const [rows] = await this.pool.execute<GenerationRunRow[]>(
        `SELECT * FROM generation_runs
         WHERE course_id = ? AND run_type IN (${placeholders})
           AND status NOT IN (?, ?, ?, ?, ?, ?)
         ORDER BY started_at DESC LIMIT 1`,
        [courseId, ...runTypes, ...terminalStatuses],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    } catch (error) { rethrow(error); }
  }

  /** 通过单条 UPDATE 原子累加，页面刷新或重复读取不会丢失已有计数。 */
  async appendMetrics(id: string, delta: GenerationMetricDelta) {
    const nextCalls = delta.modelCalls ?? 0;
    const nextUsage = delta.usageStatus ?? "unavailable";
    try {
      await this.pool.execute<ResultSetHeader>(
        `UPDATE generation_runs SET
          provider = COALESCE(provider, ?), model = COALESCE(model, ?), prompt_version = COALESCE(prompt_version, ?),
          final_revision = COALESCE(?, final_revision), error_code = COALESCE(?, error_code),
          succeeded_scene_count = succeeded_scene_count + ?, failed_scene_count = failed_scene_count + ?,
          first_pass_succeeded_count = first_pass_succeeded_count + ?, repair_count = repair_count + ?,
          repair_succeeded_count = repair_succeeded_count + ?, active_duration_ms = active_duration_ms + ?,
          usage_status = CASE
            WHEN ? = 0 THEN usage_status
            WHEN model_calls = 0 THEN ?
            WHEN usage_status = 'complete' AND ? = 'complete' THEN 'complete'
            WHEN usage_status = 'unavailable' AND ? = 'unavailable' THEN 'unavailable'
            ELSE 'partial'
          END,
          input_tokens = CASE WHEN ? IS NULL THEN input_tokens ELSE COALESCE(input_tokens, 0) + ? END,
          output_tokens = CASE WHEN ? IS NULL THEN output_tokens ELSE COALESCE(output_tokens, 0) + ? END,
          model_calls = model_calls + ?, updated_at = ?
        WHERE id = ? AND status NOT IN (?, ?, ?, ?, ?, ?)`,
        [
          delta.provider ?? null, delta.model ?? null, delta.promptVersion ?? null,
          delta.finalRevision ?? null, delta.errorCode ?? null,
          delta.succeededSceneCount ?? 0, delta.failedSceneCount ?? 0, delta.firstPassSucceededCount ?? 0,
          delta.repairCount ?? 0, delta.repairSucceededCount ?? 0, delta.activeDurationMs ?? 0,
          nextCalls, nextUsage, nextUsage, nextUsage,
          delta.inputTokens ?? null, delta.inputTokens ?? null, delta.outputTokens ?? null, delta.outputTokens ?? null,
          nextCalls, delta.updatedAt, id, ...terminalStatuses,
        ],
      );
      return this.get(id);
    } catch (error) { rethrow(error); }
  }

  async transition(id: string, status: GenerationRunStatus, options: { finalRevision?: number; errorCode?: string; finishedAt?: number; updatedAt: number }) {
    try {
      await this.pool.execute<ResultSetHeader>(
        `UPDATE generation_runs SET status = ?, final_revision = COALESCE(?, final_revision),
          error_code = COALESCE(?, error_code), finished_at = ?, updated_at = ?
         WHERE id = ? AND status NOT IN (?, ?, ?, ?, ?, ?)`,
        [status, options.finalRevision ?? null, options.errorCode ?? null, options.finishedAt ?? null, options.updatedAt, id, ...terminalStatuses],
      );
      return this.get(id);
    } catch (error) { rethrow(error); }
  }

  async supersedeOpenCourseGeneration(courseId: string, at: number) {
    try {
      await this.pool.execute<ResultSetHeader>(
        `UPDATE generation_runs SET status = 'superseded', finished_at = ?, updated_at = ?
         WHERE course_id = ? AND run_type = 'course_generation' AND status NOT IN (?, ?, ?, ?, ?, ?)`,
        [at, at, courseId, ...terminalStatuses],
      );
    } catch (error) { rethrow(error); }
  }

  async listForUsage(startedAtFrom?: number): Promise<GenerationRunWithCourse[]> {
    try {
      const where = startedAtFrom === undefined ? "" : "WHERE r.started_at >= ?";
      const [rows] = await this.pool.execute<GenerationRunRow[]>(
        `SELECT r.*, c.title AS course_title FROM generation_runs r
         INNER JOIN courses c ON c.id = r.course_id ${where}
         ORDER BY r.started_at DESC`,
        startedAtFrom === undefined ? [] : [startedAtFrom],
      );
      return rows.map((row) => ({ ...mapRow(row), courseTitle: row.course_title ?? "未命名课程" }));
    } catch (error) { rethrow(error); }
  }

  async deleteByCourseId(courseId: string) {
    try { await this.pool.execute<ResultSetHeader>("DELETE FROM generation_runs WHERE course_id = ?", [courseId]); }
    catch (error) { rethrow(error); }
  }
}
