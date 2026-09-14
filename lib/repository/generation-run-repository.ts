import type {
  GenerationMetricDelta,
  GenerationRun,
  GenerationRunCreateInput,
  GenerationRunStatus,
  GenerationRunType,
  GenerationRunWithCourse,
} from "@/lib/domain/generation-run";

export interface GenerationRunRepository {
  create(input: GenerationRunCreateInput): Promise<GenerationRun>;
  get(id: string): Promise<GenerationRun | null>;
  findOpen(courseId: string, runTypes: GenerationRunType[]): Promise<GenerationRun | null>;
  appendMetrics(id: string, delta: GenerationMetricDelta): Promise<GenerationRun | null>;
  transition(id: string, status: GenerationRunStatus, options: {
    finalRevision?: number;
    errorCode?: string;
    finishedAt?: number;
    updatedAt: number;
  }): Promise<GenerationRun | null>;
  supersedeOpenCourseGeneration(courseId: string, at: number): Promise<void>;
  listForUsage(startedAtFrom?: number): Promise<GenerationRunWithCourse[]>;
  deleteByCourseId(courseId: string): Promise<void>;
}
