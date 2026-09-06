import { writeFile, mkdir } from "node:fs/promises";
import JSZip from "jszip";
import { buildCoursePackage } from "../lib/export/build-course-package.ts";

const baseUrl = "http://localhost:3100";
const targets = [
  { courseId: "a1865e9e-6a16-4ff3-8f6f-0c668eaa95d9", label: "v2.4-tcp" },
  { courseId: "d085b604-cb41-4227-b33f-e03b528481dc", label: "v2.3-marker" },
];

await mkdir("output/export-check", { recursive: true });

for (const target of targets) {
  const body = await fetch(new URL(`/api/courses/${target.courseId}`, baseUrl)).then((r) => r.json());
  const course = body.course;
  console.log(`\n===== ${target.label}《${course.title}》 status=${course.status}`);
  const pkg = await buildCoursePackage(course, "nodebuffer");
  console.log(`[pkg] filename=${pkg.filename} slides=${pkg.slideCount} interactive=${pkg.interactiveCount}`);
  console.log(`[pkg] 降级: ${pkg.degraded.length === 0 ? "无" : pkg.degraded.map((d) => `${d.kind}×${d.count}`).join("、")}`);

  // AC-E01：ZIP 结构
  const zip = await JSZip.loadAsync(pkg.zip);
  const names = Object.keys(zip.files);
  const pptxName = names.find((n) => n.endsWith(".pptx"));
  const interactive = names.filter((n) => n.startsWith("interactive/") && n.endsWith(".html"));
  console.log(`[zip] pptx=${pptxName} interactive=${interactive.length}`);
  if (!pptxName) throw new Error("ZIP 中没有 PPTX");

  // AC-E02/E03：PPTX 内部结构
  const pptxBuf = await zip.file(pptxName).async("nodebuffer");
  const pptx = await JSZip.loadAsync(pptxBuf);
  const slideXmlNames = Object.keys(pptx.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  console.log(`[pptx] 幻灯片页数=${slideXmlNames.length}（预期 ${pkg.slideCount}）`);
  if (slideXmlNames.length !== pkg.slideCount) throw new Error("PPTX 页数与 slide 场景数不一致");

  // 逐页抽取文本，验证内容确实进入 PPTX
  for (const name of slideXmlNames.sort()) {
    const xml = await pptx.file(name).async("string");
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).filter((t) => t.trim());
    const hasTable = xml.includes("<a:tbl>");
    const hasChartRef = xml.includes("graphicFrame");
    console.log(`  ${name}: 文本片段=${texts.length} 首条="${(texts[0] ?? "").slice(0, 24)}" 表格=${hasTable} 图表引用=${hasChartRef}`);
  }
  const chartParts = Object.keys(pptx.files).filter((n) => /ppt\/charts\/chart\d+\.xml/.test(n));
  console.log(`[pptx] 原生图表部件=${chartParts.length}`);
  for (const chartPart of chartParts) {
    const xml = await pptx.file(chartPart).async("string");
    const kind = xml.includes("<c:lineChart>") ? "line" : xml.includes("<c:barChart>") ? "bar" : xml.includes("<c:pieChart>") ? "pie" : "unknown";
    console.log(`  ${chartPart}: 类型=${kind}`);
  }
  // 互动 HTML 内容
  for (const name of interactive) {
    const html = await zip.file(name).async("string");
    console.log(`  ${name}: ${html.startsWith("<!doctype html>") ? "自包含 HTML ✓" : "非 HTML!"}`);
  }
  // 留档一份 ZIP 供人工复核
  await writeFile(`output/export-check/${target.label}-${pkg.filename}`, pkg.zip);
  console.log(`[saved] output/export-check/${target.label}-${pkg.filename}`);
}
console.log("\n全部结构检查通过");
