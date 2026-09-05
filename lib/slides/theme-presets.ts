import type { SlideColor, SlideTheme } from "@/lib/domain/slide-schemas";

/**
 * 每套主题是一个完整可预测的视觉基线：模型在 Prompt 中只会看到当前课程
 * 分配到的这一套，避免自由选色导致页面风格漂移。
 *
 * 配色来源：
 * - 学术蓝青：本项目原有默认色板；
 * - 经典蓝橙：逐字取自 OpenMAIC 固定提交 59adbef0 的 lib/edit/slide-defaults.ts
 *   DEFAULT_THEME（scene-builder.ts / action/engine.ts 等处使用同一套）；
 * - 淡彩清新：取自同一提交 slide-content/system.md 卡片示例的淡彩底色与配套深色文字。
 */
export type SlideThemePreset = {
  /** 主题名，随 User Prompt 注入，便于模型理解语义（如“学术蓝青”）。 */
  name: string;
  /** 持久化到 Slide 的主题对象。 */
  theme: SlideTheme;
  /** 主强调色：标题下划线、文字侧竖条和箭头默认使用。 */
  accent: SlideColor;
  /** 浅色卡片底色与配套深色文字，用于信息分组卡片。 */
  cards: Array<{ bg: SlideColor; text: SlideColor }>;
  /** 推荐页面背景色（纯色或渐变端点）。 */
  pageBackgrounds: SlideColor[];
};

const FONT_NAME = "Microsoft YaHei";

export const SLIDE_THEME_PRESETS: SlideThemePreset[] = [
  {
    name: "学术蓝青",
    accent: "#498BA6",
    theme: {
      backgroundColor: "#ffffff",
      themeColors: ["#BF545D", "#143F59", "#498BA6", "#5CE3F2", "#14D9C5"],
      fontColor: "#143F59",
      fontName: FONT_NAME,
      outline: { color: "#BF545D", width: 2, style: "solid" },
    },
    cards: [
      { bg: "#EAF6F8", text: "#143F59" },
      { bg: "#E4FAF7", text: "#0E5F5B" },
      { bg: "#F3FAFB", text: "#498BA6" },
      { bg: "#FDEEEE", text: "#BF545D" },
    ],
    pageBackgrounds: ["#FFFFFF", "#F3FAFB", "#EAF6F8", "#E4FAF7"],
  },
  {
    name: "经典蓝橙",
    accent: "#ED7D31",
    theme: {
      backgroundColor: "#ffffff",
      themeColors: ["#5b9bd5", "#ed7d31", "#a5a5a5", "#ffc000", "#4472c4"],
      fontColor: "#333333",
      fontName: FONT_NAME,
      outline: { color: "#d14424", width: 2, style: "solid" },
    },
    cards: [
      { bg: "#E8F4FD", text: "#1E40AF" },
      { bg: "#DBEAFE", text: "#1D4ED8" },
      { bg: "#DCFCE7", text: "#166534" },
      { bg: "#FEF3C7", text: "#92400E" },
    ],
    pageBackgrounds: ["#FFFFFF", "#F8FAFC", "#EFF6FF", "#FFF7E6"],
  },
  {
    name: "淡彩清新",
    accent: "#1E40AF",
    theme: {
      backgroundColor: "#ffffff",
      themeColors: ["#1E40AF", "#166534", "#92400E", "#1D4ED8", "#0F766E"],
      fontColor: "#333333",
      fontName: FONT_NAME,
      outline: { color: "#1E40AF", width: 2, style: "solid" },
    },
    cards: [
      { bg: "#DBEAFE", text: "#1E40AF" },
      { bg: "#DCFCE7", text: "#166534" },
      { bg: "#FEF3C7", text: "#92400E" },
      { bg: "#E8F4FD", text: "#333333" },
    ],
    pageBackgrounds: ["#FFFFFF", "#F8FAFC", "#F0FDF4", "#FFFBEB"],
  },
];

/** 与历史版本一致的默认主题（第一套预设），测试与无 courseId 场景使用。 */
export const DEFAULT_SLIDE_THEME = SLIDE_THEME_PRESETS[0].theme;

/** 对 courseId 做 FNV-1a 哈希后选择主题；同一课程的所有场景保持同一套视觉。 */
export function resolveCourseTheme(courseId: string): SlideThemePreset {
  let hash = 0x811c9dc5;
  for (let index = 0; index < courseId.length; index += 1) {
    hash ^= courseId.charCodeAt(index) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return SLIDE_THEME_PRESETS[(hash >>> 0) % SLIDE_THEME_PRESETS.length];
}
