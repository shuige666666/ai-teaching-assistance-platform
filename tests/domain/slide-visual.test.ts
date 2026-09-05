import { describe, expect, it } from "vitest";
import { SlideColorSchema, SlideSchema, SlideThemeSchema, type PPTElement } from "@/lib/domain/slide-schemas";
import { buildChartOption, DEFAULT_CHART_COLORS } from "@/lib/slides/chart-option";
import { assembleSlide, normalizeGeneratedSlideScene } from "@/lib/slides/normalize-slide";
import { resolveShapePath, SLIDE_SHAPE_FORMULAS } from "@/lib/slides/resolve-shape-path";
import { DEFAULT_SLIDE_THEME, resolveCourseTheme, SLIDE_THEME_PRESETS } from "@/lib/slides/theme-presets";

const SAFE_SVG_PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/;

function slideScene(elements: unknown[]) {
  return {
    type: "slide" as const,
    content: {
      background: { type: "solid" as const, color: "#FFFFFF" },
      elements,
    },
    narration: "这一场讲解新的幻灯片元素。",
    summary: "覆盖图表、表格与形状预设。",
  };
}

const titleElement = {
  type: "text" as const, left: 60, top: 46, width: 700, height: 68,
  content: "<p style=\"font-size:32px;font-weight:bold\">标题</p>", textType: "title" as const,
};

describe("slide shape formulas", () => {
  it("全部预设都解析为安全 path 且 viewBox 与宽高一致", () => {
    for (const formula of SLIDE_SHAPE_FORMULAS) {
      const resolved = resolveShapePath(formula, 280, 240);
      expect(resolved.viewBox).toEqual([280, 240]);
      expect(resolved.path).toMatch(SAFE_SVG_PATH);
      expect(resolved.path).not.toContain("NaN");
    }
  });

  it("roundRect 圆角半径不超过高度和宽度的一半", () => {
    expect(resolveShapePath("roundRect", 280, 240).path).toContain("A 14 14");
    expect(resolveShapePath("roundRect", 20, 10).path).toContain("A 5 5");
  });
});

describe("chart option builder", () => {
  const chartElement = {
    id: "chart", type: "chart" as const, left: 0, top: 0, width: 420, height: 260, rotate: 0,
    chartType: "column" as const,
    data: { labels: ["A", "B"], series: [{ name: "掌握度", values: [60, 75] }] },
  };

  it("柱状图使用类目轴并关闭动画", () => {
    const option = buildChartOption(chartElement);
    expect(option.animation).toBe(false);
    const xAxis = option.xAxis as { type: string; data: string[] };
    expect(xAxis.type).toBe("category");
    expect(xAxis.data).toEqual(["A", "B"]);
    const series = option.series as Array<{ type: string; name: string }>;
    expect(series[0]).toMatchObject({ type: "bar", name: "掌握度" });
  });

  it("条形图交换数值轴与类目轴", () => {
    const option = buildChartOption({ ...chartElement, chartType: "bar" as const });
    expect((option.xAxis as { type: string }).type).toBe("value");
    expect((option.yAxis as { type: string }).type).toBe("category");
  });

  it("饼图只使用第一组系列并映射为扇区数据", () => {
    const option = buildChartOption({
      ...chartElement,
      chartType: "pie" as const,
      data: { labels: ["A", "B"], series: [{ name: "占比", values: [3, 7] }, { name: "多余", values: [1, 1] }] },
    });
    const series = option.series as Array<{ type: string; data: Array<{ name: string; value: number }> }>;
    expect(series).toHaveLength(1);
    expect(series[0].data).toEqual([{ name: "A", value: 3 }, { name: "B", value: 7 }]);
  });

  it("缺省主题色时使用兜底配色", () => {
    const option = buildChartOption({ ...chartElement, themeColors: undefined });
    expect(option.color).toEqual([...DEFAULT_CHART_COLORS]);
  });
});

describe("slide theme presets", () => {
  it("每套预设都是合法主题，卡片配色使用合法十六进制颜色", () => {
    expect(DEFAULT_SLIDE_THEME).toBe(SLIDE_THEME_PRESETS[0].theme);
    for (const preset of SLIDE_THEME_PRESETS) {
      expect(SlideThemeSchema.safeParse(preset.theme).success).toBe(true);
      expect(SlideColorSchema.safeParse(preset.accent).success).toBe(true);
      for (const card of preset.cards) {
        expect(SlideColorSchema.safeParse(card.bg).success).toBe(true);
        expect(SlideColorSchema.safeParse(card.text).success).toBe(true);
      }
      for (const background of preset.pageBackgrounds) {
        expect(SlideColorSchema.safeParse(background).success).toBe(true);
      }
    }
  });

  it("同一 courseId 稳定命中同一套主题", () => {
    const first = resolveCourseTheme("course-alpha");
    expect(resolveCourseTheme("course-alpha")).toBe(first);
    const presets = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].map((id) => resolveCourseTheme(id).name),
    );
    expect(presets.size).toBeGreaterThanOrEqual(2);
  });
});

