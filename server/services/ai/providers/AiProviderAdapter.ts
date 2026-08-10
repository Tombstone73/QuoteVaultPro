import type { AiFeature } from "@shared/aiFoundationContracts";

export interface AiProviderRequest {
  orgId: string;
  feature: AiFeature;
  system: string;
  user: string;
  promptVersion: string;
  repairAttempt?: boolean;
  timeoutMs?: number;
  timeoutUseCase?: string;
  maxTokens?: number;
  providerConfig?: {
    enabled: boolean;
    provider: string | null;
    model: string | null;
    endpoint: string | null;
    apiKey: string | null;
    mode: string;
    source: string;
  };
}

export interface AiProviderResponse {
  rawText: string;
  provider: string;
  model: string;
  requestMetadata: Record<string, unknown>;
  /** Ephemeral Responses continuation for a single live Operator runtime.
   * Never persist, log, or return this field to a client. */
  operatorContinuation?: {
    items: unknown[];
    functionCalls: Array<{ callId: string; toolName: string }>;
  };
}

export interface AiProviderOperatorRequest extends AiProviderRequest {
  toolCatalog: ReadonlyArray<{ name: string; description: string; inputSchema?: Record<string, unknown> }>;
  /** Safe, in-memory sequence number for one bounded Operator turn. */
  operatorRequestSequence?: number;
  /** Responses output retained only for this live Operator turn. It is never
   * persisted and may include provider reasoning needed for continuation. */
  responseContinuation?: readonly unknown[];
}

export interface AiProviderAdapter {
  generateJson(request: AiProviderRequest): Promise<AiProviderResponse>;
  generateBugReview(request: AiProviderRequest): Promise<AiProviderResponse>;
  generateTriageBrief(request: AiProviderRequest): Promise<AiProviderResponse>;
  generateOperatorDecision?(request: AiProviderOperatorRequest): Promise<AiProviderResponse>;
}

export class AiProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderUnavailableError";
  }
}

export class AiProviderTimeoutError extends Error {
  timeoutMs: number;
  elapsedMs: number;
  provider: string | null;
  model: string | null;
  useCase: string;

  constructor(args: {
    timeoutMs: number;
    elapsedMs: number;
    provider: string | null;
    model: string | null;
    useCase: string;
  }) {
    super(`AI provider request timed out after ${Math.round(args.timeoutMs / 1000)} seconds.`);
    this.name = "AiProviderTimeoutError";
    this.timeoutMs = args.timeoutMs;
    this.elapsedMs = args.elapsedMs;
    this.provider = args.provider;
    this.model = args.model;
    this.useCase = args.useCase;
  }
}

export type AiProviderFailureKind =
  | "http_failure"
  | "authentication_failure"
  | "rate_limit"
  | "malformed_response"
  | "empty_response"
  | "truncated_output"
  | "provider_protocol_failure";

export class AiProviderResponseError extends Error {
  kind: AiProviderFailureKind;
  status: number | null;
  provider: string | null;
  model: string | null;
  providerRequestId: string | null;

  constructor(args: {
    kind: AiProviderFailureKind;
    message: string;
    status?: number | null;
    provider?: string | null;
    model?: string | null;
    providerRequestId?: string | null;
  }) {
    super(args.message);
    this.name = "AiProviderResponseError";
    this.kind = args.kind;
    this.status = args.status ?? null;
    this.provider = args.provider ?? null;
    this.model = args.model ?? null;
    this.providerRequestId = args.providerRequestId ?? null;
  }
}
