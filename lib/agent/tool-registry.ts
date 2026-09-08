import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AgentApplicationError, type AgentCourseUpdate, type AgentToolDefinition } from "./contracts";
import { CourseAgentQueryService } from "@/lib/application/course-agent-query-service";
import { CourseDeckService, EditDeckInputSchema, type PreparedDeckDelete } from "@/lib/application/course-deck-service";
import { CoursePatchService, PatchStageInputSchema, type PreparedCoursePatch } from "@/lib/application/course-patch-service";
import { SceneGenerationService } from "@/lib/application/scene-generation-service";
import { SceneOutlineSchema } from "@/lib/domain/schemas";
import type { AIAdapter } from "@/lib/ai/contracts";
import type { CourseRepository } from "@/lib/repository/course-repository";

const ListScenesInput = z.object({}).strict();
const ReadStageInput = z.object({
  path: z.string().optional(),
  detail: z.enum(["tree", "text", "source"]).optional(),
  offset: z.number().int().nonnegative().optional(),
  schemaFor: z.enum(["text", "chart", "table", "actions"]).optional(),
}).strict();
const GrepStageInput = z.object({ query: z.string().trim().min(1).max(200) }).strict();
const AddSceneOutlineInput = SceneOutlineSchema.omit({ id: true, order: true });
const GenerateSceneInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("regenerate"), sceneId: z.string().min(1), expectedRevision: z.number().int().nonnegative(), instruction: z.string().trim().min(1).max(500) }).strict(),
  z.object({ mode: z.literal("add"), expectedRevision: z.number().int().nonnegative(), position: z.number().int().positive(), outline: AddSceneOutlineInput, instruction: z.string().trim().min(1).max(500) }).strict(),
]);

export type ToolExecutionContext = { signal: AbortSignal; runId: string; deadlineAt: number };
export type PreparedQuizRegeneration = {
  kind: "regenerate_quiz";
  courseId: string;
  baseRevision: number;
  sceneId: string;
  outlineId: string;
  instruction: string;
  summary: string;
};
export type AgentConfirmationPayload =
  | ({ kind: "patch" } & PreparedCoursePatch)
  | PreparedDeckDelete
  | PreparedQuizRegeneration;

export type ToolOutcome =
  | { kind: "completed"; result: unknown; courseUpdate?: AgentCourseUpdate }
  | { kind: "confirmation"; payload: AgentConfirmationPayload; summary: string; confirmationKind: AgentConfirmationPayload["kind"]; execution: "short" | "long" };

type RegisteredTool = {
  label: string;
  definition: AgentToolDefinition;
  execute(courseId: string, raw: unknown, context: ToolExecutionContext): Promise<ToolOutcome>;
};

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

function updateForScene(result: { afterRevision: number }, sceneId: string, contentChanged = true): AgentCourseUpdate {
  return { revision: result.afterRevision, affectedSceneIds: [sceneId], contentChanged };
}

