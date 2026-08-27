import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClassroomRuntime } from "@/components/course/classroom-runtime";
import { SceneRenderer } from "@/components/renderers/scene-renderer";
import { SlideRenderer } from "@/components/renderers/slide-renderer";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import { CourseSchema } from "@/lib/domain/schemas";

describe("SlideRenderer", () => {
  it("把脚本样式内容转义成纯文本", () => {
    const html = renderToStaticMarkup(<SlideRenderer content={{
      type: "slide",
      blocks: [{ id: "code-1", type: "code", language: "html", code: "<script>alert('xss')</script>" }],
    }} />);
    expect(html).toContain("&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("根据 Scene 判别字段选择 slide 和 quiz 渲染器", () => {
    const course = materializeFixtureCourse(createFixtureCourse("软件测试", 3));
    const slide = course.scenes.find((scene) => scene.type === "slide");
    const quiz = course.scenes.find((scene) => scene.type === "quiz");
    expect(slide && renderToStaticMarkup(<SceneRenderer scene={slide} />)).toContain("data-testid=\"slide-renderer\"");
    expect(quiz && renderToStaticMarkup(<SceneRenderer scene={quiz} />)).toContain("data-testid=\"quiz-renderer\"");
  });

  it("partial_failed 课程只渲染已保存场景并标明原始场景序号", () => {
    const complete = materializeFixtureCourse(createFixtureCourse("增量课堂预览", 3));
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
    expect(html).toContain("已生成 2 / 3 个场景");
    expect(html).toContain("打开场景 3");
    expect(html).not.toContain("打开场景 2");
  });
});
