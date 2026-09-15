import type { CourseFolder, CourseFolderMembership } from "@/lib/domain/course-folder";

export type CourseFolderDeleteMode = "unfile" | "delete_courses";

export type CourseFolderDeleteResult = {
  folderId: string;
  deletedCourseIds: string[];
};

export interface CourseFolderRepository {
  create(name: string): Promise<CourseFolder>;
  get(id: string): Promise<CourseFolder | null>;
  list(): Promise<CourseFolder[]>;
  rename(id: string, name: string): Promise<CourseFolder | null>;
  delete(id: string, mode?: CourseFolderDeleteMode): Promise<CourseFolderDeleteResult | null>;
  listMemberships(): Promise<CourseFolderMembership[]>;
  moveCourse(courseId: string, folderId: string | null): Promise<CourseFolderMembership | null>;
  removeCourse(courseId: string): Promise<void>;
}

export class CourseFolderNameConflictError extends Error {
  constructor() { super("COURSE_FOLDER_NAME_CONFLICT"); this.name = "CourseFolderNameConflictError"; }
}

export class CourseFolderNotFoundError extends Error {
  constructor() { super("COURSE_FOLDER_NOT_FOUND"); this.name = "CourseFolderNotFoundError"; }
}
