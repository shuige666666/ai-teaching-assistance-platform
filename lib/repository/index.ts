import { InMemoryCourseRepository } from "./in-memory-course-repository";
import { MySQLCourseRepository } from "./mysql-course-repository";
import { MySQLQuizAttemptRepository } from "./mysql-quiz-attempt-repository";
import { RepositoryConfigurationError, type CourseRepository } from "./course-repository";
import type { QuizAttemptRepository } from "./quiz-attempt-repository";
import type { AgentSessionRepository } from "./agent-session-repository";
import { InMemoryAgentSessionRepository } from "./in-memory-agent-session-repository";
import { MySQLAgentSessionRepository } from "./mysql-agent-session-repository";

const globalRepository = globalThis as typeof globalThis & {
  __aiTeachingCourseRepository?: CourseRepository;
  __aiTeachingQuizAttemptRepository?: QuizAttemptRepository;
  __aiTeachingAgentSessionRepository?: AgentSessionRepository;
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

/** Agent 会话与课程使用相同的运行仓储档，测试时提供进程内实现。 */
export function getAgentSessionRepository(): AgentSessionRepository {
  if (!globalRepository.__aiTeachingAgentSessionRepository) {
    const repositoryType = process.env.COURSE_REPOSITORY ?? "mysql";
    if (repositoryType === "mysql") globalRepository.__aiTeachingAgentSessionRepository = new MySQLAgentSessionRepository();
    else if (repositoryType === "memory") globalRepository.__aiTeachingAgentSessionRepository = new InMemoryAgentSessionRepository();
    else throw new RepositoryConfigurationError();
  }
  return globalRepository.__aiTeachingAgentSessionRepository!;
}

export type { CourseRepository } from "./course-repository";
export type { AgentSessionRepository } from "./agent-session-repository";
