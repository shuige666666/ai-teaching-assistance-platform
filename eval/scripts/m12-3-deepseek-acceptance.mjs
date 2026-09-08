import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const baseUrl = process.env.EVAL_BASE_URL ?? "http://localhost:3100";
const courseId = process.argv[2];
const runName = process.argv[3] ?? "m12-3-real-deepseek";
const selectedCases = new Set((process.argv[4] ?? "query,search,move,patch,add,regenerate-slide,regenerate-interactive,regenerate-quiz,delete-cancel").split(",").filter(Boolean));
if (!courseId) {
  console.error("用法：node eval/scripts/m12-3-deepseek-acceptance.mjs <courseId> [runName] [case1,case2,...]");
  process.exit(1);
}

const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z");
const runDirectory = path.resolve(process.cwd(), "eval/runs", runName, timestamp);

async function requestJson(endpoint, init = {}) {
  const response = await fetch(new URL(endpoint, baseUrl), { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${endpoint} ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function readSse(response) {
  if (!response.ok) throw new Error(`SSE ${response.status}: ${await response.text()}`);
  if (!response.body) throw new Error("SSE 响应没有 body");
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  const consume = (block) => {
    const data = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
    if (!data) return;
    try { events.push(JSON.parse(data)); } catch { events.push({ type: "invalid_event", data }); }
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    blocks.forEach(consume);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  return events;
}

async function getCourse() {
  return (await requestJson(`/api/courses/${courseId}`)).course;
}

async function getSession(sessionId) {
  return (await requestJson(`/api/courses/${courseId}/agent/sessions/${sessionId}`)).data;
}

function sceneSummary(course) {
  return course.scenes.map((scene) => ({ id: scene.id, order: scene.order, type: scene.type, title: scene.title, outlineId: scene.outlineId }));
}

function courseSummary(course) {
  return { id: course.id, title: course.title, status: course.status, revision: course.revision, requestedSceneCount: course.requestedSceneCount, scenes: sceneSummary(course) };
}

function truncate(value, limit = 8_000) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return text;
  return text.length <= limit ? value : `${text.slice(0, limit)}…[truncated ${text.length - limit} chars]`;
}

function compactEvents(events) {
  const thinking = events.filter((event) => event.type === "thinking_delta").map((event) => event.delta ?? "").join("");
  const text = events.filter((event) => event.type === "text_delta").map((event) => event.delta ?? "").join("");
  return {
    eventTypes: events.map((event) => event.type),
    thinkingChars: thinking.length,
    thinkingPreview: thinking.slice(0, 1_000),
    text,
    runFinished: events.findLast((event) => event.type === "run_finished") ?? null,
    courseUpdates: events.filter((event) => event.type === "course_updated"),
    confirmations: events.filter((event) => event.type === "confirmation_required").map((event) => ({ block: event.block, summary: event.summary })),
    tools: events.filter((event) => event.type === "tool_started" || event.type === "tool_finished").map((event) => ({
      lifecycle: event.type === "tool_started" ? "started" : "finished",
      name: event.block?.name,
      label: event.block?.label,
      status: event.block?.status,
      callId: event.block?.callId,
      arguments: event.block?.arguments,
      result: truncate(event.block?.result),
      durationMs: event.block?.durationMs,
      confirmationId: event.block?.confirmationId,
    })),
  };
}

async function postMessage(sessionId, text, currentSceneId, courseRevision) {
  const response = await fetch(new URL(`/api/courses/${courseId}/agent/sessions/${sessionId}/messages`, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, currentSceneId, courseRevision }),
  });
  return readSse(response);
}

async function confirm(sessionId, confirmationId, decision) {
  const response = await fetch(new URL(`/api/courses/${courseId}/agent/sessions/${sessionId}/confirm`, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmationId, decision }),
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) return { kind: "sse", events: await readSse(response) };
  const body = await response.json();
  if (!response.ok) throw new Error(`confirm ${response.status}: ${JSON.stringify(body)}`);
  return { kind: "json", body };
}

async function writeCase(name, prompt, before, events, after, extra = {}) {
  const directory = path.join(runDirectory, name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "events.json"), `${JSON.stringify({ prompt, ...compactEvents(events), ...extra }, null, 2)}\n`, "utf8");
  await writeFile(path.join(directory, "before.json"), `${JSON.stringify(before, null, 2)}\n`, "utf8");
  await writeFile(path.join(directory, "after.json"), `${JSON.stringify(after, null, 2)}\n`, "utf8");
  return { name, prompt, beforeRevision: before.revision, afterRevision: after.revision, beforeScenes: before.scenes, afterScenes: after.scenes, eventTypes: events.map((event) => event.type), tools: compactEvents(events).tools.map((tool) => ({ name: tool.name, status: tool.status })), runFinished: compactEvents(events).runFinished, ...extra };
}

const sessionCreate = await requestJson(`/api/courses/${courseId}/agent/sessions`, { method: "POST", body: JSON.stringify({}) });
const sessionId = sessionCreate.data.session.id;
const secondSessionCreate = await requestJson(`/api/courses/${courseId}/agent/sessions`, { method: "POST", body: JSON.stringify({}) });
const sessionsAfterCreate = await requestJson(`/api/courses/${courseId}/agent/sessions`);
const results = [];

