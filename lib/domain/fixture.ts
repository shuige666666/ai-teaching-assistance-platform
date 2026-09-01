import { randomUUID } from "node:crypto";
import type { Course, GenerationMetadata, Scene, SceneOutline } from "./schemas";
import { CourseSchema, CURRENT_SCHEMA_VERSION } from "./schemas";
import { createProvisionalCourseBrief, type CourseBriefOverrides } from "./course-brief";

/** 从原始课程描述派生草稿标题；完整描述仍保存在 topic，不能因标题上限丢失。 */
function deriveDraftTitle(topic: string, maxLength: number = 120) {
  let title = "";
  for (const character of topic) {
    if ((title + character).length > maxLength) break;
    title += character;
  }
  return title;
}

/** 创建尚未调用模型的课程草稿，并记录用户显式设置和默认值的来源。 */
export function createCourseDraft(topic: string, requestedSceneCount: number, briefOverrides: CourseBriefOverrides = {}): Course {
  const normalizedTopic = topic.trim();
  const parsedCount = Math.min(8, Math.max(4, Math.trunc(requestedSceneCount)));
  const now = Date.now();
  const { brief, resolution } = createProvisionalCourseBrief(normalizedTopic, briefOverrides);
  return CourseSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    topic: normalizedTopic,
    title: deriveDraftTitle(normalizedTopic),
    requestedSceneCount: parsedCount,
    status: "draft",
    revision: 0,
    brief,
    briefResolution: resolution,
    outlines: [],
    scenes: [],
    sceneProgress: [],
    createdAt: now,
    updatedAt: now,
  });
}

function mockMetadata(now: number): GenerationMetadata {
  return { provider: "mock", model: "fixture-v1", promptVersion: "m1-fixture", requestId: randomUUID(), durationMs: 0, upstreamCalls: 0, repaired: false, generatedAt: now };
}

/** 创建仅包含已确认大纲的固定课程，模拟真实管线进入场景生成前的边界。 */
export function createFixtureCourse(topic: string, requestedSceneCount: number): Course {
  const normalizedTopic = topic.trim();
  const parsedCount = Math.min(8, Math.max(4, Math.trunc(requestedSceneCount)));
  const now = Date.now();
  const titles = ["建立问题地图", "拆解核心机制", "检查关键理解", "连接工程实践", "形成复习路径", "分析边界条件", "整合应用路径", "形成复习闭环"];
  const outlines: SceneOutline[] = Array.from({ length: parsedCount }, (_, index) => {
    const type = index === 2 ? ("quiz" as const) : ("slide" as const);
    const role: SceneOutline["role"] = type === "quiz"
      ? "assessment"
      : index === 0
        ? "hook"
        : index === parsedCount - 1
          ? "summary"
          : index === 1
            ? "mechanism"
            : "worked_example";
    return {
      id: randomUUID(), type, role, title: titles[index], order: index + 1, estimatedMinutes: type === "quiz" ? 3 : 5,
      teachingObjective: type === "quiz" ? `通过单选题检查对“${normalizedTopic}”关键概念的理解。` : `理解“${normalizedTopic}”的第 ${index + 1} 个学习层次，并能说明其作用。`,
      keyPoints: type === "quiz" ? ["识别核心概念", "辨析常见误区"] : [`${normalizedTopic}的核心概念`, "概念之间的因果关系", "工程中的使用边界"],
      ...(type === "quiz" ? { assessmentFocus: `检查学习者能否辨析“${normalizedTopic}”的核心概念与常见误区。` } : {}),
    };
  });
  const courseId = randomUUID();
  const provisional = createProvisionalCourseBrief(normalizedTopic);
  return CourseSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION, id: courseId, topic: normalizedTopic, title: `${normalizedTopic}：从概念到实践`, requestedSceneCount: parsedCount,
    brief: provisional.brief,
    briefResolution: { ...provisional.resolution, status: "resolved", resolvedAt: new Date(now).toISOString() },
    status: "outline_ready", revision: 0, outlines, scenes: [],
    sceneProgress: outlines.map((outline) => ({ outlineId: outline.id, status: "pending", attempts: 0, updatedAt: now })),
    outlineGeneration: mockMetadata(now), createdAt: now, updatedAt: now,
  });
}

