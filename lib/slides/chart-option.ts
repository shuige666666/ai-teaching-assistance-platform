import type { PPTChartElement } from "@/lib/domain/slide-schemas";

/** 主题色缺失时的兜底图表配色。 */
export const DEFAULT_CHART_COLORS = ["#498BA6", "#BF545D", "#14D9C5", "#F59E0B", "#7C3AED"] as const;

type EChartsOption = Record<string, unknown>;

const AXIS_LABEL = { color: "#64748b", fontSize: 11, fontFamily: "Microsoft YaHei" } as const;

function categoryAxis(labels: string[]): EChartsOption {
  return {
    type: "category", data: labels,
    axisTick: { alignWithLabel: true }, axisLine: { lineStyle: { color: "#cbd5e1" } },
    axisLabel: { ...AXIS_LABEL, interval: 0, hideOverlap: true },
  };
}

function valueAxis(): EChartsOption {
  return { type: "value", splitLine: { lineStyle: { color: "#e2e8f0" } }, axisLabel: AXIS_LABEL };
}

/**
 * 由 chart 元素数据构建确定性的 ECharts option；
 * 关闭动画以保证课堂截图和 MHTML 留档状态稳定。
 */
export function buildChartOption(element: PPTChartElement): EChartsOption {
  const colors = element.themeColors && element.themeColors.length > 0 ? element.themeColors : [...DEFAULT_CHART_COLORS];
  const base: EChartsOption = {
    animation: false,
    color: colors,
    textStyle: { fontFamily: "Microsoft YaHei" },
    grid: { left: 10, right: 20, top: element.data.series.length > 1 ? 34 : 18, bottom: 6, containLabel: true },
  };

  if (element.chartType === "pie") {
    const values = element.data.series[0].values;
    return {
      ...base,
      legend: { bottom: 0, textStyle: { ...AXIS_LABEL }, itemWidth: 12, itemHeight: 8 },
      series: [{
        type: "pie",
        radius: ["0%", "58%"],
        center: ["50%", "46%"],
        data: element.data.labels.map((label, index) => ({ name: label, value: values[index] })),
        label: { color: "#475569", fontSize: 11, fontFamily: "Microsoft YaHei" },
        itemStyle: { borderColor: "#ffffff", borderWidth: 1 },
      }],
    };
  }

  const horizontal = element.chartType === "bar";
  return {
    ...base,
    legend: element.data.series.length > 1
      ? { top: 0, textStyle: { ...AXIS_LABEL }, itemWidth: 12, itemHeight: 8 }
      : undefined,
    xAxis: horizontal ? valueAxis() : categoryAxis(element.data.labels),
    yAxis: horizontal ? categoryAxis(element.data.labels) : valueAxis(),
    series: element.data.series.map((series) => ({
      name: series.name,
      type: element.chartType === "line" ? "line" : "bar",
      data: series.values,
      ...(element.chartType === "line"
        ? { lineStyle: { width: 2.5 }, symbol: "circle", symbolSize: 6 }
        : { barMaxWidth: 36, itemStyle: { borderRadius: element.chartType === "bar" ? [0, 3, 3, 0] : [3, 3, 0, 0] } }),
    })),
  };
}