describe("normalized slide visual elements", () => {
  it("chart 元素的标签和数值被收口为纯数字，饼图多余系列被裁剪", () => {
    const output = normalizeGeneratedSlideScene(slideScene([
      titleElement,
      {
        type: "chart", left: 520, top: 180, width: 420, height: 260,
        chartType: "pie",
        data: {
          labels: ["方案A", "方案B", 30],
          series: [{ name: "占比", values: ["72", "85", "91"] }, { name: "多余", values: [1, 2, 3] }],
        },
        themeColors: ["#498BA6", "not-a-color"],
      },
    ]));
    const chart = output.content.elements.find((element): element is Extract<PPTElement, { type: "chart" }> => element.type === "chart");
    expect(chart).toMatchObject({
      chartType: "pie",
      data: { labels: ["方案A", "方案B", "30"], series: [{ name: "占比", values: [72, 85, 91] }] },
    });
    expect(chart?.themeColors).toEqual(["#498BA6"]);
    expect(output.normalizationIssues.some((issue) => issue.message.includes("饼图只保留第一组系列"))).toBe(true);
  });

  it("系列数据长度与标签不一致的 chart 被丢弃", () => {
    const output = normalizeGeneratedSlideScene(slideScene([
      titleElement,
      {
        type: "chart", left: 520, top: 180, width: 420, height: 260, chartType: "column",
        data: { labels: ["A", "B", "C"], series: [{ name: "系列", values: [1, 2] }] },
      },
    ]));
    expect(output.content.elements.some((element) => element.type === "chart")).toBe(false);
    expect(output.normalizationIssues.some((issue) => issue.message.includes("系列数据长度与标签不一致"))).toBe(true);
  });

  it("table 元素净化单元格、补齐列宽并默认带表头", () => {
    const output = normalizeGeneratedSlideScene(slideScene([
      titleElement,
      {
        type: "table", left: 60, top: 180, width: 880, height: 220,
        rows: [["对比维度", "核心结论"], ["<b>适用场景</b>", "展示教学对比"]],
      },
    ]));
    const table = output.content.elements.find((element): element is Extract<PPTElement, { type: "table" }> => element.type === "table");
    expect(table).toMatchObject({ header: true, colWidths: [1, 1], rows: [["对比维度", "核心结论"], ["适用场景", "展示教学对比"]] });
  });

  it("pathFormula 在规范化阶段解析为具体 path，渐变被保留", () => {
    const output = normalizeGeneratedSlideScene(slideScene([
      titleElement,
      {
        type: "shape", left: 60, top: 170, width: 280, height: 240, pathFormula: "roundRect",
        gradient: { type: "linear", rotate: 90, colors: [{ pos: 0, color: "#FFFFFF" }, { pos: 100, color: "#EAF6F8" }] },
      },
    ]));
    const shape = output.content.elements.find((element): element is Extract<PPTElement, { type: "shape" }> => element.type === "shape");
    expect(shape?.path).toContain("A 14 14");
    expect(shape?.viewBox).toEqual([280, 240]);
    expect(shape?.gradient?.type).toBe("linear");
  });

  it("同时提供 path 与 pathFormula 时预设获胜，缺形状定义时元素被丢弃", () => {
    const output = normalizeGeneratedSlideScene(slideScene([
      titleElement,
      {
        type: "shape", left: 60, top: 170, width: 100, height: 80,
        path: "M 0 0 L 1 0 L 1 1 L 0 1 Z", viewBox: [1, 1], pathFormula: "circle",
      },
    ]));
    const shape = output.content.elements.find((element): element is Extract<PPTElement, { type: "shape" }> => element.type === "shape");
    expect(shape?.path).not.toBe("M 0 0 L 1 0 L 1 1 L 0 1 Z");
    expect(output.normalizationIssues.some((issue) => issue.message.includes("pathFormula 已覆盖手写 path"))).toBe(true);

    const dropped = normalizeGeneratedSlideScene(slideScene([
      titleElement,
      { type: "shape", left: 60, top: 170, width: 100, height: 80 },
    ]));
    expect(dropped.content.elements.some((element) => element.type === "shape")).toBe(false);
  });

  it("course 主题决定元素默认色和 Slide 主题对象", () => {
    const preset = SLIDE_THEME_PRESETS[1];
    const output = normalizeGeneratedSlideScene(slideScene([titleElement]), preset);
    expect(output.theme).toEqual(preset.theme);
    const title = output.content.elements[0];
    expect(title.type === "text" && title.defaultColor).toBe(preset.theme.fontColor);
    const slide = assembleSlide(output);
    expect(slide.theme).toEqual(preset.theme);
    expect(SlideSchema.safeParse(slide).success).toBe(true);
  });

  it("未指定主题时保持历史默认主题", () => {
    const output = normalizeGeneratedSlideScene(slideScene([titleElement]));
    expect(output.theme).toEqual(DEFAULT_SLIDE_THEME);
    const title = output.content.elements[0];
    expect(title.type === "text" && title.defaultColor).toBe("#143F59");
  });
});
