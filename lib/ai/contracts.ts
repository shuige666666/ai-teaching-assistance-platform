import type { GenerationMetadata } from "@/lib/domain/schemas";

export type AIProvider = GenerationMetadata["provider"];
export type GenerationStage = "outline" | "scene" | "repair";

export interface GenerateTextInput {
  requestId: string;
  stage: GenerationStage;
  systemPrompt: string;
  userPrompt: string;
  signal: AbortSignal;
  maxOutputTokens: number;
}

export interface GenerateTextResult {
  text: string;
  provider: AIProvider;
  model: string;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AIAdapter {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
}

export type AIErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_AUTH_FAILED"
  | "AI_RATE_LIMITED"
  | "AI_TIMEOUT"
  | "AI_UPSTREAM_ERROR";

export class AIAdapterError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    public readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AIAdapterError";
  }
}
