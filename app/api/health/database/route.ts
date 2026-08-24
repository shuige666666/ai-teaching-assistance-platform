import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/lib/db/pool";
import { createApiError } from "@/lib/repository/error-response";

/** 提供不包含主机、用户和密码的数据库健康信息。 */
export async function GET() {
  try {
    const health = await checkDatabaseHealth();
    return NextResponse.json({ status: "ok", database: health.database, version: health.version });
  } catch {
    return NextResponse.json(createApiError("DATABASE_UNAVAILABLE", "数据库暂时不可用", true), { status: 503 });
  }
}
