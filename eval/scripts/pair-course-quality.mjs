import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  MANUAL_SCORE_DIMENSIONS,
  assertSlideQuizOnly,
  buildCourseQualityPairs,
  summarizeCourseQualityScores,
} from "./course-quality-lib.mjs";

const workspace = process.cwd();

/** 读取配对命令参数；缺少必填目录时尽早停止，避免生成不完整的评分材料。 */
function readArgument(name, required = true) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (required && !value) throw new Error(`缺少参数 ${name}`);
  return value;
}

/** 读取 JSON 报告，配对脚本只消费采集器已经落盘的事实。 */
async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

/** 检查两次运行使用的是同一冻结评价集和同一服务模型。 */
function assertComparableRuns(baseline, candidate) {
  if (baseline.datasetVersion !== candidate.datasetVersion || baseline.frozenAt !== candidate.frozenAt) {
    throw new Error("两次运行的评价集版本或 frozenAt 不一致，不能配对");
  }
  if (baseline.server?.provider !== candidate.server?.provider || baseline.server?.model !== candidate.server?.model) {
    throw new Error("两次运行的 Provider 或模型不一致，不能配对");
  }
  if (candidate.comparisonScope?.interactionMode !== "off") {
    throw new Error("候选运行没有声明 interactionMode=off，不能作为本轮 slide/quiz 配对候选");
  }
}

function safeDirectoryName(pairId) {
  return pairId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function archivePath(runDirectory, scene) {
  return path.join(runDirectory, "scenes", scene.topicId, scene.archive.filename);
}

/** 将配对场景复制为 A/B 复核材料，不建立额外的评分页面。 */
async function writeReviewMaterial(outputRoot, baselineDirectory, candidateDirectory, pairs) {
  const reviewRoot = path.join(outputRoot, "review");
  const index = [];
  for (const pair of pairs) {
    const pairDirectory = path.join(reviewRoot, safeDirectoryName(pair.pairId));
    await mkdir(pairDirectory, { recursive: true });
    await copyFile(archivePath(baselineDirectory, pair.baseline), path.join(pairDirectory, "A.mhtml"));
    await copyFile(archivePath(candidateDirectory, pair.candidate), path.join(pairDirectory, "B.mhtml"));
    index.push({
      pairId: pair.pairId,
      topicId: pair.topicId,
      sceneType: pair.sceneType,
      a: path.relative(outputRoot, path.join(pairDirectory, "A.mhtml")),
      b: path.relative(outputRoot, path.join(pairDirectory, "B.mhtml")),
    });
  }
  await writeFile(path.join(outputRoot, "review-index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

/** 生成只包含三项视觉分数的人工填写模板；模板不是评分结果。 */
async function writeScoreTemplate(outputRoot, pairs) {
  const template = pairs.map((pair) => ({
    pairId: pair.pairId,
    sceneType: pair.sceneType,
    baseline: Object.fromEntries(MANUAL_SCORE_DIMENSIONS.map((dimension) => [dimension, null])),
    candidate: Object.fromEntries(MANUAL_SCORE_DIMENSIONS.map((dimension) => [dimension, null])),
    preference: null,
    note: "",
  }));
  await writeFile(path.join(outputRoot, "scores.template.json"), `${JSON.stringify(template, null, 2)}\n`, "utf8");
}

/** 创建配对目录，并可在人工填写 scores.json 后追加三项分数汇总。 */
async function main() {
  const baselineDirectory = path.resolve(workspace, readArgument("--baseline"));
  const candidateDirectory = path.resolve(workspace, readArgument("--candidate"));
  const outputArgument = readArgument("--output", false);
  const scoresArgument = readArgument("--scores", false);
  const outputRoot = path.resolve(workspace, outputArgument ?? path.join(
    "eval",
    "runs",
    "paired-slide-quiz",
    new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-"),
  ));

  const baselineReport = await readJson(path.join(baselineDirectory, "report.json"));
  const candidateReport = await readJson(path.join(candidateDirectory, "report.json"));
  assertComparableRuns(baselineReport, candidateReport);
  assertSlideQuizOnly(baselineReport, "v0.3 基线");
  assertSlideQuizOnly(candidateReport, "v0.4 候选");

  const { pairs, unmatched } = buildCourseQualityPairs(baselineReport, candidateReport);
  await mkdir(outputRoot, { recursive: true });
  const outputPairs = pairs.map((pair) => ({
    ...pair,
    baseline: { ...pair.baseline, archivePath: archivePath(baselineDirectory, pair.baseline) },
    candidate: { ...pair.candidate, archivePath: archivePath(candidateDirectory, pair.candidate) },
  }));
  await writeFile(path.join(outputRoot, "pairs.json"), `${JSON.stringify({
    version: "course-quality-pairs.v1",
    scope: { sceneTypes: ["slide", "quiz"], interactionMode: "off" },
    baseline: { runId: baselineReport.runId, runType: baselineReport.runType, directory: baselineDirectory },
    candidate: { runId: candidateReport.runId, runType: candidateReport.runType, directory: candidateDirectory },
    pairs: outputPairs,
    unmatched,
  }, null, 2)}\n`, "utf8");
  await writeReviewMaterial(outputRoot, baselineDirectory, candidateDirectory, pairs);
  await writeScoreTemplate(outputRoot, pairs);

  if (scoresArgument) {
    const scoreValue = await readJson(path.resolve(workspace, scoresArgument));
    const scores = Array.isArray(scoreValue) ? scoreValue : scoreValue.scores;
    if (!Array.isArray(scores)) throw new Error("scores 文件必须是数组，或包含 scores 数组字段");
    const summary = summarizeCourseQualityScores(pairs, scores);
    await writeFile(path.join(outputRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }

  process.stdout.write(`slide/quiz 配对完成：${pairs.length} 对；未配对 v0.3=${unmatched.baseline.length}，v0.4=${unmatched.candidate.length}\n输出目录：${outputRoot}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
