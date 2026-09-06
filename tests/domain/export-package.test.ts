import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createFixtureCourse, materializeFixtureCourse } from "@/lib/domain/fixture";
import type { Course } from "@/lib/domain/schemas";
import type { PPTShapeElement } from "@/lib/domain/slide-schemas";
import { buildCoursePackage } from "@/lib/export/build-course-package";
import { safeFilename, sceneHtmlFileName } from "@/lib/export/filename";
import { resolveBackground, resolveChart, resolveLineGeometry, resolveShape, resolveTable, resolveTextRuns } from "@/lib/export/pptx-mapping";
import { parseRichTextRuns } from "@/lib/export/rich-text-runs";

function shapeElement(overrides: Record<string, unknown>): PPTShapeElement {
  return {
    type: "shape", id: "shape-1", left: 0, top: 0, width: 280, height: 240, rotate: 0,
    path: "", viewBox: [280, 240], fill: "#EAF6F8", fixedRatio: false,
    ...overrides,
  } as unknown as PPTShapeElement;
}

describe("export filename", () => {
  it("替换非法字符并裁剪长度", () => {
    expect(safeFilename("TCP/拥塞:控制*？<v1>")).toBe("TCP 拥塞 控制 ？ v1");
    expect(safeFilename("标题..", "默认")).toBe("标题");
    expect(safeFilename("///", "课程导出")).toBe("课程导出");
    expect(sceneHtmlFileName(3, "流程互动")).toBe("03_流程互动.html");
    expect(sceneHtmlFileName(12, "冲突/风险")).toBe("12_冲突 风险.html");
  });
});

describe("rich text runs", () => {
  it("解析段落、字号、颜色与加粗", () => {
    const runs = parseRichTextRuns('<p style="font-size:32px;font-weight:bold;color:#143F59">标题</p>');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ text: "标题", bold: true, color: "143F59", fontSize: 24, paragraphEnd: true });
  });

  it("strong/span 产生多 run 且样式只作用于作用域", () => {
    const runs = parseRichTextRuns('<p style="text-align:center"><strong>结论：</strong><span style="color:#FF0000">重点</span>正文</p>');
    expect(runs.map((run) => run.text)).toEqual(["结论：", "重点", "正文"]);
    expect(runs[0].bold).toBe(true);
    expect(runs[0].align).toBe("center");
    expect(runs[1].color).toBe("FF0000");
    expect(runs[2].bold).toBe(false);
    expect(runs[2].color).toBeUndefined();
    expect(runs[2].paragraphEnd).toBe(true);
  });

  it("br 触发软换行、实体被解码、行距被映射", () => {
    const runs = parseRichTextRuns('<p style="line-height:1.5">A &amp; B<br>C</p>');
    expect(runs).toHaveLength(2);
    expect(runs[0].text).toBe("A & B");
    expect(runs[0].lineSpacingMultiple).toBe(1.5);
    expect(runs[0].paragraphEnd).toBe(false);
    expect(runs[1].text).toBe("C");
    expect(runs[1].paragraphEnd).toBe(true);
  });
});