export class CourseAgentToolRegistry {
  private readonly tools: Map<string, RegisteredTool>;
  private readonly generation?: SceneGenerationService;
  constructor(repository: CourseRepository, generationAdapter?: AIAdapter, sceneTimeoutMs = 120_000) {
    const query = new CourseAgentQueryService(repository);
    const patch = new CoursePatchService(repository);
    const deck = new CourseDeckService(repository);
    this.generation = generationAdapter ? new SceneGenerationService(repository, generationAdapter, sceneTimeoutMs) : undefined;
    this.tools = new Map([
      ["list_scenes", {
        label: "检查当前课堂",
        definition: { type: "function", function: { name: "list_scenes", description: "列出当前课程页面、稳定 sceneId、顺序、标题和类型；不判断内容质量。", parameters: objectSchema({}) } },
        execute: async (courseId) => ({ kind: "completed", result: await query.listScenes(courseId) }),
      }],
      ["read_stage", {
        label: "读取课堂",
        definition: { type: "function", function: { name: "read_stage", description: "读取课程、目录或单页。修改前用 source，普通问答可用 text，结构浏览用 tree。", parameters: objectSchema({
          path: { type: "string", description: "空字符串、/outline、/scenes/{sceneId} 或 /scenes/{sceneId}/actions" },
          detail: { type: "string", enum: ["tree", "text", "source"] },
          offset: { type: "integer", minimum: 0 },
          schemaFor: { type: "string", enum: ["text", "chart", "table", "actions"] },
        }) } },
        execute: async (courseId, raw) => ({ kind: "completed", result: await query.readStage(courseId, ReadStageInput.parse(raw)) }),
      }],
      ["grep_stage", {
        label: "搜索课堂",
        definition: { type: "function", function: { name: "grep_stage", description: "在所有页面的用户可见文本中搜索字面量关键词。", parameters: objectSchema({ query: { type: "string", minLength: 1, maxLength: 200 } }, ["query"]) } },
        execute: async (courseId, raw) => ({ kind: "completed", result: await query.grepStage(courseId, GrepStageInput.parse(raw).query) }),
      }],
      ["patch_stage", {
        label: "编辑课堂",
        definition: { type: "function", function: { name: "patch_stage", description: "原子修改一个已读取页面的 content/actions。quiz 题目变化会等待用户确认。", parameters: objectSchema({
          sceneId: { type: "string" },
          expectedRevision: { type: "integer", minimum: 0 },
          intent: { type: "string", minLength: 1, maxLength: 500 },
          operations: {
            type: "array", minItems: 1, maxItems: 24,
            items: { oneOf: [
              objectSchema({ op: { const: "set" }, path: { type: "string" }, value: {} }, ["op", "path", "value"]),
              objectSchema({ op: { const: "remove" }, path: { type: "string" } }, ["op", "path"]),
              objectSchema({ op: { const: "str_replace" }, path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } }, ["op", "path", "oldText", "newText"]),
              objectSchema({ op: { const: "add_element" }, element: { type: "object" }, afterElementId: { type: "string" } }, ["op", "element"]),
              objectSchema({ op: { const: "delete_element" }, elementId: { type: "string" } }, ["op", "elementId"]),
            ] },
          },
        }, ["sceneId", "expectedRevision", "intent", "operations"]) } },
        execute: async (courseId, raw) => {
          const prepared = await patch.prepareScenePatch(courseId, PatchStageInputSchema.parse(raw));
          if (prepared.quizQuestionsChanged) return { kind: "confirmation", payload: { kind: "patch", ...prepared }, confirmationKind: "patch", execution: "short", summary: "修改测验题目将清理本场旧作答记录" };
          const result = await patch.commitPrepared(prepared);
          return { kind: "completed", result, courseUpdate: updateForScene(result, result.affectedSceneIds[0]) };
        },
      }],
    ]);
    this.tools.set("edit_deck", {
      label: "调整页序",
      definition: { type: "function", function: { name: "edit_deck", description: "调整课程目录标题或页面位置。先用 list_scenes 确认稳定 sceneId；delete 会等待一次确认。", parameters: objectSchema({
        operation: { type: "string", enum: ["rename", "move", "delete"] },
        sceneId: { type: "string" },
        expectedRevision: { type: "integer", minimum: 0 },
        title: { type: "string", description: "rename 使用的新目录标题" },
        toPosition: { type: "integer", minimum: 1, description: "move 完成后的 1-based 页码" },
      }, ["operation", "sceneId", "expectedRevision"]) } },
      execute: async (courseId, raw) => {
        const input = EditDeckInputSchema.parse(raw);
        if (input.operation === "rename") {
          const result = await deck.rename(courseId, input.expectedRevision, input.sceneId, input.title);
          return { kind: "completed", result, courseUpdate: result.changed ? updateForScene(result, result.sceneId, false) : undefined };
        }
        if (input.operation === "move") {
          const result = await deck.move(courseId, input.expectedRevision, input.sceneId, input.toPosition);
          return { kind: "completed", result, courseUpdate: result.changed ? updateForScene(result, result.sceneId, false) : undefined };
        }
        const prepared = await deck.prepareDelete(courseId, input.expectedRevision, input.sceneId);
        return { kind: "confirmation", payload: prepared, confirmationKind: "delete", execution: "short", summary: prepared.summary };
      },
    });
    if (this.generation) this.tools.set("generate_scene", this.createGenerationTool(repository));
  }

  /** 将整页重生成与新增页接入现有场景生成链，工具自身只负责参数和结果适配。 */
  private createGenerationTool(repository: CourseRepository): RegisteredTool {
    return {
      label: "生成页面",
      definition: { type: "function", function: { name: "generate_scene", description: "整页重生成已有页面，或按给定大纲新增页面。局部修改优先使用 patch_stage；quiz 重生成会等待确认。", parameters: objectSchema({
        mode: { type: "string", enum: ["regenerate", "add"] },
        sceneId: { type: "string", description: "regenerate 使用的稳定 sceneId" },
        expectedRevision: { type: "integer", minimum: 0 },
        instruction: { type: "string", minLength: 1, maxLength: 500 },
        position: { type: "integer", minimum: 1, description: "add 插入后的 1-based 页码" },
        outline: { type: "object", description: "add 使用的 SceneOutline 字段，不包含 id/order" },
      }, ["mode", "expectedRevision", "instruction"]) } },
      execute: async (courseId, raw, context) => {
        const input = GenerateSceneInputSchema.parse(raw);
        if (input.mode === "regenerate") {
          const course = await repository.get(courseId);
          if (!course) throw new AgentApplicationError("NOT_FOUND", "课程不存在", 404);
          if (course.revision !== input.expectedRevision) throw new AgentApplicationError("COURSE_CONFLICT", "课堂已被其他操作更新，请重新读取后再试", 409);
          const scene = course.scenes.find((item) => item.id === input.sceneId);
          if (!scene) throw new AgentApplicationError("NOT_FOUND", "目标页面不存在或不属于当前课程", 404);
          if (scene.type === "quiz") {
            const outline = course.outlines.find((item) => item.id === scene.outlineId);
            const summary = `重新生成第 ${outline?.order ?? scene.order} 页《${scene.title}》测验，将更换题目并清理本页旧作答记录`;
            return {
              kind: "confirmation", confirmationKind: "regenerate_quiz", execution: "long",
              payload: { kind: "regenerate_quiz", courseId, baseRevision: input.expectedRevision, sceneId: scene.id, outlineId: scene.outlineId, instruction: input.instruction, summary },
              summary,
            };
          }
          const oldSceneId = scene.id;
          const saved = await this.generation!.revise(courseId, scene.outlineId, input.expectedRevision, context.runId, { instruction: input.instruction, requestSignal: context.signal });
          const replacement = saved.scenes.find((item) => item.outlineId === scene.outlineId);
          if (!replacement) throw new AgentApplicationError("TOOL_EXECUTION_FAILED", "整页生成已保存，但没有找到替换页面");
          const result = {
            mode: "regenerate", oldSceneId, newSceneId: replacement.id, outlineId: scene.outlineId,
            beforeRevision: input.expectedRevision, afterRevision: saved.revision, contentChanged: true,
            message: "整页内容与 actions 已替换，目录标题保持不变",
          };
          return {
            kind: "completed", result,
            courseUpdate: { revision: saved.revision, affectedSceneIds: [replacement.id], removedSceneIds: [oldSceneId], sceneReplacements: [{ oldSceneId, newSceneId: replacement.id, outlineId: scene.outlineId }], contentChanged: true },
          };
        }
        const outline = SceneOutlineSchema.parse({ ...input.outline, id: randomUUID(), order: input.position });
        const saved = await this.generation!.insert(courseId, input.expectedRevision, context.runId, outline, input.position, input.instruction, context.signal);
        const added = saved.scenes.find((item) => item.outlineId === outline.id);
        if (!added) throw new AgentApplicationError("TOOL_EXECUTION_FAILED", "新增页面已保存，但没有找到新页面");
        const result = { mode: "add", sceneId: added.id, outlineId: outline.id, position: added.order, beforeRevision: input.expectedRevision, afterRevision: saved.revision, contentChanged: true, message: "新页面已生成并插入课程" };
        return { kind: "completed", result, courseUpdate: { revision: saved.revision, affectedSceneIds: [added.id], contentChanged: true } };
      },
    };
  }

  definitions() { return [...this.tools.values()].map((tool) => tool.definition); }
  label(name: string) { return this.tools.get(name)?.label ?? name; }
  async execute(name: string, courseId: string, input: unknown, context: ToolExecutionContext) {
    const tool = this.tools.get(name);
    if (!tool) throw new AgentApplicationError("INVALID_ARGUMENT", `当前阶段没有注册工具 ${name}`);
    if (name === "list_scenes") ListScenesInput.parse(input);
    return tool.execute(courseId, input, context);
  }
}