async function runCase(name, prompt, options = {}) {
  if (!selectedCases.has(name)) return;
  const beforeCourse = await getCourse();
  const currentSceneId = beforeCourse.scenes.find((scene) => scene.order === 2)?.id ?? beforeCourse.scenes[0]?.id;
  const events = await postMessage(sessionId, prompt, currentSceneId, beforeCourse.revision);
  const confirmations = events.filter((event) => event.type === "confirmation_required");
  let confirmationResult;
  if (confirmations.length && options.confirmDecision) {
    const confirmationId = confirmations.at(-1).block?.confirmationId;
    if (confirmationId) confirmationResult = await confirm(sessionId, confirmationId, options.confirmDecision);
  }
  const afterCourse = await getCourse();
  const result = await writeCase(name, prompt, courseSummary(beforeCourse), events, courseSummary(afterCourse), { confirmationResult: truncate(confirmationResult), sessionId, sessionsAfterCreate: sessionsAfterCreate.data?.sessions?.map((session) => ({ id: session.id, status: session.status, title: session.title })) });
  results.push(result);
  console.log(JSON.stringify({ case: name, beforeRevision: result.beforeRevision, afterRevision: result.afterRevision, tools: result.tools, finished: result.runFinished, confirmation: Boolean(confirmations.length) }));
}

await runCase("query", "请先检查当前课堂页面列表，然后回答当前课程一共有多少页，并列出第 2 页的标题。不要修改课程。只需要回答，不要调用写工具。");
await runCase("search", "请在当前课程中搜索“URL”，列出命中的页面顺序和标题。不要修改课程。");
await runCase("move", "请先检查当前课堂，把当前第 3 页移动到第 2 页。只做这个页序调整，完成后告诉我新的页面顺序。");
await runCase("patch", "请先读取标题为《URL 里到底藏着什么》的页面源码，然后只做一次最小 str_replace：把可见文本 `协议 + 域名 + 端口 + 路径` 精确替换为 `协议 + 域名 + 端口 + 路径（已复核）`。不要修改其它字段，不要询问澄清；使用编辑课堂工具完成后，再读取该页确认修改已经保存。");
await runCase("add", "请先检查当前课堂，然后在课程末尾新增一页 slide，标题为《请求链路小结（验收）》，包含三条简短要点，总结从 URL 解析到 TCP 连接的关键步骤。新增完成后告诉我页码。");
await runCase("regenerate-slide", "请先读取《打不开网页的困惑》这一页，然后重新生成这一页：保持主题和页标题不变，但让讲解更突出 DNS 解析与 TCP 连接的衔接。使用生成页面工具完成后告诉我结果。");
await runCase("regenerate-interactive", "请先读取《DNS 寻址工作台》这一页，然后重新生成这个 interactive 页面：保持 interactive 类型和 DNS 主题，增加清晰的操作反馈说明。使用生成页面工具完成后告诉我结果。");
await runCase("regenerate-quiz", "请先读取《链路知识闯关检测》这一页，然后重新生成这页测验：保留访问网址链路主题，优化题干和解析。需要用户确认时先停下，不要自行确认。", { confirmDecision: process.argv.includes("--confirm-quiz") ? "confirm" : undefined });
await runCase("delete-cancel", "请先检查当前课堂，准备删除标题为《请求链路小结（验收）》的页面；到达确认步骤后停下，不要直接执行删除。", { confirmDecision: "cancel" });

const finalCourse = await getCourse();
const finalSession = await getSession(sessionId);
const report = {
  version: "m12-3-deepseek-acceptance.v1",
  createdAt: new Date().toISOString(),
  baseUrl,
  courseId,
  sessionId,
  secondSessionId: secondSessionCreate.data.session.id,
  selectedCases: [...selectedCases],
  finalCourse: courseSummary(finalCourse),
  session: { id: finalSession.session.id, status: finalSession.session.status, messageCount: finalSession.messages.length, latestRun: finalSession.latestRun, context: finalSession.context, pendingConfirmations: finalSession.pendingConfirmations },
  results,
};
await mkdir(runDirectory, { recursive: true });
await writeFile(path.join(runDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(path.join(runDirectory, "summary.md"), [
  `# M12.3 真实 DeepSeek 验收（${timestamp}）`,
  "",
  `- 课程副本：${courseId}`,
  `- 主会话：${sessionId}`,
  `- 第二会话：${secondSessionCreate.data.session.id}`,
  `- 最终 revision：${finalCourse.revision}`,
  `- 最终页面：${finalCourse.scenes.map((scene) => `${scene.order}.${scene.type}.${scene.title}`).join("；")}`,
  "",
  "## 案例结果",
  ...results.map((result) => `- ${result.name}：REV.${result.beforeRevision} → REV.${result.afterRevision}；工具 ${result.tools.map((tool) => `${tool.name}/${tool.status}`).join(", ") || "无"}；结束 ${result.runFinished?.status ?? "未知"}`),
  "",
  "工具与模型内容详见各案例目录的 events.json；页面前后结构详见 before.json/after.json。该记录只证明调用链、持久化和结构变化，不替代人工判断教学内容与互动逻辑质量。",
].join("\n") + "\n", "utf8");
console.log(`完成：${path.relative(process.cwd(), runDirectory)}`);
