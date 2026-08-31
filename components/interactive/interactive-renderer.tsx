"use client";

import { useEffect, useRef, useState } from "react";
import type { InteractiveContent } from "@/lib/domain/schemas";
import { HostToWidgetMessageSchema, WidgetToHostMessageSchema, isResizeObserverNotification } from "@/lib/interactive/runtime-contract";
import { WIDGET_LABELS } from "@/lib/interactive/widget-types";
import styles from "./interactive-renderer.module.css";

type RuntimeState = "loading" | "ready" | "completed" | "failed";

type InteractiveRendererProps = {
  content: InteractiveContent;
  onCompleted?: () => void;
  onRegenerate?: (runtimeError: string) => Promise<void>;
  onCancelRegeneration?: () => void;
};

/** 在无同源权限的 iframe 中运行互动 HTML，并将协议失败回退到固定 React 内容。 */
export function InteractiveRenderer(props: InteractiveRendererProps) {
  return <InteractiveSession key={props.content.html} {...props} />;
}

/** 每份 HTML 有独立运行会话，失败后卸载脚本，重试重新初始化。 */
function InteractiveSession({ content, onCompleted, onRegenerate, onCancelRegeneration }: InteractiveRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const completionReported = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("loading");
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerationError, setRegenerationError] = useState<string | null>(null);
  const regenerationPending = useRef(false);
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
      if (message.type === "INTERACTIVE_WARNING" || message.type === "INTERACTIVE_ERROR") {
        // 布局循环也可能持续撑大页面；包括已保存桥接发出的 WARNING，一律停止脚本。
        failed.current = true;
        window.clearTimeout(timeout);
        const location = message.line ? `（${message.filename || "互动文档"}:${message.line}:${message.column ?? 0}）` : "";
        const explanation = isResizeObserverNotification(message.message) ? "互动布局发生循环，已停止脚本以避免页面持续延伸。" : "";
        setFailureMessage(`${explanation}${message.message}${location}`);
        setRuntimeState("failed");
        return;
      }
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

  /** 用户点击才调用模型，重复点击不发第二个请求；失败时继续保留静态内容。 */
  async function regenerate() {
    if (!onRegenerate || regenerationPending.current) return;
    regenerationPending.current = true;
    setRegenerating(true);
    setRegenerationError(null);
    try {
      await onRegenerate(failureMessage ?? "互动未完成初始化");
    } catch (error) {
      setRegenerationError(error instanceof Error ? error.message : "重新生成失败，原互动已保留");
    } finally {
      regenerationPending.current = false;
      setRegenerating(false);
    }
  }
  return (
    <div className={styles.shell} data-testid="interactive-host" data-runtime-state={runtimeState}>
      {runtimeState !== "failed" ? (
        <div className={styles.viewportFrame} data-testid="interactive-viewport-frame">
          <div className={styles.viewport} data-testid="interactive-viewport">
            <iframe
              key={attempt}
              ref={iframeRef}
              className={`${styles.frame} ${runtimeState === "ready" || runtimeState === "completed" ? styles.frameReady : ""}`}
              srcDoc={content.html}
              sandbox="allow-scripts"
              title={`课程互动：${WIDGET_LABELS[content.widgetType]}`}
              referrerPolicy="no-referrer"
              onLoad={() => iframeRef.current?.contentWindow?.postMessage({ type: "INTERACTIVE_PING", version: 1 }, "*")}
            />
          </div>
        </div>
      ) : null}
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
            {runtimeState === "failed" ? <>
              <p>{content.fallback.description}</p>
              <div className={styles.fallbackActions}>
                {onRegenerate ? <button type="button" disabled={regenerating} onClick={regenerate}>{regenerating ? "正在重新生成…" : "重新生成本场互动"}</button> : null}
                <button type="button" disabled={regenerating} onClick={retry}>重新加载原脚本</button>
                <button type="button" disabled={regenerating} onClick={() => onCompletedRef.current?.()}>跳过互动</button>
                {regenerating && onCancelRegeneration ? <button type="button" onClick={onCancelRegeneration}>取消生成</button> : null}
              </div>
              {onRegenerate ? <small className={styles.regenerationNote}>重新生成会调用模型；成功后仅替换本场互动，失败保留原内容。</small> : null}
              {regenerating ? <p role="status">正在生成新的互动，请稍候。不会自动反复生成。</p> : null}
              {regenerationError ? <p role="alert">{regenerationError}</p> : null}
            </> : null}
          </div>
          <ol>{content.fallback.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        </section>
      ) : null}
    </div>
  );
}
