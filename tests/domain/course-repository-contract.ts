import { afterEach, describe, expect, it } from "vitest";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { CourseConflictError, type CourseRepository } from "@/lib/repository/course-repository";

/** 对所有 CourseRepository 实现执行同一组 CRUD 与乐观锁契约。 */
export function courseRepositoryContract(name: string, createRepository: () => CourseRepository) {
  describe(`${name} CourseRepository contract`, () => {
    let repository: CourseRepository;
    const createdIds: string[] = [];

    afterEach(async () => {
      await Promise.all(createdIds.splice(0).map((id) => repository.delete(id)));
    });

    it("create/get/list 返回通过正式契约的课程", async () => {
      repository = createRepository();
      const created = await repository.create(createFixtureCourse(`仓储契约 ${crypto.randomUUID()}`, 4));
      createdIds.push(created.id);
      expect((await repository.get(created.id))?.id).toBe(created.id);
      expect((await repository.list()).some((item) => item.id === created.id)).toBe(true);
    });

    it("save 按 expectedRevision 递增版本并拒绝迟到写入", async () => {
      repository = createRepository();
      const created = await repository.create(createFixtureCourse(`版本控制 ${crypto.randomUUID()}`, 4));
      createdIds.push(created.id);
      const saved = await repository.save(materializeFixtureCourse(created), 0);
      expect(saved.revision).toBe(1);
      expect((await repository.get(saved.id))?.status).toBe("ready");
      await expect(repository.save(materializeFixtureCourse(created), 0)).rejects.toBeInstanceOf(CourseConflictError);
    });
  });
}
