import { z } from "zod";

// 分类只选择教学 Prompt，不规定页面布局或唯一玩法。
export const WidgetTypeSchema = z.enum(["diagram", "simulation", "game", "code"]);
export type WidgetType = z.infer<typeof WidgetTypeSchema>;
export const WIDGET_LABELS: Record<WidgetType, string> = {
  diagram: "关系探索", simulation: "过程模拟", game: "互动挑战", code: "编程实验",
};
