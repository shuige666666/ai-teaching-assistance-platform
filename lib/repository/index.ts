import { InMemoryCourseRepository } from "./in-memory-course-repository";
import { MySQLCourseRepository } from "./mysql-course-repository";
import { RepositoryConfigurationError, type CourseRepository } from "./course-repository";

const globalRepository = globalThis as typeof globalThis & {
  __aiTeachingCourseRepository?: CourseRepository;
};

/**
 * 根据显式服务端配置选择仓储。M2 默认使用 MySQL；内存实现仅保留给单元测试和受控演示。
 */
export function getCourseRepository(): CourseRepository {
  if (!globalRepository.__aiTeachingCourseRepository) {
    const repositoryType = process.env.COURSE_REPOSITORY ?? "mysql";
    if (repositoryType === "mysql") globalRepository.__aiTeachingCourseRepository = new MySQLCourseRepository();
    else if (repositoryType === "memory") globalRepository.__aiTeachingCourseRepository = new InMemoryCourseRepository();
    else throw new RepositoryConfigurationError();
  }
  return globalRepository.__aiTeachingCourseRepository;
}

export type { CourseRepository } from "./course-repository";