function createSlideScene(course: Course, outline: SceneOutline, now: number): Scene {
  const isCodeScene = outline.order === 2;
  return {
    id: randomUUID(), courseId: course.id, outlineId: outline.id, type: "slide", title: outline.title,
    summary: `本场景围绕${outline.title}组织“${course.topic}”的固定教学内容。`, order: outline.order,
    content: {
      type: "slide",
      canvas: {
        id: randomUUID(),
        viewportSize: 1000,
        viewportRatio: 0.5625,
        theme: {
          backgroundColor: "#ffffff",
          themeColors: ["#5b9bd5", "#ed7d31", "#a5a5a5", "#ffc000", "#4472c4"],
          fontColor: "#333333",
          fontName: "Microsoft YaHei",
          outline: { color: "#d14424", width: 2, style: "solid" },
        },
        background: { type: "solid", color: "#f7f3ea" },
        elements: [
          { id: randomUUID(), type: "shape", left: 56, top: 48, width: 10, height: 72, rotate: 0, path: "M 0 0 L 1 0 L 1 1 L 0 1 Z", viewBox: [1, 1], fill: "#d14424", fixedRatio: false },
          { id: randomUUID(), type: "text", left: 82, top: 48, width: 850, height: 72, rotate: 0, content: `<p style="font-size:34px;font-weight:bold;color:#252722">${outline.title}</p>`, defaultFontName: "Microsoft YaHei", defaultColor: "#333333", textType: "title", vAlign: "middle" },
          { id: randomUUID(), type: "text", left: 82, top: 122, width: 820, height: 48, rotate: 0, content: `<p style="font-size:17px;color:#68716b">第 ${String(outline.order).padStart(2, "0")} 场 · ${course.topic}</p>`, defaultFontName: "Microsoft YaHei", defaultColor: "#68716b", textType: "subtitle" },
          { id: randomUUID(), type: "shape", left: 64, top: 192, width: 388, height: 222, rotate: 0, path: "M 0 0 L 1 0 L 1 1 L 0 1 Z", viewBox: [1, 1], fill: "#ffffff", fixedRatio: false, outline: { color: "#d6d2c8", width: 1, style: "solid" } },
          { id: randomUUID(), type: "text", left: 88, top: 214, width: 340, height: 170, rotate: 0, content: `<p style="font-size:18px;font-weight:bold;color:#d14424">核心关系</p><p style="font-size:20px;color:#333333">${outline.keyPoints.slice(0, 2).join(" · ")}</p>`, defaultFontName: "Microsoft YaHei", defaultColor: "#333333", textType: "content", lineHeight: 1.5 },
          { id: randomUUID(), type: "line", left: 452, top: 304, width: 3, start: [0, 0], end: [64, 0], style: "solid", color: "#4472c4", points: ["", "arrow"] },
          ...(isCodeScene ? [{
            id: randomUUID(), type: "code" as const, left: 516, top: 192, width: 420, height: 222, rotate: 0,
            language: "typescript", fileName: "schema-boundary.ts", showLineNumbers: true, fontSize: 14,
            lines: [
              { id: randomUUID(), content: "const result = CourseSchema.safeParse(modelOutput);" },
              { id: randomUUID(), content: "if (!result.success) return { code: \"INVALID\" };" },
              { id: randomUUID(), content: "return render(result.data);" },
            ],
          }] : [
            { id: randomUUID(), type: "shape" as const, left: 516, top: 192, width: 420, height: 222, rotate: 0, path: "M 0 0 L 1 0 L 1 1 L 0 1 Z", viewBox: [1, 1] as [number, number], fill: "#e9efe7", fixedRatio: false, outline: { color: "#ccd8c8", width: 1, style: "solid" as const } },
            { id: randomUUID(), type: "text" as const, left: 540, top: 214, width: 372, height: 170, rotate: 0, content: `<p style="font-size:18px;font-weight:bold;color:#4472c4">实践边界</p><p style="font-size:20px;color:#333333">${outline.keyPoints.at(-1)}</p>`, defaultFontName: "Microsoft YaHei", defaultColor: "#333333", textType: "content" as const, lineHeight: 1.5 },
          ]),
          { id: randomUUID(), type: "text", left: 82, top: 452, width: 850, height: 54, rotate: 0, content: "<p style=\"font-size:18px;color:#333333\"><strong>学习提示：</strong>先解释问题，再追踪机制，最后确认使用边界。</p>", defaultFontName: "Microsoft YaHei", defaultColor: "#333333", textType: "notes", vAlign: "middle" },
        ],
      },
    },
    actions: [
      { id: randomUUID(), type: "speech", text: `现在进入${outline.title}。这一场将帮助你理解：${outline.teachingObjective}` },
      { id: randomUUID(), type: "pause", reason: "timed", durationMs: 1200 },
    ],
    generation: mockMetadata(now), createdAt: now, updatedAt: now,
  };
}

