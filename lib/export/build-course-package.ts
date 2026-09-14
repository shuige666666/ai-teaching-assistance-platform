import type { Course } from "@/lib/domain/schemas";
import { safeFilename, sceneHtmlFileName } from "./filename";
import {
  hex,
  inches,
  PT_PER_PX,
  resolveBackground,
  resolveChart,
  resolveCurvedLineGeometry,
  resolveGradientRepresentativeColor,
  resolveLineGeometry,
  resolveShape,
  resolveTable,
  resolveTextRuns,
} from "./pptx-mapping";

export type ExportDegradation = { kind: string; count: number };
export type CoursePackage = {
  filename: string;
  slideCount: number;
  interactiveCount: number;
  degraded: ExportDegradation[];
  zip: Blob | Buffer;
};

export type PackageOutputType = "blob" | "nodebuffer";

type Degradations = Map<string, number>;

function countDegraded(degradations: Degradations, kind: string, count = 1): void {
  if (count <= 0) return;
  degradations.set(kind, (degradations.get(kind) ?? 0) + count);
}

/** 将渲染器使用的 0～1 不透明度换算为 PPTX 的 0～100 透明度。 */
function pptxTransparency(opacity: number | undefined): number | undefined {
  return opacity === undefined || opacity >= 1 ? undefined : Math.round((1 - opacity) * 100);
}

/**
 * 把 ready/partial 课程打包为 ZIP（课程 PPTX + interactive/*.html）。
 * 纯只读转换：不写库、不改 revision；映射不了的元素跳过并计入降级清单。
 */
