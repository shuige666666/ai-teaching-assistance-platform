"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { GenerationRunStatus, GenerationRunType, UsageRange, UsageResponse } from "@/lib/domain/generation-run";

const rangeLabels: Record<UsageRange, string> = { "7d": "近 7 天", "30d": "近 30 天", all: "全部" };
const statusLabels: Record<GenerationRunStatus, string> = {
  running: "生成中", awaiting_review: "待审核", awaiting_generation: "待继续", completed: "已完成",
  partial_failed: "部分失败", failed: "失败", cancelled: "已取消", interrupted: "已中断", superseded: "已替代",
};
const typeLabels: Record<GenerationRunType, string> = {
  course_generation: "整课首次生成", scene_batch: "继续生成", scene_retry: "场景重试",
};

function formatNumber(value: number | undefined) { return value === undefined ? "—" : new Intl.NumberFormat("zh-CN").format(value); }
function formatDuration(value: number | undefined) {
  if (value === undefined) return "—";
  if (value < 1_000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1_000)}s`;
}
function formatDate(value: number) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(value); }
function percentage(numerator: number, denominator: number) { return denominator === 0 ? "暂无数据" : `${Math.round(numerator / denominator * 100)}%`; }

function UsageTrend({ data }: { data: UsageResponse["byDay"] }) {
  const chartHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = chartHost.current;
    if (!host || data.length === 0) return;
    let disposed = false;
    let dispose: (() => void) | undefined;
    void import("echarts").then((echarts) => {
      if (disposed) return;
      const chart = echarts.init(host, undefined, { renderer: "svg" });
      chart.setOption({
        animationDuration: 350,
        color: ["#498ba6", "#14d9c5", "#bf545d"],
        tooltip: { trigger: "axis" },
        legend: { top: 0, right: 0, textStyle: { color: "#4d6876", fontSize: 10 } },
        grid: { left: 38, right: 16, top: 42, bottom: 28 },
        xAxis: { type: "category", data: data.map((item) => item.date.slice(5)), axisLine: { lineStyle: { color: "#b7d0d7" } }, axisLabel: { color: "#4d6876", fontSize: 10 } },
        yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: "rgba(183,208,215,.45)" } }, axisLabel: { color: "#4d6876", fontSize: 10 } },
        series: [
          { name: "运行", type: "line", smooth: true, data: data.map((item) => item.runs) },
          { name: "完成", type: "line", smooth: true, data: data.map((item) => item.completedRuns) },
          { name: "失败", type: "line", smooth: true, data: data.map((item) => item.failedRuns) },
        ],
      });
      const observer = new ResizeObserver(() => chart.resize());
      observer.observe(host);
      dispose = () => { observer.disconnect(); chart.dispose(); };
    });
    return () => { disposed = true; dispose?.(); };
  }, [data]);
  return <div className="usage-chart" ref={chartHost} aria-label="每日生成运行趋势" />;
}

export function UsageDashboard() {
  const [range, setRange] = useState<UsageRange>("30d");
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/usage?range=${range}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "读取用量统计失败");
        setData(payload.data as UsageResponse);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "读取用量统计失败");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range, refreshKey]);

  const totals = data?.totals;
  const usageNote = totals?.usageStatus === "partial" ? "部分调用未返回 token" : totals?.usageStatus === "unavailable" ? "Provider 未返回 token" : "Provider 返回完整 token";

  function selectRange(nextRange: UsageRange) {
    if (nextRange === range) return;
    setLoading(true);
    setError(null);
    setRange(nextRange);
  }

  function refresh() {
    setLoading(true);
    setError(null);
    setRefreshKey((value) => value + 1);
  }

  return (
    <section className="usage-dashboard reveal reveal--two" aria-busy={loading}>
      <div className="usage-toolbar">
        <div className="usage-ranges" aria-label="统计时间范围">
          {(Object.keys(rangeLabels) as UsageRange[]).map((item) => (
            <button key={item} type="button" className={range === item ? "is-active" : ""} onClick={() => selectRange(item)}>{rangeLabels[item]}</button>
          ))}
        </div>
        <button className="usage-refresh" type="button" onClick={refresh} disabled={loading}>{loading ? "读取中…" : "刷新数据"}</button>
      </div>

      {error ? <div className="usage-error"><strong>暂时无法读取统计</strong><span>{error}</span></div> : null}
      {data ? (
        <>
          <div className="usage-cards">
            <article><span>生成运行</span><strong>{formatNumber(totals?.runs)}</strong><small>{rangeLabels[range]}</small></article>
            <article><span>完整运行</span><strong>{formatNumber(totals?.completedRuns)}</strong><small>终态 {formatNumber(totals?.terminalRuns)} 次</small></article>
            <article><span>场景完成率</span><strong>{percentage(totals?.succeededScenes ?? 0, totals?.requestedScenes ?? 0)}</strong><small>{formatNumber(totals?.succeededScenes)} / {formatNumber(totals?.requestedScenes)}</small></article>
            <article><span>模型调用</span><strong>{formatNumber(totals?.modelCalls)}</strong><small>包含重试与 repair</small></article>
            <article><span>输入 / 输出 TOKEN</span><strong>{formatNumber(totals?.inputTokens)} <em>/</em> {formatNumber(totals?.outputTokens)}</strong><small>{usageNote}</small></article>
            <article><span>平均有效耗时</span><strong>{formatDuration(totals?.averageActiveDurationMs)}</strong><small>不含人工审核等待</small></article>
          </div>

          <div className="usage-grid">
            <article className="usage-panel usage-panel--trend">
              <header><div><span>DAILY TREND</span><h2>每日运行趋势</h2></div><small>运行 / 完成 / 失败</small></header>
              {data.byDay.length > 0 ? <UsageTrend data={data.byDay} /> : <p className="usage-empty">当前范围还没有生成运行。</p>}
            </article>
            <article className="usage-panel">
              <header><div><span>RUN STATUS</span><h2>状态与修复</h2></div></header>
              <div className="usage-status-list">
                {data.byStatus.length > 0 ? data.byStatus.map((item) => <div key={item.status}><span>{statusLabels[item.status]}</span><strong>{item.count}</strong></div>) : <p className="usage-empty">暂无状态记录。</p>}
              </div>
              <div className="usage-repair"><span>repair 恢复</span><strong>{percentage(totals?.repairSucceededCount ?? 0, totals?.repairCount ?? 0)}</strong><small>{formatNumber(totals?.repairSucceededCount)} / {formatNumber(totals?.repairCount)}</small></div>
            </article>
          </div>

          <article className="usage-panel usage-table-panel">
            <header><div><span>MODEL BREAKDOWN</span><h2>按模型汇总</h2></div></header>
            <div className="usage-table-scroll"><table><thead><tr><th>Provider / 模型</th><th>运行</th><th>调用</th><th>输入 token</th><th>输出 token</th><th>平均耗时</th></tr></thead><tbody>
              {data.byModel.map((item, index) => <tr key={`${item.provider}-${item.model}-${index}`}><td><strong>{item.model ?? "未知模型"}</strong><small>{item.provider ?? "未知 Provider"}</small></td><td>{formatNumber(item.runs)}</td><td>{formatNumber(item.modelCalls)}</td><td>{formatNumber(item.inputTokens)}</td><td>{formatNumber(item.outputTokens)}</td><td>{formatDuration(item.averageActiveDurationMs)}</td></tr>)}
              {data.byModel.length === 0 ? <tr><td colSpan={6}>当前范围暂无模型记录。</td></tr> : null}
            </tbody></table></div>
          </article>

          <article className="usage-panel usage-table-panel">
            <header><div><span>RECENT RUNS</span><h2>最近运行</h2></div><small>最多显示 20 条</small></header>
            <div className="usage-table-scroll"><table><thead><tr><th>课程与类型</th><th>状态</th><th>场景</th><th>模型调用</th><th>repair</th><th>有效耗时</th><th>开始时间</th></tr></thead><tbody>
              {data.recentRuns.map((run) => <tr key={run.id}><td><Link href={`/generation/${run.courseId}`}>{run.courseTitle}</Link><small>{typeLabels[run.runType]}</small></td><td><span className={`usage-status usage-status--${run.status}`}>{statusLabels[run.status]}</span></td><td>{run.succeededScenes} / {run.requestedScenes}</td><td>{run.modelCalls}</td><td>{run.repairCount}</td><td>{formatDuration(run.activeDurationMs)}</td><td>{formatDate(run.startedAt)}</td></tr>)}
              {data.recentRuns.length === 0 ? <tr><td colSpan={7}>统计启用后生成课程，这里会显示运行记录。</td></tr> : null}
            </tbody></table></div>
          </article>

          <footer className="usage-footnote">
            <span>{data.recordingStartedAt ? `统计自 ${formatDate(data.recordingStartedAt)} 开始` : "尚无运行记录"}</span>
            <p>有效耗时只累计服务端大纲和场景生成请求；未结束运行不进入平均值。用量和运行状态不代表课程事实正确性、教学质量或学习效果。</p>
          </footer>
        </>
      ) : loading ? <div className="usage-loading">正在读取运行记录…</div> : null}
    </section>
  );
}
