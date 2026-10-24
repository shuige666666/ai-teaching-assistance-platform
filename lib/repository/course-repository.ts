import type { Course, CourseSummary } from "@/lib/domain/schemas";
import type { CourseMaterial } from "@/lib/materials/types";

export type CourseSaveOptions = {
  clearQuizAttemptsForSceneId?: string;
  replaceMaterials?: CourseMaterial[];
};

export interface CourseRepository {
  create(course: Course): Promise<Course>;
  get(id: string): Promise<Course | null>;
  list(): Promise<CourseSummary[]>;
  listMaterials(courseId: string): Promise<CourseMaterial[]>;
  save(course: Course, expectedRevision: number, options?: CourseSaveOptions): Promise<Course>;
  delete(id: string): Promise<void>;
}

export class CourseConflictError extends Error {
  constructor() { super("COURSE_CONFLICT"); this.name = "CourseConflictError"; }
}

export class DatabaseUnavailableError extends Error {
  constructor(options?: ErrorOptions) { super("DATABASE_UNAVAILABLE", options); this.name = "DatabaseUnavailableError"; }
}

export class StoredCourseInvalidError extends Error {
  constructor(options?: ErrorOptions) { super("STORED_COURSE_INVALID", options); this.name = "StoredCourseInvalidError"; }
}

export class LegacyCourseUnsupportedError extends Error {
  constructor() { super("LEGACY_COURSE_UNSUPPORTED"); this.name = "LegacyCourseUnsupportedError"; }
}

export class FutureCourseSchemaVersionError extends Error {
  constructor() { super("FUTURE_COURSE_SCHEMA_VERSION"); this.name = "FutureCourseSchemaVersionError"; }
}

export class RepositoryConfigurationError extends Error {
  constructor() { super("REPOSITORY_CONFIGURATION_INVALID"); this.name = "RepositoryConfigurationError"; }
}
