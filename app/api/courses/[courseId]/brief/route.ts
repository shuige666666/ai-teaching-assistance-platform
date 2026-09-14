import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { CourseBriefService } from "@/lib/application/course-brief-service";
import { mapOutlineError, readLimitedJson } from "@/lib/application/outline-api";
import { CourseBriefOverridesSchema } from "@/lib/domain/course-brief";
import { getCourseRepository, getGenerationRunTracker } from "@/lib/repository";

type RouteContext = { params: Promise<{ courseId: string }> };

const EditBriefInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  changes: CourseBriefOverridesSchema,
}).strict();

/** 保存确认前的课程要求；服务端负责将依赖旧 Brief 的大纲整体失效。 */
export async function PATCH(request: Request, context: RouteContext) {
  const requestId = randomUUID();
  try {
    const { courseId } = await context.params;
    const input = EditBriefInputSchema.parse(await readLimitedJson(request));
    const course = await new CourseBriefService(getCourseRepository(), Date.now, getGenerationRunTracker()).edit(courseId, input.expectedRevision, input.changes);
    return NextResponse.json({ success: true, data: { course }, meta: { requestId } });
  } catch (error) {
    const mapped = mapOutlineError(error, requestId);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
