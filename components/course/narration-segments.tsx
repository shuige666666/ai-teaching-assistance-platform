"use client";

import { useEffect, useRef } from "react";
import type { Action } from "@/lib/domain/schemas";
import type { PlaybackStatus } from "@/lib/playback/playback-machine";

type NarrationSegmentsProps = {
  actions: Action[];
  actionIndex: number;
  status: PlaybackStatus;
  onSelect: (actionIndex: number, play?: boolean) => void;
};

/** 展示可定位的分段讲稿，段落导航使用原 Action 下标以兼容暂停动作。 */
export function NarrationSegments({ actions, actionIndex, status, onSelect }: NarrationSegmentsProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const segments = actions.flatMap((action, index) => action.type === "speech" ? [{ action, index }] : []);
  // 段间若有 timed pause，导航仍从最近讲过的段落继续，不能跳回第一段。
  const selectedIndex = segments.findLastIndex((segment) => segment.index <= actionIndex);

  useEffect(() => {
    const list = listRef.current;
    const active = activeRef.current;
    if (!list || !active) return;
    // 只滚动讲稿容器，避免自动推进时把整个课堂页面带走。
    const rowBox = active.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    if (rowBox.top < listBox.top || rowBox.bottom > listBox.bottom) {
      list.scrollTop += rowBox.top - listBox.top;
    }
  }, [actionIndex, actions]);

  if (segments.length === 0) return <p>当前场景没有讲解段落。</p>;

  return (
    <section className="narration-segments" aria-label="分段讲稿">
      <div className="narration-segment-heading">
        <span>讲解段落</span>
        <small aria-live="polite">第 {Math.max(1, selectedIndex + 1)} / {segments.length} 段</small>
      </div>
      <div className="narration-segment-tools">
        <button type="button" disabled={selectedIndex <= 0} onClick={() => onSelect(segments[selectedIndex - 1].index)}>上一段</button>
        <button type="button" disabled={selectedIndex < 0} onClick={() => onSelect(segments[selectedIndex].index, true)}>重听本段</button>
        <button type="button" disabled={selectedIndex >= segments.length - 1} onClick={() => onSelect(segments[selectedIndex + 1].index)}>下一段</button>
      </div>
      <ol className="narration-segment-list" ref={listRef}>
        {segments.map(({ action, index }, segmentIndex) => {
          const active = index === actionIndex && status !== "completed";
          return (
            <li key={action.id}>
              <button
                type="button"
                className={active ? "is-current" : ""}
                ref={active ? activeRef : undefined}
                aria-label={`定位第 ${segmentIndex + 1} 段`}
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect(index)}
              >
                <span className="narration-segment-number">{String(segmentIndex + 1).padStart(2, "0")}{active ? (status === "idle" ? " · 待讲" : " · 当前") : ""}</span>
                <span className="narration-segment-text">{action.text}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
