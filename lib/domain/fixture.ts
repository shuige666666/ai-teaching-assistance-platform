import { randomUUID } from "node:crypto";
import type { Course, GenerationMetadata, Scene, SceneOutline } from "./schemas";
import { CourseSchema } from "./schemas";

/** 从原始课程描述派生草稿标题；完整描述仍保存在 topic，不能因标题上限丢失。 */
function deriveDraftTitle(topic: string, maxLength: number = 120) {
  let title = "";
  for (const character of topic) {
    if ((title + character).length > maxLength) break;
    title += character;
  }
  return title;
}

/** 创建尚未调用模型的课程草稿，主题和场景数量是后续生成管线的唯一输入事实。 */
export function createCourseDraft(topic: string, requestedSceneCount: number): Course {
  const normalizedTopic = topic.trim();
  const parsedCount = Math.min(5, Math.max(3, Math.trunc(requestedSceneCount)));
  const now = Date.now();
  return CourseSchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    topic: normalizedTopic,
    title: deriveDraftTitle(normalizedTopic),
    requestedSceneCount: parsedCount,
    status: "draft",
    revision: 0,
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
  const parsedCount = Math.min(5, Math.max(3, Math.trunc(requestedSceneCount)));
  const now = Date.now();
  const titles = ["建立问题地图", "拆解核心机制", "检查关键理解", "连接工程实践", "形成复习路径"];
  const outlines: SceneOutline[] = Array.from({ length: parsedCount }, (_, index) => {
    const type = index === 2 ? ("quiz" as const) : ("slide" as const);
    return {
      id: randomUUID(), type, title: titles[index], order: index + 1, estimatedMinutes: type === "quiz" ? 3 : 5,
      teachingObjective: type === "quiz" ? `通过单选题检查对“${normalizedTopic}”关键概念的理解。` : `理解“${normalizedTopic}”的第 ${index + 1} 个学习层次，并能说明其作用。`,
      keyPoints: type === "quiz" ? ["识别核心概念", "辨析常见误区"] : [`${normalizedTopic}的核心概念`, "概念之间的因果关系", "工程中的使用边界"],
    };
  });
  const courseId = randomUUID();
  return CourseSchema.parse({
    schemaVersion: 1, id: courseId, topic: normalizedTopic, title: `${normalizedTopic}：从概念到实践`, requestedSceneCount: parsedCount,
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
      type: "slide", subtitle: `第 ${String(outline.order).padStart(2, "0")} 场 · ${course.topic}`,
      blocks: isCodeScene ? [
        { id: randomUUID(), type: "paragraph", text: "固定渲染器只消费通过 Schema 的结构化内容，因此课程展示不会依赖模型生成的 React 或 HTML。" },
        { id: randomUUID(), type: "code", language: "typescript", caption: "模型数据经过契约校验后再进入渲染层", code: `const result = CourseSchema.safeParse(modelOutput);\n\nif (!result.success) {\n  return { code: "MODEL_OUTPUT_INVALID" };\n}` },
        { id: randomUUID(), type: "callout", tone: "warning", title: "安全边界", text: "代码块只作为文本显示，即使内容含有 <script>alert('xss')</script> 也不会执行。" },
      ] : [
        { id: randomUUID(), type: "paragraph", text: `学习“${course.topic}”时，先建立问题、机制与应用之间的结构，比孤立记忆术语更可靠。` },
        { id: randomUUID(), type: "bullet_list", items: outline.keyPoints },
        { id: randomUUID(), type: "callout", tone: outline.order === 1 ? "info" : "example", title: outline.order === 1 ? "学习提示" : "实践连接", text: outline.order === 1 ? "先回答它解决什么问题，再追踪它如何工作。" : "尝试用自己的项目或日常系统举出一个对应案例。" },
      ],
    },
    actions: [
      { id: randomUUID(), type: "speech", text: `现在进入${outline.title}。这一场将帮助你理解：${outline.teachingObjective}` },
      { id: randomUUID(), type: "pause", reason: "timed", durationMs: 1200 },
    ],
    generation: mockMetadata(now), createdAt: now, updatedAt: now,
  };
}

function createQuizScene(course: Course, outline: SceneOutline, now: number): Scene {
  const correctId = randomUUID();
  return {
    id: randomUUID(), courseId: course.id, outlineId: outline.id, type: "quiz", title: outline.title,
    summary: `用单选题检查学习者是否理解“${course.topic}”的结构化学习方法。`, order: outline.order,
    content: { type: "quiz", questions: [{
      id: randomUUID(), type: "single_choice", prompt: `关于“${course.topic}”课程内容的生成与展示，下列哪项最符合本系统的设计？`,
      options: [
        { id: correctId, label: "模型返回结构化数据，程序校验后用固定组件渲染" },
        { id: randomUUID(), label: "模型直接生成并执行任意 React 源码" },
        { id: randomUUID(), label: "只要接口调用成功，就跳过内容校验" },
      ], correctOptionId: correctId, explanation: "结构化契约将不稳定的模型输出与确定性的课堂渲染分离，是本项目复刻的核心机制。",
    }] },
    actions: [
      { id: randomUUID(), type: "speech", text: "请完成这道单选题，提交后再查看解析。" },
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
