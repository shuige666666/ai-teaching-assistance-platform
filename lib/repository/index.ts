import { InMemoryCourseRepository } from "./in-memory-course-repository";
import { MySQLCourseRepository } from "./mysql-course-repository";
import { MySQLQuizAttemptRepository } from "./mysql-quiz-attempt-repository";
import { RepositoryConfigurationError, type CourseRepository } from "./course-repository";
import type { QuizAttemptRepository } from "./quiz-attempt-repository";
import type { AgentSessionRepository } from "./agent-session-repository";
import { InMemoryAgentSessionRepository } from "./in-memory-agent-session-repository";
import { MySQLAgentSessionRepository } from "./mysql-agent-session-repository";
import type { GenerationRunRepository } from "./generation-run-repository";
import { InMemoryGenerationRunRepository } from "./in-memory-generation-run-repository";
import { MySQLGenerationRunRepository } from "./mysql-generation-run-repository";
import { GenerationRunTracker } from "@/lib/application/generation-run-tracker";
import type { CourseFolderRepository } from "./course-folder-repository";
import { InMemoryCourseFolderRepository } from "./in-memory-course-folder-repository";
import { MySQLCourseFolderRepository } from "./mysql-course-folder-repository";

const globalRepository = globalThis as typeof globalThis & {
  __aiTeachingCourseRepository?: CourseRepository;
  __aiTeachingQuizAttemptRepository?: QuizAttemptRepository;
  __aiTeachingAgentSessionRepository?: AgentSessionRepository;
  __aiTeachingGenerationRunRepository?: GenerationRunRepository;
  __aiTeachingGenerationRunTracker?: GenerationRunTracker;
  __aiTeachingCourseFolderRepository?: CourseFolderRepository;
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

/** 生成运行历史与课程聚合分表保存；内存实现仅供测试和 mock 演示。 */
export function getGenerationRunRepository(): GenerationRunRepository {
  if (!globalRepository.__aiTeachingGenerationRunRepository) {
    const repositoryType = process.env.COURSE_REPOSITORY ?? "mysql";
    if (repositoryType === "mysql") globalRepository.__aiTeachingGenerationRunRepository = new MySQLGenerationRunRepository();
    else if (repositoryType === "memory") globalRepository.__aiTeachingGenerationRunRepository = new InMemoryGenerationRunRepository();
    else throw new RepositoryConfigurationError();
  }
  return globalRepository.__aiTeachingGenerationRunRepository;
}

/** 复用进程级 Tracker，使所有生成路由使用同一套运行口径。 */
export function getGenerationRunTracker(): GenerationRunTracker {
  if (!globalRepository.__aiTeachingGenerationRunTracker) {
    globalRepository.__aiTeachingGenerationRunTracker = new GenerationRunTracker(getGenerationRunRepository());
  }
  return globalRepository.__aiTeachingGenerationRunTracker;
}

/** 课程文件夹只管理首页分组，不进入 Course 内容聚合。 */
export function getCourseFolderRepository(): CourseFolderRepository {
  if (!globalRepository.__aiTeachingCourseFolderRepository) {
    const repositoryType = process.env.COURSE_REPOSITORY ?? "mysql";
    if (repositoryType === "mysql") globalRepository.__aiTeachingCourseFolderRepository = new MySQLCourseFolderRepository();
    else if (repositoryType === "memory") globalRepository.__aiTeachingCourseFolderRepository = new InMemoryCourseFolderRepository(getCourseRepository());
    else throw new RepositoryConfigurationError();
  }
  return globalRepository.__aiTeachingCourseFolderRepository;
}

export type { CourseRepository } from "./course-repository";
export type { AgentSessionRepository } from "./agent-session-repository";
export type { GenerationRunRepository } from "./generation-run-repository";
export type { CourseFolderRepository } from "./course-folder-repository";
