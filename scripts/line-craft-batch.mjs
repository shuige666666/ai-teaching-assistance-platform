import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseUrl = "http://localhost:3100";
const outputDir = "output/line-craft-batch";
const topics = [
  "HTTP 请求的完整生命周期：从输入网址到页面渲染",
  "TCP 三次握手与四次挥手",
  "Git 分支、提交与合并的工作流程",
  "操作系统进程状态切换与 CPU 调度",
];

async function requestJson(pathname, init = {}, courseId = null) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(new URL(pathname, baseUrl), { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
    const body = await response.json().catch(() => null);
    if (response.ok) return body;
    const retryable = body?.error?.retryable === true && attempt < 1;
    if (!retryable) throw new Error(`${pathname} -> ${response.status}: ${JSON.stringify(body?.error ?? {})}`);
    console.log(`    可重试错误（${body.error.code}），刷新课程状态后重试`);
    await new Promise((r) => setTimeout(r, 2500));
    if (courseId) {
      const fresh = await fetch(new URL(`/api/courses/${courseId}`, baseUrl)).then((r) => r.json()).catch(() => null);
      if (fresh?.course && init.body) {
        const payload = JSON.parse(init.body);
        if (payload.expectedRevision !== undefined) payload.expectedRevision = fresh.course.revision;
        if (payload.courseTitle !== undefined) { payload.courseTitle = fresh.course.title; payload.outlines = fresh.course.outlines; }
        init = { ...init, body: JSON.stringify(payload) };
      }
    }
  }
}

function stripTags(html) { return html.replace(/<[^>]+>/g, ""); }

