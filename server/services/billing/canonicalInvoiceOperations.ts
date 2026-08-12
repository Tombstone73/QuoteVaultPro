import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { auditLogs, invoices, orders } from "@shared/schema";
import { db } from "../../db";
import { appendInvoiceInternalNoteCanonical, createInvoiceFromOrderInTransaction, markInvoiceSentCanonical, updateInvoiceSafeDraftCanonical, type CanonicalSafeInvoiceDraftPatch } from "../../invoicesService";

export class CanonicalInvoiceOperationError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 409) { super(message); }
}

/** Shared application boundary for reviewed Invoice operations. Financial math remains in invoicesService. */
export class CanonicalInvoiceOperations {
  async createDraftsFromOrders(input: { organizationId: string; actorUserId: string; orderIds: string[]; terms?: string; customDueDate?: Date | null; auditSource: "ui" | "assistant" | "automation" }) {
    const orderIds = Array.from(new Set(input.orderIds.map((id) => id.trim()).filter(Boolean))).sort();
    if (!orderIds.length) throw new CanonicalInvoiceOperationError("ORDER_REQUIRED", "At least one order is required.", 400);
    return db.transaction(async (tx) => {
      for (const orderId of orderIds) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${input.organizationId}:${orderId}`}))`);
      const existing = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.organizationId, input.organizationId), inArray(invoices.orderId, orderIds), ne(invoices.status, "void")));
      if (existing.length) throw new CanonicalInvoiceOperationError("INVOICE_ALREADY_EXISTS", "One or more selected orders already has an active invoice.");
      const created = [];
      for (const orderId of orderIds) {
        const invoice = await createInvoiceFromOrderInTransaction(tx, input.organizationId, orderId, input.actorUserId, { terms: input.terms ?? "due_on_receipt", customDueDate: input.customDueDate ?? null });
        await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "invoice_created", entityType: "invoice", entityId: invoice.id, entityName: String(invoice.invoiceNumber), description: "Created draft invoice through canonical Invoice operation.", newValues: { orderId, source: input.auditSource } as any } as any);
        created.push(invoice);
      }
      return created;
    });
  }
  updateSafeDraft(input: { organizationId: string; actorUserId: string; invoiceId: string; patch: CanonicalSafeInvoiceDraftPatch }) { return updateInvoiceSafeDraftCanonical({ organizationId: input.organizationId, invoiceId: input.invoiceId, userId: input.actorUserId, patch: input.patch }); }
  markSent(input: { organizationId: string; actorUserId: string; invoiceId: string; via?: "email" | "manual" | "portal" }) { return markInvoiceSentCanonical({ organizationId: input.organizationId, invoiceId: input.invoiceId, userId: input.actorUserId, via: input.via }); }
  addInternalNote(input: { organizationId: string; actorUserId: string; invoiceId: string; note: string }) { return appendInvoiceInternalNoteCanonical({ organizationId: input.organizationId, invoiceId: input.invoiceId, userId: input.actorUserId, note: input.note }); }

  async finalize(input: { organizationId: string; actorUserId: string; actorUserName?: string | null; invoiceId: string }) {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${input.organizationId}:${input.invoiceId}`}))`);
      const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.organizationId, input.organizationId))).limit(1);
      if (!invoice) throw new CanonicalInvoiceOperationError("INVOICE_NOT_FOUND", "Invoice not found.", 404);
      const status = String(invoice.status || "").toLowerCase();
      if (status === "void") throw new CanonicalInvoiceOperationError("INVOICE_NOT_FINALIZABLE", "Void invoices cannot be finalized.", 400);
      if (status !== "draft") return { invoice, transitioned: false };
      const issuedAt = new Date();
      const [updated] = await tx.update(invoices).set({ status: "finalized", issuedAt, qbSyncStatus: "not_synced", qbLastError: null, updatedAt: issuedAt } as any).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId))).returning();
      if (invoice.orderId) await tx.update(orders).set({ billingStatus: "billed", updatedAt: new Date() } as any).where(and(eq(orders.id, invoice.orderId), eq(orders.organizationId, input.organizationId)));
      await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, userName: input.actorUserName ?? null, actionType: "invoice_finalized", entityType: "invoice", entityId: invoice.id, entityName: String(invoice.invoiceNumber), description: "Invoice finalized through the canonical Invoice operation." } as any);
      return { invoice: updated, transitioned: true };
    });
    if (result.transitioned && result.invoice.orderId) {
      const { applyWorkflowStatusPillFailSoft } = await import("../workflowStatusPillService");
      await applyWorkflowStatusPillFailSoft({ organizationId: input.organizationId, orderId: String(result.invoice.orderId), triggerKey: "invoice_finalized", actorUserId: input.actorUserId, actorUserName: input.actorUserName || "System", source: "system", reason: "Invoice finalized", metadata: { invoiceId: result.invoice.id } });
    }
    return result.invoice;
  }
}
export const canonicalInvoiceOperations = new CanonicalInvoiceOperations();
