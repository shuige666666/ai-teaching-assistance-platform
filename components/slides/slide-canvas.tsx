"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Slide, SlideBackground } from "@/lib/domain/slide-schemas";
import { SlideElement } from "./slide-element";
import styles from "./slide-canvas.module.css";

function backgroundStyle(background: SlideBackground): CSSProperties {
  if (background.type === "solid") return { backgroundColor: background.color };
  const colors = [...background.gradient.colors]
    .sort((a, b) => a.pos - b.pos)
    .map((item) => `${item.color} ${item.pos}%`)
    .join(", ");
  if (background.gradient.type === "radial") return { backgroundImage: `radial-gradient(circle, ${colors})` };
  return { backgroundImage: `linear-gradient(${background.gradient.rotate}deg, ${colors})` };
}

/** 把 1000 × 562.5 逻辑画布等比缩放到课堂容器，保持元素坐标和后续导出数据一致。 */
export function SlideCanvas({ slide }: { slide: Slide }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const updateScale = useCallback(() => {
    const width = shellRef.current?.clientWidth;
    if (width) setScale(width / slide.viewportSize);
  }, [slide.viewportSize]);

  useEffect(() => {
    updateScale();
    const element = shellRef.current;
    if (!element) return;
    const observer = new ResizeObserver(updateScale);
    observer.observe(element);
    return () => observer.disconnect();
  }, [updateScale]);

  return (
    <div className={styles.shell} ref={shellRef} data-testid="slide-canvas">
      <div
        className={styles.viewport}
        style={{ ...backgroundStyle(slide.background), transform: `scale(${scale})` }}
      >
        {slide.elements.map((element, index) => (
          <SlideElement element={element} index={index} key={element.id} theme={slide.theme} />
        ))}
      </div>
    </div>
  );
}
