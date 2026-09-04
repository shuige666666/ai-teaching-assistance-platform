import { randomUUID } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import {
  PPTElementSchema,
  SLIDE_VIEWPORT_RATIO,
  SLIDE_VIEWPORT_SIZE,
  SlideBackgroundSchema,
  SlideColorSchema,
  SlideLinePointSchema,
  SlideLineStyleSchema,
  SlideSchema,
  type PPTElement,
  type PPTTextElement,
  type Slide,
  type SlideBackground,
} from "@/lib/domain/slide-schemas";

const SLIDE_HEIGHT = SLIDE_VIEWPORT_SIZE * SLIDE_VIEWPORT_RATIO;
const SUPPORTED_ELEMENT_TYPES = new Set(["text", "shape", "line", "code"]);
const SAFE_SVG_PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/;

export const DEFAULT_SLIDE_THEME = {
  backgroundColor: "#ffffff",
  themeColors: ["#BF545D", "#143F59", "#498BA6", "#5CE3F2", "#14D9C5"],
  fontColor: "#143F59",
  fontName: "Microsoft YaHei",
  outline: { color: "#BF545D", width: 2, style: "solid" as const },
};

const GeneratedBaseElementSchema = z.object({
  left: z.number().finite(),
  top: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  rotate: z.number().finite().min(-360).max(360).optional(),
});

const GeneratedTextElementSchema = GeneratedBaseElementSchema.extend({
  type: z.literal("text"),
  content: z.string().min(1).max(8_000),
  defaultFontName: z.string().max(80).optional(),
  defaultColor: SlideColorSchema.optional(),
  textType: z.enum(["title", "subtitle", "content", "itemTitle", "item", "notes"]).optional(),
  lineHeight: z.number().finite().min(0.8).max(3).optional(),
  fill: SlideColorSchema.optional(),
  opacity: z.number().finite().min(0).max(1).optional(),
  vAlign: z.enum(["top", "middle", "bottom"]).optional(),
});

const GeneratedShapeElementSchema = GeneratedBaseElementSchema.extend({
  type: z.literal("shape"),
  path: z.string().trim().min(1).max(4_000).refine((value) => SAFE_SVG_PATH.test(value), "shape.path 包含不支持的 SVG 指令"),
  viewBox: z.tuple([z.number().finite().positive(), z.number().finite().positive()]),
  fill: SlideColorSchema.optional(),
  fixedRatio: z.boolean().optional(),
  outline: z.object({
    style: SlideLineStyleSchema.optional(),
    width: z.number().finite().min(0).max(12).optional(),
    color: SlideColorSchema.optional(),
  }).optional(),
});

const GeneratedLineElementSchema = z.object({
  type: z.literal("line"),
  left: z.number().finite(),
  top: z.number().finite(),
  width: z.number().finite().positive().max(12),
  start: z.tuple([z.number().finite(), z.number().finite()]),
  end: z.tuple([z.number().finite(), z.number().finite()]),
  curve: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  style: SlideLineStyleSchema.optional(),
  color: SlideColorSchema.optional(),
  points: z.tuple([SlideLinePointSchema, SlideLinePointSchema]).optional(),
});

