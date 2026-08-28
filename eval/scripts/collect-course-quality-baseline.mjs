import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";
import { analyzeLegacySlide, createHumanScoreTemplate, parseEvaluationInputs } from "./course-quality-lib.mjs";

const workspace = process.cwd();
const datasetPath = path.join(workspace, "eval", "config", "course-quality.v1.json");
const densityPath = path.join(workspace, "eval", "config", "slide-density.v1.json");

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

/** 从持久化 Course 中只提取评价需要的公开内容和生成元数据。 */
function sanitizeCourse(course) {
  return {
    courseId: course.id,
    schemaVersion: course.schemaVersion,
    title: course.title,
    status: course.status,
    revision: course.revision,
    requestedSceneCount: course.requestedSceneCount,
    outlineGeneration: course.outlineGeneration,
    outlines: course.outlines.map(({ type, title, teachingObjective, keyPoints, order, estimatedMinutes }) => ({ type, title, teachingObjective, keyPoints, order, estimatedMinutes })),
    scenes: course.scenes.map((scene) => ({
      type: scene.type,
      title: scene.title,
      summary: scene.summary,
      order: scene.order,
      content: scene.content,
      narration: scene.actions.find((action) => action.type === "speech")?.text ?? "",
      generation: scene.generation,
    })),
    sceneProgress: course.sceneProgress.map(({ status, attempts, lastError }) => ({ status, attempts, lastError })),
  };
}

/** 收集 slide surface 及关键容器的实际尺寸；M7.0 只观察，不阻塞保存。 */
async function collectDomMetrics(page, tolerancePx) {
  return page.evaluate((tolerance) => {
    const selectors = [".classroom-stage", ".scene-heading", "[data-testid='slide-renderer']", ".lesson-blocks"];
    const containers = selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return { selector, missing: true };
      return {
        selector,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        horizontalOverflow: element.scrollWidth > element.clientWidth + tolerance,
        verticalOverflow: element.scrollHeight > element.clientHeight + tolerance,
      };
    });
    const textElements = [...document.querySelectorAll("[data-testid='slide-renderer'] p, [data-testid='slide-renderer'] li, [data-testid='slide-renderer'] figcaption")]
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null);
    const fontSizes = textElements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)).filter(Number.isFinite);
    return {
      containers,
      minimumVisibleTextFontPx: fontSizes.length ? Math.min(...fontSizes) : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageScroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    };
  }, tolerancePx);
}

