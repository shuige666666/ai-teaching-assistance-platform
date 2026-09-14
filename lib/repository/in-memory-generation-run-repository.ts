import { randomUUID } from "node:crypto";
import {
  GenerationRunSchema,
  isTerminalGenerationRun,
  type GenerationMetricDelta,
  type GenerationRun,
  type GenerationRunCreateInput,
  type GenerationRunStatus,
  type GenerationRunType,
  type GenerationRunWithCourse,
  type UsageStatus,
} from "@/lib/domain/generation-run";
import type { GenerationRunRepository } from "./generation-run-repository";

function clone<T>(value: T): T { return structuredClone(value); }

function mergeUsageStatus(current: UsageStatus, currentCalls: number, next: UsageStatus | undefined, nextCalls: number): UsageStatus {
  if (nextCalls === 0) return current;
  if (currentCalls === 0) return next ?? "unavailable";
  if (current === "complete" && next === "complete") return "complete";
  if (current === "unavailable" && (next ?? "unavailable") === "unavailable") return "unavailable";
  return "partial";
}

export class InMemoryGenerationRunRepository implements GenerationRunRepository {
  private readonly runs = new Map<string, GenerationRun>();
  private readonly courseTitles = new Map<string, string>();

  /** 测试可登记课程标题，使内存用量查询与 MySQL JOIN 的输出一致。 */
  setCourseTitle(courseId: string, title: string) { this.courseTitles.set(courseId, title); }

  async create(input: GenerationRunCreateInput): Promise<GenerationRun> {
    if (input.courseTitle) this.courseTitles.set(input.courseId, input.courseTitle);
    const run = GenerationRunSchema.parse({
      ...input,
      id: randomUUID(),
      succeededSceneCount: 0,
      failedSceneCount: 0,
      firstPassSucceededCount: 0,
      modelCalls: 0,
      repairCount: 0,
      repairSucceededCount: 0,
      usageStatus: "unavailable",
      activeDurationMs: 0,
    });
    this.runs.set(run.id, clone(run));
    return clone(run);
  }

  async get(id: string) {
    const run = this.runs.get(id);
    return run ? clone(run) : null;
  }

  async findOpen(courseId: string, runTypes: GenerationRunType[]) {
    const run = [...this.runs.values()]
      .filter((item) => item.courseId === courseId && runTypes.includes(item.runType) && !isTerminalGenerationRun(item.status))
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    return run ? clone(run) : null;
  }

  async appendMetrics(id: string, delta: GenerationMetricDelta) {
    const current = this.runs.get(id);
    if (!current || isTerminalGenerationRun(current.status)) return current ? clone(current) : null;
    const nextCalls = delta.modelCalls ?? 0;
    const next = GenerationRunSchema.parse({
      ...current,
      provider: current.provider ?? delta.provider,
      model: current.model ?? delta.model,
      promptVersion: current.promptVersion ?? delta.promptVersion,
      finalRevision: delta.finalRevision ?? current.finalRevision,
      errorCode: delta.errorCode ?? current.errorCode,
      succeededSceneCount: current.succeededSceneCount + (delta.succeededSceneCount ?? 0),
      failedSceneCount: current.failedSceneCount + (delta.failedSceneCount ?? 0),
      firstPassSucceededCount: current.firstPassSucceededCount + (delta.firstPassSucceededCount ?? 0),
      modelCalls: current.modelCalls + nextCalls,
      repairCount: current.repairCount + (delta.repairCount ?? 0),
      repairSucceededCount: current.repairSucceededCount + (delta.repairSucceededCount ?? 0),
      inputTokens: delta.inputTokens === undefined ? current.inputTokens : (current.inputTokens ?? 0) + delta.inputTokens,
      outputTokens: delta.outputTokens === undefined ? current.outputTokens : (current.outputTokens ?? 0) + delta.outputTokens,
      usageStatus: mergeUsageStatus(current.usageStatus, current.modelCalls, delta.usageStatus, nextCalls),
      activeDurationMs: current.activeDurationMs + (delta.activeDurationMs ?? 0),
      updatedAt: delta.updatedAt,
    });
    this.runs.set(id, clone(next));
    return clone(next);
  }

  async transition(id: string, status: GenerationRunStatus, options: { finalRevision?: number; errorCode?: string; finishedAt?: number; updatedAt: number }) {
    const current = this.runs.get(id);
    if (!current || isTerminalGenerationRun(current.status)) return current ? clone(current) : null;
    const next = GenerationRunSchema.parse({
      ...current,
      status,
      finalRevision: options.finalRevision ?? current.finalRevision,
      errorCode: options.errorCode ?? current.errorCode,
      finishedAt: options.finishedAt,
      updatedAt: options.updatedAt,
    });
    this.runs.set(id, clone(next));
    return clone(next);
  }

  async supersedeOpenCourseGeneration(courseId: string, at: number) {
    for (const [id, run] of this.runs) {
      if (run.courseId !== courseId || run.runType !== "course_generation" || isTerminalGenerationRun(run.status)) continue;
      this.runs.set(id, { ...run, status: "superseded", finishedAt: at, updatedAt: at });
    }
  }

  async listForUsage(startedAtFrom?: number): Promise<GenerationRunWithCourse[]> {
    return [...this.runs.values()]
      .filter((run) => startedAtFrom === undefined || run.startedAt >= startedAtFrom)
      .map((run) => ({ ...clone(run), courseTitle: this.courseTitles.get(run.courseId) ?? "未命名课程" }));
  }

  async deleteByCourseId(courseId: string) {
    for (const [id, run] of this.runs) if (run.courseId === courseId) this.runs.delete(id);
    this.courseTitles.delete(courseId);
  }
}
