/**
 * 把净化后的幻灯片富文本（白名单标签 + 白名单内联样式）解析为 PPTX 文本 runs。
 * 输入边界由 sanitizeSlideText 保证：只有 p/span/strong/b/em/i/u/br 和六种样式属性，
 * 因此这里使用约束态解析器而不引入 DOM 依赖，可在 Node 单测中直接运行。
 */

export type RichTextRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** 无 # 前缀的十六进制色；未显式指定时由映射层回填元素默认色。 */
  color?: string;
  /** PPT point（CSS px × 0.75）。 */
  fontSize?: number;
  /** 段落属性只挂在段落首 run 上。 */
  align?: "left" | "center" | "right";
  lineSpacingMultiple?: number;
  /** 该 run 是否结束当前段落（对应 </p>）。 */
  paragraphEnd: boolean;
  /** 该 run 之前有 <br> 软换行。 */
  softBreakBefore: boolean;
};

type Format = { bold: boolean; italic: boolean; underline: boolean; color?: string; fontSize?: number };

const TAG_RE = /<(\/?)(p|span|strong|b|em|i|u|br)\b([^>]*)>/gi;
const STYLE_RE = /([\w-]+)\s*:\s*([^;"]+)/g;

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function parseStyle(style: string): Partial<Format> {
  const next: Partial<Format> = {};
  for (const match of style.matchAll(STYLE_RE)) {
    const property = match[1].toLowerCase();
    const value = match[2].trim();
    if (property === "color") {
      const color = value.replace(/^#/, "");
      if (/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/.test(color)) next.color = color.toUpperCase();
    } else if (property === "font-size") {
      const px = Number(value.replace(/px/i, ""));
      if (Number.isFinite(px) && px > 0) next.fontSize = Math.round(px * 0.75 * 10) / 10;
    } else if (property === "font-weight") {
      if (value === "bold" || value === "600" || value === "700" || value === "800") next.bold = true;
    } else if (property === "font-style") {
      if (value === "italic") next.italic = true;
    } else if (property === "text-decoration") {
      if (value === "underline") next.underline = true;
    }
  }
  return next;
}

const ALIGN_VALUES = ["left", "center", "right"] as const;

/** 段落属性（对齐/行距）从 style 中提取。 */
function parseParagraphStyle(style: string): { align?: (typeof ALIGN_VALUES)[number]; lineSpacingMultiple?: number } {
  const result: { align?: (typeof ALIGN_VALUES)[number]; lineSpacingMultiple?: number } = {};
  for (const match of style.matchAll(STYLE_RE)) {
    const property = match[1].toLowerCase();
    const value = match[2].trim();
    if (property === "text-align") {
      const align = value.toLowerCase();
      if ((ALIGN_VALUES as readonly string[]).includes(align)) result.align = align as (typeof ALIGN_VALUES)[number];
    } else if (property === "line-height") {
      const lineHeight = Number(value);
      if (Number.isFinite(lineHeight) && lineHeight >= 0.5 && lineHeight <= 4) result.lineSpacingMultiple = lineHeight;
    }
  }
  return result;
}

/**
 * 解析为扁平 runs：段落属性挂在每段首 run，`paragraphEnd` 标记段落结束。
 * `<br>` 视作段内软换行（下个 run 带 softBreakBefore），由映射层转成 PPTX 换行。
 */
export function parseRichTextRuns(content: string): RichTextRun[] {
  const runs: RichTextRun[] = [];
  let format: Format = { bold: false, italic: false, underline: false };
  const stack: Array<{ tag: string; format: Format }> = [];
  let paragraphAlign: RichTextRun["align"];
  let paragraphLineSpacing: RichTextRun["lineSpacingMultiple"];
  let softBreakBefore = false;
  let paragraphHasContent = false;

  const closeParagraph = () => {
    const last = runs[runs.length - 1];
    if (last && !last.paragraphEnd) last.paragraphEnd = true;
    paragraphAlign = undefined;
    paragraphLineSpacing = undefined;
    softBreakBefore = false;
  };

  let lastIndex = 0;
  for (const match of content.matchAll(TAG_RE)) {
    const textSegment = content.slice(lastIndex, match.index).replace(/\s+/g, " ");
    if (textSegment) {
      runs.push({
        text: decodeEntities(textSegment),
        bold: format.bold, italic: format.italic, underline: format.underline,
        color: format.color, fontSize: format.fontSize,
        ...(runs.length === 0 || runs[runs.length - 1].paragraphEnd ? { align: paragraphAlign, lineSpacingMultiple: paragraphLineSpacing } : {}),
        softBreakBefore,
        paragraphEnd: false,
      });
      if (softBreakBefore) softBreakBefore = false;
      paragraphHasContent = true;
    }
    lastIndex = (match.index ?? 0) + match[0].length;
    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    const attributes = match[3] ?? "";
    const styleMatch = attributes.match(/style\s*=\s*"([^"]*)"/i);
    const style = styleMatch?.[1] ?? "";

    if (tag === "br") {
      softBreakBefore = true;
      continue;
    }
    if (tag === "p") {
      if (closing) {
        // 先恢复段前的格式作用域，再收口段落。
        const scopeIndex = stack.map((entry) => entry.tag).lastIndexOf("p");
        if (scopeIndex >= 0) {
          format = stack[scopeIndex].format;
          stack.length = scopeIndex;
        }
        closeParagraph();
      } else {
        const paragraphStyle = parseParagraphStyle(style);
        paragraphAlign = paragraphStyle.align;
        paragraphLineSpacing = paragraphStyle.lineSpacingMultiple;
        // 段级内联样式（font-size/color/font-weight 等）作为该段 runs 的基础格式。
        stack.push({ tag: "p", format });
        format = { ...format, ...parseStyle(style) };
        // 相邻段落：前一段在此收口。
        if (paragraphHasContent && runs.length > 0 && !runs[runs.length - 1].paragraphEnd) closeParagraph();
      }
      continue;
    }
    if (closing) {
      const scopeIndex = stack.map((entry) => entry.tag).lastIndexOf(tag);
      if (scopeIndex >= 0) {
        format = stack[scopeIndex].format;
        stack.length = scopeIndex;
      }
      continue;
    }
    const overrides = parseStyle(style);
    if (tag === "strong" || tag === "b") overrides.bold = true;
    if (tag === "em" || tag === "i") overrides.italic = true;
    if (tag === "u") overrides.underline = true;
    stack.push({ tag, format });
    format = { ...format, ...overrides };
  }

  const tail = content.slice(lastIndex).replace(/\s+/g, " ");
  if (tail) {
    runs.push({
      text: decodeEntities(tail), bold: format.bold, italic: format.italic, underline: format.underline,
      color: format.color, fontSize: format.fontSize,
      ...(runs.length === 0 || runs[runs.length - 1]?.paragraphEnd ? { align: paragraphAlign, lineSpacingMultiple: paragraphLineSpacing } : {}),
      softBreakBefore, paragraphEnd: false,
    });
  }
  closeParagraph();
  return runs.filter((run) => run.text.length > 0);
}
