import { randomUUID } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import {
  PPTElementSchema,
  SLIDE_VIEWPORT_RATIO,
  SLIDE_VIEWPORT_SIZE,
  SlideBackgroundSchema,
  SlideColorSchema,
  SlideGradientSchema,
  SlideLinePointSchema,
  SlideLineStyleSchema,
  SlideSchema,
  type PPTElement,
  type PPTTextElement,
  type Slide,
  type SlideBackground,
} from "@/lib/domain/slide-schemas";
import { resolveShapePath, SLIDE_SHAPE_FORMULAS } from "./resolve-shape-path";
import { DEFAULT_SLIDE_THEME, SLIDE_THEME_PRESETS, type SlideThemePreset } from "./theme-presets";

const SLIDE_HEIGHT = SLIDE_VIEWPORT_SIZE * SLIDE_VIEWPORT_RATIO;
const SUPPORTED_ELEMENT_TYPES = new Set(["text", "shape", "line", "code", "chart", "table"]);
const SAFE_SVG_PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/;
const HEX_COLOR = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?$/;

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
  path: z.string().trim().min(1).max(4_000).refine((value) => SAFE_SVG_PATH.test(value), "shape.path 包含不支持的 SVG 指令").optional(),
  pathFormula: z.enum(SLIDE_SHAPE_FORMULAS).optional(),
  viewBox: z.tuple([z.number().finite().positive(), z.number().finite().positive()]).optional(),
  fill: SlideColorSchema.optional(),
  gradient: SlideGradientSchema.optional(),
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

const GeneratedChartElementSchema = GeneratedBaseElementSchema.extend({
  type: z.literal("chart"),
  chartType: z.enum(["bar", "column", "line", "pie"]),
  data: z.object({
    labels: z.array(z.union([z.string(), z.number(), z.boolean()]).transform((value) => String(value).trim().slice(0, 30))).min(2).max(8),
    series: z.array(z.object({
      name: z.union([z.string(), z.number()]).transform((value) => String(value).trim().slice(0, 40) || "系列"),
      // 数值允许字符串形式传入，统一转数字后必须有限，否则整个元素被丢弃。
      values: z.preprocess(
        (raw) => Array.isArray(raw) ? raw.map((item) => Number(item)) : raw,
        z.array(z.number().finite()).min(1).max(8),
      ),
    }).strict()).min(1).max(3),
  }).strict(),
  themeColors: z.array(z.string()).max(12).optional(),
});

const GeneratedTableElementSchema = GeneratedBaseElementSchema.extend({
  type: z.literal("table"),
  colWidths: z.array(z.number().finite().positive()).max(6).optional(),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean()]).transform((value) => String(value).slice(0, 200))).min(1).max(8)).min(1).max(8),
  header: z.boolean().optional(),
  outline: z.object({
    style: SlideLineStyleSchema.optional(),
    width: z.number().finite().min(0).max(12).optional(),
    color: SlideColorSchema.optional(),
  }).optional(),
});

const GeneratedPPTElementSchema = z.discriminatedUnion("type", [
  GeneratedTextElementSchema,
  GeneratedShapeElementSchema,
  GeneratedLineElementSchema,
  GeneratedCodeElementSchema,
  GeneratedChartElementSchema,
  GeneratedTableElementSchema,
]);

const GeneratedSlideSceneSchema = z.object({
  type: z.literal("slide"),
  content: z.object({
    background: z.unknown().optional(),
    elements: z.array(z.unknown()).min(1).max(80),
  }),
  // 兼容历史单段输出；新 Prompt 使用分段讲稿，两者同时存在时以分段为准。
  narration: z.string().trim().min(1).max(1_500).optional(),
  narrationSegments: z.array(z.object({
    text: z.string().trim().min(1).max(1_500),
    targetRefs: z.array(z.string().trim().min(1).max(80)).max(4).default([]),
  })).min(1).max(12).optional(),
  summary: z.string().trim().min(1).max(300),
}).superRefine((output, context) => {
  if (!output.narrationSegments && !output.narration) {
    context.addIssue({ code: "custom", path: ["narrationSegments"], message: "必须提供分段讲稿或历史 narration" });
  }
  if (output.narrationSegments && output.narrationSegments.reduce((total, segment) => total + segment.text.length, 0) > 1_500) {
    context.addIssue({ code: "custom", path: ["narrationSegments"], message: "整页分段讲稿合计不能超过 1500 字符" });
  }
});

