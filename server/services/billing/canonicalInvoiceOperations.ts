import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { auditLogs, invoices } from "@shared/schema";
import { db } from "../../db";
import { appendInvoiceInternalNoteCanonical, createInvoiceFromOrderInTransaction, markInvoiceSentCanonical, updateInvoiceSafeDraftCanonical, type CanonicalSafeInvoiceDraftPatch } from "../../invoicesService";

export class CanonicalInvoiceOperationError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 409) { super(message); }
}

/** Shared application boundary for reviewed Invoice operations. Financial math remains in invoicesService. */
export class CanonicalInvoiceOperations {
  async createOrderBackedInvoicesFromOrders(input: { organizationId: string; actorUserId: string; orderIds: string[]; terms?: string; customDueDate?: Date | null; auditSource: "ui" | "assistant" | "automation" }) {
    const orderIds = Array.from(new Set(input.orderIds.map((id) => id.trim()).filter(Boolean))).sort();
    if (!orderIds.length) throw new CanonicalInvoiceOperationError("ORDER_REQUIRED", "At least one order is required.", 400);
    return db.transaction(async (tx) => {
      for (const orderId of orderIds) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${input.organizationId}:${orderId}`}))`);
      const existing = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.organizationId, input.organizationId), inArray(invoices.orderId, orderIds), ne(invoices.status, "void")));
      if (existing.length) throw new CanonicalInvoiceOperationError("INVOICE_ALREADY_EXISTS", "One or more selected orders already has an active invoice.");
      const created = [];
      for (const orderId of orderIds) {
        const invoice = await createInvoiceFromOrderInTransaction(tx, input.organizationId, orderId, input.actorUserId, { terms: input.terms ?? "due_on_receipt", customDueDate: input.customDueDate ?? null });
        await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "invoice_created", entityType: "invoice", entityId: invoice.id, entityName: String(invoice.invoiceNumber), description: "Created live Order-backed invoice through canonical Invoice operation.", newValues: { orderId, source: input.auditSource } as any } as any);
        created.push(invoice);
      }
      return created;
    });
  }
  updateSafeDraft(input: { organizationId: string; actorUserId: string; invoiceId: string; patch: CanonicalSafeInvoiceDraftPatch }) { return updateInvoiceSafeDraftCanonical({ organizationId: input.organizationId, invoiceId: input.invoiceId, userId: input.actorUserId, patch: input.patch }); }
  markSent(input: { organizationId: string; actorUserId: string; invoiceId: string; via?: "email" | "manual" | "portal" }) { return markInvoiceSentCanonical({ organizationId: input.organizationId, invoiceId: input.invoiceId, userId: input.actorUserId, via: input.via }); }
  addInternalNote(input: { organizationId: string; actorUserId: string; invoiceId: string; note: string }) { return appendInvoiceInternalNoteCanonical({ organizationId: input.organizationId, invoiceId: input.invoiceId, userId: input.actorUserId, note: input.note }); }
}
export const canonicalInvoiceOperations = new CanonicalInvoiceOperations();