function createQuizScene(course: Course, outline: SceneOutline, now: number): Scene {
  const correctId = randomUUID(), firstMultiCorrectId = randomUUID(), secondMultiCorrectId = randomUUID();
  return {
    id: randomUUID(), courseId: course.id, outlineId: outline.id, type: "quiz", title: outline.title,
    summary: `用单选题和多选题检查学习者是否理解“${course.topic}”的结构化学习方法。`, order: outline.order,
    content: { type: "quiz", questions: [{
      id: randomUUID(), type: "single_choice", prompt: `关于“${course.topic}”课程内容的生成与展示，下列哪项最符合本系统的设计？`,
      options: [
        { id: correctId, label: "模型返回结构化数据，程序校验后用固定组件渲染" },
        { id: randomUUID(), label: "模型直接生成并执行任意 React 源码" },
        { id: randomUUID(), label: "只要接口调用成功，就跳过内容校验" },
      ], correctOptionIds: [correctId], explanation: "结构化契约将不稳定的模型输出与确定性的课堂渲染分离，是本项目复刻的核心机制。",
    }, {
      id: randomUUID(), type: "multiple_choice", prompt: "以下哪些做法能够提升课程生成结果的可靠性？",
      options: [
        { id: firstMultiCorrectId, label: "校验模型输出的数据结构" },
        { id: secondMultiCorrectId, label: "保存前检查领域约束" },
        { id: randomUUID(), label: "接口成功后跳过内容验证" },
      ], correctOptionIds: [firstMultiCorrectId, secondMultiCorrectId], explanation: "结构校验和领域约束共同阻止无效内容进入课堂。",
    }] },
    actions: [
      { id: randomUUID(), type: "speech", text: "请完成单选题和多选题，提交后再查看解析。" },
      { id: randomUUID(), type: "pause", reason: "learner" },
    ],
    generation: mockMetadata(now), createdAt: now, updatedAt: now,
  };
}

/** 将合法大纲装配成完整固定课程；模型接入前用它保持正式契约和数据库链路可运行。 */
export function materializeFixtureCourse(course: Course): Course {
  const now = Date.now();
  const scenes = course.outlines.map((outline) => outline.type === "quiz" ? createQuizScene(course, outline, now) : createSlideScene(course, outline, now));
  return CourseSchema.parse({
    ...course, status: "ready", scenes,
    sceneProgress: course.outlines.map((outline) => ({ outlineId: outline.id, status: "ready", attempts: 1, updatedAt: now })), updatedAt: now,
  });
}
