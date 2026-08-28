import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";
import { createSummaryMarkdown, parseEvaluationDataset, sanitizeCourse } from "./course-quality-lib.mjs";
import { captureCourseSceneArchives } from "./scene-archive-lib.mjs";

const workspace = process.cwd();
const datasetPath = path.join(workspace, "eval", "config", "course-quality.v1.json");

/** 读取 UTF-8 JSON；解析错误应在任何网络请求前暴露。 */
async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

/** 调用正式业务 API，并保留稳定错误码和请求编号，不记录 Provider 原始响应。 */
async function requestJson(baseUrl, pathname, init = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(body?.error?.message ?? `${init.method ?? "GET"} ${pathname} 返回 ${response.status}`);
    error.details = { status: response.status, code: body?.error?.code, retryable: body?.error?.retryable, requestId: body?.error?.requestId, upstreamCalls: body?.error?.upstreamCalls };
    throw error;
  }
  return body;
}

/** 依次执行创建、大纲确认和逐场景生成；单个业务阶段不做额外手动重试。 */
async function generateCourse(baseUrl, topic, sceneCount) {
  const created = await requestJson(baseUrl, "/api/courses", { method: "POST", body: JSON.stringify({ topic: topic.prompt, requestedSceneCount: sceneCount }) });
  let course = created.course;
  const collectionErrors = [];
  try {
    course = (await requestJson(baseUrl, `/api/courses/${course.id}/outline/generate`, { method: "POST", body: JSON.stringify({ expectedRevision: course.revision }) })).data.course;
    course = (await requestJson(baseUrl, `/api/courses/${course.id}/outline`, { method: "PATCH", body: JSON.stringify({ expectedRevision: course.revision, courseTitle: course.title, outlines: course.outlines }) })).data.course;
    for (const outline of course.outlines) {
      try {
        course = (await requestJson(baseUrl, `/api/courses/${course.id}/scenes/${outline.id}/generate`, { method: "POST", body: JSON.stringify({ expectedRevision: course.revision }) })).data.course;
      } catch (error) {
        course = (await requestJson(baseUrl, `/api/courses/${course.id}`)).course;
        collectionErrors.push({ stage: "scene", order: outline.order, message: error.message, details: error.details ?? null });
      }
    }
  } catch (error) {
    course = (await requestJson(baseUrl, `/api/courses/${course.id}`)).course;
    collectionErrors.push({ stage: course.outlines.length ? "outline-confirmation" : "outline", message: error.message, details: error.details ?? null });
  }
  return { course, collectionErrors };
}

/** 保存可续跑检查点；完成报告落盘后会删除它，避免最终目录重复。 */
async function writeProgress(outputRoot, base, results) {
  await writeFile(path.join(outputRoot, "progress.json"), `${JSON.stringify({ ...base, results }, null, 2)}\n`, "utf8");
}

/** 主流程先做纯文件校验，只有显式运行基线时才创建课程并产生模型费用。 */
async function main() {
  const validateOnly = process.argv.includes("--validate-only");
  const smokeMock = process.argv.includes("--smoke-mock");
  const dataset = parseEvaluationDataset(await readJson(datasetPath), !validateOnly && !smokeMock);
  if (validateOnly) {
    process.stdout.write(`M7.0 ${dataset.status} dataset valid: ${dataset.topics.length} topics\n`);
    return;
  }

  const baseUrl = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
  const config = await requestJson(baseUrl, "/api/health/config");
  if (smokeMock) {
    if (config.status !== "ok" || config.mode !== "mock") throw new Error("采集器 smoke 只允许连接明确的 mock 服务；未创建任何课程");
  } else if (config.status !== "ok" || config.mode !== "remote" || config.provider !== "deepseek") {
    throw new Error("M7.0 正式基线要求当前服务明确运行在 remote + deepseek；未创建任何课程");
  }

  const resumeDirectory = process.env.EVAL_RESUME_RUN ? path.resolve(workspace, process.env.EVAL_RESUME_RUN) : null;
  const runId = resumeDirectory ? path.basename(resumeDirectory) : new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const outputRoot = resumeDirectory ?? path.resolve(workspace, process.env.EVAL_OUTPUT_DIR ?? path.join("eval", smokeMock ? ".tmp" : path.join("runs", "baseline-v0.3")), runId);
  await mkdir(outputRoot, { recursive: true });
  const reportBase = {
    version: "course-quality-run.v2",
    runType: smokeMock ? "collector_smoke_mock" : "baseline_v0_3_deepseek",
    runId,
    createdAt: new Date().toISOString(),
    datasetVersion: dataset.version,
    frozenAt: dataset.frozenAt,
    evidenceFormat: "mhtml",
    server: { baseUrl, provider: config.provider, model: config.model, mode: config.mode },
    runPolicy: dataset.generationPolicy,
  };
  let results = [];
  if (resumeDirectory) {
    const progress = await readJson(path.join(outputRoot, "progress.json"));
    if (progress.version !== reportBase.version || progress.datasetVersion !== dataset.version || progress.frozenAt !== dataset.frozenAt) throw new Error("续跑目录的评价集版本或 frozenAt 不一致");
    if (progress.server?.provider !== config.provider || progress.server?.model !== config.model || progress.server?.mode !== config.mode) throw new Error("续跑必须使用与原运行相同的 mode、Provider 和模型");
    results = progress.results;
  }

  const browser = await chromium.launch();
  try {
    const completedTopicIds = new Set(results.map((result) => result.topicId));
    const topics = (smokeMock ? dataset.topics.slice(0, 1) : dataset.topics).filter((topic) => !completedTopicIds.has(topic.id));
    for (const topic of topics) {
      process.stdout.write(`Collecting ${topic.id}...\n`);
      const startedAt = Date.now();
      // mock 仅验证采集链，使用短标题避免测试数据影响正式冻结输入。
      const generationTopic = smokeMock ? { ...topic, prompt: `${topic.title}（采集器 smoke）` } : topic;
      const generated = await generateCourse(baseUrl, generationTopic, dataset.sceneCount);
      const collectionErrors = [...generated.collectionErrors];
      let sceneArchives = [];
      try {
        sceneArchives = await captureCourseSceneArchives(browser, baseUrl, generated.course, path.join(outputRoot, "scenes", topic.id));
      } catch (error) {
        collectionErrors.push({ stage: "archive", message: error instanceof Error ? error.message : String(error), details: null });
      } finally {
        if (smokeMock || process.env.EVAL_DELETE_COURSES === "1") await fetch(new URL(`/api/courses/${generated.course.id}`, baseUrl), { method: "DELETE" });
      }
      results.push({ topicId: topic.id, category: topic.category, durationMs: Date.now() - startedAt, course: sanitizeCourse(generated.course), collectionErrors, sceneArchives });
      await writeProgress(outputRoot, reportBase, results);
    }
  } finally {
    await browser.close();
  }

  const report = { ...reportBase, results };
  await writeFile(path.join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputRoot, "summary.md"), createSummaryMarkdown(report), "utf8");
  if (smokeMock) {
    const result = results[0];
    if (result?.course.status !== "ready" || result.collectionErrors.length > 0 || result.sceneArchives.length !== result.course.scenes.length) {
      throw new Error(`采集器 smoke 未形成完整 ready 课程和逐场景 MHTML；失败报告保留在 ${outputRoot}`);
    }
    await rm(outputRoot, { recursive: true, force: true });
    process.stdout.write("M7.0 collector smoke passed; temporary archives cleaned\n");
    return;
  }
  await rm(path.join(outputRoot, "progress.json"), { force: true });
  process.stdout.write(`M7.0 baseline written to ${outputRoot}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
