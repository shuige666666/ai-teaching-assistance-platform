/** Prompt 可用的形状预设；规范化阶段解析成具体 path + viewBox，渲染器保持只认 path。 */
export const SLIDE_SHAPE_FORMULAS = ["rect", "roundRect", "circle", "triangle", "diamond", "rightArrow"] as const;
export type SlideShapeFormula = (typeof SLIDE_SHAPE_FORMULAS)[number];

function n(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** 把预设解析为当前元素宽高下的绝对 path；坐标空间与 viewBox 一致，方便导出与测试。 */
export function resolveShapePath(formula: SlideShapeFormula, width: number, height: number): { path: string; viewBox: [number, number] } {
  const w = n(width);
  const h = n(height);
  switch (formula) {
    case "rect":
      return { path: `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`, viewBox: [width, height] };
    case "roundRect": {
      const r = Math.min(14, width / 2, height / 2);
      const rr = n(r);
      return {
        path: `M ${rr} 0 L ${n(width - r)} 0 A ${rr} ${rr} 0 0 1 ${w} ${rr} L ${w} ${n(height - r)} A ${rr} ${rr} 0 0 1 ${n(width - r)} ${h} L ${rr} ${h} A ${rr} ${rr} 0 0 1 0 ${n(height - r)} L 0 ${rr} A ${rr} ${rr} 0 0 1 ${rr} 0 Z`,
        viewBox: [width, height],
      };
    }
    case "circle":
      return {
        path: `M 0 ${n(height / 2)} A ${n(width / 2)} ${n(height / 2)} 0 1 0 ${w} ${n(height / 2)} A ${n(width / 2)} ${n(height / 2)} 0 1 0 0 ${n(height / 2)} Z`,
        viewBox: [width, height],
      };
    case "triangle":
      return { path: `M ${n(width / 2)} 0 L ${w} ${h} L 0 ${h} Z`, viewBox: [width, height] };
    case "diamond":
      return { path: `M ${n(width / 2)} 0 L ${w} ${n(height / 2)} L ${n(width / 2)} ${h} L 0 ${n(height / 2)} Z`, viewBox: [width, height] };
    case "rightArrow":
      return {
        path: `M 0 ${n(height * 0.2)} L ${n(width * 0.6)} ${n(height * 0.2)} L ${n(width * 0.6)} 0 L ${w} ${n(height / 2)} L ${n(width * 0.6)} ${h} L ${n(width * 0.6)} ${n(height * 0.8)} L 0 ${n(height * 0.8)} Z`,
        viewBox: [width, height],
      };
  }
}