export async function buildCoursePackage(course: Course, outputType: PackageOutputType): Promise<CoursePackage> {
  const [{ default: PptxGenJS }, jszipModule] = await Promise.all([import("pptxgenjs"), import("jszip")]);
  const JSZip = jszipModule.default;
  const degradations: Degradations = new Map();
  const zip = new JSZip();

  const pptx = new PptxGenJS();
  // 4.0.1 运行时已提供 custGeom，但发布包的 ShapeType 声明遗漏了该枚举成员。
  const customGeometryShape = "custGeom" as (typeof pptx.ShapeType)[keyof typeof pptx.ShapeType];
  pptx.defineLayout({ name: "SLIDE169", width: 1000 / 75, height: 562.5 / 75 });
  pptx.layout = "SLIDE169";
  const themeFontName = courseTitle(course);
  pptx.theme = { headFontFace: themeFontName, bodyFontFace: themeFontName };

  const slideScenes = course.scenes.filter((scene) => scene.type === "slide").sort((a, b) => a.order - b.order);
  const interactiveScenes = course.scenes.filter((scene) => scene.type === "interactive").sort((a, b) => a.order - b.order);

  for (const scene of slideScenes) {
    if (scene.type !== "slide") continue;
    const canvas = scene.content.canvas;
    const slide = pptx.addSlide();
    const background = resolveBackground(canvas.background);
    slide.background = { color: background.color };
    if (background.degraded) countDegraded(degradations, "渐变背景降级纯色");

    for (const element of canvas.elements) {
      if (element.type === "line") {
        const line = {
          color: hex(element.color), width: element.width * PT_PER_PX,
          dashType: element.style === "dashed" ? "dash" as const : element.style === "dotted" ? "sysDot" as const : "solid" as const,
          beginArrowType: element.points[0] === "arrow" ? "triangle" as const : element.points[0] === "dot" ? "oval" as const : undefined,
          endArrowType: element.points[1] === "arrow" ? "triangle" as const : element.points[1] === "dot" ? "oval" as const : undefined,
        };
        const curve = resolveCurvedLineGeometry(element);
        if (curve) {
          slide.addShape(customGeometryShape, { ...curve, points: curve.points, line });
        } else {
          const geometry = resolveLineGeometry(element);
          slide.addShape(pptx.ShapeType.line, {
            x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h,
            flipH: geometry.flipH || undefined, flipV: geometry.flipV || undefined,
            line,
          });
        }
        continue;
      }
      const box = { x: inches(element.left), y: inches(element.top), w: inches(element.width), h: inches(element.height) };
      if (element.type === "text") {
        const { runs, defaultFontSize, layout } = resolveTextRuns(element);
        const transparency = pptxTransparency(element.opacity);
        slide.addText(
          runs.map((run) => ({
            text: run.text,
            options: {
              bold: run.bold || undefined,
              italic: run.italic || undefined,
              underline: run.underline ? { style: "sng" as const } : undefined,
              color: run.color ?? hex(element.defaultColor),
              fontFace: run.fontFace ?? layout.fontFamily,
              fontSize: run.fontSize ?? defaultFontSize,
              transparency,
              align: run.align,
              lineSpacingMultiple: run.lineSpacingMultiple ?? layout.lineHeight,
              paraSpaceAfter: run.paraSpaceAfter,
              breakLine: run.paragraphEnd || undefined,
              softBreakBefore: run.softBreakBefore || undefined,
            },
          })),
          {
            ...box, valign: layout.verticalAlign, rotate: element.rotate || undefined,
            fontFace: layout.fontFamily, fontSize: defaultFontSize, color: hex(layout.color),
            transparency,
            fill: element.fill ? { color: hex(element.fill), transparency } : undefined,
            margin: layout.paddingPx[0] * PT_PER_PX, isTextBox: true,
          },
        );
        continue;
      }
      if (element.type === "shape") {
        const spec = resolveShape(element);
        if (spec.kind === "skip") {
          countDegraded(degradations, `跳过${spec.reason}`);
          continue;
        }
        let fill = hex(element.fill);
        if (element.gradient) {
          fill = resolveGradientRepresentativeColor(element.gradient.colors);
          countDegraded(degradations, "形状渐变降级纯色");
        }
        slide.addShape(spec.kind === "preset" ? pptx.ShapeType[spec.preset as keyof typeof pptx.ShapeType] : customGeometryShape, {
          ...box, fill: { color: fill }, rotate: element.rotate || undefined,
          points: spec.kind === "custom" ? spec.points : undefined,
          rectRadius: spec.kind === "preset" && spec.preset === "roundRect" ? inches(Math.min(14, element.width / 2, element.height / 2)) : undefined,
          line: element.outline && element.outline.width > 0
            ? { color: hex(element.outline.color), width: element.outline.width * PT_PER_PX, dashType: element.outline.style === "dashed" ? "dash" : element.outline.style === "dotted" ? "sysDot" : "solid" }
            : { type: "none" },
        });
        continue;
      }
      if (element.type === "code") {
        const header = `${element.fileName ?? element.language} · ${element.language}`;
        const body = element.lines.map((line) => line.content);
        slide.addText(
          [
            { text: header, options: { bold: true, color: "94A3B8", fontSize: Math.max(8, element.fontSize * 0.75 - 2), breakLine: true } },
            ...body.map((line, index) => ({ text: line || " ", options: { breakLine: index < body.length - 1 || undefined } })),
          ],
          {
            ...box, fontFace: "Consolas", fontSize: element.fontSize * PT_PER_PX, color: "1F2937",
            fill: { color: "F8FAFC" }, fit: "shrink", margin: 6, valign: "top", rotate: element.rotate || undefined,
          },
        );
        continue;
      }
      if (element.type === "chart") {
        const spec = resolveChart(element);
        slide.addChart(spec.type, spec.data, {
          ...box, chartColors: spec.chartColors, barDir: spec.barDir,
          showLegend: spec.showLegend, legendPos: spec.legendPos, legendFontSize: 11 * PT_PER_PX,
          catAxisLabelColor: "64748B", valAxisLabelColor: "64748B",
          catAxisLabelFontSize: 11 * PT_PER_PX, valAxisLabelFontSize: 11 * PT_PER_PX,
          catAxisLabelFontFace: canvas.theme.fontName, valAxisLabelFontFace: canvas.theme.fontName,
          catAxisLineColor: "CBD5E1", valAxisLineColor: "CBD5E1",
          valGridLine: { color: "E2E8F0", size: 0.75 },
        });
        continue;
      }
      if (element.type === "table") {
        const spec = resolveTable(element);
        slide.addTable(
          spec.rows.map((row) => row.map((cell) => ({
            text: cell.text,
            options: cell.header
              ? { bold: true, fill: { color: "EAF6F8" }, color: "143F59" }
              : { fill: { color: "F7FBFC" } },
          }))),
          {
            ...box, colW: spec.colWidths,
            rowH: Array.from({ length: Math.max(1, spec.rows.length) }, () => inches(element.height / Math.max(1, spec.rows.length))),
            fontFace: canvas.theme.fontName, fontSize: 14 * PT_PER_PX,
            color: hex(canvas.theme.fontColor), valign: "middle",
            border: {
              pt: element.outline && element.outline.width > 0 ? element.outline.width * PT_PER_PX : 0.75,
              color: element.outline && element.outline.width > 0 ? hex(element.outline.color) : "B7D0D7",
            },
            margin: [7 * PT_PER_PX, 12 * PT_PER_PX, 7 * PT_PER_PX, 12 * PT_PER_PX],
          },
        );
      }
    }
  }

  const pptxTitle = safeFilename(course.title, "课程导出");
  for (const scene of interactiveScenes) {
    if (scene.type !== "interactive") continue;
    zip.file(`interactive/${sceneHtmlFileName(scene.order, scene.title)}`, scene.content.html);
  }

  const pptxOutput = await pptx.write({ outputType: outputType === "blob" ? "blob" : "nodebuffer" });
  zip.file(`${pptxTitle}.pptx`, pptxOutput);
  const zipOutput = await zip.generateAsync({ type: outputType === "blob" ? "blob" : "nodebuffer", compression: "DEFLATE" });

  return {
    filename: `${pptxTitle}.zip`,
    slideCount: slideScenes.length,
    interactiveCount: interactiveScenes.length,
    degraded: [...degradations.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
    zip: zipOutput,
  };
}

function courseTitle(course: Course): string {
  const theme = course.scenes.find((scene) => scene.type === "slide")?.content;
  return theme?.type === "slide" ? theme.canvas.theme.fontName : "Microsoft YaHei";
}
