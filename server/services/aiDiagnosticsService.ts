import { sanitizeAiDiagnosticEnvelope, type AiDiagnosticEnvelope } from "@shared/aiDiagnostics";

const safeBuildValue = (value: unknown): string | null => typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : null;

/** Deployment providers expose different variable names. Read a small
 * allowlist only; diagnostics must never record environment configuration. */
export function resolveAiDiagnosticDeploymentFingerprint(env: NodeJS.ProcessEnv = process.env) {
  return {
    gitSha: safeBuildValue(env.RAILWAY_GIT_COMMIT_SHA ?? env.VERCEL_GIT_COMMIT_SHA ?? env.GIT_SHA ?? env.SOURCE_VERSION),
    buildId: safeBuildValue(env.RAILWAY_DEPLOYMENT_ID ?? env.VERCEL_DEPLOYMENT_ID ?? env.BUILD_ID),
    environment: safeBuildValue(env.RAILWAY_ENVIRONMENT ?? env.VERCEL_ENV ?? env.NODE_ENV),
    operatorArchitectureVersion: "operator-business-operations-v1",
  };
}

function safePersistenceErrorCode(error: unknown): string {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : null;
  return typeof code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : "unknown";
}

function logPersistenceFailure(envelope: AiDiagnosticEnvelope | null, stage: "validation" | "insert", error: unknown) {
  // Deliberately excludes database messages, connection details, provider output, and stack traces.
  console.warn("[AI_DIAGNOSTICS] Persistence failed.", {
    reference: envelope?.referenceId ?? "unavailable",
    diagnosticType: envelope?.diagnosticType ?? "unavailable",
    persistenceStage: stage,
    databaseErrorCode: safePersistenceErrorCode(error),
    tenantId: envelope?.tenantId ?? "unavailable",
    correlationId: envelope?.correlationId ?? "unavailable",
  });
}

const safeIdentifier = (value: unknown): string | null => typeof value === "string" && value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null;

/** Keep a lookup record even when one optional structural field exceeded the
 * diagnostic schema. The fallback contains only server-owned identifiers and
 * stage/error tokens; it never stores provider output or request content. */
export function sanitizeOrFallbackAiDiagnosticEnvelope(value: unknown): AiDiagnosticEnvelope | null {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  try { return sanitizeAiDiagnosticEnvelope({ ...raw, deployment: resolveAiDiagnosticDeploymentFingerprint() }); }
  catch {
    const referenceId = safeIdentifier(raw.referenceId);
    const correlationId = safeIdentifier(raw.correlationId);
    const tenantId = safeIdentifier(raw.tenantId);
    if (!referenceId || !correlationId || !tenantId) return null;
    const diagnosticType = ["ai_planner", "product_intent_compiler", "specialist_dispatch", "operator_runtime"].includes(String(raw.diagnosticType)) ? raw.diagnosticType : "operator_runtime";
    return sanitizeAiDiagnosticEnvelope({ version: 1, referenceId, correlationId, diagnosticType, tenantId,
      actorId: safeIdentifier(raw.actorId), conversationId: safeIdentifier(raw.conversationId), provider: null, model: null, providerRequestId: null,
      stage: "diagnostic_payload_validation_failed", errorCode: "diagnostic_sanitization_failed", providerResponseState: "contract_failed",
      parseMethod: "none", repairAttempted: false, repairResult: "not_attempted", validationSchema: null, validationIssuePaths: [], validationIssueCodes: [],
      returnedTopLevelKeys: [], missingRequiredKeys: [], unknownKeys: [], plannerOperation: null, selectedCapability: null, specialistName: null,
      optionNormalizationStage: null, resolverStage: null, persistenceAttempted: true, persistenceResult: "succeeded", createdAt: new Date().toISOString(),
      deployment: resolveAiDiagnosticDeploymentFingerprint() });
  }
}

/** The sole write boundary for sanitized AI failure diagnostics. */
export async function persistAiDiagnostic(value: unknown): Promise<AiDiagnosticEnvelope | null> {
  const envelope = sanitizeOrFallbackAiDiagnosticEnvelope(value);
  if (!envelope) { logPersistenceFailure(null, "validation", new Error("diagnostic_identifier_invalid")); return null; }
  try {
    const { db } = await import("../db");
    const { aiAuditEvents } = await import("@shared/schema");
    await db.insert(aiAuditEvents).values({ orgId: envelope.tenantId, actorUserId: envelope.actorId, conversationId: envelope.conversationId, eventType: "ai_diagnostic", status: "failed", correlationId: envelope.correlationId, metadata: envelope });
    return envelope;
  } catch (error) {
    logPersistenceFailure(envelope, "insert", error);
    return null;
  }
}
