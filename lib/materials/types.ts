import { z } from "zod";

export const MAX_MATERIAL_FILES = 3;
export const MAX_MATERIAL_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_MATERIAL_TEXT_CHARS = 40_000;
export const MAX_MATERIAL_BLOCK_CHARS = 1_600;
export const MAX_SCENE_SOURCE_BLOCKS = 10;

export const MaterialBlockSchema = z.object({
  id: z.string().min(1).max(80),
  text: z.string().trim().min(1).max(MAX_MATERIAL_BLOCK_CHARS),
  pageNumber: z.number().int().positive().optional(),
  heading: z.string().max(200).optional(),
}).strict();

export const CourseMaterialSchema = z.object({
  id: z.string().uuid(),
  courseId: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(["application/pdf", "text/markdown", "text/plain"]),
  fileSize: z.number().int().positive().max(MAX_MATERIAL_FILE_BYTES),
  contentHash: z.string().length(64),
  pageCount: z.number().int().positive().optional(),
  selectedPages: z.array(z.number().int().positive()).optional(),
  blocks: z.array(MaterialBlockSchema).min(1),
  warnings: z.array(z.string()).default([]),
  createdAt: z.number().int().nonnegative(),
}).strict();

export type MaterialBlock = z.infer<typeof MaterialBlockSchema>;
export type CourseMaterial = z.infer<typeof CourseMaterialSchema>;
export type MaterialContextBlock = MaterialBlock & { materialId: string; fileName: string };

/** 材料错误保留可操作的提示，避免把解析失败伪装成无材料生成。 */
export class MaterialError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "MaterialError";
  }
}