/** 使用相同课堂数据分别保存桌面和窄屏证据。 */
async function captureSlideEvidence(browser, baseUrl, course, topicDirectory, density) {
  const evidence = [];
  const slides = course.scenes.filter((scene) => scene.type === "slide").sort((left, right) => left.order - right.order);
  for (const viewport of density.viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const browserErrors = [];
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    try {
      const navigation = await page.goto(new URL(`/classroom/${course.id}`, baseUrl).href, { waitUntil: "networkidle" });
      if (!navigation?.ok()) throw new Error(`课堂页面返回 ${navigation?.status() ?? "unknown"}`);
      await page.locator("nav.scene-rail").waitFor({ state: "attached" });
      let currentOrder = 1;
      for (const scene of slides) {
        if (viewport.id === "desktop") {
          await page.getByRole("button", { name: new RegExp(`打开场景 ${scene.order}`) }).click();
        } else {
          // 窄屏按产品真实交互隐藏左侧场景栏，使用底部“下一场景”顺序经过 quiz。
          while (currentOrder < scene.order) {
            await page.locator(".classroom-controls .control-button").last().click();
            currentOrder += 1;
            await page.waitForFunction((order) => document.querySelector(".scene-heading .eyebrow")?.textContent?.includes(`SCENE ${String(order).padStart(2, "0")}`), currentOrder);
          }
        }
        await page.getByTestId("slide-renderer").waitFor();
        await page.evaluate(() => window.scrollTo(0, 0));
        const filename = `${String(scene.order).padStart(2, "0")}-${viewport.id}.png`;
        await page.screenshot({ path: path.join(topicDirectory, filename), fullPage: false });
        evidence.push({ sceneOrder: scene.order, viewport: viewport.id, screenshot: filename, dom: await collectDomMetrics(page, density.domOverflowRule.tolerancePx) });
      }
    } catch (error) {
      const errorScreenshot = `visual-error-${viewport.id}.png`;
      await page.screenshot({ path: path.join(topicDirectory, errorScreenshot), fullPage: false });
      const bodyText = await page.locator("body").innerText().catch(() => "");
      throw new Error(`${error instanceof Error ? error.message : String(error)}；url=${page.url()}；body=${bodyText.slice(0, 500)}；browserErrors=${browserErrors.join(" | ")}；screenshot=${errorScreenshot}`);
    } finally {
      await context.close();
    }
  }
  return evidence;
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

/** 主流程先完成纯文件校验；只有显式运行基线时才检查远端配置并创建课程。 */
async function main() {
  const validateOnly = process.argv.includes("--validate-only");
  const smokeMock = process.argv.includes("--smoke-mock");
  const inputs = parseEvaluationInputs(await readJson(datasetPath), await readJson(densityPath), !validateOnly && !smokeMock);
  if (validateOnly) {
    process.stdout.write(`M7.0 ${inputs.dataset.status} protocol valid: ${inputs.dataset.topics.length} topics, ${inputs.density.viewports.length} viewports\n`);
    return;
  }

  const baseUrl = process.env.EVAL_BASE_URL ?? "http://127.0.0.1:3000";
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
  const browser = await chromium.launch();
  let results = [];
  if (resumeDirectory) {
    const progress = await readJson(path.join(outputRoot, "progress.json"));
    if (progress.datasetVersion !== inputs.dataset.version || progress.densityPolicyVersion !== inputs.density.version || progress.frozenAt !== inputs.dataset.frozenAt) {
      throw new Error("续跑目录的评价集、密度协议或 frozenAt 与当前冻结版本不一致");
    }
    if (progress.server?.provider !== config.provider || progress.server?.model !== config.model || progress.server?.mode !== config.mode) {
      throw new Error("续跑必须使用与原运行相同的 mode、Provider 和模型");
    }
    results = progress.results;
  }
  try {
    const completedTopicIds = new Set(results.map((result) => result.topicId));
    const topics = (smokeMock ? inputs.dataset.topics.slice(0, 1) : inputs.dataset.topics).filter((topic) => !completedTopicIds.has(topic.id));
    for (const topic of topics) {
      process.stdout.write(`Collecting ${topic.id}...\n`);
      const topicDirectory = path.join(outputRoot, "evidence", topic.id);
      await mkdir(topicDirectory, { recursive: true });
      const startedAt = Date.now();
      // mock 会把主题原文直接拼入标题；smoke 使用短标题只验证采集链，不改变正式基线输入。
      const generationTopic = smokeMock ? { ...topic, prompt: `${topic.title}（采集器 smoke）` } : topic;
      const generated = await generateCourse(baseUrl, generationTopic, inputs.dataset.sceneCount);
      const slideReports = generated.course.scenes.filter((scene) => scene.type === "slide").map((scene) => ({ sceneOrder: scene.order, report: analyzeLegacySlide(scene, inputs.density) }));
      const collectionErrors = [...generated.collectionErrors];
      let visualEvidence = [];
      try {
        visualEvidence = generated.course.scenes.some((scene) => scene.type === "slide") ? await captureSlideEvidence(browser, baseUrl, generated.course, topicDirectory, inputs.density) : [];
      } catch (error) {
        collectionErrors.push({ stage: "visual", message: error instanceof Error ? error.message : String(error), details: null });
      } finally {
        if (smokeMock || process.env.EVAL_DELETE_COURSES === "1") await fetch(new URL(`/api/courses/${generated.course.id}`, baseUrl), { method: "DELETE" });
      }
      results.push({ topicId: topic.id, category: topic.category, durationMs: Date.now() - startedAt, course: sanitizeCourse(generated.course), collectionErrors, slideReports, visualEvidence });
      // 每个主题结束后立即保存检查点，避免后续故障丢失已经产生费用的证据。
      await writeFile(path.join(outputRoot, "progress.json"), `${JSON.stringify({
        version: "course-quality-run.v1",
        runId,
        runType: smokeMock ? "collector_smoke_mock" : "baseline_v0_3_deepseek",
        createdAt: new Date().toISOString(),
        datasetVersion: inputs.dataset.version,
        densityPolicyVersion: inputs.density.version,
        frozenAt: inputs.dataset.frozenAt,
        server: { baseUrl, provider: config.provider, model: config.model, mode: config.mode },
        runPolicy: inputs.dataset.generationPolicy,
        results,
      }, null, 2)}\n`, "utf8");
    }
  } finally {
    await browser.close();
  }

  const report = {
    version: "course-quality-run.v1",
    runType: smokeMock ? "collector_smoke_mock" : "baseline_v0_3_deepseek",
    runId,
    createdAt: new Date().toISOString(),
    datasetVersion: inputs.dataset.version,
    densityPolicyVersion: inputs.density.version,
    frozenAt: inputs.dataset.frozenAt,
    server: { baseUrl, provider: config.provider, model: config.model, mode: config.mode },
    runPolicy: inputs.dataset.generationPolicy,
    results,
  };
  await writeFile(path.join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputRoot, "scores.json"), `${JSON.stringify(createHumanScoreTemplate(runId, smokeMock ? inputs.dataset.topics.slice(0, 1) : inputs.dataset.topics, results), null, 2)}\n`, "utf8");
  if (smokeMock) {
    const smokeResult = results[0];
    if (smokeResult?.course.status !== "ready" || smokeResult.collectionErrors.length > 0 || smokeResult.visualEvidence.length === 0) {
      throw new Error(`采集器 smoke 未形成 ready 课程和双视口证据；失败报告保留在 ${outputRoot}`);
    }
    // smoke 只验证采集链；成功后清理临时截图，避免与正式基线混在一起。
    await rm(outputRoot, { recursive: true, force: true });
    process.stdout.write("M7.0 collector smoke passed; temporary evidence cleaned\n");
    return;
  }
  process.stdout.write(`M7.0 baseline written to ${outputRoot}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
