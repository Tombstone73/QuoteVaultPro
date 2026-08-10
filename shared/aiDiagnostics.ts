import { z } from "zod";

const safeId = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const safeText = z.string().trim().min(1).max(160);

/** Persisted diagnostic metadata. It is deliberately summary-only: prompts,
 * model output, credentials, headers, URLs, and stack traces are excluded. */
export const aiDiagnosticEnvelopeSchema = z.object({
  version: z.literal(1), referenceId: safeId, correlationId: safeId,
  diagnosticType: z.enum(["ai_planner", "product_intent_compiler", "specialist_dispatch", "operator_runtime"]),
  tenantId: safeId, actorId: safeId.nullable(), conversationId: safeId.nullable(),
  provider: safeText.nullable(), model: safeText.nullable(), providerRequestId: safeId.nullable(),
  stage: safeText, errorCode: safeText.nullable(), providerResponseState: z.enum(["not_received", "received", "empty", "parse_failed", "contract_failed", "accepted"]),
  parseMethod: z.enum(["none", "raw_json", "extracted_json", "repaired_json"]), repairAttempted: z.boolean(), repairResult: z.enum(["not_attempted", "succeeded", "failed"]),
  validationSchema: safeText.nullable(), validationIssuePaths: z.array(safeText).max(20), validationIssueCodes: z.array(safeText).max(20),
  returnedTopLevelKeys: z.array(safeText).max(30), missingRequiredKeys: z.array(safeText).max(30), unknownKeys: z.array(safeText).max(30),
  /** Safe protocol tokens only (for example a root `kind`); raw provider
   * output is never retained in diagnostics. */
  providerResponseKinds: z.array(safeText).max(2).optional(),
  plannerOperation: safeText.nullable(), selectedCapability: safeText.nullable(), specialistName: safeText.nullable(),
  optionNormalizationStage: safeText.nullable(), resolverStage: safeText.nullable(), persistenceAttempted: z.boolean(), persistenceResult: z.enum(["not_attempted", "succeeded", "failed"]), createdAt: z.string().datetime(),
  /** Continuation-only context. These are server-owned identifiers and
   * structural summaries; neither provider output nor customer content is kept. */
  sessionId: safeId.nullable().optional(), currentRevision: z.number().int().nonnegative().nullable().optional(),
  patchOperationCount: z.number().int().nonnegative().max(50).nullable().optional(), patchPaths: z.array(safeText).max(30).optional(),
  /** Safe server-derived details for an Operator Product Builder batch. This
   * makes a failed dependent edit diagnosable without persisting model prose. */
  semanticBatch: z.object({
    operationCount: z.number().int().nonnegative().max(24),
    operationTypes: z.array(safeText).max(24),
    failingOperation: z.object({
      index: z.number().int().positive(), type: safeText, targetLabels: z.array(safeText).max(4),
      validationStage: safeText, dependsOnPriorBatchOperation: z.boolean(), failureCode: safeText.nullable(),
    }).strict().nullable(),
    originalRevisionUnchanged: z.boolean(),
  }).strict().optional(),
  /** Safe structural facts for an ordinary Operator failure. These identify
   * the rejected boundary without retaining prompts, arguments, observations,
   * or provider reasoning. */
  operatorRuntime: z.object({
    step: z.number().int().positive().max(25),
    decisionType: safeText.nullable(), toolName: safeText.nullable(),
    argumentValidationSucceeded: z.boolean(), handlerEntered: z.boolean(),
    observationReturned: z.boolean(), continuationStarted: z.boolean(),
    finalResultAccepted: z.boolean(), failureKind: safeText.nullable(),
    providerDecisionShape: z.object({
      responseItemCount: z.number().int().nonnegative().max(64).nullable(), responseItemTypes: z.array(safeText).max(32), unknownItemTypes: z.array(safeText).max(16),
      outputTextPresent: z.boolean(), outputTextItemCount: z.number().int().nonnegative().max(64).nullable().optional().default(null), outputTextLengths: z.array(z.number().int().nonnegative().max(1_000_000)).max(32).optional().default([]), textBeginsKnownTransportMarker: z.boolean().optional().default(false), textEndsKnownTransportMarker: z.boolean().optional().default(false), finalTextRemainingAfterTransportStripping: z.boolean().optional().default(false), finalTextLength: z.number().int().nonnegative().max(1_000_000).nullable(), functionCallItemCount: z.number().int().nonnegative().max(24).nullable().optional().default(null), functionCallCount: z.number().int().nonnegative().max(24).nullable(), functionArgumentDecodeSucceeded: z.boolean().nullable(),
      responseStatus: safeText.nullable(), terminalClassification: safeText.nullable(), decisionDiscriminator: safeText.nullable().optional().default(null), structuredDecisionPresent: z.boolean().optional().default(false), parseClassification: safeText.nullable(), controlProtocolDetected: z.boolean(), decisionParseStage: z.literal("operator_decision_parse"),
    }).strict().nullable().optional(),
  }).strict().optional(),
  /** Runtime identity is safe operational metadata. It lets an administrator
   * distinguish an old deployment from the current Operator architecture
   * without retaining prompts, provider output, URLs, or credentials. */
  deployment: z.object({ gitSha: safeText.nullable(), buildId: safeText.nullable(), environment: safeText.nullable(), operatorArchitectureVersion: safeText.nullable() }).strict().optional(),
}).strict();
export type AiDiagnosticEnvelope = z.infer<typeof aiDiagnosticEnvelopeSchema>;

export function sanitizeAiDiagnosticEnvelope(value: unknown): AiDiagnosticEnvelope {
  return aiDiagnosticEnvelopeSchema.parse(value);
}
