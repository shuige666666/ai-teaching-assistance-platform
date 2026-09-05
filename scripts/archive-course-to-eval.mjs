import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";
import { captureCourseSceneArchives } from "../eval/scripts/scene-archive-lib.mjs";

const baseUrl = process.env.EVAL_BASE_URL ?? "http://localhost:3100";

const usage = () => {
  console.error("用法：node scripts/archive-course-to-eval.mjs <courseId> <runName> [补充JSON文件路径]");
  console.error("示例：node scripts/archive-course-to-eval.mjs 08466058-... slide-v2.4-smoke output/deepseek-smoke/summary.json");
  process.exit(1);
};

const [courseId, runName, supplementFile] = process.argv.slice(2);
if (!courseId || !runName) usage();

const course = await fetch(new URL(`/api/courses/${courseId}`, baseUrl)).then((r) => r.json());
if (!course.course) throw new Error(`课程 ${courseId} 不存在`);
const snapshot = course.course;

let supplement = null;
if (supplementFile) {
  supplement = await import("node:fs/promises").then((fs) => fs.readFile(supplementFile, "utf8")).then(JSON.parse);
}

const now = new Date();
const timestamp = now.toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z");
const runDirectory = path.resolve(process.cwd(), "eval/runs", runName, timestamp);
const promptVersions = [...new Set(snapshot.scenes.map((scene) => scene.generation.promptVersion))];

console.log(`归档课程 ${snapshot.id.slice(0, 8)}《${snapshot.title}》→ ${path.relative(process.cwd(), runDirectory)}`);
const browser = await chromium.launch();
try {
  const sceneArchives = await captureCourseSceneArchives(browser, baseUrl, snapshot, path.join(runDirectory, "scenes", runName));
  const elementStats = snapshot.scenes
    .filter((scene) => scene.type === "slide")
    .map((scene) => {
      const typeCount = {};
      for (const element of scene.content.canvas.elements) typeCount[element.type] = (typeCount[element.type] ?? 0) + 1;
      return {
        order: scene.order,
        elementCount: scene.content.canvas.elements.length,
        typeCount,
        gradients: scene.content.canvas.elements.filter((element) => element.gradient).length,
      };
    });
  const report = {
    version: "course-quality-run.v2",
    evidenceFormat: "mhtml",
    runKind: "course-archive",
    createdAt: now.toISOString(),
    note: "由 scripts/archive-course-to-eval.mjs 从数据库既有课程归档，未调用任何生成接口。",
    promptVersions,
    results: [{
      topicId: runName,
      course: { courseId: snapshot.id, revision: snapshot.revision, title: snapshot.title, status: snapshot.status, scenes: snapshot.scenes.map(({ order, type, title }) => ({ order, type, title })) },
      generation: { provider: snapshot.scenes[0]?.generation.provider, model: snapshot.scenes[0]?.generation.model },
      elementStats,
      sceneArchives,
      ...(supplement ? { supplement } : {}),
    }],
  };
  await mkdir(runDirectory, { recursive: true });
  await writeFile(path.join(runDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(runDirectory, "summary.md"), [
    `# ${runName}（${timestamp}）`,
    "",
    `- 课程：${snapshot.title}（${snapshot.id}，${snapshot.status}，REV.${snapshot.revision}）`,
    `- Prompt 版本：${promptVersions.join("、")}`,
    `- 场景：${snapshot.scenes.map((scene) => `${scene.order}.${scene.type}`).join(" ")}`,
    `- MHTML：${sceneArchives.length} 份（1280×720 视口，SHA-256 见 report.json）`,
  ].join("\n") + "\n", "utf8");
  console.log(`完成：${sceneArchives.length} 份 MHTML + report.json + summary.md`);
} finally {
  await browser.close();
}
