import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SlideRenderer } from "@/components/renderers/slide-renderer";
import { SlideSchema, type CanvasSlideContent } from "@/lib/domain/slide-schemas";
import { DEFAULT_SLIDE_THEME } from "@/lib/slides/theme-presets";

describe("SlideRenderer visual elements", () => {
  it("渲染 chart 容器、table 表头和 shape 渐变定义", () => {
    const canvas = SlideSchema.parse({
      id: "visual-slide",
      viewportSize: 1000,
      viewportRatio: 0.5625,
      theme: DEFAULT_SLIDE_THEME,
      background: { type: "solid", color: "#FFFFFF" },
      elements: [
        {
          id: "chart-1", type: "chart", left: 520, top: 180, width: 420, height: 260, rotate: 0,
          chartType: "column",
          data: { labels: ["方案A", "方案B"], series: [{ name: "准确率", values: [72, 85] }] },
        },
        {
          id: "table-1", type: "table", left: 60, top: 180, width: 400, height: 220, rotate: 0,
          header: true, colWidths: [1, 2],
          rows: [["对比维度", "核心结论"], ["适用场景", "教学对比"]],
        },
        {
          id: "shape-1", type: "shape", left: 60, top: 60, width: 200, height: 80, rotate: 0,
          path: "M 0 0 L 1 0 L 1 1 L 0 1 Z", viewBox: [1, 1], fill: "#EAF6F8", fixedRatio: false,
          gradient: { type: "linear", rotate: 90, colors: [{ pos: 0, color: "#FFFFFF" }, { pos: 100, color: "#EAF6F8" }] },
        },
      ],
    }) as CanvasSlideContent["canvas"];
    const html = renderToStaticMarkup(<SlideRenderer content={{ type: "slide", canvas }} />);
    expect(html).toContain('data-element-type="chart"');
    expect(html).toContain('data-element-type="table"');
    expect(html).toContain("<th");
    expect(html).toContain("linearGradient");
    expect(html).toContain("适用场景");
  });
});
