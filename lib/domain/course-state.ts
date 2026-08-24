import type { Course, CourseStatus } from "./schemas";

const allowedTransitions: Record<CourseStatus, CourseStatus[]> = {
  draft: ["outlining"], outlining: ["outline_ready", "failed"], outline_ready: ["generating", "outlining"],
  generating: ["ready", "partial_failed", "failed"], partial_failed: ["generating", "ready"], ready: ["generating"], failed: ["outlining", "generating"],
};

/** 只负责课程生命周期状态迁移；非法跳转会立即失败，避免页面伪造完成状态。 */
export function transitionCourseStatus(course: Course, nextStatus: CourseStatus): Course {
  if (!allowedTransitions[course.status].includes(nextStatus)) throw new Error(`INVALID_COURSE_TRANSITION:${course.status}->${nextStatus}`);
  return { ...course, status: nextStatus, updatedAt: Math.max(Date.now(), course.updatedAt) };
}
