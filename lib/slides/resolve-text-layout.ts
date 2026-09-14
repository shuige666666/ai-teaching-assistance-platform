import type { PPTTextElement } from "@/lib/domain/slide-schemas";

export const DEFAULT_SLIDE_TEXT_FONT_SIZE_PX = 18;
export const DEFAULT_SLIDE_TEXT_LINE_HEIGHT = 1.2;
export const SLIDE_TEXT_PADDING_PX = 10;
export const SLIDE_PARAGRAPH_SPACING_PX = 7;

export type ResolvedTextLayout = {
  fontFamily: string;
  fontSizePx: number;
  color: string;
  lineHeight: number;
  paddingPx: [number, number, number, number];
  paragraphSpacingPx: number;
  verticalAlign: "top" | "middle" | "bottom";
};

/**
 * 汇总网页渲染与 PPTX 导出共同使用的文本框默认排版。
 * 旧课程不需要迁移；未持久化的内边距、段距和行高在这里统一补齐。
 */
export function resolveTextLayout(element: PPTTextElement): ResolvedTextLayout {
  return {
    fontFamily: element.defaultFontName,
    fontSizePx: DEFAULT_SLIDE_TEXT_FONT_SIZE_PX,
    color: element.defaultColor,
    lineHeight: element.lineHeight ?? DEFAULT_SLIDE_TEXT_LINE_HEIGHT,
    paddingPx: [SLIDE_TEXT_PADDING_PX, SLIDE_TEXT_PADDING_PX, SLIDE_TEXT_PADDING_PX, SLIDE_TEXT_PADDING_PX],
    paragraphSpacingPx: SLIDE_PARAGRAPH_SPACING_PX,
    verticalAlign: element.vAlign ?? "top",
  };
}
