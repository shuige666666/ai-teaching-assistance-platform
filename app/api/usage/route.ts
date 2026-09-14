import { NextResponse } from "next/server";
import { buildUsageResponse, type UsageRange } from "@/lib/domain/generation-run";
import { resolveRequestId } from "@/lib/observability/server-log";
import { getGenerationRunRepository } from "@/lib/repository";
import { mapRepositoryError } from "@/lib/repository/error-response";

export const dynamic = "force-dynamic";

const ranges = new Set<UsageRange>(["7d", "30d", "all"]);

/** 返回课程生成运行的只读汇总，不把设置页查询混入课程聚合。 */
export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    const candidate = new URL(request.url).searchParams.get("range") ?? "30d";
    if (!ranges.has(candidate as UsageRange)) {
      return NextResponse.json({ success: false, error: { code: "INVALID_RANGE", message: "统计范围只支持 7d、30d 或 all", retryable: false, requestId } }, { status: 400 });
    }
    const range = candidate as UsageRange;
    const now = Date.now();
    const startedAtFrom = range === "all" ? undefined : now - (range === "7d" ? 7 : 30) * 24 * 60 * 60 * 1_000;
    const runs = await getGenerationRunRepository().listForUsage(startedAtFrom);
    return NextResponse.json({ success: true, data: buildUsageResponse(runs), meta: { requestId, range, generatedAt: now } });
  } catch (error) {
    const mapped = mapRepositoryError(error, requestId);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
