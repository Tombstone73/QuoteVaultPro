import type { AiFeature } from "@shared/aiFoundationContracts";

export interface AiProviderRequest {
  orgId: string;
  feature: AiFeature;
  system: string;
  user: string;
  promptVersion: string;
  repairAttempt?: boolean;
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
}

export interface AiProviderAdapter {
  generateJson(request: AiProviderRequest): Promise<AiProviderResponse>;
  generateBugReview(request: AiProviderRequest): Promise<AiProviderResponse>;
  generateTriageBrief(request: AiProviderRequest): Promise<AiProviderResponse>;
}

export class AiProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderUnavailableError";
  }
}
