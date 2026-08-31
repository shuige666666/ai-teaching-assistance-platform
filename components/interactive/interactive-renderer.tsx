"use client";

import { useEffect, useRef, useState } from "react";
import type { InteractiveContent } from "@/lib/domain/schemas";
import { HostToWidgetMessageSchema, WidgetToHostMessageSchema } from "@/lib/interactive/runtime-contract";
import { WIDGET_LABELS } from "@/lib/interactive/widget-types";
import styles from "./interactive-renderer.module.css";

type RuntimeState = "loading" | "ready" | "completed" | "failed";

type InteractiveRendererProps = {
  content: InteractiveContent;
  onCompleted?: () => void;
};

/** 在无同源权限的 iframe 中运行互动 HTML，并将协议失败回退到固定 React 内容。 */
export function InteractiveRenderer({ content, onCompleted }: InteractiveRendererProps) {
  return <InteractiveSession key={content.html} content={content} onCompleted={onCompleted} />;
}

/** 每份 HTML 有独立运行会话，失败后卸载脚本，重试重新初始化。 */
function InteractiveSession({ content, onCompleted }: InteractiveRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const completionReported = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("loading");
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const failed = useRef(false);

  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      failed.current = true;
      setFailureMessage("互动内容在 30 秒内没有完成初始化，外部资源可能尚未加载成功。");
      setRuntimeState("failed");
    }, 30_000);

    // 只处理当前 iframe 的协议消息，其他页面或已卸载场景不能改变播放状态。
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow || failed.current) return;
      // 第三方库自己的消息不是课堂协议，不因无关消息使整个场景降级。
      if (typeof event.data?.type !== "string" || !event.data.type.startsWith("INTERACTIVE_")) return;
      const parsed = WidgetToHostMessageSchema.safeParse(event.data);
      if (!parsed.success) {
        failed.current = true;
        window.clearTimeout(timeout);
        setFailureMessage("互动内容发送了不符合 M9 协议的消息。");
        setRuntimeState("failed");
        return;
      }
      const message = parsed.data;
      if (message.type === "INTERACTIVE_READY") {
        window.clearTimeout(timeout);
        if (!completionReported.current) setRuntimeState("ready");
      } else if (message.type === "INTERACTIVE_COMPLETED") {
        window.clearTimeout(timeout);
        setRuntimeState("completed");
        if (!completionReported.current) {
          completionReported.current = true;
          onCompletedRef.current?.();
        }
      } else {
        failed.current = true;
        window.clearTimeout(timeout);
        setFailureMessage(message.message);
        setRuntimeState("failed");
      }
    }

    window.addEventListener("message", onMessage);
    iframeRef.current?.contentWindow?.postMessage({ type: "INTERACTIVE_PING", version: 1 }, "*");
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    };
  }, [content.html, attempt]);

  /** 资源加载失败后允许重新加载，不调用模型也不改写已保存场景。 */
  function retry() {
    failed.current = false;
    completionReported.current = false;
    setFailureMessage(null);
    setRuntimeState("loading");
    setAttempt((value) => value + 1);
  }

  /** 通知互动页清空操作进度，允许学习者重复探索。 */
  function reset() {
    const message = HostToWidgetMessageSchema.parse({ type: "INTERACTIVE_RESET", version: 1 });
    completionReported.current = false;
    setFailureMessage(null);
    setRuntimeState("ready");
    iframeRef.current?.contentWindow?.postMessage(message, "*");
  }

  const showFallback = runtimeState === "loading" || runtimeState === "failed";
  return (
    <div className={styles.shell} data-testid="interactive-host" data-runtime-state={runtimeState}>
      {runtimeState !== "failed" ? <iframe
        key={attempt}
        ref={iframeRef}
        className={`${styles.frame} ${runtimeState === "ready" || runtimeState === "completed" ? styles.frameReady : ""}`}
        srcDoc={content.html}
        sandbox="allow-scripts"
        title={`课程互动：${WIDGET_LABELS[content.widgetType]}`}
        referrerPolicy="no-referrer"
        onLoad={() => iframeRef.current?.contentWindow?.postMessage({ type: "INTERACTIVE_PING", version: 1 }, "*")}
      /> : null}
      {!showFallback ? (
        <div className={styles.toolbar}>
          <span>{runtimeState === "completed" ? "COMPLETED" : WIDGET_LABELS[content.widgetType]}</span>
          <small>页面可联网，请勿输入密钥或敏感数据</small>
          <button type="button" onClick={reset}>重置互动</button>
        </div>
      ) : null}
      {showFallback ? (
        <section className={styles.fallback} role={runtimeState === "failed" ? "alert" : "status"}>
          <div>
            <span className={styles.fallbackMark}>{runtimeState === "loading" ? "LOADING INTERACTIVE" : "STATIC FALLBACK"}</span>
            <h2>{content.fallback.title}</h2>
            <p>{runtimeState === "failed" && failureMessage ? failureMessage : content.fallback.description}</p>
            {runtimeState === "failed" ? <><p>{content.fallback.description}</p><div className={styles.fallbackActions}><button type="button" onClick={retry}>重新加载</button><button type="button" onClick={() => onCompletedRef.current?.()}>跳过互动</button></div></> : null}
          </div>
          <ol>{content.fallback.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        </section>
      ) : null}
    </div>
  );
}
