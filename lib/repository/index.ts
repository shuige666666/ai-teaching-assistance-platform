import { InMemoryCourseRepository } from "./in-memory-course-repository";
import { MySQLCourseRepository } from "./mysql-course-repository";
import { MySQLQuizAttemptRepository } from "./mysql-quiz-attempt-repository";
import { RepositoryConfigurationError, type CourseRepository } from "./course-repository";
import type { QuizAttemptRepository } from "./quiz-attempt-repository";

const globalRepository = globalThis as typeof globalThis & {
  __aiTeachingCourseRepository?: CourseRepository;
  __aiTeachingQuizAttemptRepository?: QuizAttemptRepository;
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

/** 测验作答是独立事实表，正式运行时始终与 MySQL 课程仓储配套。 */
export function getQuizAttemptRepository(): QuizAttemptRepository {
  if (!globalRepository.__aiTeachingQuizAttemptRepository) {
    const repositoryType = process.env.COURSE_REPOSITORY ?? "mysql";
    if (repositoryType !== "mysql") throw new RepositoryConfigurationError();
    globalRepository.__aiTeachingQuizAttemptRepository = new MySQLQuizAttemptRepository();
  }
  return globalRepository.__aiTeachingQuizAttemptRepository;
}

export type { CourseRepository } from "./course-repository";
