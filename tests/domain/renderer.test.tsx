import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SceneRenderer } from "@/components/renderers/scene-renderer";
import { SlideRenderer } from "@/components/renderers/slide-renderer";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";

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
});
