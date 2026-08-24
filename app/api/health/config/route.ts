import { NextResponse } from "next/server";
import { resolveAIConfig } from "@/lib/ai/config";
import { AIAdapterError } from "@/lib/ai/contracts";
import { createApiError } from "@/lib/repository/error-response";

/** 校验当前启用的 AI 配置，只返回模式、Provider 和模型，不暴露 Key 或 Base URL。 */
export async function GET() {
  try {
    const config = resolveAIConfig();
    return NextResponse.json({
      status: "ok",
      mode: config.mode,
      provider: config.provider,
      model: config.model,
      timeouts: { outlineMs: config.timeoutMs, sceneMs: config.sceneTimeoutMs },
    });
  } catch (error) {
    const message = error instanceof AIAdapterError ? error.message : "AI 服务端配置无效";
    return NextResponse.json(createApiError("AI_NOT_CONFIGURED", message, false), { status: 503 });
  }
}
