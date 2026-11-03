import { AgentApplicationError } from "@/lib/agent/contracts";
import type { Course, Scene } from "@/lib/domain/schemas";
import { extractInteractiveAuthorHtml } from "@/lib/interactive/html-policy";
import type { CourseRepository } from "@/lib/repository/course-repository";

const SOURCE_PAGE_SIZE = 12_000;
function requireCourse(course: Course | null): Course {
  if (!course) throw new AgentApplicationError("NOT_FOUND", "课程不存在", 404);
  return course;
}
function visibleSceneText(scene: Scene): string {
  const actions = scene.actions.flatMap((action) => action.type === "speech" ? [action.text] : []);
  if (scene.type === "slide") {
    const parts = scene.content.canvas.elements.flatMap((element) => {
      if (element.type === "text") return [element.content];
      if (element.type === "code") return element.lines.map((line) => line.content);
      if (element.type === "chart") return [...element.data.labels, ...element.data.series.flatMap((series) => [series.name, ...series.values.map(String)])];
      if (element.type === "table") return element.rows.flat();
      return [];
    });
    return [scene.title, scene.summary, ...parts, ...actions].join("\n");
  }
  if (scene.type === "quiz") return [scene.title, scene.summary, ...scene.content.questions.flatMap((question) => [question.prompt, ...question.options.map((option) => option.label), question.explanation]), ...actions].join("\n");
  return [scene.title, scene.summary, scene.content.fallback.title, scene.content.fallback.description, ...scene.content.fallback.steps, ...actions].join("\n");
}
function editableScene(scene: Scene): unknown {
  return scene.type === "interactive" ? { ...scene, content: { ...scene.content, html: extractInteractiveAuthorHtml(scene.content.html) } } : scene;
}
const structureGuides = {
  slide: "可编辑 content.canvas.theme/background/elements 与 actions。已有元素 id/type 必须保留；新增或删除元素使用 add_element/delete_element。每个 speech 对应一段讲稿，focusElementIds 可引用本页最多 4 个元素 ID；修改讲稿时保留或同步调整聚焦。新增可选字段可整体 set 对应 action 或 actions；不要把生成期 ref 写入课程。删除目标后需复查讲稿。",
  quiz: "questions 为 1～3 题。选项 ID 与 correctOptionIds 必须对应；题目实际变化需要用户确认并清理旧作答。",
  interactive: "html 为作者源码，保存时平台会重新注入 CSP 与运行时。可编辑 fallback、html 与 actions，不能改变 widgetType/runtimeContractVersion。",
};
const schemaExamples: Record<string, unknown> = {
  text: { type: "text", left: 80, top: 80, width: 420, height: 120, rotate: 0, content: "正文", defaultFontName: "Microsoft YaHei", defaultColor: "#143f59", textType: "content" },
  chart: { type: "chart", left: 500, top: 120, width: 400, height: 260, rotate: 0, chartType: "column", data: { labels: ["A", "B"], series: [{ name: "系列", values: [1, 2] }] } },
  table: { type: "table", left: 100, top: 140, width: 800, height: 260, rotate: 0, colWidths: [1, 2], rows: [["字段", "说明"], ["A", "示例"]], header: true },
  actions: [{ type: "speech", text: "当前段讲解文本", focusElementIds: [] }],
};

export class CourseAgentQueryService {
  constructor(private readonly repository: CourseRepository) {}

  /** 返回页面清单；它只描述结构，不对内容质量作判断。 */
  async listScenes(courseId: string) {
    const course = requireCourse(await this.repository.get(courseId));
    return { courseId, courseRevision: course.revision, scenes: course.scenes.slice().sort((a, b) => a.order - b.order).map((scene) => ({
      sceneId: scene.id, outlineId: scene.outlineId, order: scene.order, title: scene.title, type: scene.type,
      elementCount: scene.type === "slide" ? scene.content.canvas.elements.length : undefined,
    })) };
  }

