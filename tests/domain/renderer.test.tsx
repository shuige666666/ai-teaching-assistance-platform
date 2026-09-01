import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClassroomRuntime } from "@/components/course/classroom-runtime";
import { SceneRenderer } from "@/components/renderers/scene-renderer";
import { SlideRenderer } from "@/components/renderers/slide-renderer";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { CourseSchema } from "@/lib/domain/schemas";

describe("SlideRenderer", () => {
  it("把代码元素中的脚本源码转义成纯文本", () => {
    const course = materializeFixtureCourse(createFixtureCourse("代码安全", 4));
    const slide = course.scenes.find((scene) => scene.type === "slide" && scene.content.canvas.elements.some((element) => element.type === "code"));
    if (!slide || slide.type !== "slide") throw new Error("code slide expected");
    const code = slide.content.canvas.elements.find((element) => element.type === "code");
    if (!code || code.type !== "code") throw new Error("code element expected");
    code.lines[0].content = "<script>alert('xss')</script>";
    const html = renderToStaticMarkup(<SlideRenderer content={slide.content} />);
    expect(html).toContain("&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("只读画布渲染 text、shape、line、code 并把标题保留在 PPT 内", () => {
    const course = materializeFixtureCourse(createFixtureCourse("PPT 画布", 4));
    const slide = course.scenes.find((scene) => scene.type === "slide" && scene.content.canvas.elements.some((element) => element.type === "code"));
    if (!slide || slide.type !== "slide") throw new Error("slide expected");
    const html = renderToStaticMarkup(<SlideRenderer content={slide.content} />);
    expect(html).toContain("data-testid=\"slide-canvas\"");
    expect(html).toContain("data-text-type=\"title\"");
    expect(html).toContain("data-element-type=\"text\"");
    expect(html).toContain("data-element-type=\"shape\"");
    expect(html).toContain("data-element-type=\"line\"");
    expect(html).toContain("data-element-type=\"code\"");
  });

  it("使用稳定尺寸的箭头标记并把可选控制点渲染为曲线", () => {
    const course = materializeFixtureCourse(createFixtureCourse("反馈回路", 4));
    const slide = course.scenes.find((scene) => scene.type === "slide" && scene.content.canvas.elements.some((element) => element.type === "line"));
    if (!slide || slide.type !== "slide") throw new Error("line slide expected");
    const line = slide.content.canvas.elements.find((element) => element.type === "line");
    if (!line || line.type !== "line") throw new Error("line expected");
    line.curve = [32, 36];
    const html = renderToStaticMarkup(<SlideRenderer content={slide.content} />);
    expect(html).toContain("markerUnits=\"userSpaceOnUse\"");
    expect(html).toContain(" Q ");
  });

  it("根据 Scene 判别字段选择 slide 和 quiz 渲染器", () => {
    const course = materializeFixtureCourse(createFixtureCourse("软件测试", 4));
    const slide = course.scenes.find((scene) => scene.type === "slide");
    const quiz = course.scenes.find((scene) => scene.type === "quiz");
    expect(slide && renderToStaticMarkup(<SceneRenderer scene={slide} />)).toContain("data-testid=\"slide-renderer\"");
    const quizHtml = quiz && renderToStaticMarkup(<SceneRenderer scene={quiz} />);
    expect(quizHtml).toContain("data-testid=\"quiz-renderer\"");
    expect(quizHtml).toContain("单选题");
    expect(quizHtml).toContain("多选题");
  });

  it("partial_failed 课程只渲染已保存场景并标明原始场景序号", () => {
    const complete = materializeFixtureCourse(createFixtureCourse("增量课堂预览", 4));
    const failedOutline = complete.outlines[1];
    const now = Date.now();
    const partial = CourseSchema.parse({
      ...complete,
      status: "partial_failed",
      scenes: complete.scenes.filter((scene) => scene.outlineId !== failedOutline.id),
      sceneProgress: complete.sceneProgress.map((progress) => progress.outlineId === failedOutline.id ? {
        ...progress,
        status: "failed",
        lastError: { code: "INVALID_MODEL_OUTPUT", message: "模型输出未通过场景契约", retryable: true, stage: "scene" },
        updatedAt: now,
      } : progress),
      lastError: { code: "INVALID_MODEL_OUTPUT", message: "模型输出未通过场景契约", retryable: true, stage: "scene" },
      updatedAt: now,
    });

    const html = renderToStaticMarkup(<ClassroomRuntime course={partial} />);
    expect(html).toContain("PARTIAL COURSE PREVIEW");
    expect(html).toContain("已生成 3 / 4 个场景");
    expect(html).toContain("打开场景 3");
    expect(html).not.toContain("打开场景 2");
  });
});
