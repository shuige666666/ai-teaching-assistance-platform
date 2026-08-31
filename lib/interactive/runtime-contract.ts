import { z } from "zod";

export const INTERACTIVE_RUNTIME_VERSION = 1 as const;

// 仅识别浏览器已知布局通知；不能把 TypeError 等真实异常一并吞掉。
export const RESIZE_OBSERVER_NOTIFICATIONS = [
  "ResizeObserver loop completed with undelivered notifications.",
  "ResizeObserver loop limit exceeded",
] as const;

/** 统一新桥接和已保存 HTML 的布局通知分类，不修改课程原文。 */
export function isResizeObserverNotification(message: string): boolean {
  return RESIZE_OBSERVER_NOTIFICATIONS.some((known) => known === message.trim());
}

const diagnosticFields = {
  message: z.string().trim().min(1).max(300),
  filename: z.string().max(200).optional(),
  line: z.number().int().nonnegative().optional(),
  column: z.number().int().nonnegative().optional(),
};

export const WidgetToHostMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("INTERACTIVE_READY"), version: z.literal(INTERACTIVE_RUNTIME_VERSION) }).strict(),
  z.object({ type: z.literal("INTERACTIVE_COMPLETED"), version: z.literal(INTERACTIVE_RUNTIME_VERSION) }).strict(),
  z.object({ type: z.literal("INTERACTIVE_ERROR"), version: z.literal(INTERACTIVE_RUNTIME_VERSION), ...diagnosticFields }).strict(),
  z.object({ type: z.literal("INTERACTIVE_WARNING"), version: z.literal(INTERACTIVE_RUNTIME_VERSION), ...diagnosticFields }).strict(),
]);

export const HostToWidgetMessageSchema = z.object({
  type: z.enum(["INTERACTIVE_RESET", "INTERACTIVE_PING"]),
  version: z.literal(INTERACTIVE_RUNTIME_VERSION),
}).strict();

export type WidgetToHostMessage = z.infer<typeof WidgetToHostMessageSchema>;
export type HostToWidgetMessage = z.infer<typeof HostToWidgetMessageSchema>;
