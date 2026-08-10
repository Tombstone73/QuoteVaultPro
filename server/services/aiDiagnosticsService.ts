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

/** The sole write boundary for sanitized AI failure diagnostics. */
export async function persistAiDiagnostic(value: unknown): Promise<AiDiagnosticEnvelope | null> {
  let envelope: AiDiagnosticEnvelope;
  try {
    envelope = sanitizeAiDiagnosticEnvelope({ ...(value && typeof value === "object" ? value : {}), deployment: resolveAiDiagnosticDeploymentFingerprint() });
  } catch (error) {
    logPersistenceFailure(null, "validation", error);
    return null;
  }
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