const GeneratedCodeElementSchema = GeneratedBaseElementSchema.extend({
  type: z.literal("code"),
  language: z.string().regex(/^[a-zA-Z0-9_+#.-]{1,32}$/),
  lines: z.array(z.string().max(500)).min(1).max(80),
  fileName: z.string().trim().min(1).max(120).optional(),
  showLineNumbers: z.boolean().optional(),
  fontSize: z.number().finite().min(10).max(32).optional(),
});

const GeneratedPPTElementSchema = z.discriminatedUnion("type", [
  GeneratedTextElementSchema,
  GeneratedShapeElementSchema,
  GeneratedLineElementSchema,
  GeneratedCodeElementSchema,
]);

const GeneratedSlideSceneSchema = z.object({
  type: z.literal("slide"),
  content: z.object({
    background: z.unknown().optional(),
    elements: z.array(z.unknown()).min(1).max(80),
  }),
  narration: z.string().trim().min(1).max(1_500),
  summary: z.string().trim().min(1).max(300),
});

export type SlideNormalizationIssue = { path: string; message: string };
export type NormalizedSlideSceneOutput = {
  type: "slide";
  content: { background: SlideBackground; elements: PPTElement[] };
  narration: string;
  summary: string;
  normalizationIssues: SlideNormalizationIssue[];
};

export class InvalidGeneratedSlideError extends Error {
  constructor(public readonly issues: SlideNormalizationIssue[]) {
    super("INVALID_MODEL_OUTPUT");
    this.name = "InvalidGeneratedSlideError";
  }
}

/** 只保留幻灯片文本需要的标签和排版样式，删除脚本、链接与可改变页面结构的 CSS。 */
export function sanitizeSlideText(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: ["p", "span", "strong", "b", "em", "i", "u", "br"],
    allowedAttributes: { "*": ["style"] },
    allowedStyles: {
      "*": {
        "font-size": [/^(?:1[6-9]|[2-5][0-9]|60)px$/],
        color: [/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?$/],
        "text-align": [/^(?:left|center|right)$/],
        "line-height": [/^(?:0\.[89]|[12](?:\.\d)?|3)$/],
        "font-weight": [/^(?:normal|bold|[4-8]00)$/],
        "text-decoration": [/^(?:none|underline)$/],
      },
    },
    allowedSchemes: [],
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true,
  }).trim();
}

function visibleText(value: string): string {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
}

function normalizeBackground(value: unknown, issues: SlideNormalizationIssue[]): SlideBackground {
  const parsed = SlideBackgroundSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (value !== undefined) issues.push({ path: "content.background", message: "背景无效，已回退为白色纯色背景" });
  return { type: "solid", color: DEFAULT_SLIDE_THEME.backgroundColor };
}

function normalizeBox(element: { left: number; top: number; width: number; height: number }) {
  const left = Math.max(0, element.left);
  const top = Math.max(0, element.top);
  const right = Math.min(SLIDE_VIEWPORT_SIZE, element.left + element.width);
  const bottom = Math.min(SLIDE_HEIGHT, element.top + element.height);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/** 将单个不可信模型元素收口为可持久化元素；无法安全显示时只丢弃当前元素。 */
function normalizeElement(value: unknown, index: number, issues: SlideNormalizationIssue[]): PPTElement | null {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!record || typeof record.type !== "string" || !SUPPORTED_ELEMENT_TYPES.has(record.type)) {
    issues.push({ path: `content.elements.${index}`, message: "未支持的元素类型已丢弃" });
    return null;
  }
  const parsed = GeneratedPPTElementSchema.safeParse(record);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    issues.push({ path: `content.elements.${index}.${first?.path.join(".") ?? ""}`, message: first?.message ?? "元素字段无效" });
    return null;
  }
  const element = parsed.data;
  if (element.type === "line") {
    const left = Math.max(0, Math.min(SLIDE_VIEWPORT_SIZE, element.left));
    const top = Math.max(0, Math.min(SLIDE_HEIGHT, element.top));
    const clampPoint = ([x, y]: [number, number]): [number, number] => [
      Math.max(-left, Math.min(SLIDE_VIEWPORT_SIZE - left, x)),
      Math.max(-top, Math.min(SLIDE_HEIGHT - top, y)),
    ];
    const start = clampPoint(element.start);
    const end = clampPoint(element.end);
    const curve = element.curve ? clampPoint(element.curve) : undefined;
    if (start[0] === end[0] && start[1] === end[1]) {
      issues.push({ path: `content.elements.${index}`, message: "起点与终点重合的线条已丢弃" });
      return null;
    }
    return PPTElementSchema.parse({
      id: randomUUID(), type: "line", left, top, width: element.width,
      start, end, curve, style: element.style ?? "solid", color: element.color ?? DEFAULT_SLIDE_THEME.fontColor,
      points: element.points ?? ["", ""],
    });
  }

  const box = normalizeBox(element);
  if (!box) {
    issues.push({ path: `content.elements.${index}`, message: "完全位于画布外的元素已丢弃" });
    return null;
  }
  if (element.type === "text") {
    const content = sanitizeSlideText(element.content);
    const plainText = visibleText(content);
    if (!plainText || /https?:\/\/|www\./i.test(plainText)) {
      issues.push({ path: `content.elements.${index}.content`, message: "空文本或外部链接文本已丢弃" });
      return null;
    }
    return PPTElementSchema.parse({
      id: randomUUID(), type: "text", ...box, rotate: element.rotate ?? 0, content,
      defaultFontName: element.defaultFontName?.trim() || DEFAULT_SLIDE_THEME.fontName,
      defaultColor: element.defaultColor ?? DEFAULT_SLIDE_THEME.fontColor,
      textType: element.textType ?? "content", lineHeight: element.lineHeight, fill: element.fill,
      opacity: element.opacity, vAlign: element.vAlign,
    });
  }
  if (element.type === "shape") {
    return PPTElementSchema.parse({
      id: randomUUID(), type: "shape", ...box, rotate: element.rotate ?? 0,
      path: element.path, viewBox: element.viewBox, fill: element.fill ?? DEFAULT_SLIDE_THEME.themeColors[0],
      fixedRatio: element.fixedRatio ?? false,
      outline: element.outline ? {
        style: element.outline.style ?? "solid",
        width: element.outline.width ?? 0,
        color: element.outline.color ?? DEFAULT_SLIDE_THEME.fontColor,
      } : undefined,
    });
  }
  return PPTElementSchema.parse({
    id: randomUUID(), type: "code", ...box, rotate: element.rotate ?? 0,
    language: element.language, lines: element.lines.map((content) => ({ id: randomUUID(), content })),
    fileName: element.fileName, showLineNumbers: element.showLineNumbers ?? true, fontSize: element.fontSize ?? 14,
  });
}

