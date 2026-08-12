import { computeInvoicePaymentRollup } from "@shared/rollups/invoicePaymentRollup";
import { appendPaymentNoteCanonical, getInvoiceWithRelations, recordManualPaymentCanonical, type CanonicalInternalManualPaymentMethod } from "../../invoicesService";

export const canonicalManualPaymentMethodValues = ["cash", "check", "wire", "bank_transfer", "ach", "other"] as const;
export type CanonicalManualPaymentMethod = typeof canonicalManualPaymentMethodValues[number];
export class CanonicalPaymentOperationError extends Error { constructor(readonly code: string, message: string, readonly statusCode = 409) { super(message); } }

/** Shared exact-cents, tenant-scoped and idempotent manual-payment boundary. */
export class CanonicalPaymentOperations {
  async recordManualPayment(input: { organizationId: string; actorUserId: string; invoiceId: string; amountCents: number; method: CanonicalManualPaymentMethod; appliedAt?: Date; notes?: string; reference?: string; idempotencyKey: string; source: "ui" | "assistant" }) {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new CanonicalPaymentOperationError("PAYMENT_AMOUNT_INVALID", "Payment amount must be a positive number of cents.", 400);
    if (!canonicalManualPaymentMethodValues.includes(input.method)) throw new CanonicalPaymentOperationError("PAYMENT_METHOD_NOT_ALLOWED", "Payment method is not supported for manual recording.", 400);
    if (!input.idempotencyKey.trim()) throw new CanonicalPaymentOperationError("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.", 400);
    const payment = await recordManualPaymentCanonical({ organizationId: input.organizationId, invoiceId: input.invoiceId, userId: input.actorUserId, amount: input.amountCents / 100, method: input.method as CanonicalInternalManualPaymentMethod, paidAt: input.appliedAt, notes: input.notes, idempotencyKey: input.idempotencyKey, source: input.source, reference: input.reference });
    const relations = await getInvoiceWithRelations(input.invoiceId);
    if (!relations || (relations.invoice as any).organizationId !== input.organizationId) throw new CanonicalPaymentOperationError("INVOICE_NOT_FOUND", "Invoice not found.", 404);
    const rollup = computeInvoicePaymentRollup({ invoiceTotalCents: Number((relations.invoice as any).totalCents || 0), payments: relations.payments.map((row: any) => ({ id: row.id, status: String(row.status || "succeeded"), amountCents: Number(row.amountCents || 0) })) });
    return { payment, invoice: relations.invoice, rollup };
  }
  addInternalNote(input: { organizationId: string; actorUserId: string; paymentId: string; note: string }) {
    return appendPaymentNoteCanonical({ organizationId: input.organizationId, paymentId: input.paymentId, userId: input.actorUserId, note: input.note });
  }
}
export const canonicalPaymentOperations = new CanonicalPaymentOperations();
