import { and, eq, sql } from "drizzle-orm";
import { auditLogs } from "@shared/schema";

/** Same request is serialized across processes and survives a lost HTTP response. */
export async function runProofGenerationRequest<T>(tx: any, input: {
  organizationId: string; actorUserId: string; requestId?: string; fingerprint: string;
}, generate: () => Promise<T>): Promise<T> {
  if (!input.requestId) return generate(); // compatibility for older clients
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.organizationId}), hashtext(${`proof-generation:${input.requestId}`}))`);
  const [previous] = await tx.select({ values: auditLogs.newValues }).from(auditLogs).where(and(
    eq(auditLogs.organizationId, input.organizationId), eq(auditLogs.entityType, "proof_generation_request"),
    eq(auditLogs.entityId, input.requestId),
    sql`${auditLogs.newValues}->>'requestId' = ${input.requestId}`,
  )).limit(1);
  if (previous) {
    if (previous.values.actorUserId !== input.actorUserId || previous.values.fingerprint !== input.fingerprint) {
      throw Object.assign(new Error("This proof generation request changed. Start a new generation request."), { statusCode: 409, code: "PROOF_GENERATION_REQUEST_CHANGED" });
    }
    return previous.values.result as T;
  }
  const result = await generate();
  await tx.insert(auditLogs).values({
    organizationId: input.organizationId, userId: input.actorUserId, actionType: "CREATE",
    entityType: "proof_generation_request", entityId: input.requestId,
    description: "Completed proof generation request", newValues: { requestId: input.requestId, actorUserId: input.actorUserId, fingerprint: input.fingerprint, result },
  });
  return result;
}
