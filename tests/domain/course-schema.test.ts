import { describe, expect, it } from "vitest";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { CourseSchema } from "@/lib/domain/schemas";

describe("CourseSchema", () => {
  it("接受包含 slide、quiz 和代码块的完整 fixture", () => {
    const course = materializeFixtureCourse(createFixtureCourse("TCP 拥塞控制", 4));
    expect(CourseSchema.parse(course).status).toBe("ready");
    expect(course.scenes.some((scene) => scene.type === "quiz")).toBe(true);
    expect(course.scenes.some((scene) => scene.type === "slide" && scene.content.blocks.some((block) => block.type === "code"))).toBe(true);
  });

  it("拒绝未知内容块类型", () => {
    const course = materializeFixtureCourse(createFixtureCourse("操作系统调度", 3));
    const slide = course.scenes.find((scene) => scene.type === "slide");
    expect(slide).toBeDefined();
    if (slide?.type === "slide") {
      const invalid = structuredClone(course) as unknown as { scenes: Array<{ content: { blocks?: unknown[] } }> };
      const invalidSlide = invalid.scenes.find((scene) => Array.isArray(scene.content.blocks));
      invalidSlide?.content.blocks?.push({ id: "bad", type: "html", html: "<script>alert(1)</script>" });
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
