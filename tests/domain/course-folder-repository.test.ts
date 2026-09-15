import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCourseDraft } from "@/lib/domain/fixture";
import { CourseFolderNameConflictError, CourseFolderNotFoundError } from "@/lib/repository/course-folder-repository";
import { InMemoryCourseFolderRepository } from "@/lib/repository/in-memory-course-folder-repository";
import { InMemoryCourseRepository } from "@/lib/repository/in-memory-course-repository";

describe("CourseFolderRepository", () => {
  it("创建、重命名并拒绝大小写不同的同名文件夹", async () => {
    const repository = new InMemoryCourseFolderRepository();
    const folder = await repository.create("计算机网络");
    await expect(repository.create("计算机网络")).rejects.toBeInstanceOf(CourseFolderNameConflictError);
    const renamed = await repository.rename(folder.id, "数据库课程");
    expect(renamed?.name).toBe("数据库课程");
    expect((await repository.list()).map((item) => item.name)).toEqual(["数据库课程"]);
  });

  it("删除文件夹时可以选择保留课程或连同课程删除", async () => {
    const courses = new InMemoryCourseRepository();
    const repository = new InMemoryCourseFolderRepository(courses);
    const folder = await repository.create("Java");
    const course = await courses.create(createCourseDraft("Java 并发", 4));
    await repository.moveCourse(course.id, folder.id);
    expect(await repository.listMemberships()).toEqual([expect.objectContaining({ courseId: course.id, folderId: folder.id })]);
    await repository.moveCourse(course.id, null);
    expect(await repository.listMemberships()).toEqual([]);
    await repository.moveCourse(course.id, folder.id);
    expect(await repository.delete(folder.id, "unfile")).toEqual({ folderId: folder.id, deletedCourseIds: [] });
    expect(await repository.listMemberships()).toEqual([]);
    expect(await courses.get(course.id)).not.toBeNull();

    const destructiveFolder = await repository.create("待删除课程");
    await repository.moveCourse(course.id, destructiveFolder.id);
    expect(await repository.delete(destructiveFolder.id, "delete_courses")).toEqual({ folderId: destructiveFolder.id, deletedCourseIds: [course.id] });
    expect(await courses.get(course.id)).toBeNull();
  });

  it("移动到不存在的文件夹时返回明确错误", async () => {
    const repository = new InMemoryCourseFolderRepository();
    await expect(repository.moveCourse(randomUUID(), randomUUID())).rejects.toBeInstanceOf(CourseFolderNotFoundError);
  });
});
