import { getInvoiceEmailDeliveryFailureKind } from "./invoiceEmailDeliveryFailure";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { auditLogs } from "@shared/schema";
import { db } from "../db";
import { emailService } from "../emailService";

export type ProofDelivery = { status: "pending" | "accepted" | "failed" | "unknown"; retryable: boolean; message: string };

/** Called inside the proof workflow transaction, before tokens or recipients change. */
export async function claimProofEmailDelivery(tx: any, input: { organizationId: string; proofVersionId: string; actorUserId: string; requestId?: string }) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.organizationId}), hashtext(${`proof-email:${input.proofVersionId}`}))`);
  const attempts = await tx.select().from(auditLogs).where(and(
    eq(auditLogs.organizationId, input.organizationId), eq(auditLogs.entityType, "proof_email_delivery"),
    eq(auditLogs.entityId, input.proofVersionId),
  )).orderBy(desc(auditLogs.createdAt));
  if (attempts.some((attempt: any) => attempt.newValues?.status === "pending" || attempt.newValues?.status === "unknown")) {
    throw Object.assign(new Error("A proof email delivery is still pending or its outcome is unknown. Check email delivery before sending again; the proof version is preserved."), { statusCode: 409 });
  }
  if (input.requestId && attempts.some((attempt: any) => attempt.newValues?.requestId === input.requestId)) {
    throw Object.assign(new Error("This email request was already processed. Refresh the proof delivery status before starting a new send."), { statusCode: 409 });
  }
  const id = randomUUID();
  await tx.insert(auditLogs).values({ id, organizationId: input.organizationId, userId: input.actorUserId,
    actionType: "CREATE", entityType: "proof_email_delivery", entityId: input.proofVersionId,
    description: "Proof email delivery attempt", newValues: { requestId: input.requestId ?? id, status: "pending", retryable: false, message: "Email delivery is pending; customer approval status is separate." } });
  return id;
}

/** Transport acceptance is not customer receipt or approval. No private transport errors are returned. */
export async function deliverProofEmail(input: { organizationId: string; attemptId: string; to: string; subject: string; html: string }): Promise<ProofDelivery> {
  let delivery: ProofDelivery;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      emailService.sendEmail(input.organizationId, { to: input.to, subject: input.subject, html: input.html }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Proof email delivery timed out")), 45_000); }),
    ]);
    delivery = { status: "accepted", retryable: false, message: "Email service accepted the proof notification. Customer receipt and approval are not confirmed." };
  } catch (error) {
    const kind = getInvoiceEmailDeliveryFailureKind(error);
    const configurationFailure = /Email settings not configured|Gmail is not connected|Gmail OAuth app is not configured/i.test(error instanceof Error ? error.message : "");
    const uncertain = kind === "needs_review" || (kind !== "retryable" && !configurationFailure);
    delivery = uncertain
      ? { status: "unknown", retryable: false, message: "Email delivery outcome is unknown. Check sent mail before retrying; the proof remains available for review." }
      : { status: "failed", retryable: true, message: "Proof email delivery failed. Check email settings and retry notification for this exact version. The proof and customer response state are preserved." };
  }
  clearTimeout(timer);
  await db.update(auditLogs).set({ newValues: sql`coalesce(${auditLogs.newValues}, '{}'::jsonb) || ${JSON.stringify(delivery)}::jsonb`, description: `Proof email delivery ${delivery.status}` })
    .where(and(eq(auditLogs.organizationId, input.organizationId), eq(auditLogs.id, input.attemptId)));
  return delivery;
}
