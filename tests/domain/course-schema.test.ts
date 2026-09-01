import { describe, expect, it } from "vitest";
import { createCourseDraft, createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { upgradeCourseV4ToV5 } from "@/lib/domain/course-upgrade";
import { CourseSchema } from "@/lib/domain/schemas";

describe("CourseSchema", () => {
  it("长课程描述完整保存到 topic，并为草稿派生契约内标题", () => {
    const topic = `面向初学者讲解${"浏览器导航过程".repeat(40)}`;
    const course = createCourseDraft(topic, 5);
    expect(course.topic).toBe(topic);
    expect(course.title.length).toBeLessThanOrEqual(120);
    expect(topic.startsWith(course.title)).toBe(true);
  });

  it("接受包含 Course v5 slide、单选、多选和代码元素的完整 fixture", () => {
    const course = materializeFixtureCourse(createFixtureCourse("TCP 拥塞控制", 4));
    expect(course.schemaVersion).toBe(5);
    expect(CourseSchema.parse(course).status).toBe("ready");
    expect(course.scenes.some((scene) => scene.type === "quiz")).toBe(true);
    expect(course.scenes.some((scene) => scene.type === "quiz" && scene.content.questions.some((question) => question.type === "multiple_choice"))).toBe(true);
    expect(course.scenes.some((scene) => scene.type === "slide" && scene.content.canvas.elements.some((element) => element.type === "code"))).toBe(true);
  });

  it("将 v4 单选题正确答案无损升级为 v5 数组", () => {
    const current = materializeFixtureCourse(createFixtureCourse("数据库事务", 4));
    const legacy = structuredClone(current) as unknown as Record<string, unknown> & { scenes: Array<Record<string, unknown>> };
    legacy.schemaVersion = 4;
    legacy.scenes = legacy.scenes.map((scene) => {
      if (scene.type !== "quiz") return scene;
      const content = scene.content as { type: string; questions: Array<Record<string, unknown>> };
      return {
        ...scene,
        content: {
          ...content,
          questions: content.questions.map((question) => {
            const answerIds = question.correctOptionIds as string[];
            const rest = { ...question };
            delete rest.correctOptionIds;
            return { ...rest, type: "single_choice", correctOptionId: answerIds[0] };
          }),
        },
      };
    });

    const upgraded = CourseSchema.parse(upgradeCourseV4ToV5(legacy));
    const quiz = upgraded.scenes.find((scene) => scene.type === "quiz");
    expect(upgraded.schemaVersion).toBe(5);
    expect(quiz?.type === "quiz" && quiz.content.questions.every((question) => question.correctOptionIds.length === 1)).toBe(true);
  });

  it("拒绝未知 PPTElement 类型", () => {
    const course = materializeFixtureCourse(createFixtureCourse("操作系统调度", 3));
    const slide = course.scenes.find((scene) => scene.type === "slide");
    expect(slide).toBeDefined();
    if (slide?.type === "slide") {
      const invalid = structuredClone(course) as unknown as { scenes: Array<{ type: string; content: { canvas?: { elements: unknown[] } } }> };
      const invalidSlide = invalid.scenes.find((scene) => scene.type === "slide");
      invalidSlide?.content.canvas?.elements.push({ id: "bad", type: "html", html: "<script>alert(1)</script>" });
      expect(() => CourseSchema.parse(invalid)).toThrow();
    }
  });

  it("拒绝重复大纲 ID 和不连续顺序", () => {
    const course = createFixtureCourse("计算机网络", 4);
    course.outlines[1].id = course.outlines[0].id;
    course.outlines[1].order = 8;
    expect(() => CourseSchema.parse(course)).toThrow();
  });

  it("拒绝重复 Action ID 和不符合场景类型的 pause", () => {
    const course = materializeFixtureCourse(createFixtureCourse("进程调度", 3));
    const slide = course.scenes.find((scene) => scene.type === "slide");
    expect(slide).toBeDefined();
    if (slide) {
      slide.actions = [
        { id: "same", type: "speech", text: "讲解" },
        { id: "same", type: "pause", reason: "learner" },
      ];
      expect(() => CourseSchema.parse(course)).toThrow();
    }
  });
});
