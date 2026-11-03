import type { CSSProperties } from "react";
import type { PPTElement } from "@/lib/domain/slide-schemas";
import styles from "./slide-canvas.module.css";

/** 在画布坐标系中绘制临时聚焦框，不改动元素样式、层级或导出内容。 */
export function SlideFocus({ element }: { element: PPTElement }) {
  let box: CSSProperties;
  if (element.type === "line") {
    // 线条的 width 是笔画粗细；聚焦范围需按端点及曲线控制点计算。
    const points = [element.start, element.end, ...(element.curve ? [element.curve] : [])];
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    box = {
      left: element.left + Math.min(...xs) - 4,
      top: element.top + Math.min(...ys) - 4,
      width: Math.max(...xs) - Math.min(...xs) + 8,
      height: Math.max(...ys) - Math.min(...ys) + 8,
    };
  } else {
    box = { left: element.left, top: element.top, width: element.width, height: element.height, transform: `rotate(${element.rotate}deg)` };
  }
  return <div className={styles.focusFrame} style={box} data-focus-element-id={element.id} aria-hidden="true" />;
}
