import { mkdir } from "node:fs/promises";
import JSZip from "jszip";
import { chromium } from "@playwright/test";

const baseUrl = "http://localhost:3100";
const courseId = "a1865e9e-6a16-4ff3-8f6f-0c668eaa95d9";
await mkdir("output/export-check", { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
await page.goto(`${baseUrl}/classroom/${courseId}`);
await page.getByTestId("slide-canvas").waitFor({ state: "visible" });

const exportButton = page.getByTestId("export-button");
await exportButton.waitFor({ state: "visible" });
console.log(`[ui] 按钮文本: ${await exportButton.innerText()}`);

const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
await exportButton.click();
const download = await downloadPromise;
const target = "output/export-check/browser-download.zip";
await download.saveAs(target);
console.log(`[download] ${download.suggestedFilename()} → ${target}`);

await page.getByTestId("export-zone").waitFor({ state: "visible" });
const message = await page.getByTestId("export-message").innerText().catch(() => "(无提示)");
console.log(`[ui] 完成提示: ${message}`);

const zip = await JSZip.loadAsync(await import("node:fs/promises").then((fs) => fs.readFile(target)));
const names = Object.keys(zip.files);
const pptxName = names.find((n) => n.endsWith(".pptx"));
console.log(`[zip] pptx=${pptxName} interactive 条目=${names.filter((n) => n.startsWith("interactive/")).length}`);
if (!pptxName) throw new Error("下载的 ZIP 中没有 PPTX");
const pptx = await JSZip.loadAsync(await zip.file(pptxName).async("nodebuffer"));
const slideCount = Object.keys(pptx.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
console.log(`[pptx] 幻灯片页数=${slideCount}`);
if (slideCount !== 3) throw new Error("浏览器导出的 PPTX 页数异常");

// 检查下载后 UI 状态
await browser.close();
console.log("[done] 浏览器导出链路验证通过");
