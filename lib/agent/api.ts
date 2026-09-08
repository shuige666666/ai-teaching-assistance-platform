import { randomUUID } from "node:crypto";
import { z } from "zod";
import { mapRepositoryError } from "@/lib/repository/error-response";
import { AgentApplicationError } from "./contracts";

export function mapAgentError(error: unknown, requestId = randomUUID()) {
  if (error instanceof AgentApplicationError) {
    return { status: error.status, body: { success: false as const, error: { code: error.code, message: error.message, retryable: error.code === "COURSE_CONFLICT" || error.code === "RUN_IN_PROGRESS", requestId } } };
  }
  if (error instanceof z.ZodError) {
    return { status: 400, body: { success: false as const, error: { code: "INVALID_ARGUMENT", message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；"), retryable: false, requestId } } };
  }
  return mapRepositoryError(error, requestId);
}

