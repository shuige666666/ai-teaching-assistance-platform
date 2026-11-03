import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AgentApplicationError } from "@/lib/agent/contracts";
import { buildQuizQuestions, toEditableQuizQuestions } from "@/lib/domain/quiz-question-builder";
import { ActionSchema, CourseSchema, SceneSchema, type Scene } from "@/lib/domain/schemas";
import { PPTElementSchema } from "@/lib/domain/slide-schemas";
import { postProcessInteractiveHtml, extractInteractiveAuthorHtml } from "@/lib/interactive/html-policy";
import { sanitizeSlideText } from "@/lib/slides/normalize-slide";
import { CourseConflictError, type CourseRepository } from "@/lib/repository/course-repository";
import { refreshPatchedSceneSummary } from "./scene-summary";

const JsonValueSchema: z.ZodType<unknown> = z.unknown();
const PatchOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), path: z.string().min(1), value: JsonValueSchema }).strict(),
  z.object({ op: z.literal("remove"), path: z.string().min(1) }).strict(),
  z.object({ op: z.literal("str_replace"), path: z.string().min(1), oldText: z.string().min(1), newText: z.string() }).strict(),
  z.object({ op: z.literal("add_element"), element: z.record(z.string(), z.unknown()), afterElementId: z.string().min(1).optional() }).strict(),
  z.object({ op: z.literal("delete_element"), elementId: z.string().min(1) }).strict(),
]);
export const PatchStageInputSchema = z.object({
  sceneId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  intent: z.string().trim().min(1).max(500),
  operations: z.array(PatchOperationSchema).min(1).max(24),
}).strict();
export type PatchStageInput = z.infer<typeof PatchStageInputSchema>;

export type PreparedCoursePatch = {
  courseId: string;
  sceneId: string;
  baseRevision: number;
  candidateScene: Scene;
  quizQuestionsChanged: boolean;
  changedPaths: string[];
  warnings: string[];
  summary: string;
};
export type CoursePatchResult = {
  beforeRevision: number;
  afterRevision: number;
  affectedSceneIds: string[];
  changedPaths: string[];
  warnings: string[];
  changeSummary: string;
};

function decodePointer(path: string): string[] {
  if (!(path === "/content" || path.startsWith("/content/") || path === "/actions" || path.startsWith("/actions/"))) {
    throw new AgentApplicationError("INVALID_ARGUMENT", "补丁路径只能位于 /content 或 /actions");
  }
  return path.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~")).map((part) => {
    if (["__proto__", "prototype", "constructor"].includes(part)) throw new AgentApplicationError("INVALID_ARGUMENT", "补丁路径包含不支持的字段");
    return part;
  });
}

function resolveParent(root: unknown, path: string): { parent: Record<string, unknown> | unknown[]; key: string } {
  const parts = decodePointer(path);
  const key = parts.pop();
  let current: unknown = root;
  for (const part of parts) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part) || Number(part) >= current.length) throw new AgentApplicationError("INVALID_ARGUMENT", `路径不存在：${path}`);
      current = current[Number(part)];
    } else if (typeof current === "object" && current !== null && Object.hasOwn(current, part)) {
      current = (current as Record<string, unknown>)[part];
    } else throw new AgentApplicationError("INVALID_ARGUMENT", `路径不存在：${path}`);
  }
  if (!key || (!Array.isArray(current) && (typeof current !== "object" || current === null))) throw new AgentApplicationError("INVALID_ARGUMENT", `路径不存在：${path}`);
  return { parent: current as Record<string, unknown> | unknown[], key };
}

function hasKey(parent: Record<string, unknown> | unknown[], key: string): boolean {
  return Array.isArray(parent) ? /^\d+$/.test(key) && Number(key) < parent.length : Object.hasOwn(parent, key);
}

