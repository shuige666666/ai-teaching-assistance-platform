import { NextResponse } from "next/server";
import { z } from "zod";
import { CourseMaterialService } from "@/lib/application/course-material-service";
import { mapOutlineError, readLimitedJson } from "@/lib/application/outline-api";
import { getCourseRepository } from "@/lib/repository";
import { MaterialError, MAX_MATERIAL_FILES, MAX_MATERIAL_FILE_BYTES } from "@/lib/materials/types";
import { resolveRequestId, startServerOperation } from "@/lib/observability/server-log";

export const runtime = "nodejs";
type Context = { params: Promise<{ courseId: string }> };
const RevisionSchema = z.coerce.number().int().nonnegative();

/** 按课程返回已保存的原文片段，供解析预览和页面来源查看使用。 */
export async function GET(request: Request, context: Context) {
  const requestId = resolveRequestId(request);
  try {
    const { courseId } = await context.params;
    const repository = getCourseRepository();
    if (!await repository.get(courseId)) throw new MaterialError("COURSE_NOT_FOUND", "课程不存在", 404);
    return NextResponse.json({ success: true, data: { materials: await repository.listMaterials(courseId) } });
  } catch (error) {
    const mapped = mapOutlineError(error, requestId);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

/** 接收文件本身并在服务端解析，不接受浏览器提供的原文或来源 ID。 */
export async function POST(request: Request, context: Context) {
  const requestId = resolveRequestId(request);
  const operation = startServerOperation("material.replace", { requestId, stage: "material" });
  try {
    const { courseId } = await context.params;
    if (Number(request.headers.get("content-length")) > MAX_MATERIAL_FILES * MAX_MATERIAL_FILE_BYTES + 64 * 1024) throw new MaterialError("MATERIAL_REQUEST_TOO_LARGE", "上传请求过大，每份材料最多 10 MB", 413);
    const form = await request.formData();
    const revision = form.get("expectedRevision");
    if (typeof revision !== "string" || !/^\d+$/.test(revision)) throw new MaterialError("INVALID_REQUEST", "缺少有效的课程版本号");
    const files = form.getAll("files");
    const ranges = form.getAll("pageRanges");
    if (files.some((file) => !(file instanceof File))) throw new MaterialError("INVALID_REQUEST", "请上传文件本身");
    const uploads = files.map((file, index) => ({ file: file as File, pageRange: typeof ranges[index] === "string" ? ranges[index] as string : "" }));
    const result = await new CourseMaterialService(getCourseRepository()).replace(courseId, RevisionSchema.parse(revision), uploads, request.signal);
    operation.success({ courseId, materialCount: result.materials.length });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    operation.failure(error);
    const mapped = mapOutlineError(error, requestId);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

/** 删除材料并使依赖它的大纲失效，revision 阻止并发上传或生成互相覆盖。 */
export async function DELETE(request: Request, context: Context) {
  const requestId = resolveRequestId(request);
  try {
    const { courseId } = await context.params;
    const input = z.object({ expectedRevision: z.number().int().nonnegative(), materialId: z.string().uuid() }).strict().parse(await readLimitedJson(request));
    const result = await new CourseMaterialService(getCourseRepository()).remove(courseId, input.expectedRevision, input.materialId);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const mapped = mapOutlineError(error, requestId);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
