import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// 显式授权才调用付费模型；只创建本次样例，不修改已有课程或冻结基线。
if (!process.argv.includes("--run-remote")) throw new Error("需要 --run-remote 明确允许真实模型调用");
const baseUrl = process.env.EVAL_BASE_URL || "http://127.0.0.1:3101";
const runDir = path.resolve("eval/runs/m9-diversity-v0.4", new Date().toISOString().replaceAll(":", "-"));
await mkdir(runDir, { recursive: true });
const report = { startedAt: new Date().toISOString(), baseUrl, courses: [] };

/** 走正式 API 保存生成事实，失败时不以手工 HTML 替代模型结果。 */
async function api(url, method = "GET", data) {
  const response = await fetch(baseUrl + url, { method, headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(180000) });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify({ status: response.status, ...body }));
  return body.course ?? body.data?.course ?? body;
}
const health = await api("/api/health/config");
if (health.provider !== "deepseek" || health.mode !== "remote") throw new Error("验证服务必须显式使用 remote DeepSeek");
report.model = health.model;
console.log(JSON.stringify({ runDir, model: health.model }));
const cases = [
  { topic: "Agent 开发实验：工具调用与决策循环。面向有 Python 基础的学生，恰好安排两个互动：一个改变工具失败率与重试上限观察 Agent 决策的 simulation，一个补全 Python 工具路由函数并运行测试的 code。其余场景用 slide 讲解和 quiz 检查。", types: ["simulation", "code"] },
  { topic: "Agent 工具调度与数据救援。恰好安排两个互动：一个 diagram 通过条件选择追踪不同工具调用路径，一个 game 让学生在有限预算下选择读取、校验、修复和保存工具救回数据。其余场景用 slide 讲解和 quiz 检查。", types: ["diagram", "game"] },
];
for (const item of cases) {
  const entry = { requestedTypes: item.types, stages: [] };
  report.courses.push(entry);
  try {
    let course = await api("/api/courses", "POST", { topic: item.topic, requestedSceneCount: 6, briefOverrides: { interactionMode: "required" } });
    entry.courseId = course.id;
    course = await api(`/api/courses/${course.id}/outline/generate`, "POST", { expectedRevision: course.revision });
    entry.outlineGeneration = course.outlineGeneration;
    entry.outlines = course.outlines;
    console.log(JSON.stringify({ courseId: course.id, outlines: course.outlines.map(o => ({ order:o.order, type:o.type, widgetType:o.widgetType, design:o.widgetOutline })) }));
    for (const outline of course.outlines) {
      try {
        course = await api(`/api/courses/${course.id}/scenes/${outline.id}/generate`, "POST", { expectedRevision: course.revision });
        const scene = course.scenes.find(s => s.outlineId === outline.id);
        entry.stages.push({ order: outline.order, type: scene.type, widgetType: scene.content.widgetType, title: scene.title, generation: scene.generation });
      } catch (error) {
        entry.stages.push({ order: outline.order, failure: String(error) });
        course = await api(`/api/courses/${course.id}`);
      }
      entry.status = course.status;
      console.log(JSON.stringify({ courseId:course.id, stage:entry.stages.at(-1) }));
      await writeFile(path.join(runDir,"report.json"), JSON.stringify(report,null,2));
    }
  } catch (error) { entry.failure = String(error); }
  await writeFile(path.join(runDir,"report.json"), JSON.stringify(report,null,2));
}
console.log(JSON.stringify({ runDir, courses:report.courses.map(c=>({id:c.courseId,status:c.status,failure:c.failure})) }));