function applyGenericOperation(root: Record<string, unknown>, operation: Extract<PatchStageInput["operations"][number], { path: string }>) {
  const { parent, key } = resolveParent(root, operation.path);
  if (!hasKey(parent, key)) throw new AgentApplicationError("INVALID_ARGUMENT", `路径不存在：${operation.path}`);
  const indexOrKey = Array.isArray(parent) ? Number(key) : key;
  if (operation.op === "set") {
    (parent as Record<string | number, unknown>)[indexOrKey] = structuredClone(operation.value);
    return;
  }
  if (operation.op === "remove") {
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
    return;
  }
  const current = (parent as Record<string | number, unknown>)[indexOrKey];
  if (typeof current !== "string") throw new AgentApplicationError("INVALID_ARGUMENT", `str_replace 只能作用于字符串：${operation.path}`);
  const first = current.indexOf(operation.oldText);
  if (first < 0 || current.indexOf(operation.oldText, first + operation.oldText.length) >= 0) {
    throw new AgentApplicationError("INVALID_ARGUMENT", `oldText 必须在目标字段中恰好出现一次：${operation.path}`);
  }
  (parent as Record<string | number, unknown>)[indexOrKey] = current.slice(0, first) + operation.newText + current.slice(first + operation.oldText.length);
}

function normalizeActions(candidate: Record<string, unknown>, original: Scene) {
  if (!Array.isArray(candidate.actions)) return;
  const originals = new Map(original.actions.map((action) => [action.id, action.type]));
  candidate.actions = candidate.actions.map((raw) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const action = { ...raw } as Record<string, unknown>;
    if (typeof action.id !== "string" || !action.id) action.id = randomUUID();
    else if (!originals.has(action.id)) throw new AgentApplicationError("INVALID_ARGUMENT", "新增 action 不能自行指定 ID，请省略 id");
    else if (originals.get(action.id) !== action.type) throw new AgentApplicationError("INVALID_ARGUMENT", "已有 action 的 type 不能修改");
    return action;
  });
}

function normalizeSlide(candidate: Record<string, unknown>, original: Extract<Scene, { type: "slide" }>, addedIds: Set<string>, deletedIds: Set<string>, warnings: string[]) {
  const content = candidate.content as { canvas?: { elements?: unknown[] } } | undefined;
  if (content?.canvas && (content.canvas as { id?: unknown }).id !== original.content.canvas.id) {
    throw new AgentApplicationError("INVALID_ARGUMENT", "slide canvas ID 由服务端维护，不能修改");
  }
  const elements = content?.canvas?.elements;
  if (!Array.isArray(elements)) return;
  const originalElements = new Map(original.content.canvas.elements.map((element) => [element.id, element]));
  for (const raw of elements) {
    if (typeof raw !== "object" || raw === null) continue;
    const element = raw as Record<string, unknown>;
    if (typeof element.id !== "string" || !element.id) throw new AgentApplicationError("INVALID_ARGUMENT", "新增元素必须使用 add_element");
    const previous = originalElements.get(element.id);
    if (!previous && !addedIds.has(element.id)) throw new AgentApplicationError("INVALID_ARGUMENT", "通用补丁不能自行创建元素 ID");
    if (previous && previous.type !== element.type) throw new AgentApplicationError("INVALID_ARGUMENT", "已有元素的 type 不能修改");
    if (element.type === "text" && typeof element.content === "string") {
      const sanitized = sanitizeSlideText(element.content);
      if (sanitized !== element.content) warnings.push(`元素 ${element.id} 的富文本已按课堂白名单净化`);
      element.content = sanitized;
    }
    if (element.type === "code" && Array.isArray(element.lines)) {
      const oldLines = previous?.type === "code" ? new Map(previous.lines.map((line) => [line.id, true])) : new Map<string, boolean>();
      element.lines = element.lines.map((rawLine) => {
        if (typeof rawLine === "string") return { id: randomUUID(), content: rawLine };
        if (typeof rawLine !== "object" || rawLine === null) return rawLine;
        const line = { ...rawLine } as Record<string, unknown>;
        if (typeof line.id !== "string" || !line.id) line.id = randomUUID();
        else if (previous?.type === "code" && !oldLines.has(line.id)) throw new AgentApplicationError("INVALID_ARGUMENT", "新增代码行不能自行指定 ID");
        return line;
      });
    }
  }
  for (const id of originalElements.keys()) {
    if (!deletedIds.has(id) && !elements.some((element) => typeof element === "object" && element !== null && (element as { id?: unknown }).id === id)) {
      throw new AgentApplicationError("INVALID_ARGUMENT", "删除元素必须使用 delete_element");
    }
  }
}

