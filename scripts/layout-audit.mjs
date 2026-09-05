import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseUrl = "http://localhost:3100";
const outputDir = "output/layout-audit";
const targets = [
  { courseId: "acbf6bf6-1458-4927-838f-410c2e681a19", label: "v2.2首轮", scenes: [3, 5] },
  { courseId: "d085b604-cb41-4227-b33f-e03b528481dc", label: "v2.3二轮", scenes: [5] },
];

const W = 1000, H = 562.5;
const MARGIN = { left: 50, top: 45, right: 950, bottom: 517.5 };

function stripTags(html) { return html.replace(/<[^>]+>/g, ""); }
function firstFontSize(html) { const m = html.match(/font-size:\s*(\d+)px/); return m ? Number(m[1]) : 18; }
function rectsIntersect(a, b) {
  return !(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top);
}
function overlapArea(a, b) {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return Math.max(0, w) * Math.max(0, h);
}

function auditSlide(canvas) {
  const issues = [];
  const boxes = [];
  for (const el of canvas.elements) {
    const box = { left: el.left, top: el.top, width: el.width, height: el.height };
    const right = el.left + el.width, bottom = el.top + el.height;
    // 1. 画布越界（规范化后理论上不可能，仍验证）
    if (el.left < -0.01 || el.top < -0.01 || right > W + 0.01 || bottom > H + 0.01) {
      issues.push({ kind: "画布越界", element: `${el.type}#${(el.id ?? "").slice(0, 8)}`, detail: `left=${el.left.toFixed(1)} top=${el.top.toFixed(1)} right=${right.toFixed(1)} bottom=${bottom.toFixed(1)}` });
    }
    // 2. 安全边距违规（prompt 要求 50/45/950/517.5，规范化不检查）
    const isBackgroundish = el.type === "shape" && el.width > 800;
    if (!isBackgroundish && (el.left < MARGIN.left - 0.01 || el.top < MARGIN.top - 0.01 || right > MARGIN.right + 0.01 || bottom > MARGIN.bottom + 0.01)) {
      issues.push({ kind: "安全边距违规", element: `${el.type}#${(el.id ?? "").slice(0, 8)} ${el.textType ?? ""}`, detail: `box=(${el.left.toFixed(0)},${el.top.toFixed(0)},${right.toFixed(0)},${bottom.toFixed(0)}) 允许范围=(${MARGIN.left},${MARGIN.top},${MARGIN.right},${MARGIN.bottom})` });
    }
    // 3. 旋转（可导致视觉出界）
    if (el.rotate && Math.abs(el.rotate) > 0.01) issues.push({ kind: "存在旋转", element: `${el.type}#${(el.id ?? "").slice(0, 8)}`, detail: `rotate=${el.rotate}°` });
    // 4. 文字溢出估算：行数×字号×1.5+20 vs 实际高度
    if (el.type === "text") {
      const paragraphs = el.content.split(/<br\s*\/?>|<\/p>/i).map(stripTags).map(s => s.trim()).filter(Boolean);
      const fs = firstFontSize(el.content);
      const capacity = Math.max(1, Math.floor((el.width - 20) / fs));
      let neededLines = 0;
      for (const p of paragraphs) neededLines += Math.max(1, Math.ceil(p.length / capacity));
      const neededHeight = neededLines * fs * 1.5 + 20;
      if (neededHeight > el.height * 1.15) {
        issues.push({ kind: "文字疑似溢出", element: `text#${(el.id ?? "").slice(0, 8)} textType=${el.textType}`, detail: `估算需 ${neededHeight.toFixed(0)}px（${neededLines} 行 × ${fs}px），实际框高 ${el.height.toFixed(0)}px，文字="${stripTags(el.content).slice(0, 18)}…"` });
      }
      boxes.push({ el, box });
    } else if (el.type === "chart" || el.type === "table" || el.type === "code") {
      boxes.push({ el, box });
    }
  }
  // 5. 文字/图表/表格/代码之间的显著重叠
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (!rectsIntersect(a.box, b.box)) continue;
      const area = overlapArea(a.box, b.box);
      const smaller = Math.min(a.box.width * a.box.height, b.box.width * b.box.height);
      if (smaller > 0 && area / smaller > 0.3) {
        issues.push({ kind: "显著重叠", element: `${a.el.type}#${(a.el.id ?? "").slice(0, 8)} × ${b.el.type}#${(b.el.id ?? "").slice(0, 8)}`, detail: `重叠面积占较小元素 ${(area / smaller * 100).toFixed(0)}%（a=(${a.box.left.toFixed(0)},${a.box.top.toFixed(0)},${(a.box.left + a.box.width).toFixed(0)},${(a.box.top + a.box.height).toFixed(0)}) b=(${b.box.left.toFixed(0)},${b.box.top.toFixed(0)},${(b.box.left + b.box.width).toFixed(0)},${(b.box.top + b.box.height).toFixed(0)})）` });
      }
    }
  }
  return issues;
}

await mkdir(outputDir, { recursive: true });
const report = {};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

for (const target of targets) {
  const course = (await fetch(new URL(`/api/courses/${target.courseId}`, baseUrl)).then(r => r.json())).course;
  report[`${target.label} ${target.courseId.slice(0, 8)}`] = {};
  for (const order of target.scenes) {
    const outline = course.outlines.find(o => o.order === order);
    const scene = course.scenes.find(s => s.outlineId === outline.id);
    if (!scene || scene.type !== "slide") continue;
    const issues = auditSlide(scene.content.canvas);
    report[`${target.label} ${target.courseId.slice(0, 8)}`][`场景${order} ${scene.title}`] = { promptVersion: scene.generation.promptVersion, elementCount: scene.content.canvas.elements.length, issueCount: issues.length, issues };
    // 截图该场景
    await page.goto(`${baseUrl}/classroom/${target.courseId}`);
    await page.getByTestId("slide-canvas").waitFor({ state: "visible" });
    await page.getByRole("button", { name: new RegExp(`打开场景 ${order}`) }).click();
    await page.waitForTimeout(1500);
    const file = `${target.label}-场景${order}.png`;
    await page.screenshot({ path: `${outputDir}/${file}` });
    console.log(`\n=== ${target.label} 场景${order}《${scene.title}》 prompt=${scene.generation.promptVersion} 元素=${scene.content.canvas.elements.length} 问题=${issues.length}`);
    for (const issue of issues) console.log(`  [${issue.kind}] ${issue.element} → ${issue.detail}`);
  }
}
await browser.close();
await writeFile(`${outputDir}/audit-report.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`\n报告已写入 ${outputDir}/audit-report.json`);
