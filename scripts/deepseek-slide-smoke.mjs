import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = "http://localhost:3100";
const outputDir = "output/deepseek-smoke";
const topic = process.argv[2] ?? "Python、Java、Go、Rust 四种后端编程语言的性能与生态对比";

async function requestJson(pathname, init = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error?.message ?? `${init.method ?? "GET"} ${pathname} 返回 ${response.status}`);
    error.details = { status: response.status, code: body?.error?.code, requestId: body?.error?.requestId };
    throw error;
  }
  return body;
}

const config = await requestJson("/api/health/config");
if (config.mode !== "remote" || config.provider !== "deepseek") {
  throw new Error(`真实 smoke 要求 remote + deepseek，当前 mode=${config.mode} provider=${config.provider}`);
}
console.log(`[config] mode=${config.mode} provider=${config.provider} model=${config.model}`);

await mkdir(outputDir, { recursive: true });

// 1. 创建课程并生成大纲。
let course = (await requestJson("/api/courses", { method: "POST", body: JSON.stringify({ topic, requestedSceneCount: 5 }) })).course;
console.log(`[create] courseId=${course.id}`);
try {
  const outlineStart = Date.now();
  course = (await requestJson(`/api/courses/${course.id}/outline/generate`, { method: "POST", body: JSON.stringify({ expectedRevision: course.revision }) })).data.course;
  console.log(`[outline] ${((Date.now() - outlineStart) / 1000).toFixed(1)}s，${course.outlines.length} 个场景：${course.outlines.map((item) => `${item.order}.${item.type}(${item.role})`).join(" ")}`);

  // 2. 人工确认大纲并逐场生成；单场失败允许显式重试一次。
  course = (await requestJson(`/api/courses/${course.id}/outline`, { method: "PATCH", body: JSON.stringify({ expectedRevision: course.revision, courseTitle: course.title, outlines: course.outlines }) })).data.course;
  for (const outline of course.outlines) {
    const started = Date.now();
    try {
      course = (await requestJson(`/api/courses/${course.id}/scenes/${outline.id}/generate`, { method: "POST", body: JSON.stringify({ expectedRevision: course.revision }) })).data.course;
      const scene = course.scenes.find((item) => item.outlineId === outline.id);
      console.log(`[scene ${outline.order}] ${scene ? "ok" : "missing"} ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (error) {
      console.log(`[scene ${outline.order}] 第一次失败：${error.message}，显式重试一次`);
      course = (await requestJson(`/api/courses/${course.id}/scenes/${outline.id}/generate`, { method: "POST", body: JSON.stringify({ expectedRevision: course.revision }) })).data.course;
      console.log(`[scene ${outline.order}] 重试成功 ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
  }
  course = (await requestJson(`/api/courses/${course.id}`)).course;
  console.log(`[status] ${course.status}`);

  // 3. 统计每场 slide 的元素构成，检验新元素是否真的被模型使用。
  const summary = { courseId: course.id, classroomUrl: `${baseUrl}/classroom/${course.id}`, status: course.status, scenes: [] };
  for (const scene of course.scenes) {
    if (scene.type !== "slide") {
      summary.scenes.push({ order: scene.order, type: scene.type, promptVersion: scene.generation.promptVersion });
      continue;
    }
    const canvas = scene.content.canvas;
    const typeCount = {};
    for (const element of canvas.elements) typeCount[element.type] = (typeCount[element.type] ?? 0) + 1;
    summary.scenes.push({
      order: scene.order, type: scene.type, promptVersion: scene.generation.promptVersion,
      repaired: scene.generation.repaired, upstreamCalls: scene.generation.upstreamCalls,
      durationMs: scene.generation.durationMs, usage: scene.generation.usage ?? null,
      elementCount: canvas.elements.length, typeCount,
      gradients: canvas.elements.filter((element) => element.gradient).length,
      themeColors: canvas.theme.themeColors,
      charts: canvas.elements.filter((element) => element.type === "chart").map((element) => ({ chartType: element.chartType, labels: element.data.labels.length, series: element.data.series.length })),
      tables: canvas.elements.filter((element) => element.type === "table").map((element) => ({ rows: element.rows.length, cols: element.colWidths.length })),
    });
  }
  await writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  for (const scene of summary.scenes) {
    if (scene.type !== "slide") { console.log(`[slide?] 场景 ${scene.order} 是 ${scene.type}，跳过统计`); continue; }
    console.log(`[slide ${scene.order}] ${JSON.stringify(scene.typeCount)} 渐变=${scene.gradients} chart=${JSON.stringify(scene.charts)} table=${JSON.stringify(scene.tables)} usage=${JSON.stringify(scene.usage)}`);
  }

  // 4. 打开课堂逐场截图（1280×720，与 MHTML 留档视口一致）。
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${baseUrl}/classroom/${course.id}`);
  await page.getByTestId("slide-canvas").waitFor({ state: "visible", timeout: 30_000 });
  for (const scene of summary.scenes) {
    await page.getByRole("button", { name: new RegExp(`打开场景 ${scene.order}`) }).click();
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(outputDir, `scene-${String(scene.order).padStart(2, "0")}.png`) });
    console.log(`[screenshot] scene-${String(scene.order).padStart(2, "0")}.png`);
  }
  await browser.close();
  console.log(`[done] 课堂地址：${summary.classroomUrl}（课程已保留，可在首页删除）`);
} catch (error) {
  console.error(`[failed] ${error.message} ${JSON.stringify(error.details ?? {})}`);
  console.error(`课程未删除，可在首页检查：/generation/${course.id}`);
  process.exitCode = 1;
}
