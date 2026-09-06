import type {
  PPTChartElement,
  PPTLineElement,
  PPTShapeElement,
  PPTTableElement,
  PPTTextElement,
  SlideBackground,
} from "@/lib/domain/slide-schemas";
import { parseRichTextRuns, type RichTextRun } from "./rich-text-runs";

export const PX_PER_INCH = 75;
export const PT_PER_PX = 0.75;

export const inches = (px: number) => px / PX_PER_INCH;
export const hex = (color: string) => color.replace(/^#/, "").toUpperCase();

export type BackgroundSpec = { color: string; degraded: boolean };

/** 背景映射：solid 直转；渐变在 PPTX 中无原生页面背景支持，降级为首个色标纯色。 */
export function resolveBackground(background: SlideBackground): BackgroundSpec {
  if (background.type === "solid") return { color: hex(background.color), degraded: false };
  const stops = [...background.gradient.colors].sort((a, b) => a.pos - b.pos);
  return { color: hex(stops[0]?.color ?? "FFFFFF"), degraded: true };
}

export type ShapePreset = "rect" | "roundRect" | "ellipse" | "triangle" | "diamond" | "rightArrow";
export type ShapeSpec = { kind: "preset"; preset: ShapePreset } | { kind: "skip"; reason: string };

function pathPoints(path: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (const match of path.matchAll(/([ML])\s+(-?[\d.]+)[\s,]+(-?[\d.]+)/gi)) {
    points.push([Number(match[2]), Number(match[3])]);
  }
  return points;
}

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.02;
}

function samePoints(points: Array<[number, number]>, expected: Array<[number, number]>): boolean {
  return points.length === expected.length && points.every(([x, y], index) => approx(x, expected[index][0]) && approx(y, expected[index][1]));
}

/**
 * 形状映射：优先使用规范化阶段保留的 pathFormula；
 * 历史数据（仅 path）按 viewBox 归一后的坐标点反推常见预设，无法识别则跳过。
 */
export function resolveShape(shape: PPTShapeElement): ShapeSpec {
  if (shape.pathFormula) return { kind: "preset", preset: shape.pathFormula === "circle" ? "ellipse" : shape.pathFormula };
  const points = pathPoints(shape.path).map(([x, y]) => [x / shape.viewBox[0], y / shape.viewBox[1]] as [number, number]);
  const arcs = (shape.path.match(/A\s/g) ?? []).length;
  if (arcs === 4) return { kind: "preset", preset: "roundRect" };
  if (arcs === 2 && points.length > 0 && approx(points[0][1], 0.5)) return { kind: "preset", preset: "ellipse" };
  if (samePoints(points, [[0, 0], [1, 0], [1, 1], [0, 1]])) return { kind: "preset", preset: "rect" };
  if (samePoints(points, [[0.5, 0], [1, 1], [0, 1]])) return { kind: "preset", preset: "triangle" };
  if (samePoints(points, [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]])) return { kind: "preset", preset: "diamond" };
  if (samePoints(points, [[0, 0.2], [0.6, 0.2], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.8], [0, 0.8]])) return { kind: "preset", preset: "rightArrow" };
  return { kind: "skip", reason: "手写 SVG path 暂不支持导出" };
}

export type LineSpec = {
  x: number; y: number; w: number; h: number;
  flipH: boolean; flipV: boolean;
  kind: "horizontal" | "vertical" | "diagonal";
};

/** 线段几何：绝对端点 → 包围盒 + 翻转标记；斜线在 PPTX 中仍为直线（OOXML line 语义）。 */
export function resolveLineGeometry(line: PPTLineElement): LineSpec {
  const x1 = line.left + line.start[0], y1 = line.top + line.start[1];
  const x2 = line.left + line.end[0], y2 = line.top + line.end[1];
  const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  return {
    x: inches(Math.min(x1, x2)),
    y: inches(Math.min(y1, y2)),
    w: inches(w),
    h: inches(h),
    flipH: x2 < x1,
    flipV: y2 < y1,
    kind: h * PX_PER_INCH < 1 ? "horizontal" : w * PX_PER_INCH < 1 ? "vertical" : "diagonal",
  };
}

export type ChartSpec = {
  type: "bar" | "line" | "pie";
  barDir?: "col" | "bar";
  data: Array<{ name: string; labels: string[]; values: number[] }>;
  chartColors: string[];
  showLegend: boolean;
  legendPos: "t" | "b";
};

/** 图表映射：数据元素直转为 PPTX 原生图表；饼图只含一组系列。 */
export function resolveChart(chart: PPTChartElement): ChartSpec {
  const data = chart.data.series.map((series) => ({ name: series.name, labels: chart.data.labels, values: series.values }));
  const chartColors = (chart.themeColors ?? []).map(hex);
  if (chart.chartType === "pie") return { type: "pie", data: data.slice(0, 1), chartColors, showLegend: true, legendPos: "b" };
  if (chart.chartType === "line") return { type: "line", data, chartColors, showLegend: data.length > 1, legendPos: "t" };
  return { type: "bar", barDir: chart.chartType === "bar" ? "bar" : "col", data, chartColors, showLegend: data.length > 1, legendPos: "t" };
}

export type TableCellSpec = { text: string; header: boolean };
export type TableSpec = { rows: TableCellSpec[][]; colWidths: number[] };

/** 表格映射：首行表头标记 + 按比例换算的列宽（英寸）。 */
export function resolveTable(table: PPTTableElement): TableSpec {
  const total = table.colWidths.reduce((sum, width) => sum + width, 0) || 1;
  const totalInches = inches(table.width);
  const colWidths = table.colWidths.map((width) => Math.round((width / total) * totalInches * 100) / 100);
  const rows = table.rows.map((row, rowIndex) =>
    row.map((cell) => ({ text: cell, header: table.header && rowIndex === 0 })),
  );
  return { rows, colWidths };
}

/** 文本映射：净化 HTML → runs；未显式指定字号时回退 18px → 13.5pt。 */
export function resolveTextRuns(text: PPTTextElement): { runs: RichTextRun[]; defaultFontSize: number } {
  return { runs: parseRichTextRuns(text.content), defaultFontSize: Math.round(18 * PT_PER_PX * 10) / 10 };
}