  /** 按 tree/text/source 投影读取课程；source 使用字符游标分页。 */
  async readStage(courseId: string, input: { path?: string; detail?: "tree" | "text" | "source"; offset?: number; schemaFor?: string }) {
    const course = requireCourse(await this.repository.get(courseId));
    const detail = input.detail ?? "tree";
    const path = input.path ?? "";
    if (input.schemaFor) return { courseRevision: course.revision, schemaFor: input.schemaFor, schema: schemaExamples[input.schemaFor] ?? null };
    if (path === "" || path === "/outline") {
      if (detail === "source") {
        const source = JSON.stringify(path === "/outline" ? course.outlines : { id: course.id, title: course.title, topic: course.topic, brief: course.brief, outlines: course.outlines }, null, 2);
        return this.pageSource(course.revision, path, source, input.offset);
      }
      return detail === "text"
        ? { courseRevision: course.revision, path, title: course.title, topic: course.topic, outlines: course.outlines.map(({ id, order, title, teachingObjective, keyPoints, type }) => ({ id, order, title, teachingObjective, keyPoints, type })) }
        : { ...(await this.listScenes(courseId)), title: course.title, requestedSceneCount: course.requestedSceneCount };
    }
    const match = path.match(/^\/scenes\/([^/]+)(?:\/(actions))?$/);
    if (!match) throw new AgentApplicationError("INVALID_ARGUMENT", "read_stage path 只支持课程、/outline、/scenes/{sceneId} 或其 /actions");
    const scene = course.scenes.find((item) => item.id === match[1]);
    if (!scene) throw new AgentApplicationError("NOT_FOUND", "目标页面不属于当前课程", 404);
    if (match[2]) return { courseRevision: course.revision, path, actions: scene.actions };
    if (detail === "tree") return { courseRevision: course.revision, path, scene: { sceneId: scene.id, order: scene.order, title: scene.title, type: scene.type, actionCount: scene.actions.length, elementCount: scene.type === "slide" ? scene.content.canvas.elements.length : undefined } };
    if (detail === "text") return { courseRevision: course.revision, path, sceneId: scene.id, order: scene.order, title: scene.title, type: scene.type, text: visibleSceneText(scene) };
    return { ...this.pageSource(course.revision, path, JSON.stringify(editableScene(scene), null, 2), input.offset), sceneId: scene.id, structureGuide: structureGuides[scene.type] };
  }

  /** 在所有可见文本中做不区分大小写的字面量搜索，并限制总命中数。 */
  async grepStage(courseId: string, query: string) {
    const course = requireCourse(await this.repository.get(courseId));
    const needle = query.normalize("NFKC").trim().toLocaleLowerCase();
    if (!needle) throw new AgentApplicationError("INVALID_ARGUMENT", "搜索关键词不能为空");
    const matches: Array<{ sceneId: string; order: number; title: string; snippet: string }> = [];
    for (const scene of course.scenes.slice().sort((a, b) => a.order - b.order)) {
      const text = visibleSceneText(scene).normalize("NFKC");
      const lowered = text.toLocaleLowerCase();
      let from = 0;
      for (let perScene = 0; perScene < 10 && matches.length < 30; perScene += 1) {
        const index = lowered.indexOf(needle, from);
        if (index < 0) break;
        matches.push({ sceneId: scene.id, order: scene.order, title: scene.title, snippet: text.slice(Math.max(0, index - 60), Math.min(text.length, index + needle.length + 100)).replace(/\s+/g, " ") });
        from = index + Math.max(1, needle.length);
      }
      if (matches.length >= 30) break;
    }
    return { courseRevision: course.revision, query, matches, truncated: matches.length >= 30 };
  }

  private pageSource(courseRevision: number, path: string, source: string, rawOffset = 0) {
    const offset = Math.max(0, rawOffset);
    const content = source.slice(offset, offset + SOURCE_PAGE_SIZE);
    const nextOffset = offset + content.length < source.length ? offset + content.length : undefined;
    return { courseRevision, path, content, offset, totalChars: source.length, nextOffset };
  }
}
