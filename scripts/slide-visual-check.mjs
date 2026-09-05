import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseUrl = process.env.CHECK_BASE_URL ?? "http://localhost:3100";
const outputDir = "output/slide-visual-check";

async function requestJson(pathname, init = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${pathname} -> ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const config = await requestJson("/api/health/config");
if (config.mode !== "mock") throw new Error(`visual check 需要 mock 服务，当前 mode=${config.mode}`);

await mkdir(outputDir, { recursive: true });
const created = await requestJson("/api/courses", {
  method: "POST",
  body: JSON.stringify({ topic: "神经网络基础：从神经元到反向传播", requestedSceneCount: 4 }),
});
let course = created.course;
try {
  course = (await requestJson(`/api/courses/${course.id}/outline/generate`, { method: "POST", body: JSON.stringify({ expectedRevision: course.revision }) })).data.course;
  course = (await requestJson(`/api/courses/${course.id}/outline`, { method: "PATCH", body: JSON.stringify({ expectedRevision: course.revision, courseTitle: course.title, outlines: course.outlines }) })).data.course;
  for (const outline of course.outlines) {
    course = (await requestJson(`/api/courses/${course.id}/scenes/${outline.id}/generate`, { method: "POST", body: JSON.stringify({ expectedRevision: course.revision }) })).data.course;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${baseUrl}/classroom/${course.id}`);
  const canvas = page.getByTestId("slide-canvas");
  await canvas.waitFor({ state: "visible" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outputDir}/scene-1-hook-chart-table.png` });
  const chartSvgCount = await canvas.locator('[data-element-type="chart"] svg').count();
  await page.getByRole("button", { name: /打开场景 2/ }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outputDir}/scene-2-mechanism-code.png` });
  await browser.close();
  console.log(JSON.stringify({ courseId: course.id, status: course.status, chartSvgCount }));
} finally {
  const cleanup = await fetch(new URL(`/api/courses/${course.id}`, baseUrl), { method: "DELETE" });
  console.log(`cleanup ${cleanup.status}`);
}
