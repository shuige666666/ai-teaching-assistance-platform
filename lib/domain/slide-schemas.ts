import { z } from "zod";

export const SLIDE_VIEWPORT_SIZE = 1000 as const;
export const SLIDE_VIEWPORT_RATIO = 0.5625 as const;

export const SlideColorSchema = z.string().regex(/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?$/, "颜色必须使用十六进制格式");
export const SlideLineStyleSchema = z.enum(["solid", "dashed", "dotted"]);
export const SlideLinePointSchema = z.enum(["", "arrow", "dot"]);

export const SlideElementOutlineSchema = z.object({
  style: SlideLineStyleSchema,
  width: z.number().finite().min(0).max(12),
  color: SlideColorSchema,
}).strict();

export const SlideThemeSchema = z.object({
  backgroundColor: SlideColorSchema,
  themeColors: z.array(SlideColorSchema).min(1).max(12),
  fontColor: SlideColorSchema,
  fontName: z.string().trim().min(1).max(80),
  outline: SlideElementOutlineSchema,
}).strict();

const GradientColorSchema = z.object({
  pos: z.number().finite().min(0).max(100),
  color: SlideColorSchema,
}).strict();

export const SlideBackgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color: SlideColorSchema }).strict(),
  z.object({
    type: z.literal("gradient"),
    gradient: z.object({
      type: z.enum(["linear", "radial"]),
      rotate: z.number().finite().min(-360).max(360),
      colors: z.array(GradientColorSchema).min(2).max(8),
    }).strict(),
  }).strict(),
]);

const PPTBaseElementSchema = z.object({
  id: z.string().min(1),
  left: z.number().finite(),
  top: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  rotate: z.number().finite().min(-360).max(360),
});

export const PPTTextElementSchema = PPTBaseElementSchema.extend({
  type: z.literal("text"),
  content: z.string().min(1).max(8_000),
  defaultFontName: z.string().trim().min(1).max(80),
  defaultColor: SlideColorSchema,
  textType: z.enum(["title", "subtitle", "content", "itemTitle", "item", "notes"]),
  lineHeight: z.number().finite().min(0.8).max(3).optional(),
  fill: SlideColorSchema.optional(),
  opacity: z.number().finite().min(0).max(1).optional(),
  vAlign: z.enum(["top", "middle", "bottom"]).optional(),
}).strict();

export const PPTShapeElementSchema = PPTBaseElementSchema.extend({
  type: z.literal("shape"),
  path: z.string().trim().min(1).max(4_000),
  viewBox: z.tuple([z.number().finite().positive(), z.number().finite().positive()]),
  fill: SlideColorSchema,
  fixedRatio: z.boolean(),
  outline: SlideElementOutlineSchema.optional(),
}).strict();

export const PPTLineElementSchema = z.object({
  id: z.string().min(1),
  type: z.literal("line"),
  left: z.number().finite(),
  top: z.number().finite(),
  width: z.number().finite().positive().max(12),
  start: z.tuple([z.number().finite(), z.number().finite()]),
  end: z.tuple([z.number().finite(), z.number().finite()]),
  style: SlideLineStyleSchema,
  color: SlideColorSchema,
  points: z.tuple([SlideLinePointSchema, SlideLinePointSchema]),
}).strict();

export const CodeLineSchema = z.object({
  id: z.string().min(1),
  content: z.string().max(500),
}).strict();

export const PPTCodeElementSchema = PPTBaseElementSchema.extend({
  type: z.literal("code"),
  language: z.string().regex(/^[a-zA-Z0-9_+#.-]{1,32}$/),
  lines: z.array(CodeLineSchema).min(1).max(80),
  fileName: z.string().trim().min(1).max(120).optional(),
  showLineNumbers: z.boolean(),
  fontSize: z.number().finite().min(10).max(32),
}).strict();

export const PPTElementSchema = z.discriminatedUnion("type", [
  PPTTextElementSchema,
  PPTShapeElementSchema,
  PPTLineElementSchema,
  PPTCodeElementSchema,
]);

export const SlideSchema = z.object({
  id: z.string().min(1),
  viewportSize: z.literal(SLIDE_VIEWPORT_SIZE),
  viewportRatio: z.literal(SLIDE_VIEWPORT_RATIO),
  theme: SlideThemeSchema,
  elements: z.array(PPTElementSchema).min(1).max(40),
  background: SlideBackgroundSchema,
}).strict();

export const CanvasSlideContentSchema = z.object({
  type: z.literal("slide"),
  canvas: SlideSchema,
}).strict();

export type SlideColor = z.infer<typeof SlideColorSchema>;
export type SlideElementOutline = z.infer<typeof SlideElementOutlineSchema>;
export type SlideTheme = z.infer<typeof SlideThemeSchema>;
export type SlideBackground = z.infer<typeof SlideBackgroundSchema>;
export type PPTTextElement = z.infer<typeof PPTTextElementSchema>;
export type PPTShapeElement = z.infer<typeof PPTShapeElementSchema>;
export type PPTLineElement = z.infer<typeof PPTLineElementSchema>;
export type PPTCodeElement = z.infer<typeof PPTCodeElementSchema>;
export type PPTElement = z.infer<typeof PPTElementSchema>;
export type Slide = z.infer<typeof SlideSchema>;
export type CanvasSlideContent = z.infer<typeof CanvasSlideContentSchema>;
