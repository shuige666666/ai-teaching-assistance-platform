import { z } from "zod";

export const INTERACTIVE_RUNTIME_VERSION = 1 as const;

export const WidgetToHostMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("INTERACTIVE_READY"), version: z.literal(INTERACTIVE_RUNTIME_VERSION) }).strict(),
  z.object({ type: z.literal("INTERACTIVE_COMPLETED"), version: z.literal(INTERACTIVE_RUNTIME_VERSION) }).strict(),
  z.object({ type: z.literal("INTERACTIVE_ERROR"), version: z.literal(INTERACTIVE_RUNTIME_VERSION), message: z.string().trim().min(1).max(300) }).strict(),
]);

export const HostToWidgetMessageSchema = z.object({
  type: z.enum(["INTERACTIVE_RESET", "INTERACTIVE_PING"]),
  version: z.literal(INTERACTIVE_RUNTIME_VERSION),
}).strict();

export type WidgetToHostMessage = z.infer<typeof WidgetToHostMessageSchema>;
export type HostToWidgetMessage = z.infer<typeof HostToWidgetMessageSchema>;
