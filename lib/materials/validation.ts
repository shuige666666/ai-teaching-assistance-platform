import { z } from "zod";
import { buildMaterialContext } from "./context";
import { CourseMaterialSchema, MaterialError, MAX_MATERIAL_FILES, type CourseMaterial } from "./types";

/** 校验材料归属和总预算，保证数据库与内存实现使用同一边界。 */
export function validateCourseMaterials(courseId: string, value: unknown): CourseMaterial[] {
  const materials = z.array(CourseMaterialSchema).max(MAX_MATERIAL_FILES).parse(value);
  if (materials.some((material) => material.courseId !== courseId)) throw new MaterialError("INVALID_MATERIAL_OWNER", "材料不属于当前课程");
  const blocks = buildMaterialContext(materials);
  if (new Set(materials.map((material) => material.id)).size !== materials.length || new Set(blocks.map((block) => block.id)).size !== blocks.length) {
    throw new MaterialError("INVALID_MATERIAL_IDS", "材料或片段 ID 重复");
  }
  return materials;
}
