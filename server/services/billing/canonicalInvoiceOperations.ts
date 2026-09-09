import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { auditLogs, invoices, orderLineItems, orders, products } from "@shared/schema";
import { db } from "../../db";
import { appendInvoiceInternalNoteCanonical, createInvoiceFromOrderInTransaction, markInvoiceSentCanonical, updateInvoiceSafeDraftCanonical, type CanonicalSafeInvoiceDraftPatch } from "../../invoicesService";
import { isCanceledOrder } from "../../../shared/operationalState";
import { recomputeOrderBillingStatus, resolveInvoiceFinancialEligibility } from "../orderBillingService";

export class CanonicalInvoiceOperationError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 409) { super(message); }
}

/** Shared application boundary for reviewed Invoice operations. Financial math remains in invoicesService. */
export class CanonicalInvoiceOperations {
  /**
   * Creates the first invoice for a historical Order.  Unlike the general
   * order-backed creation operation, this deliberately treats every linked
   * invoice (including a void record) as evidence that the Order has already
   * participated in invoicing.  The same advisory lock used by the low-level
   * creator makes stale screens and double-clicks return the existing record.
   */
  async createFirstOrderBackedInvoice(input: { organizationId: string; actorUserId: string; orderId: string; terms?: string; customDueDate?: Date | null }) {
    const orderId = input.orderId.trim();
    if (!orderId) throw new CanonicalInvoiceOperationError("ORDER_REQUIRED", "An Order is required.", 400);

    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${input.organizationId}:${orderId}`}))`);

      const [order] = await tx
        .select({ id: orders.id, state: orders.state, status: orders.status, canceledAt: orders.canceledAt })
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.organizationId, input.organizationId)))
        .limit(1);
      if (!order) throw new CanonicalInvoiceOperationError("ORDER_NOT_FOUND", "Order not found.", 404);
      if (isCanceledOrder(order)) {
        throw new CanonicalInvoiceOperationError("ORDER_CANCELLED", "Cannot create an invoice from a cancelled order.");
      }

      const [existing] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.organizationId, input.organizationId), eq(invoices.orderId, orderId)))
        .orderBy(invoices.createdAt, invoices.id)
        .limit(1);
      if (existing) return { invoice: existing, created: false };

      await recomputeOrderBillingStatus({ organizationId: input.organizationId, orderId, executor: tx });
      const invoiceLines = await tx
        .select({
          totalPrice: orderLineItems.totalPrice,
          workflowIntent: products.workflowIntent,
          allowZeroPrice: products.allowZeroPrice,
        })
        .from(orderLineItems)
        .leftJoin(products, and(eq(products.id, orderLineItems.productId), eq(products.organizationId, input.organizationId)))
        .where(eq(orderLineItems.orderId, orderId));
      const eligibility = resolveInvoiceFinancialEligibility(invoiceLines);
      if (!eligibility.canCreateInvoice) {
        throw new CanonicalInvoiceOperationError(eligibility.code || "ORDER_NOT_INVOICEABLE", eligibility.message || "Order cannot be invoiced.");
      }

      const invoice = await createInvoiceFromOrderInTransaction(tx, input.organizationId, orderId, input.actorUserId, {
        terms: input.terms ?? "due_on_receipt",
        customDueDate: input.customDueDate ?? null,
      });
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId,
        userId: input.actorUserId,
        actionType: "invoice_created",
        entityType: "invoice",
        entityId: invoice.id,
        entityName: String(invoice.displayNumber || invoice.invoiceNumber),
        description: "Created the first linked invoice for a historical Order through the canonical Invoice operation.",
        newValues: { orderId, source: "historical_order_cleanup" } as any,
      } as any);
      return { invoice, created: true };
    });
  }

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