/** 解析并规范化整个 slide 响应；坏元素可局部降级，空页和无标题页面仍明确失败。 */
export function normalizeGeneratedSlideScene(value: unknown): NormalizedSlideSceneOutput {
  const parsed = GeneratedSlideSceneSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidGeneratedSlideError(parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
  }
  const issues: SlideNormalizationIssue[] = [];
  const elements = parsed.data.content.elements
    .map((element, index) => normalizeElement(element, index, issues))
    .filter((element): element is PPTElement => element !== null)
    .slice(0, 40);
  if (elements.length === 0) throw new InvalidGeneratedSlideError([...issues, { path: "content.elements", message: "规范化后没有可显示元素" }]);

  const explicitTitle = elements.find((element): element is PPTTextElement => element.type === "text" && element.textType === "title");
  if (!explicitTitle) {
    const firstTextIndex = elements.findIndex((element) => element.type === "text");
    if (firstTextIndex < 0) throw new InvalidGeneratedSlideError([...issues, { path: "content.elements", message: "幻灯片必须包含画布内标题" }]);
    const firstText = elements[firstTextIndex] as PPTTextElement;
    elements[firstTextIndex] = { ...firstText, textType: "title" };
    issues.push({ path: `content.elements.${firstTextIndex}.textType`, message: "首个文本元素已归一为标题" });
  }

  return {
    type: "slide",
    content: { background: normalizeBackground(parsed.data.content.background, issues), elements },
    narration: parsed.data.narration,
    summary: parsed.data.summary,
    normalizationIssues: issues,
  };
}

/** 为规范化后的元素装配服务端 Slide 身份和固定逻辑画布。 */
export function assembleSlide(output: NormalizedSlideSceneOutput): Slide {
  return SlideSchema.parse({
    id: randomUUID(), viewportSize: SLIDE_VIEWPORT_SIZE, viewportRatio: SLIDE_VIEWPORT_RATIO,
    theme: DEFAULT_SLIDE_THEME, background: output.content.background, elements: output.content.elements,
  });
}