export type SlideNormalizationIssue = { path: string; message: string };
export type NormalizedSlideSceneOutput = {
  type: "slide";
  content: { background: SlideBackground; elements: PPTElement[] };
  narration: string;
  narrationSegments: Array<{ text: string; focusElementIds: string[] }>;
  summary: string;
  theme: SlideThemePreset["theme"];
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
        "font-family": [/^[a-zA-Z0-9\u3400-\u9fff _.-]{1,80}$/],
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

function normalizeBackground(value: unknown, theme: SlideThemePreset, issues: SlideNormalizationIssue[]): SlideBackground {
  const parsed = SlideBackgroundSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (value !== undefined) issues.push({ path: "content.background", message: "背景无效，已回退为白色纯色背景" });
  return { type: "solid", color: theme.theme.backgroundColor };
}

function normalizeBox(element: { left: number; top: number; width: number; height: number }) {
  const left = Math.max(0, element.left);
  const top = Math.max(0, element.top);
  const right = Math.min(SLIDE_VIEWPORT_SIZE, element.left + element.width);
  const bottom = Math.min(SLIDE_HEIGHT, element.top + element.height);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function normalizeChartElement(
  element: z.infer<typeof GeneratedChartElementSchema>,
  box: { left: number; top: number; width: number; height: number },
  index: number,
  issues: SlideNormalizationIssue[],
): PPTElement | null {
  const labels = element.data.labels.filter((label) => label.length > 0);
  if (labels.length < 2) {
    issues.push({ path: `content.elements.${index}.data.labels`, message: "图表标签不足两个，已丢弃" });
    return null;
  }
  let series = element.data.series.map((item) => ({ name: item.name, values: item.values.slice(0, labels.length) }));
  if (element.chartType === "pie" && series.length > 1) {
    issues.push({ path: `content.elements.${index}.data.series`, message: "饼图只保留第一组系列" });
    series = series.slice(0, 1);
  }
  const incomplete = series.filter((item) => item.values.length !== labels.length);
  if (incomplete.length > 0 || series.length === 0) {
    issues.push({ path: `content.elements.${index}.data.series`, message: "系列数据长度与标签不一致，已丢弃" });
    return null;
  }
  const themeColors = (element.themeColors ?? []).filter((color) => HEX_COLOR.test(color));
  return PPTElementSchema.parse({
    id: randomUUID(), type: "chart", ...box, rotate: element.rotate ?? 0, chartType: element.chartType,
    data: { labels, series }, themeColors: themeColors.length > 0 ? themeColors : undefined,
  });
}

function normalizeTableElement(
  element: z.infer<typeof GeneratedTableElementSchema>,
  box: { left: number; top: number; width: number; height: number },
  index: number,
  issues: SlideNormalizationIssue[],
): PPTElement | null {
  const columnCount = Math.min(6, Math.max(1, element.colWidths?.length ?? Math.max(...element.rows.map((row) => row.length))));
  const rows = element.rows.slice(0, 7)
    .map((row) => row.slice(0, columnCount).map((cell) => visibleText(cell).slice(0, 60)))
    .map((row) => Array.from({ length: columnCount }, (_, columnIndex) => row[columnIndex] ?? ""));
  if (rows.length < 2 || rows.some((row) => row.every((cell) => cell.length === 0))) {
    issues.push({ path: `content.elements.${index}.rows`, message: "表格至少需要表头和一行非空数据，已丢弃" });
    return null;
  }
  const colWidths = element.colWidths && element.colWidths.length > 0
    ? Array.from({ length: columnCount }, (_, index) => element.colWidths![index] ?? 1)
    : Array.from({ length: columnCount }, () => 1);
  return PPTElementSchema.parse({
    id: randomUUID(), type: "table", ...box, rotate: element.rotate ?? 0,
    colWidths, rows, header: element.header ?? true,
    outline: element.outline ? {
      style: element.outline.style ?? "solid",
      width: element.outline.width ?? 1,
      color: element.outline.color ?? DEFAULT_SLIDE_THEME.fontColor,
    } : undefined,
  });
}

/** 将单个不可信模型元素收口为可持久化元素；无法安全显示时只丢弃当前元素。 */
function normalizeElement(value: unknown, index: number, theme: SlideThemePreset, issues: SlideNormalizationIssue[]): PPTElement | null {
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
      start, end, curve, style: element.style ?? "solid", color: element.color ?? theme.theme.fontColor,
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
      defaultFontName: element.defaultFontName?.trim() || theme.theme.fontName,
      defaultColor: element.defaultColor ?? theme.theme.fontColor,
      textType: element.textType ?? "content", lineHeight: element.lineHeight, fill: element.fill,
      opacity: element.opacity, vAlign: element.vAlign,
    });
  }
  if (element.type === "shape") {
    let path = element.path;
    let viewBox = element.viewBox;
    if (element.pathFormula) {
      const resolved = resolveShapePath(element.pathFormula, box.width, box.height);
      path = resolved.path;
      viewBox = resolved.viewBox;
      if (element.path) issues.push({ path: `content.elements.${index}.path`, message: "pathFormula 已覆盖手写 path" });
    }
    if (!path || !viewBox) {
      issues.push({ path: `content.elements.${index}.path`, message: "形状缺少 path 或 pathFormula，已丢弃" });
      return null;
    }
    return PPTElementSchema.parse({
      id: randomUUID(), type: "shape", ...box, rotate: element.rotate ?? 0,
      path, viewBox, pathFormula: element.pathFormula, fill: element.fill ?? theme.theme.themeColors[0], gradient: element.gradient,
      fixedRatio: element.fixedRatio ?? false,
      outline: element.outline ? {
        style: element.outline.style ?? "solid",
        width: element.outline.width ?? 0,
        color: element.outline.color ?? theme.theme.fontColor,
      } : undefined,
    });
  }
  if (element.type === "chart") {
    return normalizeChartElement(element, box, index, issues);
  }
  if (element.type === "table") {
    return normalizeTableElement(element, box, index, issues);
  }
  return PPTElementSchema.parse({
    id: randomUUID(), type: "code", ...box, rotate: element.rotate ?? 0,
    language: element.language, lines: element.lines.map((content) => ({ id: randomUUID(), content })),
    fileName: element.fileName, showLineNumbers: element.showLineNumbers ?? true, fontSize: element.fontSize ?? 14,
  });
}

