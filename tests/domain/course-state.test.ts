import { describe, expect, it } from "vitest";
import { transitionCourseStatus } from "@/lib/domain/course-state";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";

describe("transitionCourseStatus", () => {
  it("覆盖 draft 到 generating 的合法状态路径", () => {
    const course = createFixtureCourse("数据库事务", 4);
    const draft = { ...course, status: "draft" as const, outlines: [], sceneProgress: [] };
    const outlining = transitionCourseStatus(draft, "outlining");
    const outlineReady = transitionCourseStatus({ ...outlining, outlines: course.outlines, sceneProgress: course.sceneProgress }, "outline_ready");
    const generating = transitionCourseStatus(outlineReady, "generating");
    const readyFixture = materializeFixtureCourse(course);
    expect(transitionCourseStatus({ ...readyFixture, status: generating.status }, "ready").status).toBe("ready");
  });

  it("拒绝 outline_ready 直接跳到 ready", () => {
    const course = createFixtureCourse("数据库事务", 4);
    expect(() => transitionCourseStatus(course, "ready")).toThrow("INVALID_COURSE_TRANSITION");
  });
});
