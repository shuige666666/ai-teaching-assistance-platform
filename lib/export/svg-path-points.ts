// @ts-expect-error v6 自带 d.ts，但 package exports 未声明 types 条件，NodeNext 无法自动解析。
import { SVGPathData as SVGPathDataRuntime } from "svg-pathdata";
import { inches } from "./pptx-units";

type NormalizedSvgCommand =
  | { type: 1 }
  | { type: 2 | 16; x: number; y: number }
  | { type: 32; x: number; y: number; x1: number; y1: number; x2: number; y2: number }
  | { type: 128; x: number; y: number; x1: number; y1: number };

type SvgPathDataInstance = {
  commands: NormalizedSvgCommand[];
  toAbs(): SvgPathDataInstance;
  normalizeHVZ(normalizeZ?: boolean, normalizeH?: boolean, normalizeV?: boolean): SvgPathDataInstance;
  normalizeST(): SvgPathDataInstance;
  aToC(): SvgPathDataInstance;
};

const SVGPathData = SVGPathDataRuntime as unknown as {
  new(path: string): SvgPathDataInstance;
  readonly CLOSE_PATH: 1;
  readonly MOVE_TO: 2;
  readonly LINE_TO: 16;
  readonly CURVE_TO: 32;
  readonly QUAD_TO: 128;
};

export type PptxCustomGeometryPoint =
  | { x: number; y: number; moveTo?: boolean }
  | { x: number; y: number; curve: { type: "cubic"; x1: number; y1: number; x2: number; y2: number } }
  | { x: number; y: number; curve: { type: "quadratic"; x1: number; y1: number } }
  | { close: true };

export type SvgPathGeometryResult =
  | { ok: true; points: PptxCustomGeometryPoint[] }
  | { ok: false; reason: string };

type PathBox = {
  width: number;
  height: number;
  viewBox: [number, number];
  fixedRatio: boolean;
};

type PointTransform = (x: number, y: number) => [number, number];

/** 将 SVG viewBox 坐标映射到形状本地坐标；fixedRatio 与浏览器的 xMidYMid meet 保持一致。 */
function createPointTransform(box: PathBox): PointTransform {
  const [viewWidth, viewHeight] = box.viewBox;
  if (box.fixedRatio) {
    const scale = Math.min(box.width / viewWidth, box.height / viewHeight);
    const offsetX = (box.width - viewWidth * scale) / 2;
    const offsetY = (box.height - viewHeight * scale) / 2;
    return (x, y) => [inches(x * scale + offsetX), inches(y * scale + offsetY)];
  }
  const scaleX = box.width / viewWidth;
  const scaleY = box.height / viewHeight;
  return (x, y) => [inches(x * scaleX), inches(y * scaleY)];
}

function allFinite(values: number[]): boolean {
  return values.every(Number.isFinite);
}

/**
 * 将 SVG path 规范化为 PptxGenJS custGeom 控制点。
 * 相对命令、H/V、S/T 与圆弧由 svg-pathdata 负责展开，非法 path 只让当前元素降级。
 */
export function svgPathToPptxPoints(path: string, box: PathBox): SvgPathGeometryResult {
  if (!path.trim() || !allFinite([box.width, box.height, ...box.viewBox]) || box.width <= 0 || box.height <= 0 || box.viewBox.some((value) => value <= 0)) {
    return { ok: false, reason: "SVG path 或 viewBox 无效" };
  }

  try {
    const commands = new SVGPathData(path)
      .toAbs()
      .normalizeHVZ(false, true, true)
      .normalizeST()
      .aToC()
      .commands;
    const transform = createPointTransform(box);
    const points: PptxCustomGeometryPoint[] = [];

    for (const command of commands) {
      if (command.type === SVGPathData.CLOSE_PATH) {
        points.push({ close: true });
        continue;
      }
      if (command.type === SVGPathData.MOVE_TO || command.type === SVGPathData.LINE_TO) {
        const [x, y] = transform(command.x, command.y);
        points.push({ x, y, moveTo: command.type === SVGPathData.MOVE_TO || undefined });
        continue;
      }
      if (command.type === SVGPathData.QUAD_TO) {
        const [x, y] = transform(command.x, command.y);
        const [x1, y1] = transform(command.x1, command.y1);
        points.push({ x, y, curve: { type: "quadratic", x1, y1 } });
        continue;
      }
      if (command.type === SVGPathData.CURVE_TO) {
        const [x, y] = transform(command.x, command.y);
        const [x1, y1] = transform(command.x1, command.y1);
        const [x2, y2] = transform(command.x2, command.y2);
        points.push({ x, y, curve: { type: "cubic", x1, y1, x2, y2 } });
      }
    }

    const drawable = points.some((point) => "curve" in point || ("x" in point && !point.moveTo));
    return drawable ? { ok: true, points } : { ok: false, reason: "SVG path 没有可绘制片段" };
  } catch {
    return { ok: false, reason: "SVG path 解析失败" };
  }
}
