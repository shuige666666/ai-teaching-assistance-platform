import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const workspace = process.cwd();
const runDirectory = path.resolve(workspace, process.argv[2] ?? "");

function countUpstreamCalls(result) {
  const successfulCalls = (result.course.outlineGeneration?.upstreamCalls ?? 0)
    + result.course.scenes.reduce((total, scene) => total + (scene.generation?.upstreamCalls ?? 0), 0);
  const failedCalls = result.collectionErrors
    .filter((error) => error.stage === "scene")
    .reduce((total, error) => total + (error.details?.upstreamCalls ?? 0), 0);
  return { successfulCalls, failedCalls, totalCalls: successfulCalls + failedCalls };
}

function summarizeResult(result) {
  const calls = countUpstreamCalls(result);
  const density = { pass: 0, warning: 0, fail: 0 };
  for (const entry of result.slideReports) density[entry.report.densityStatus] += 1;
  const overflowEvidence = result.visualEvidence.filter((evidence) =>
    evidence.dom?.containers?.some((container) => container.horizontalOverflow || container.verticalOverflow),
  );
  return {
    topicId: result.topicId,
    courseId: result.course.courseId,
    title: result.course.title,
    status: result.course.status,
    savedScenes: result.course.scenes.length,
    requestedScenes: result.course.requestedSceneCount,
    durationMs: result.durationMs,
    ...calls,
    repairedSavedScenes: result.course.scenes.filter((scene) => scene.generation?.repaired).length,
    density,
    visualEvidence: result.visualEvidence.length,
    overflowEvidence: overflowEvidence.map((evidence) => ({ sceneOrder: evidence.sceneOrder, viewport: evidence.viewport })),
    errors: result.collectionErrors,
  };
}

function createMarkdown(report, summary) {
  const rows = summary.courses.map((course) => {
    const overflow = course.overflowEvidence.length === 0
      ? "0"
      : course.overflowEvidence.map((item) => `${item.sceneOrder}/${item.viewport}`).join("、");
    return `| ${course.topicId} | ${course.status} | ${course.savedScenes}/${course.requestedScenes} | ${course.totalCalls} | ${course.density.pass}/${course.density.warning}/${course.density.fail} | ${overflow} |`;
  });
  return `# M7.0 DeepSeek v0.3 基线验收摘要

> 运行 ID：\`${report.runId}\`  
> 协议冻结时间：\`${report.frozenAt}\`  
> 模式：\`${report.server.mode} / ${report.server.provider} / ${report.server.model}\`

## 自动证据摘要

- 课程完成：${summary.readyCourses}/${summary.courseCount} 为 \`ready\`，${summary.partialFailedCourses}/${summary.courseCount} 为 \`partial_failed\`。
- 场景保存：${summary.savedScenes}/${summary.requestedScenes}；上游调用 ${summary.totalUpstreamCalls} 次，其中失败场景消耗 ${summary.failedSceneUpstreamCalls} 次。
- 生成元数据可追溯 token：输入 ${summary.recordedInputTokens}，输出 ${summary.recordedOutputTokens}；失败请求未持久化 token，不计入该合计。
- slide 密度：pass/warning/fail = ${summary.density.pass}/${summary.density.warning}/${summary.density.fail}。
- 截图 ${summary.visualEvidence} 张；发现 ${summary.overflowEvidence} 张存在容器溢出，这些都是窄屏基线问题，不应在 M7.0 中修改 CSS。

| 主题 | 状态 | 场景 | 调用 | 密度 P/W/F | 溢出场景/视口 |
| --- | --- | ---: | ---: | ---: | --- |
${rows.join("\n")}

## 你需要完成的人工验收

1. 依次打开每个主题目录中的 desktop/narrow 截图，再通过课程 ID 打开实际课堂，阅读可见内容、narration 和 quiz。
2. 按 \`eval/README.md\` 中的七维量表给 1～5 分，填写 \`scores.json\`；不确定时写原因，不要默认填 3。
3. 两门 \`partial_failed\` 课程必须按当前缺失状态评分，不要手动重试或删除；这正是 v0.3 基线的完成率证据。
4. 如发现会误导学习者的核心事实错误，设置 \`criticalError=true\` 并记录主题、场景序号和理由。

人工分数完成后，M7.0 才能视为完成；本轮结果只是 v0.3 基线，不对冻结阈值作达标判定。
`;
}

async function main() {
  if (!process.argv[2]) throw new Error("请传入基线运行目录，例如 eval/runs/baseline-v0.3/<runId>");
  const report = JSON.parse(await readFile(path.join(runDirectory, "report.json"), "utf8"));
  const courses = report.results.map(summarizeResult);
  const generations = report.results.flatMap((result) => [result.course.outlineGeneration, ...result.course.scenes.map((scene) => scene.generation)]).filter(Boolean);
  const summary = {
    version: "course-quality-summary.v1",
    runId: report.runId,
    readyCourses: courses.filter((course) => course.status === "ready").length,
    partialFailedCourses: courses.filter((course) => course.status === "partial_failed").length,
    courseCount: courses.length,
    savedScenes: courses.reduce((total, course) => total + course.savedScenes, 0),
    requestedScenes: courses.reduce((total, course) => total + course.requestedScenes, 0),
    totalUpstreamCalls: courses.reduce((total, course) => total + course.totalCalls, 0),
    failedSceneUpstreamCalls: courses.reduce((total, course) => total + course.failedCalls, 0),
    recordedInputTokens: generations.reduce((total, generation) => total + (generation.usage?.inputTokens ?? 0), 0),
    recordedOutputTokens: generations.reduce((total, generation) => total + (generation.usage?.outputTokens ?? 0), 0),
    density: courses.reduce((total, course) => ({ pass: total.pass + course.density.pass, warning: total.warning + course.density.warning, fail: total.fail + course.density.fail }), { pass: 0, warning: 0, fail: 0 }),
    visualEvidence: courses.reduce((total, course) => total + course.visualEvidence, 0),
    overflowEvidence: courses.reduce((total, course) => total + course.overflowEvidence.length, 0),
    courses,
  };
  const scoreTemplate = JSON.parse(await readFile(path.join(runDirectory, "scores.json"), "utf8"));
  const resultByTopic = new Map(courses.map((course) => [course.topicId, course]));
  const workingScores = {
    ...scoreTemplate,
    courses: scoreTemplate.courses.map((entry) => {
      const course = resultByTopic.get(entry.topicId);
      return {
        ...entry,
        courseId: course?.courseId ?? null,
        title: course?.title ?? null,
        status: course?.status ?? null,
        savedScenes: course?.savedScenes ?? null,
        requestedScenes: course?.requestedScenes ?? null,
      };
    }),
  };
  // 一份人类可读摘要配一份评分表，原始机器证据统一留在 report.json。
  await writeFile(path.join(runDirectory, "summary.md"), createMarkdown(report, summary), "utf8");
  await writeFile(path.join(runDirectory, "scores.json"), `${JSON.stringify(workingScores, null, 2)}\n`, "utf8");
  process.stdout.write(`M7.0 summary written to ${runDirectory}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