function quizComparable(scene: Extract<Scene, { type: "quiz" }>) {
  return toEditableQuizQuestions(scene.content);
}

export class CoursePatchService {
  constructor(private readonly repository: CourseRepository, private readonly now: () => number = Date.now) {}

  /** 在内存副本上顺序应用补丁并完成整场、整课校验，不产生部分写入。 */
  async prepareScenePatch(courseId: string, rawInput: PatchStageInput): Promise<PreparedCoursePatch> {
    const input = PatchStageInputSchema.parse(rawInput);
    const current = await this.repository.get(courseId);
    if (!current) throw new AgentApplicationError("NOT_FOUND", "课程不存在", 404);
    if (current.revision !== input.expectedRevision) throw new CourseConflictError();
    if (current.activeOperation || !["ready", "partial_failed"].includes(current.status)) throw new AgentApplicationError("TOOL_EXECUTION_FAILED", "课程已有生成操作，请稍后刷新重试");
    const original = current.scenes.find((scene) => scene.id === input.sceneId);
    const progress = original && current.sceneProgress.find((item) => item.outlineId === original.outlineId);
    if (!original || progress?.status !== "ready") throw new AgentApplicationError("NOT_FOUND", "只能修改当前课程中已经保存的 ready 页面", 404);

    const candidate = structuredClone(original) as unknown as Record<string, unknown>;
    if (original.type === "interactive") {
      const content = candidate.content as Record<string, unknown>;
      content.html = extractInteractiveAuthorHtml(String(content.html));
    }
    const addedIds = new Set<string>();
    const deletedIds = new Set<string>();
    const changedPaths: string[] = [];
    const warnings: string[] = [];

    for (const operation of input.operations) {
      if (operation.op === "add_element") {
        if (original.type !== "slide") throw new AgentApplicationError("INVALID_ARGUMENT", "add_element 只适用于 slide");
        const id = randomUUID();
        const element = { ...structuredClone(operation.element), id } as Record<string, unknown>;
        if (element.type === "code" && Array.isArray(element.lines)) element.lines = element.lines.map((line) => typeof line === "string" ? { id: randomUUID(), content: line } : { ...(line as object), id: randomUUID() });
        const parsed = PPTElementSchema.parse(element);
        const elements = ((candidate.content as { canvas: { elements: unknown[] } }).canvas.elements);
        const after = operation.afterElementId ? elements.findIndex((item) => (item as { id?: string }).id === operation.afterElementId) : elements.length - 1;
        if (operation.afterElementId && after < 0) throw new AgentApplicationError("INVALID_ARGUMENT", "afterElementId 不存在");
        elements.splice(after + 1, 0, parsed);
        addedIds.add(id);
        changedPaths.push("/content/canvas/elements");
      } else if (operation.op === "delete_element") {
        if (original.type !== "slide") throw new AgentApplicationError("INVALID_ARGUMENT", "delete_element 只适用于 slide");
        const elements = ((candidate.content as { canvas: { elements: Array<{ id: string }> } }).canvas.elements);
        const index = elements.findIndex((element) => element.id === operation.elementId);
        if (index < 0) throw new AgentApplicationError("INVALID_ARGUMENT", "elementId 不存在");
        elements.splice(index, 1);
        deletedIds.add(operation.elementId);
        changedPaths.push("/content/canvas/elements");
      } else {
        applyGenericOperation(candidate, operation);
        changedPaths.push(operation.path);
      }
    }

    normalizeActions(candidate, original);
    if (original.type === "slide") normalizeSlide(candidate, original, addedIds, deletedIds, warnings);
    if (deletedIds.size > 0 && Array.isArray(candidate.actions)) {
      // 删除元素时同步清理旧聚焦；其他不存在的目标仍由 SceneSchema 拒绝。
      candidate.actions = candidate.actions.map((raw, index) => {
        const action = ActionSchema.parse(raw);
        if (action.type !== "speech" || !action.focusElementIds?.some((id) => deletedIds.has(id))) return action;
        warnings.push(`第 ${index + 1} 个讲解动作的目标元素已删除，已清理高亮引用，请复查对应讲稿`);
        changedPaths.push(`/actions/${index}/focusElementIds`);
        return { ...action, focusElementIds: action.focusElementIds.filter((id) => !deletedIds.has(id)) };
      });
    }
    if (original.type === "interactive") {
      const content = candidate.content as Record<string, unknown>;
      if (content.widgetType !== original.content.widgetType || content.runtimeContractVersion !== original.content.runtimeContractVersion) {
        throw new AgentApplicationError("INVALID_ARGUMENT", "互动页 widgetType 与 runtimeContractVersion 不能修改");
      }
      content.html = postProcessInteractiveHtml(String(content.html));
    }

    let quizQuestionsChanged = false;
    if (original.type === "quiz") {
      const rawScene = SceneSchema.parse({ ...candidate, updatedAt: Math.max(this.now(), original.updatedAt) });
      if (rawScene.type !== "quiz") throw new AgentApplicationError("INVALID_ARGUMENT", "页面类型不能修改");
      quizQuestionsChanged = JSON.stringify(quizComparable(original)) !== JSON.stringify(quizComparable(rawScene));
      if (quizQuestionsChanged) (candidate.content as { questions: unknown[] }).questions = buildQuizQuestions(quizComparable(rawScene));
    }

    const candidateScene = SceneSchema.parse({ ...candidate, id: original.id, courseId: original.courseId, outlineId: original.outlineId, type: original.type, createdAt: original.createdAt, updatedAt: Math.max(this.now(), original.updatedAt) });
    candidateScene.summary = refreshPatchedSceneSummary(original, candidateScene);
    if (candidateScene.summary !== original.summary) changedPaths.push("/summary");
    const candidateCourse = CourseSchema.parse({ ...current, scenes: current.scenes.map((scene) => scene.id === original.id ? candidateScene : scene), updatedAt: Math.max(this.now(), current.updatedAt) });
    void candidateCourse;
    return { courseId, sceneId: original.id, baseRevision: current.revision, candidateScene, quizQuestionsChanged, changedPaths: [...new Set(changedPaths)], warnings, summary: input.intent };
  }

