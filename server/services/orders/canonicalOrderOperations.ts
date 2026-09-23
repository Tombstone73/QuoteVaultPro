import { and, eq, ne, sql } from "drizzle-orm";

import { auditLogs, customerPaymentBatches, invoiceEmailDeliveryJobs, invoiceEmailLogs, invoices, orders, payments } from "@shared/schema";
import { db } from "../../db";
import { storage } from "../../storage";
import { OrdersRepository } from "../../storage/orders.repo";
import { resolveOrderCustomerContactIds } from "../orderCustomerResolutionService";
import { orderChangesRequireOrderBackedInvoiceSynchronization } from "./orderHeaderUpdatePolicy";
import { assertCustomerCreditForOrder, orderPayloadTotalCents } from "../customerCreditPolicyService";
import { parseMoneyToCents } from "@shared/customerCreditExposure";
import { getInvoiceBillingOwnerTransitionBlocker } from "./invoiceBillingOwnerTransition";

type CreateOrderPayload = Parameters<typeof storage.createOrder>[1];
type UpdateOrderPayload = Parameters<typeof storage.updateOrder>[2];
export type CanonicalQuoteConversionOptions = Parameters<typeof storage.convertQuoteToOrder>[3];

export class CanonicalOrderOperationError extends Error {
  constructor(readonly code: "ORDER_NOT_FOUND" | "ORDER_NOT_EDITABLE" | "ORDER_STALE" | "ORDER_IDENTITY_REQUIRED" | "ORDER_INVOICE_CUSTOMER_REVIEW_REQUIRED", message: string) { super(message); }
}

/** Shared boundary for Order header/create/conversion writes. */
class CanonicalOrderOperations {
  async normalizeOwnerIdentity(input: { organizationId: string; customerId?: string | null; contactId?: string | null; preserveExplicitCustomerClear?: boolean }) { return resolveOrderCustomerContactIds(input); }

