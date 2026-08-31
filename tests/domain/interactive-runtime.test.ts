import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { buildRuntimeBootstrap } from "@/lib/interactive/runtime-bootstrap";
import { isResizeObserverNotification, WidgetToHostMessageSchema } from "@/lib/interactive/runtime-contract";
import { CANVAS_RESIZE_EXAMPLE, RESET_STATE_EXAMPLE, SIMULATION_CONTROL_EXAMPLE } from "@/lib/interactive/layout-templates";

/** 在隔离 JS 上下文执行真正注入的桥接，检查消息行为而不只比对字符串。 */
function createRuntime() {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const parent = { postMessage: vi.fn() };
  const context = createContext({ window: {}, parent, addEventListener: (name: string, fn: (event: Record<string, unknown>) => void) => listeners.set(name, fn) });
  runInContext(buildRuntimeBootstrap().replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""), context);
  return { listeners, parent, context };
}

describe("互动运行稳定性", () => {
  it("布局循环也上报错误并去重，真实异常保留行列", () => {
    const { listeners, parent } = createRuntime();
    const message = "ResizeObserver loop completed with undelivered notifications.";
    listeners.get("error")!({ message });
    listeners.get("error")!({ message });
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage.mock.calls[0][0]).toMatchObject({ type: "INTERACTIVE_ERROR", message });
    const other = createRuntime();
    other.listeners.get("error")!({ message: "TypeError: value.toFixed is not a function", filename: "https://example.com/widget.js?secret=test", lineno: 42, colno: 8 });
    const diagnostic = other.parent.postMessage.mock.calls[0][0];
    expect(diagnostic).toMatchObject({ type: "INTERACTIVE_ERROR", filename: "https://example.com/widget.js", line: 42, column: 8 });
    expect(WidgetToHostMessageSchema.safeParse(diagnostic).success).toBe(true);
    expect(isResizeObserverNotification("TypeError: ResizeObserver is not defined")).toBe(false);
  });

  it("初始错误在宿主 PING 时重放，其他窗口无法请求重放", () => {
    const { listeners, parent, context } = createRuntime();
    listeners.get("unhandledrejection")!({ reason: new Error("初始化失败") });
    runInContext("window.InteractiveRuntime.ready()", context);
    parent.postMessage.mockClear();
    listeners.get("message")!({ source: {}, data: { type: "INTERACTIVE_PING", version: 1 } });
    expect(parent.postMessage).not.toHaveBeenCalled();
    listeners.get("message")!({ source: parent, data: { type: "INTERACTIVE_PING", version: 1 } });
    expect(parent.postMessage.mock.calls.map(([message]) => message.type)).toEqual(["INTERACTIVE_ERROR"]);
  });

  it("布局错误优先于 ready 重放，历史 WARNING 的诊断字段仍严格校验", () => {
    const { listeners, parent, context } = createRuntime();
    listeners.get("error")!({ message: "ResizeObserver loop limit exceeded" });
    runInContext("window.InteractiveRuntime.ready()", context);
    parent.postMessage.mockClear();
    listeners.get("message")!({ source: parent, data: { type: "INTERACTIVE_PING", version: 1 } });
    expect(parent.postMessage.mock.calls.map(([message]) => message.type)).toEqual(["INTERACTIVE_ERROR"]);
    expect(WidgetToHostMessageSchema.safeParse({ type: "INTERACTIVE_WARNING", version: 1, message: "layout", line: -1 }).success).toBe(false);
  });

  it("Canvas 示例仅在尺寸变化时调整缓冲区，不修改 CSS 宽高", () => {
    const width = vi.fn(), height = vi.fn(), render = vi.fn();
    const stage = { clientWidth: 300, clientHeight: 180 };
    const canvas = { closest: () => stage, getContext: () => ({ setTransform: vi.fn() }), style: Object.freeze({}) };
    Object.defineProperties(canvas, { width: { set: width }, height: { set: height } });
    const context = createContext({ document: { querySelector: () => canvas }, window: { devicePixelRatio: 2 }, ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: vi.fn(), cancelAnimationFrame: vi.fn(), addEventListener: vi.fn(), render });
    runInContext(CANVAS_RESIZE_EXAMPLE, context);
    runInContext("resizeCanvas(300,180); resizeCanvas(300,180); resizeCanvas(0,0)", context);
    expect(width.mock.calls).toEqual([[600]]);
    expect(height.mock.calls).toEqual([[360]]);
    expect(render).toHaveBeenCalledTimes(1);
    runInContext("resizeCanvas(400,200)", context);
    expect(width.mock.calls).toEqual([[600], [800]]);
  });

  it("调参参与推进，开始去重，正常失败不降级，重置恢复默认参数", () => {
    const handlers = new Map<string, () => void>();
    const speed = { value: "2.5", valueAsNumber: 2.5, addEventListener: (name: string, fn: () => void) => handlers.set(name, fn) };
    const feedback = { textContent: "" };
    const runtime = { onReset: vi.fn(), reset: vi.fn(), complete: vi.fn(), error: vi.fn() };
    const requestAnimationFrame = vi.fn(() => 1);
    const context = createContext({ structuredClone, performance: { now: () => 0 }, requestAnimationFrame, cancelAnimationFrame: vi.fn(), InteractiveRuntime: runtime, document: { querySelector: (id: string) => id === "#speed" ? speed : id === "#feedback" ? feedback : { addEventListener: vi.fn() } } });
    runInContext(`${RESET_STATE_EXAMPLE}\n${SIMULATION_CONTROL_EXAMPLE}`, context);
    handlers.get("input")!();
    runInContext("advance = dt => { state.step += state.speed * dt; }; start(); start()", context);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    runInContext("frame(40)", context);
    expect(runInContext("state.step", context)).toBeCloseTo(0.1);
    speed.valueAsNumber = NaN;
    handlers.get("input")!();
    expect(runInContext("state.speed", context)).toBe(2.5);
    runInContext("finish(false, '预算耗尽，可以重来')", context);
    expect(runtime.error).not.toHaveBeenCalled();
    expect(runtime.complete).not.toHaveBeenCalled();
    expect(feedback.textContent).toContain("预算耗尽");
    runtime.onReset.mock.calls[0][0]();
    expect(runInContext("({speed:state.speed,step:state.step,running:state.running,ended:state.ended})", context)).toEqual({ speed: 1, step: 0, running: false, ended: false });
    expect(speed.value).toBe("1");
  });
});
