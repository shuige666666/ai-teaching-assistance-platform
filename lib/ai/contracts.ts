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

export type AIResponseKind =
  | "aborted"
  | "network_error"
  | "http_error"
  | "response_read_error"
  | "empty_body"
  | "invalid_json"
  | "invalid_envelope"
  | "empty_content";

export interface AIAdapterDiagnostics {
  providerStatus?: number;
  responseKind: AIResponseKind;
  contentType?: string;
  responseBytes?: number;
  finishReason?: string;
}

interface AIAdapterErrorOptions extends ErrorOptions {
  diagnostics?: AIAdapterDiagnostics;
  automaticRetryable?: boolean;
}

export class AIAdapterError extends Error {
  public readonly diagnostics?: AIAdapterDiagnostics;
  public readonly automaticRetryable: boolean;

  constructor(
    public readonly code: AIErrorCode,
    message: string,
    public readonly retryable: boolean,
    options?: AIAdapterErrorOptions,
  ) {
    super(message, options);
    this.name = "AIAdapterError";
    this.diagnostics = options?.diagnostics;
    // 用户可手动重试不等于当前已取消的请求还应自动重试。
    this.automaticRetryable = options?.automaticRetryable ?? retryable;
  }
}
