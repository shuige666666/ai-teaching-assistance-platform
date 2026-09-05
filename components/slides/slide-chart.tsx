"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { PPTChartElement } from "@/lib/domain/slide-schemas";
import { buildChartOption } from "@/lib/slides/chart-option";
import styles from "./slide-canvas.module.css";

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, SVGRenderer]);

/**
 * 用固定逻辑像素初始化 SVG 图表：画布由 SlideCanvas 统一缩放，
 * 图表内部无需感知容器尺寸；关闭动画以保证课堂截图和 MHTML 留档稳定。
 * 初始化失败时直接在容器内降级为文字摘要，不影响页面其余元素。
 */
export function SlideChart({ element }: { element: PPTChartElement }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let instance: echarts.ECharts | undefined;
    try {
      instance = echarts.init(container, undefined, {
        renderer: "svg", width: element.width, height: element.height,
      });
      instance.setOption(buildChartOption(element));
    } catch {
      instance?.dispose();
      const fallback = document.createElement("div");
      fallback.className = styles.chartFallback;
      fallback.dataset.elementType = "chart-fallback";
      fallback.textContent = `图表暂时无法渲染：${element.data.labels.join("、")}`;
      container.replaceChildren(fallback);
    }
    return () => instance?.dispose();
  }, [element]);

  return (
    <div
      className={`${styles.box} ${styles.chart}`}
      data-element-type="chart"
      aria-hidden="true"
      style={{
        left: element.left, top: element.top, width: element.width, height: element.height,
        transform: `rotate(${element.rotate}deg)`,
      }}
      ref={containerRef}
    />
  );
}
