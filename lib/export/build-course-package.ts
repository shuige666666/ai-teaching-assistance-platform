import type { Course } from "@/lib/domain/schemas";
import { safeFilename, sceneHtmlFileName } from "./filename";
import {
  hex,
  inches,
  PT_PER_PX,
  resolveBackground,
  resolveChart,
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
        const geometry = resolveLineGeometry(element);
        if (geometry.kind === "diagonal") countDegraded(degradations, "斜线按直线近似");
        slide.addShape(pptx.ShapeType.line, {
          x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h,
          flipH: geometry.flipH || undefined, flipV: geometry.flipV || undefined,
          line: {
            color: hex(element.color), width: element.width * PT_PER_PX,
            dashType: element.style === "dashed" ? "dash" : element.style === "dotted" ? "sysDot" : "solid",
            beginArrowType: element.points[0] === "arrow" ? "triangle" : element.points[0] === "dot" ? "oval" : undefined,
            endArrowType: element.points[1] === "arrow" ? "triangle" : element.points[1] === "dot" ? "oval" : undefined,
          },
        });
        continue;
      }
      const box = { x: inches(element.left), y: inches(element.top), w: inches(element.width), h: inches(element.height) };
      if (element.type === "text") {
        const { runs, defaultFontSize } = resolveTextRuns(element);
        slide.addText(
          runs.map((run) => ({
            text: run.text,
            options: {
              bold: run.bold || undefined,
              italic: run.italic || undefined,
              underline: run.underline ? { style: "sng" as const } : undefined,
              color: run.color ?? hex(element.defaultColor),
              fontSize: run.fontSize ?? defaultFontSize,
              align: run.align,
              lineSpacingMultiple: run.lineSpacingMultiple,
              breakLine: run.paragraphEnd || undefined,
              softBreakBefore: run.softBreakBefore || undefined,
            },
          })),
          {
            ...box, valign: element.vAlign ?? "top", rotate: element.rotate || undefined,
            fontFace: canvas.theme.fontName, fontSize: defaultFontSize, color: hex(element.defaultColor),
            fill: element.fill ? { color: hex(element.fill) } : undefined,
            margin: 0, isTextBox: true,
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
          const stops = [...element.gradient.colors].sort((a, b) => a.pos - b.pos);
          fill = hex(stops[0]?.color ?? element.fill);
          countDegraded(degradations, "形状渐变降级纯色");
        }
        slide.addShape(pptx.ShapeType[spec.preset as keyof typeof pptx.ShapeType], {
          ...box, fill: { color: fill }, rotate: element.rotate || undefined,
          rectRadius: spec.preset === "roundRect" ? inches(Math.min(14, element.width / 2, element.height / 2)) : undefined,
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
            fill: { color: "F8FAFC" }, margin: 6, valign: "top", rotate: element.rotate || undefined,
          },
        );
        continue;
      }
      if (element.type === "chart") {
        const spec = resolveChart(element);
        slide.addChart(spec.type, spec.data, {
          ...box, chartColors: spec.chartColors, barDir: spec.barDir,
          showLegend: spec.showLegend, legendPos: spec.legendPos, legendFontSize: 10,
          catAxisLabelColor: "64748B", valAxisLabelColor: "64748B",
          catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
          catAxisLabelFontFace: canvas.theme.fontName, valAxisLabelFontFace: canvas.theme.fontName,
        });
        continue;
      }
      if (element.type === "table") {
        const spec = resolveTable(element);
        slide.addTable(
          spec.rows.map((row) => row.map((cell) => ({
            text: cell.text,
            options: cell.header
              ? { bold: true, fill: { color: "F1F5F9" } }
              : {},
          }))),
          {
            ...box, colW: spec.colWidths, fontFace: canvas.theme.fontName, fontSize: 12,
            color: hex(canvas.theme.fontColor), valign: "middle",
            border: { pt: 0.5, color: "CBD5E1" }, margin: 0.06,
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