  /** 提交已校验候选页；确认等待期间的 revision 变化仍会阻止覆盖。 */
  async commitPrepared(prepared: PreparedCoursePatch): Promise<CoursePatchResult> {
    const current = await this.repository.get(prepared.courseId);
    if (!current) throw new AgentApplicationError("NOT_FOUND", "课程不存在", 404);
    if (current.revision !== prepared.baseRevision) throw new CourseConflictError();
    if (current.activeOperation || !["ready", "partial_failed"].includes(current.status)) throw new AgentApplicationError("TOOL_EXECUTION_FAILED", "课程状态已变化，请重新读取");
    const existing = current.scenes.find((scene) => scene.id === prepared.sceneId);
    if (!existing) throw new AgentApplicationError("NOT_FOUND", "目标页面已不存在", 404);
    if (
      prepared.candidateScene.id !== existing.id ||
      prepared.candidateScene.courseId !== current.id ||
      prepared.candidateScene.outlineId !== existing.outlineId ||
      prepared.candidateScene.type !== existing.type
    ) throw new AgentApplicationError("INVALID_ARGUMENT", "冻结候选页的服务端身份与当前页面不一致");
    const candidate = CourseSchema.parse({ ...current, scenes: current.scenes.map((scene) => scene.id === prepared.sceneId ? prepared.candidateScene : scene), updatedAt: Math.max(this.now(), current.updatedAt) });
    const saved = await this.repository.save(candidate, current.revision, prepared.quizQuestionsChanged ? { clearQuizAttemptsForSceneId: existing.id } : undefined);
    return { beforeRevision: current.revision, afterRevision: saved.revision, affectedSceneIds: [prepared.sceneId], changedPaths: prepared.changedPaths, warnings: prepared.warnings, changeSummary: prepared.summary };
  }
}
