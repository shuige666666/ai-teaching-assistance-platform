import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** 检查 MHTML 是否具备 Chromium 快照的基本边界，防止空文件被当作成功证据。 */
export async function verifySceneArchive(filePath) {
  const content = await readFile(filePath);
  const header = content.subarray(0, Math.min(content.length, 4096)).toString("utf8");
  if (content.length < 1024 || !header.includes("Content-Type: multipart/related")) {
    throw new Error(`场景快照不是有效 MHTML：${filePath}`);
  }
  return { bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") };
}

/** 使用 Chromium 当前渲染后的 DOM，为课程的每个已保存场景生成单文件 MHTML。 */
export async function captureCourseSceneArchives(browser, baseUrl, course, topicDirectory) {
  await mkdir(topicDirectory, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  let activePage = null;
  try {
    const archives = [];

    // captureSnapshot 后页面脚本可能不再响应，因此每个场景使用一个全新的课堂页。
    for (const scene of [...course.scenes].sort((left, right) => left.order - right.order)) {
      const page = await context.newPage();
      activePage = page;
      // 外部资源可能维持连接；页面可操作与互动 READY 才是归档依据，不等待全站网络空闲。
      const navigation = await page.goto(new URL(`/classroom/${course.id ?? course.courseId}`, baseUrl).href, { waitUntil: "domcontentloaded" });
      if (!navigation?.ok()) throw new Error(`课堂页面返回 ${navigation?.status() ?? "unknown"}`);
      await page.locator("nav.scene-rail").waitFor({ state: "attached" });
      await page.getByRole("button", { name: new RegExp(`打开场景 ${scene.order}：`) }).click();
      const sceneNumber = `SCENE ${String(scene.order).padStart(2, "0")}`;
      const activeSceneLabel = scene.type === "slide"
        ? page.locator(".scene-slide-meta").filter({ hasText: sceneNumber })
        : page.locator(".scene-heading .eyebrow").filter({ hasText: sceneNumber });
      await activeSceneLabel.waitFor();
      if (scene.type === "interactive") {
        // 等 iframe 进入可见状态再留档，避免把初始化占位当作互动页面。
        await page.locator('[data-testid="interactive-host"][data-runtime-state="ready"], [data-testid="interactive-host"][data-runtime-state="completed"], [data-testid="interactive-host"][data-runtime-state="failed"]').waitFor({ timeout: 35_000 });
      } else {
        await page.getByTestId(scene.type === "quiz" ? "quiz-renderer" : "slide-renderer").waitFor();
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      const filename = `${String(scene.order).padStart(2, "0")}-${scene.type}.mhtml`;
      const filePath = path.join(topicDirectory, filename);
      const client = await context.newCDPSession(page);
      const snapshot = await client.send("Page.captureSnapshot", { format: "mhtml" });
      await writeFile(filePath, snapshot.data, "utf8");
      const verified = await verifySceneArchive(filePath);
      archives.push({ sceneOrder: scene.order, sceneType: scene.type, filename, format: "mhtml", viewport: { width: 1280, height: 720 }, ...verified });
      await page.close();
      activePage = null;
    }
    return archives;
  } catch (error) {
    const bodyText = await activePage?.locator("body").innerText().catch(() => "") ?? "";
    throw new Error(`${error instanceof Error ? error.message : String(error)}；url=${activePage?.url() ?? "unknown"}；body=${bodyText.slice(0, 500)}`);
  } finally {
    await context.close();
  }
}
