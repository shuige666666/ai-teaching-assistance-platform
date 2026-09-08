import { z } from "zod";
import { AgentApplicationError, type AgentToolDefinition } from "./contracts";
import { CourseAgentQueryService } from "@/lib/application/course-agent-query-service";
import { CoursePatchService, PatchStageInputSchema, type PreparedCoursePatch } from "@/lib/application/course-patch-service";
import type { CourseRepository } from "@/lib/repository/course-repository";

const ListScenesInput = z.object({}).strict();
const ReadStageInput = z.object({
  path: z.string().optional(),
  detail: z.enum(["tree", "text", "source"]).optional(),
  offset: z.number().int().nonnegative().optional(),
  schemaFor: z.enum(["text", "chart", "table", "actions"]).optional(),
}).strict();
const GrepStageInput = z.object({ query: z.string().trim().min(1).max(200) }).strict();

export type ToolOutcome =
  | { kind: "completed"; result: unknown; courseUpdate?: { revision: number; affectedSceneIds: string[] } }
  | { kind: "confirmation"; prepared: PreparedCoursePatch; summary: string };

type RegisteredTool = {
  label: string;
  definition: AgentToolDefinition;
  execute(courseId: string, raw: unknown): Promise<ToolOutcome>;
};

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

export class CourseAgentToolRegistry {
  private readonly tools: Map<string, RegisteredTool>;
  constructor(repository: CourseRepository) {
    const query = new CourseAgentQueryService(repository);
    const patch = new CoursePatchService(repository);
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
          if (prepared.quizQuestionsChanged) return { kind: "confirmation", prepared, summary: "修改测验题目将清理本场旧作答记录" };
          const result = await patch.commitPrepared(prepared);
          return { kind: "completed", result, courseUpdate: { revision: result.afterRevision, affectedSceneIds: result.affectedSceneIds } };
        },
      }],
    ]);
  }
  definitions() { return [...this.tools.values()].map((tool) => tool.definition); }
  label(name: string) { return this.tools.get(name)?.label ?? name; }
  async execute(name: string, courseId: string, input: unknown) {
    const tool = this.tools.get(name);
    if (!tool) throw new AgentApplicationError("INVALID_ARGUMENT", `当前阶段没有注册工具 ${name}`);
    if (name === "list_scenes") ListScenesInput.parse(input);
    return tool.execute(courseId, input);
  }
}
