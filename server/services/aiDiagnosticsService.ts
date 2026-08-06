import { sanitizeAiDiagnosticEnvelope, type AiDiagnosticEnvelope } from "@shared/aiDiagnostics";

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
    envelope = sanitizeAiDiagnosticEnvelope(value);
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
