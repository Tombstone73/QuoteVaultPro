export interface AiProviderRequest {
  system: string;
  user: string;
  promptVersion: string;
  repairAttempt?: boolean;
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
