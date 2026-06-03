export interface AiProviderRequest {
  orgId: string;
  feature: "bug_review";
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
  generateBugReview(request: AiProviderRequest): Promise<AiProviderResponse>;
}

export class AiProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderUnavailableError";
  }
}