  async create(input: { organizationId: string; actorUserId: string; actorOrgRole?: string | null; creditOverride?: boolean; creditOverrideReason?: string | null; payload: CreateOrderPayload; auditDescription?: string }) {
    const identity = await this.normalizeOwnerIdentity({ organizationId: input.organizationId, customerId: input.payload.customerId, contactId: input.payload.contactId, preserveExplicitCustomerClear: input.payload.customerId === null });
    const creditDecision = await assertCustomerCreditForOrder({ organizationId: input.organizationId, customerId: identity.customerId, actorUserId: input.actorUserId, actorOrgRole: input.actorOrgRole, proposedOrderTotalCents: orderPayloadTotalCents(input.payload as any), override: input.creditOverride, overrideReason: input.creditOverrideReason });
    const order = await storage.createOrder(input.organizationId, { ...input.payload, createdByUserId: input.actorUserId, customerId: identity.customerId, contactId: identity.contactId });
    await db.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "CREATE", entityType: "order", entityId: order.id, entityName: order.displayNumber || order.orderNumber, description: input.auditDescription ?? `Created order ${order.displayNumber || order.orderNumber}.` });
    if ((creditDecision as any)?.overrideApplied) await db.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "customer_credit_limit_override", entityType: "order", entityId: order.id, entityName: order.displayNumber || order.orderNumber, description: "Authorized customer credit-limit override.", newValues: { customerId: identity.customerId, reason: (creditDecision as any).overrideReason, creditLimitCents: (creditDecision as any).creditLimitCents, projectedExposureCents: (creditDecision as any).projectedExposureCents, overLimitCents: (creditDecision as any).overLimitCents } as any } as any);
    return order;
  }

  async updateEditableHeader(input: { organizationId: string; actorUserId: string; actorOrgRole?: string | null; creditOverride?: boolean; creditOverrideReason?: string | null; orderId: string; changes: UpdateOrderPayload; expectedUpdatedAt?: Date | string | null; allowNonNew?: boolean; auditDescription?: string }) {
    const [existing] = await db.select().from(orders).where(and(eq(orders.id, input.orderId), eq(orders.organizationId, input.organizationId))).limit(1);
    if (!existing) throw new CanonicalOrderOperationError("ORDER_NOT_FOUND", "Order not found.");
    if (!input.allowNonNew && existing.status !== "new") throw new CanonicalOrderOperationError("ORDER_NOT_EDITABLE", "Only new orders can be changed by this operation.");
    if (input.expectedUpdatedAt && String(existing.updatedAt) !== String(input.expectedUpdatedAt)) throw new CanonicalOrderOperationError("ORDER_STALE", "The order changed after this proposal was prepared.");
    const ownerTouched = input.changes.customerId !== undefined || input.changes.contactId !== undefined;
    const identity = ownerTouched ? await resolveOrderCustomerContactIds({ organizationId: input.organizationId, customerId: input.changes.customerId !== undefined ? input.changes.customerId as string | null : existing.customerId, contactId: input.changes.contactId !== undefined ? input.changes.contactId as string | null : existing.contactId, preserveExplicitCustomerClear: input.changes.customerId === null || (existing.customerId === null && input.changes.customerId === undefined) }) : null;
    const nextCustomerId = identity ? identity.customerId : existing.customerId;
    const nextContactId = identity ? identity.contactId : existing.contactId;
    if (!nextCustomerId && !nextContactId) throw new CanonicalOrderOperationError("ORDER_IDENTITY_REQUIRED", "Select a customer or contact for this order.");
    const billingOwnerChanges = nextCustomerId !== existing.customerId || (!nextCustomerId && nextContactId !== existing.contactId);
    const proposedTotalCents = input.changes.total !== undefined ? parseMoneyToCents(input.changes.total) : parseMoneyToCents(existing.total);
    await assertCustomerCreditForOrder({
      organizationId: input.organizationId,
      customerId: nextCustomerId,
      actorUserId: input.actorUserId,
      actorOrgRole: input.actorOrgRole,
      proposedOrderTotalCents: proposedTotalCents,
      // Moving an order to a different customer adds its full value to that
      // customer's position; an in-place update applies only the delta.
      existingOrderTotalCents: nextCustomerId === existing.customerId ? parseMoneyToCents(existing.total) : 0,
      orderId: existing.id,
      override: input.creditOverride,
      overrideReason: input.creditOverrideReason,
    });
    return db.transaction(async (tx) => {
      if (billingOwnerChanges) {
        // Lock the Order before inspecting the Invoice. A simultaneous send,
        // payment, or owner edit must not observe a partially changed owner.
        await tx.execute(sql`select id from ${orders} where ${orders.id} = ${input.orderId} and ${orders.organizationId} = ${input.organizationId} for update`);
        const [lockedOrder] = await tx.select().from(orders).where(and(eq(orders.id, input.orderId), eq(orders.organizationId, input.organizationId))).limit(1);
        if (!lockedOrder || lockedOrder.customerId !== existing.customerId || lockedOrder.contactId !== existing.contactId) {
          throw new CanonicalOrderOperationError("ORDER_STALE", "Order ownership changed while saving. Reload the Order and try again.");
        }
        const linkedInvoices = await tx.select().from(invoices).where(and(eq(invoices.organizationId, input.organizationId), eq(invoices.orderId, input.orderId), ne(invoices.status, "void")));
        if (linkedInvoices.length > 1) throw new CanonicalOrderOperationError("ORDER_INVOICE_CUSTOMER_REVIEW_REQUIRED", "This Order has multiple live Invoices. Resolve billing ownership through a reviewed correction.");
        let invoice = linkedInvoices[0];
        if (invoice) {
          await tx.execute(sql`select id from ${invoices} where ${invoices.id} = ${invoice.id} for update`);
          [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId))).limit(1);
          if (!invoice) throw new CanonicalOrderOperationError("ORDER_INVOICE_CUSTOMER_REVIEW_REQUIRED", "Invoice changed while its billing owner was being reviewed. Retry the Order edit.");
          // Portal funding can exist before invoice-level payment effects do.
          const [pendingFunding] = await tx.select({ id: customerPaymentBatches.id }).from(customerPaymentBatches).where(and(
            eq(customerPaymentBatches.organizationId, input.organizationId),
            eq(customerPaymentBatches.provider, "stripe"),
            eq(customerPaymentBatches.status, "pending"),
            sql`${customerPaymentBatches.providerEvidence}->'allocations' @> ${JSON.stringify([{ invoiceId: invoice.id }])}::jsonb`,
          )).limit(1);
          if (pendingFunding) throw new CanonicalOrderOperationError("ORDER_INVOICE_CUSTOMER_REVIEW_REQUIRED", "This Invoice has a pending customer payment. Resolve that payment before changing billing ownership.");
          const [[payment], [email], [delivery], [autoCreated]] = await Promise.all([
            tx.select({ id: payments.id }).from(payments).where(and(eq(payments.organizationId, input.organizationId), eq(payments.invoiceId, invoice.id))).limit(1),
            tx.select({ id: invoiceEmailLogs.id }).from(invoiceEmailLogs).where(and(eq(invoiceEmailLogs.organizationId, input.organizationId), eq(invoiceEmailLogs.invoiceId, invoice.id), eq(invoiceEmailLogs.status, "sent"))).limit(1),
            tx.select({ id: invoiceEmailDeliveryJobs.id }).from(invoiceEmailDeliveryJobs).where(and(eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId), eq(invoiceEmailDeliveryJobs.invoiceId, invoice.id))).limit(1),
            tx.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, input.organizationId), eq(auditLogs.entityId, invoice.id), eq(auditLogs.entityType, "invoice"), eq(auditLogs.actionType, "invoice_order_backed_created"))).limit(1),
          ]);
          const reason = getInvoiceBillingOwnerTransitionBlocker(invoice, { paymentExists: !!payment, successfulEmailExists: !!email, deliveryJobExists: !!delivery, autoCreatedInvoiceEvidence: !!autoCreated });
          if (reason) throw new CanonicalOrderOperationError("ORDER_INVOICE_CUSTOMER_REVIEW_REQUIRED", `${reason} Billing ownership cannot be changed through the Order editor; review the Invoice first.`);
          await tx.update(invoices).set({
            customerId: nextCustomerId,
            contactId: nextCustomerId ? null : nextContactId,
            invoiceVersion: Number(invoice.invoiceVersion || 1) + 1,
            accountingUpdatedAt: new Date(),
            updatedAt: new Date(),
          }).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId)));
          await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "invoice_billing_owner_changed", entityType: "invoice", entityId: invoice.id, entityName: String(invoice.displayNumber || invoice.invoiceNumber), description: "Changed an untouched Invoice billing owner with its Order in one transaction.", oldValues: { customerId: invoice.customerId, contactId: invoice.contactId } as any, newValues: { customerId: nextCustomerId, contactId: nextCustomerId ? null : nextContactId } as any } as any);
        }
      }
      let order = await new OrdersRepository(tx).updateOrder(input.organizationId, input.orderId, {
        ...input.changes,
        ...(identity ? { customerId: identity.customerId, contactId: identity.contactId } : {}),
      });
      // Customer identity and every commercial header amount must derive a
      // complete financial snapshot from persisted billable lines. In
      // particular, a shipping-price correction must not reuse a stale Order
      // subtotal after historical line removal.
      if (input.changes.customerId !== undefined || orderChangesRequireOrderBackedInvoiceSynchronization(input.changes)) {
        const { recalculateEditableOrderFinancialsInTransaction } = await import("./orderTaxCalculationService");
        order = await recalculateEditableOrderFinancialsInTransaction(tx, {
          organizationId: input.organizationId,
          orderId: order.id,
          actorUserId: input.actorUserId,
        }) ?? order;
      }
      await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "UPDATE", entityType: "order", entityId: order.id, entityName: order.displayNumber || order.orderNumber, description: input.auditDescription ?? `Updated order ${order.displayNumber || order.orderNumber}.` });
      return order;
    });
  }

  async convertQuoteToOrder(input: { organizationId: string; actorUserId: string; quoteId: string; options?: CanonicalQuoteConversionOptions }) {
    return storage.convertQuoteToOrder(input.organizationId, input.quoteId, input.actorUserId, input.options);
  }
}

export const canonicalOrderOperations = new CanonicalOrderOperations();