/** 读取仅用于本次生成的临时引用，不把模型提供的 ref 当成领域 ID。 */
function readElementRef(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("ref" in value)) return undefined;
  const parsed = z.string().trim().min(1).max(80).safeParse(value.ref);
  return parsed.success ? parsed.data : undefined;
}

/** 解析并规范化整个 slide 响应；坏元素可局部降级，空页和无标题页面仍明确失败。 */
export function normalizeGeneratedSlideScene(value: unknown, theme: SlideThemePreset = SLIDE_THEME_PRESETS[0]): NormalizedSlideSceneOutput {
  const parsed = GeneratedSlideSceneSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidGeneratedSlideError(parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
  }
  const issues: SlideNormalizationIssue[] = [];
  // 1. 保留原始引用与规范化元素的配对，过滤和截断不会改变讲稿的关联对象。
  const refs = parsed.data.content.elements.map(readElementRef);
  const refCounts = new Map<string, number>();
  refs.forEach((ref) => { if (ref) refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1); });
  const retained = parsed.data.content.elements
    .map((element, index) => ({ element: normalizeElement(element, index, theme, issues), ref: refs[index] }))
    .filter((item): item is { element: PPTElement; ref: string | undefined } => item.element !== null)
    .slice(0, 40);
  const elements = retained.map((item) => item.element);
  if (elements.length === 0) throw new InvalidGeneratedSlideError([...issues, { path: "content.elements", message: "规范化后没有可显示元素" }]);

  // 2. 只有唯一且最终可见的目标可以被引用，不猜测重复 ref 或回退到第一个元素。
  const refToId = new Map(retained.flatMap(({ element, ref }) => ref && refCounts.get(ref) === 1 ? [[ref, element.id] as const] : []));
  const narrationSegments = parsed.data.narrationSegments
    ? parsed.data.narrationSegments.map((segment, index) => ({
        text: segment.text,
        focusElementIds: [...new Set(segment.targetRefs.flatMap((ref) => {
          const id = refToId.get(ref);
          if (id) return [id];
          issues.push({ path: `narrationSegments.${index}.targetRefs`, message: `聚焦引用 ${ref} 不存在、已被过滤或存在歧义，已取消该目标高亮` });
          return [];
        }))],
      }))
    : [{ text: parsed.data.narration!, focusElementIds: [] }];

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
    content: { background: normalizeBackground(parsed.data.content.background, theme, issues), elements },
    // 合并文本只供生成期校验使用，持久化仍只保存 actions 中的分段文本。
    narration: narrationSegments.map((segment) => segment.text).join("\n"),
    narrationSegments,
    summary: parsed.data.summary,
    theme: theme.theme,
    normalizationIssues: issues,
  };
}

/** 为规范化后的元素装配服务端 Slide 身份、主题和固定逻辑画布。 */
export function assembleSlide(output: NormalizedSlideSceneOutput): Slide {
  return SlideSchema.parse({
    id: randomUUID(), viewportSize: SLIDE_VIEWPORT_SIZE, viewportRatio: SLIDE_VIEWPORT_RATIO,
    theme: output.theme, background: output.content.background, elements: output.content.elements,
  });
}
