import { db } from "../db";
import { aiAuditEvents } from "@shared/schema";
import { sanitizeAiDiagnosticEnvelope, type AiDiagnosticEnvelope } from "@shared/aiDiagnostics";

/** The sole write boundary for sanitized AI failure diagnostics. */
export async function persistAiDiagnostic(value: unknown): Promise<AiDiagnosticEnvelope | null> {
  try {
    const envelope = sanitizeAiDiagnosticEnvelope(value);
    await db.insert(aiAuditEvents).values({ orgId: envelope.tenantId, actorUserId: envelope.actorId, conversationId: envelope.conversationId, eventType: "ai_diagnostic", status: "failed", correlationId: envelope.correlationId, metadata: envelope });
    return envelope;
  } catch {
    return null;
  }
}