describe("pptx element mapping", () => {
  it("背景：solid 直转、渐变降级为首个色标", () => {
    expect(resolveBackground({ type: "solid", color: "#F3FAFB" })).toEqual({ color: "F3FAFB", degraded: false });
    const gradient = resolveBackground({
      type: "gradient",
      gradient: { type: "linear", rotate: 90, colors: [{ pos: 0, color: "#FFFFFF" }, { pos: 100, color: "#E4FAF7" }] },
    });
    expect(gradient).toEqual({ color: "FFFFFF", degraded: true });
  });

  it("形状：pathFormula 优先，历史 path 反推预设，未知 path 跳过", () => {
    expect(resolveShape(shapeElement({ pathFormula: "roundRect" }))).toEqual({ kind: "preset", preset: "roundRect" });
    expect(resolveShape(shapeElement({
      path: "M 14 0 L 266 0 A 14 14 0 0 1 280 14 L 280 226 A 14 14 0 0 1 266 240 L 14 240 A 14 14 0 0 1 0 226 L 0 14 A 14 14 0 0 1 14 0 Z",
    }))).toEqual({ kind: "preset", preset: "roundRect" });
    expect(resolveShape(shapeElement({ path: "M 0 0 L 1 0 L 1 1 L 0 1 Z", viewBox: [1, 1] }))).toEqual({ kind: "preset", preset: "rect" });
    expect(resolveShape(shapeElement({ path: "M 1 0.5 A 0.5 0.5 0 1 1 0 0.5 A 0.5 0.5 0 1 1 1 0.5 Z", viewBox: [1, 1] }))).toEqual({ kind: "preset", preset: "ellipse" });
    expect(resolveShape(shapeElement({ path: "M 140 0 L 280 120 L 0 120 Z", viewBox: [280, 120] }))).toEqual({ kind: "preset", preset: "triangle" });
    expect(resolveShape(shapeElement({ path: "M 3 1 C 3 2, 2 3, 0 2 Z", viewBox: [3, 3] }))).toEqual({ kind: "skip", reason: "手写 SVG path 暂不支持导出" });
  });

  it("线段：水平/垂直/斜线方向与包围盒", () => {
    const horizontal = resolveLineGeometry({ type: "line", id: "l1", left: 200, top: 100, width: 3, start: [0, 0], end: [100, 0], style: "solid", color: "#000", points: ["", "arrow"] });
    expect(horizontal).toMatchObject({ x: 200 / 75, y: 100 / 75, w: 100 / 75, h: 0, kind: "horizontal", flipH: false, flipV: false });
    const vertical = resolveLineGeometry({ type: "line", id: "l2", left: 480, top: 300, width: 3, start: [0, 0], end: [0, 60], style: "solid", color: "#000", points: ["", "arrow"] });
    expect(vertical).toMatchObject({ kind: "vertical", h: 60 / 75, w: 0 });
    const diagonal = resolveLineGeometry({ type: "line", id: "l3", left: 100, top: 100, width: 3, start: [100, 0], end: [0, 60], style: "solid", color: "#000", points: ["", "arrow"] });
    expect(diagonal).toMatchObject({ kind: "diagonal", flipH: true, flipV: false });
  });

  it("图表映射：柱状方向、饼图裁剪为单系列、主题色转十六进制", () => {
    const chart = {
      type: "chart", id: "c1", left: 0, top: 0, width: 420, height: 260, rotate: 0,
      chartType: "column",
      data: { labels: ["A", "B"], series: [{ name: "准确率", values: [72, 85] }, { name: "多余", values: [1, 2] }] },
      themeColors: ["#498BA6"],
    } as unknown as Parameters<typeof resolveChart>[0];
    const column = resolveChart(chart);
    expect(column).toMatchObject({ type: "bar", barDir: "col", showLegend: true, chartColors: ["498BA6"] });
    const pie = resolveChart({ ...chart, chartType: "pie" });
    expect(pie.type).toBe("pie");
    expect(pie.data).toHaveLength(1);
  });

  it("表格映射：列宽按比例换算英寸、首行标记表头", () => {
    const table = {
      type: "table", id: "t1", left: 60, top: 180, width: 880, height: 220, rotate: 0,
      header: true, colWidths: [1, 3], rows: [["维度", "结论"], ["性能", "编译型占优"]],
    } as unknown as Parameters<typeof resolveTable>[0];
    const spec = resolveTable(table);
    expect(spec.colWidths).toEqual([2.93, 8.8]);
    expect(spec.rows[0].every((cell) => cell.header)).toBe(true);
    expect(spec.rows[1].every((cell) => !cell.header)).toBe(true);
  });

  it("文本：字号回退为 18px 的 point 值", () => {
    const element = {
      type: "text", id: "x", left: 0, top: 0, width: 700, height: 68, rotate: 0, content: "<p>正文</p>",
      defaultFontName: "Microsoft YaHei", defaultColor: "#333333", textType: "content",
    } as unknown as Parameters<typeof resolveTextRuns>[0];
    expect(resolveTextRuns(element).defaultFontSize).toBe(13.5);
  });
});

describe("build course package", () => {
  it("fixture 课程打包为 ZIP：一个 PPTX、quiz 不进导出物", async () => {
    const course: Course = materializeFixtureCourse(createFixtureCourse("导出打包", 3));
    const pkg = await buildCoursePackage(course, "nodebuffer");
    expect(pkg.filename).toBe("导出打包：从概念到实践.zip");
    expect(pkg.slideCount).toBe(3);
    expect(pkg.interactiveCount).toBe(0);

    const zip = await JSZip.loadAsync(pkg.zip);
    const names = Object.keys(zip.files);
    expect(names.filter((name) => name.endsWith(".pptx"))).toEqual(["导出打包：从概念到实践.pptx"]);
    expect(names.some((name) => name.startsWith("interactive/") && name.endsWith(".html"))).toBe(false);

    const pptx = await JSZip.loadAsync(zip.file("导出打包：从概念到实践.pptx")!.async("nodebuffer"));
    const slideNames = Object.keys(pptx.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(slideNames).toHaveLength(3);
    const slide1 = await pptx.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide1).toContain("导出打包");
  });

  it("interactive 场景按序号与安全化标题写入 ZIP", async () => {
    const course: Course = materializeFixtureCourse(createFixtureCourse("互动导出", 3));
    const interactiveScene = {
      ...course.scenes[0],
      type: "interactive" as const,
      content: {
        type: "interactive" as const, widgetType: "diagram" as const, runtimeContractVersion: 1 as const,
        html: "<!doctype html><html><body>互动</body></html>",
        fallback: { title: "t", description: "d", steps: ["a", "b"] },
      },
    };
    const withInteractive: Course = { ...course, status: "ready", scenes: [interactiveScene, course.scenes[1]] };
    const pkg = await buildCoursePackage(withInteractive, "nodebuffer");
    expect(pkg.interactiveCount).toBe(1);
    expect(pkg.slideCount).toBe(1);

    const zip = await JSZip.loadAsync(pkg.zip);
    const interactiveNames = Object.keys(zip.files).filter((name) => name.startsWith("interactive/") && name.endsWith(".html"));
    expect(interactiveNames).toHaveLength(1);
    expect(interactiveNames[0]).toMatch(/^interactive\/01_.+\.html$/);
    const html = await zip.file(interactiveNames[0])!.async("string");
    expect(html).toContain("互动");
  });
});
