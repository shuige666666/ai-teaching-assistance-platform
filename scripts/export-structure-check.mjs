import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { createJiti } from "jiti";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.EXPORT_BASE_URL ?? "http://localhost:3100";
const targets = [
  { courseId: "a1865e9e-6a16-4ff3-8f6f-0c668eaa95d9", label: "v2.4-tcp" },
  { courseId: "d085b604-cb41-4227-b33f-e03b528481dc", label: "v2.3-marker" },
];

const { buildCoursePackage } = await createJiti(import.meta.url, { alias: { "@": repoRoot } }).import("../lib/export/build-course-package.ts");

async function main() {
  const outputDir = resolve(repoRoot, "output/export-check");
  await mkdir(outputDir, { recursive: true });

  for (const target of targets) {
    const response = await fetch(new URL(`/api/courses/${target.courseId}`, baseUrl));
    if (!response.ok) throw new Error(`${target.label} 课程读取失败：HTTP ${response.status}`);
    const body = await response.json();
    const course = body.course;
    if (!course) throw new Error(`${target.label} API 响应缺少 course`);
    console.log(`\n===== ${target.label}《${course.title}》 status=${course.status}`);
    const pkg = await buildCoursePackage(course, "nodebuffer");
    console.log(`[pkg] filename=${pkg.filename} slides=${pkg.slideCount} interactive=${pkg.interactiveCount}`);
    console.log(`[pkg] 降级: ${pkg.degraded.length === 0 ? "无" : pkg.degraded.map((d) => `${d.kind}×${d.count}`).join("、")}`);

    // AC-E01：ZIP 结构
    const zip = await JSZip.loadAsync(pkg.zip);
    const names = Object.keys(zip.files);
    const pptxNames = names.filter((name) => name.endsWith(".pptx"));
    const interactive = names.filter((name) => name.startsWith("interactive/") && name.endsWith(".html"));
    console.log(`[zip] pptx=${pptxNames.join(", ") || "无"} interactive=${interactive.length}`);
    if (pptxNames.length !== 1) throw new Error(`ZIP 中应有且仅有一个 PPTX，实际 ${pptxNames.length} 个`);
    if (interactive.length !== pkg.interactiveCount) throw new Error("互动 HTML 数量与课程统计不一致");

    // AC-E02/E03：PPTX 内部结构
    const pptxBuf = await zip.file(pptxNames[0]).async("nodebuffer");
    const pptx = await JSZip.loadAsync(pptxBuf);
    const slideXmlNames = Object.keys(pptx.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]));
    console.log(`[pptx] 幻灯片页数=${slideXmlNames.length}（预期 ${pkg.slideCount}）`);
    if (slideXmlNames.length !== pkg.slideCount) throw new Error("PPTX 页数与 slide 场景数不一致");

    // 逐页抽取文本，验证内容确实进入 PPTX
    for (const name of slideXmlNames) {
      const xml = await pptx.file(name).async("string");
      const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1]).filter((text) => text.trim());
      const hasTable = xml.includes("<a:tbl>");
      const hasChartRef = xml.includes("graphicFrame");
      console.log(`  ${name}: 文本片段=${texts.length} 首条="${(texts[0] ?? "").slice(0, 24)}" 表格=${hasTable} 图表引用=${hasChartRef}`);
    }
    const chartParts = Object.keys(pptx.files).filter((name) => /ppt\/charts\/chart\d+\.xml/.test(name));
    console.log(`[pptx] 原生图表部件=${chartParts.length}`);
    for (const chartPart of chartParts) {
      const xml = await pptx.file(chartPart).async("string");
      const kind = xml.includes("<c:lineChart>") ? "line" : xml.includes("<c:barChart>") ? "bar" : xml.includes("<c:pieChart>") ? "pie" : "unknown";
      console.log(`  ${chartPart}: 类型=${kind}`);
    }
    // 互动 HTML 内容
    for (const name of interactive) {
      const html = await zip.file(name).async("string");
      if (!html.startsWith("<!doctype html>")) throw new Error(`${name} 不是自包含 HTML`);
      console.log(`  ${name}: 自包含 HTML ✓`);
    }
    // 留档一份 ZIP 供人工复核
    const savedPath = resolve(outputDir, `${target.label}-${pkg.filename}`);
    await writeFile(savedPath, pkg.zip);
    console.log(`[saved] ${relative(repoRoot, savedPath).replaceAll("\\", "/")}`);
  }
}

main().then(() => console.log("\n全部结构检查通过")).catch((error) => {
  console.error("\n结构检查失败：", error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
