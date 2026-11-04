import { AiProviderResponseError, type AiProviderAdapter, type AiProviderRequest } from "../ai/providers/AiProviderAdapter";
import type { InboundParseDeadline } from "./inboundParseDeadline";

/** Retry only a positively identified output truncation, once, with the same
 * evidence and the original overall deadline. Never splice partial JSON or
 * resume it into a valid proposal. Every returned object is validated later. */
export async function generateInboundJson(provider: Pick<AiProviderAdapter, "generateJson">, request: AiProviderRequest, deadline: InboundParseDeadline) {
  const run = (maxTokens: number) => deadline.run("provider_request", () => provider.generateJson({ ...request, maxTokens }), request.timeoutMs);
  try { return await run(8192); }
  catch (error) {
    if (!(error instanceof AiProviderResponseError) || error.kind !== "truncated_output" || deadline.signal.aborted) throw error;
    console.info("[InboundParse]", { parseAttemptId: deadline.id, stage: "provider_request", event: "truncation_retry", maxTokens: 12_288 });
    const response = await run(12_288);
    return { ...response, requestMetadata: { ...response.requestMetadata, truncationRecoveryRetries: 1 } };
  }
}
