import { randomUUID } from "node:crypto";
import { CourseFolderNameSchema, CourseFolderSchema, CourseFolderMembershipSchema, type CourseFolder, type CourseFolderMembership } from "@/lib/domain/course-folder";
import { CourseFolderNameConflictError, CourseFolderNotFoundError, type CourseFolderRepository } from "./course-folder-repository";
import type { CourseRepository } from "./course-repository";

export class InMemoryCourseFolderRepository implements CourseFolderRepository {
  private readonly folders = new Map<string, CourseFolder>();
  private readonly memberships = new Map<string, CourseFolderMembership>();

  constructor(private readonly courseRepository?: CourseRepository) {}

  async create(name: string) {
    const normalizedName = CourseFolderNameSchema.parse(name);
    if ([...this.folders.values()].some((folder) => folder.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) throw new CourseFolderNameConflictError();
    const now = Date.now();
    const folder = CourseFolderSchema.parse({ id: randomUUID(), name: normalizedName, order: this.folders.size, createdAt: now, updatedAt: now });
    this.folders.set(folder.id, folder);
    return structuredClone(folder);
  }

  async get(id: string) {
    const folder = this.folders.get(id);
    return folder ? structuredClone(folder) : null;
  }

  async list() {
    return [...this.folders.values()].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt).map((folder) => structuredClone(folder));
  }

  async rename(id: string, name: string) {
    const current = this.folders.get(id);
    if (!current) return null;
    const normalizedName = CourseFolderNameSchema.parse(name);
    if ([...this.folders.values()].some((folder) => folder.id !== id && folder.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) throw new CourseFolderNameConflictError();
    const updated = CourseFolderSchema.parse({ ...current, name: normalizedName, updatedAt: Date.now() });
    this.folders.set(id, updated);
    return structuredClone(updated);
  }

  async delete(id: string, mode: "unfile" | "delete_courses" = "unfile") {
    if (!this.folders.has(id)) return null;
    const courseIds = [...this.memberships.values()]
      .filter((membership) => membership.folderId === id)
      .map((membership) => membership.courseId);
    if (mode === "delete_courses") {
      for (const courseId of courseIds) await this.courseRepository?.delete(courseId);
    }
    this.folders.delete(id);
    for (const courseId of courseIds) this.memberships.delete(courseId);
    return { folderId: id, deletedCourseIds: mode === "delete_courses" ? courseIds : [] };
  }

  async listMemberships() {
    return [...this.memberships.values()].map((membership) => structuredClone(membership));
  }

  async moveCourse(courseId: string, folderId: string | null) {
    if (folderId === null) {
      this.memberships.delete(courseId);
      return null;
    }
    if (!this.folders.has(folderId)) throw new CourseFolderNotFoundError();
    const membership = CourseFolderMembershipSchema.parse({ courseId, folderId, movedAt: Date.now() });
    this.memberships.set(courseId, membership);
    return structuredClone(membership);
  }

  async removeCourse(courseId: string) {
    this.memberships.delete(courseId);
  }
}
