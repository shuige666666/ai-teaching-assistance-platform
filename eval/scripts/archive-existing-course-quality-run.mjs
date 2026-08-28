import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";
import { createSummaryMarkdown } from "./course-quality-lib.mjs";
import { captureCourseSceneArchives } from "./scene-archive-lib.mjs";

/** 读取 JSON，并让文件错误在启动浏览器前直接暴露。 */
async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

/** 只读取既有课程；该迁移脚本不包含任何生成接口调用。 */
async function fetchCourse(baseUrl, courseId) {
  const response = await fetch(new URL(`/api/courses/${courseId}`, baseUrl));
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? `读取课程 ${courseId} 失败：${response.status}`);
  return body.course;
}

/** 防止数据库内容已变化时给旧报告配上不对应的视觉快照。 */
function assertSameCourse(snapshot, current) {
  if (snapshot.courseId !== current.id || snapshot.revision !== current.revision) {
    throw new Error(`课程 ${snapshot.courseId} 的 revision 已变化，拒绝覆盖旧基线证据`);
  }
  const oldScenes = snapshot.scenes.map(({ order, type, title }) => ({ order, type, title }));
  const currentScenes = current.scenes.map(({ order, type, title }) => ({ order, type, title }));
  if (JSON.stringify(oldScenes) !== JSON.stringify(currentScenes)) {
    throw new Error(`课程 ${snapshot.courseId} 的场景已变化，拒绝覆盖旧基线证据`);
  }
}

/** 给 85be4b9f 产生的既有基线补齐 MHTML，并在成功后清理旧截图和提前评分文件。 */
async function main() {
  if (!process.argv[2]) throw new Error("请传入既有运行目录，例如 eval/runs/baseline-v0.3/<runId>");
  const runDirectory = path.resolve(process.cwd(), process.argv[2]);
  const baseUrl = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
  const original = await readJson(path.join(runDirectory, "report.json"));
  if (!Array.isArray(original.results) || original.results.length === 0) throw new Error("旧报告没有可迁移课程");
  if (original.version === "course-quality-run.v2" && original.evidenceFormat === "mhtml") {
    throw new Error("该运行已经完成 MHTML 迁移，不应重复覆盖现有场景归档");
  }

  const scenesDirectory = path.join(runDirectory, "scenes");
  await rm(scenesDirectory, { recursive: true, force: true });
  await mkdir(scenesDirectory, { recursive: true });
  const browser = await chromium.launch();
  const migratedResults = [];
  try {
    for (const result of original.results) {
      process.stdout.write(`Archiving ${result.topicId}...\n`);
      const currentCourse = await fetchCourse(baseUrl, result.course.courseId);
      assertSameCourse(result.course, currentCourse);
      const sceneArchives = await captureCourseSceneArchives(browser, baseUrl, currentCourse, path.join(scenesDirectory, result.topicId));
      if (sceneArchives.length !== result.course.scenes.length) throw new Error(`${result.topicId} 的 MHTML 数量与已保存场景不一致`);
      const kept = { ...result };
      delete kept.slideReports;
      delete kept.visualEvidence;
      migratedResults.push({ ...kept, sceneArchives });
    }
  } catch (error) {
    // 迁移失败时只清理新目录，旧截图与旧报告仍保持可恢复。
    await rm(scenesDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    await browser.close();
  }

  const report = {
    ...original,
    version: "course-quality-run.v2",
    evidenceFormat: "mhtml",
    migratedAt: new Date().toISOString(),
    migratedFrom: { version: original.version, commit: "85be4b9f", reason: "以逐场景 MHTML 替代截图、DOM 密度观察和提前人工评分" },
    results: migratedResults,
  };
  delete report.densityPolicyVersion;
  await writeFile(path.join(runDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(runDirectory, "summary.md"), createSummaryMarkdown(report), "utf8");

  // 新证据全部通过校验后再删除 85be4b9f 遗留物，避免迁移中途造成证据损失。
  await rm(path.join(runDirectory, "evidence"), { recursive: true, force: true });
  await rm(path.join(runDirectory, "scores.json"), { force: true });
  await rm(path.join(runDirectory, "progress.json"), { force: true });
  process.stdout.write(`Archived ${migratedResults.reduce((total, result) => total + result.sceneArchives.length, 0)} scenes without regenerating courses: ${runDirectory}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