function auditLines(canvas, sceneTitle) {
  const lines = canvas.elements.filter((e) => e.type === "line");
  const nodes = canvas.elements.filter((e) => e.type === "shape" && e.width >= 120 && e.height >= 50);
  const texts = canvas.elements.filter((e) => e.type === "text");
  const findings = { sceneTitle, lineCount: lines.length, connectors: [], suspiciousBars: [] };
  for (const line of lines) {
    const x1 = line.left + line.start[0], y1 = line.top + line.start[1];
    const x2 = line.left + line.end[0], y2 = line.top + line.end[1];
    const length = Math.round(Math.hypot(x2 - x1, y2 - y1));
    const horizontal = Math.abs(y2 - y1) < 6;
    const midY = (y1 + y2) / 2, left = Math.min(x1, x2), right = Math.max(x1, x2);
    const entry = { from: `${x1.toFixed(0)},${y1.toFixed(0)}`, to: `${x2.toFixed(0)},${y2.toFixed(0)}`, length, horizontal, startArrow: line.points[0] || "-", endArrow: line.points[1] || "-", startGap: null, endGap: null };
    const covering = nodes.filter((n) => midY >= n.top - 6 && midY <= n.top + n.height + 6);
    for (const node of covering) {
      const nodeRight = node.left + node.width;
      const gapFromNodeRight = left - nodeRight;
      const gapToNodeLeft = node.left - right;
      if (gapFromNodeRight >= -4 && (entry.startGap === null || Math.abs(gapFromNodeRight) < Math.abs(entry.startGap))) entry.startGap = Math.round(gapFromNodeRight);
      if (gapToNodeLeft >= -4 && (entry.endGap === null || Math.abs(gapToNodeLeft) < Math.abs(entry.endGap))) entry.endGap = Math.round(gapToNodeLeft);
    }
    findings.connectors.push(entry);
  }
  const titleBottoms = texts.filter((t) => t.textType === "title").map((t) => ({ left: t.left, bottom: t.top + t.height }));
  for (const shape of canvas.elements.filter((e) => e.type === "shape" && e.height <= 8 && e.width >= 20)) {
    const isUnderline = titleBottoms.some((tb) => Math.abs(shape.top - tb.bottom - 10) < 14 && shape.left >= tb.left - 10);
    if (!isUnderline) findings.suspiciousBars.push({ left: shape.left, top: shape.top, w: shape.width, h: shape.height });
  }
  findings.textPreview = texts.slice(0, 8).map((t) => stripTags(t.content).slice(0, 12));
  return findings;
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const collected = [];
let shotIndex = 0;

for (const topic of topics) {
  if (collected.filter((item) => item.lineCount > 0).length >= 4) break;
  console.log(`\n===== 课程主题：${topic}`);
  let course;
  try {
    course = (await requestJson("/api/courses", { method: "POST", body: JSON.stringify({ topic, requestedSceneCount: 6 }) })).course;
    course = (await requestJson(`/api/courses/${course.id}/outline/generate`, { method: "POST", body: JSON.stringify({ expectedRevision: course.revision }) }, course.id)).data.course;
    course = (await requestJson(`/api/courses/${course.id}/outline`, { method: "PATCH", body: JSON.stringify({ expectedRevision: course.revision, courseTitle: course.title, outlines: course.outlines }) }, course.id)).data.course;
  } catch (error) {
    console.log(`  大纲失败：${error.message}`);
    if (course) await fetch(new URL(`/api/courses/${course.id}`, baseUrl), { method: "DELETE" }).catch(() => {});
    continue;
  }
  const slideOutlines = course.outlines.filter((o) => o.type === "slide");
  console.log(`  大纲：${course.outlines.map((o) => `${o.order}.${o.role}`).join(" ")}`);
  for (const outline of slideOutlines) {
    try {
      course = (await requestJson(`/api/courses/${course.id}/scenes/${outline.id}/generate`, { method: "POST", body: JSON.stringify({ expectedRevision: course.revision }) })).data.course;
    } catch (error) {
      console.log(`  场景 ${outline.order} 生成失败：${error.message}`);
      continue;
    }
    const scene = course.scenes.find((s) => s.outlineId === outline.id);
    if (!scene || scene.type !== "slide") continue;
    const counts = {};
    for (const el of scene.content.canvas.elements) counts[el.type] = (counts[el.type] ?? 0) + 1;
    const lineCount = counts.line ?? 0;
    if (lineCount === 0) {
      // 无连线的 mechanism/worked_example 页记录构成，用于观察 v2.4 条件触发是否过度收敛
      if (outline.role === "mechanism" || outline.role === "worked_example") {
        console.log(`  场景 ${outline.order}（${outline.role}）无连线，元素构成：${JSON.stringify(counts)}，keyPoints=${JSON.stringify(outline.keyPoints).slice(0, 120)}`);
      } else {
        console.log(`  场景 ${outline.order}（${outline.role}）：无连线，跳过`);
      }
      continue;
    }
    const findings = auditLines(scene.content.canvas, scene.title);
    findings.courseId = course.id; findings.order = outline.order; findings.role = outline.role; findings.promptVersion = scene.generation.promptVersion; findings.lineCount = lineCount;
    shotIndex += 1;
    findings.screenshot = `flow-${String(shotIndex).padStart(2, "0")}-${outline.role}.png`;
    await page.goto(`${baseUrl}/classroom/${course.id}`);
    await page.getByTestId("slide-canvas").waitFor({ state: "visible" });
    await page.getByRole("button", { name: new RegExp(`打开场景 ${outline.order}`) }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${outputDir}/${findings.screenshot}` });
    collected.push(findings);
    console.log(`  场景 ${outline.order}（${outline.role}）连线 ${lineCount} 根：`);
    for (const c of findings.connectors) {
      console.log(`    (${c.from}) → (${c.to}) 长=${c.length}${c.horizontal ? "" : "[斜/竖线]"} 起端间隙=${c.startGap ?? "?"} 末端间隙=${c.endGap ?? "?"} 箭头=${c.endArrow}`);
    }
    if (findings.suspiciousBars.length > 0) console.log(`    [!] 疑似色条：${JSON.stringify(findings.suspiciousBars)}`);
  }
  await fetch(new URL(`/api/courses/${course.id}`, baseUrl), { method: "DELETE" });
  console.log(`  （课程已删除，截图保留）累计连线页：${collected.length}`);
}
await browser.close();

const all = collected.flatMap((f) => f.connectors);
const horizontal = all.filter((c) => c.horizontal);
const summary = {
  auditedLineSlides: collected.length,
  totalConnectors: all.length,
  horizontalConnectors: horizontal.length,
  lengthOk: horizontal.filter((c) => c.length >= 40).length,
  edgeToEdgeStart: horizontal.filter((c) => c.startGap !== null && c.startGap >= -4 && c.startGap <= 12).length,
  edgeToEdgeEnd: horizontal.filter((c) => c.endGap !== null && c.endGap >= -4 && c.endGap <= 12).length,
  endArrow: all.filter((c) => c.endArrow === "arrow").length,
  slidesWithSuspiciousBars: collected.filter((f) => f.suspiciousBars.length > 0).length,
  zeroLength: all.filter((c) => c.length === 0).length,
};
console.log("\n===== 连线工艺合规汇总 =====");
console.log(JSON.stringify(summary, null, 2));
await writeFile(`${outputDir}/batch-report.json`, `${JSON.stringify({ summary, details: collected }, null, 2)}\n`, "utf8");
console.log(`报告与截图在 ${outputDir}/`);
