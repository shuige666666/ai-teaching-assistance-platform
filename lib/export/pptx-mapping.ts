import type {
  PPTChartElement,
  PPTLineElement,
  PPTShapeElement,
  PPTTableElement,
  PPTTextElement,
  SlideBackground,
} from "@/lib/domain/slide-schemas";
import { resolveTextLayout, type ResolvedTextLayout } from "@/lib/slides/resolve-text-layout";
import { parseRichTextRuns, type RichTextRun } from "./rich-text-runs";
import { svgPathToPptxPoints, type PptxCustomGeometryPoint } from "./svg-path-points";
import { hex, inches, PT_PER_PX, PX_PER_INCH } from "./pptx-units";

export { hex, inches, PT_PER_PX, PX_PER_INCH } from "./pptx-units";

export type BackgroundSpec = { color: string; degraded: boolean };

type GradientStop = { pos: number; color: string };

function rgb(color: string): [number, number, number] | null {
  let value = hex(color);
  if (value.length === 3) value = value.split("").map((part) => part + part).join("");
  if (value.length === 8) value = value.slice(0, 6);
  if (!/^[0-9A-F]{6}$/.test(value)) return null;
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)];
}

/** 取渐变 50% 位置的插值色，比固定使用首色更接近页面整体观感。 */
export function resolveGradientRepresentativeColor(stops: GradientStop[]): string {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  if (sorted.length === 0) return "FFFFFF";
  const left = [...sorted].reverse().find((stop) => stop.pos <= 50) ?? sorted[0];
  const right = sorted.find((stop) => stop.pos >= 50) ?? sorted[sorted.length - 1];
  const leftRgb = rgb(left.color), rightRgb = rgb(right.color);
  if (!leftRgb || !rightRgb || left.pos === right.pos) return hex(left.color).slice(0, 6);
  const ratio = (50 - left.pos) / (right.pos - left.pos);
  return leftRgb.map((value, index) => Math.round(value + (rightRgb[index] - value) * ratio).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** 背景映射：solid 直转；渐变降级为中点代表色，同时保留降级提示。 */
export function resolveBackground(background: SlideBackground): BackgroundSpec {
  if (background.type === "solid") return { color: hex(background.color), degraded: false };
  return { color: resolveGradientRepresentativeColor(background.gradient.colors), degraded: true };
}

export type ShapePreset = "rect" | "roundRect" | "ellipse" | "triangle" | "diamond" | "rightArrow";
export type ShapeSpec =
  | { kind: "preset"; preset: ShapePreset }
  | { kind: "custom"; points: PptxCustomGeometryPoint[] }
  | { kind: "skip"; reason: string };

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
 * 历史数据（仅 path）先反推常见预设，无法识别时转换为可编辑自由形状。
 */
export function resolveShape(shape: PPTShapeElement): ShapeSpec {
  if (shape.pathFormula) return { kind: "preset", preset: shape.pathFormula === "circle" ? "ellipse" : shape.pathFormula };
  const points = pathPoints(shape.path).map(([x, y]) => [x / shape.viewBox[0], y / shape.viewBox[1]] as [number, number]);
  const arcs = (shape.path.match(/A\s/gi) ?? []).length;
  if (arcs === 4) return { kind: "preset", preset: "roundRect" };
  if (arcs === 2 && points.length > 0 && approx(points[0][1], 0.5)) return { kind: "preset", preset: "ellipse" };
  if (samePoints(points, [[0, 0], [1, 0], [1, 1], [0, 1]])) return { kind: "preset", preset: "rect" };
  if (samePoints(points, [[0.5, 0], [1, 1], [0, 1]])) return { kind: "preset", preset: "triangle" };
  if (samePoints(points, [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]])) return { kind: "preset", preset: "diamond" };
  if (samePoints(points, [[0, 0.2], [0.6, 0.2], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.8], [0, 0.8]])) return { kind: "preset", preset: "rightArrow" };
  const custom = svgPathToPptxPoints(shape.path, {
    width: shape.width,
    height: shape.height,
    viewBox: shape.viewBox,
    fixedRatio: shape.fixedRatio,
  });
  return custom.ok ? { kind: "custom", points: custom.points } : { kind: "skip", reason: custom.reason };
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

export type CurvedLineSpec = {
  x: number; y: number; w: number; h: number;
  points: PptxCustomGeometryPoint[];
};

/** 将网页 SVG 二次曲线转换为同控制点的 PPTX 自由路径。 */
export function resolveCurvedLineGeometry(line: PPTLineElement): CurvedLineSpec | null {
  if (!line.curve) return null;
  const start = [line.left + line.start[0], line.top + line.start[1]] as const;
  const end = [line.left + line.end[0], line.top + line.end[1]] as const;
  const control = [line.left + line.curve[0], line.top + line.curve[1]] as const;
  const minX = Math.min(start[0], end[0], control[0]);
  const minY = Math.min(start[1], end[1], control[1]);
  const width = Math.max(0.01, Math.max(start[0], end[0], control[0]) - minX);
  const height = Math.max(0.01, Math.max(start[1], end[1], control[1]) - minY);
  return {
    x: inches(minX), y: inches(minY), w: inches(width), h: inches(height),
    points: [
      { x: inches(start[0] - minX), y: inches(start[1] - minY), moveTo: true },
      {
        x: inches(end[0] - minX), y: inches(end[1] - minY),
        curve: { type: "quadratic", x1: inches(control[0] - minX), y1: inches(control[1] - minY) },
      },
    ],
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

/** 文本映射：净化 HTML → runs，并把共享段后间距附着到非末段。 */
export function resolveTextRuns(text: PPTTextElement): { runs: RichTextRun[]; defaultFontSize: number; layout: ResolvedTextLayout } {
  const layout = resolveTextLayout(text);
  const parsed = parseRichTextRuns(text.content);
  const finalParagraphIndex = parsed.reduce((last, run, index) => run.paragraphEnd ? index : last, -1);
  const runs = parsed.map((run, index) => ({
    ...run,
    paraSpaceAfter: run.paragraphEnd && index !== finalParagraphIndex
      ? Math.round(layout.paragraphSpacingPx * PT_PER_PX * 10) / 10
      : undefined,
  }));
  return { runs, defaultFontSize: Math.round(layout.fontSizePx * PT_PER_PX * 10) / 10, layout };
}
