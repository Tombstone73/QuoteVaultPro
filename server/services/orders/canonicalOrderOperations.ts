import { BILLING_OWNERSHIP_REVIEW_MESSAGE, type BillingOwnershipOverrideContext } from '@shared/billingOwnershipReview';
import { hasAdminOrOwnerOperationalRole } from '@shared/roleAccess';
import { accountingApprovalRevocationPatch } from '../../lib/invoiceAccountingApproval';
import { assertBillingOwnershipReconciled, requireBillingOwnershipReviewer, BillingOwnershipReviewError } from '../billingOwnershipReview.service';
import { hasAppliedInvoicePayment } from '../../lib/invoicePaymentEvidence';
import { InvoicePaymentContextError, lockInvoicePaymentContext, retireInvoicePaymentSessions } from '../invoicePaymentSession.service';
import { and, eq, ne, sql } from "drizzle-orm";

import { auditLogs, stripePaymentAttempts, customerPaymentBatches, invoiceGuestPaymentTokens, customerAccountCreditApplications, customerAccountCredits, stripeRefundRequests, invoiceEmailDeliveryJobs, invoiceEmailLogs, invoices, orders, payments } from "@shared/schema";
import { db } from "../../db";
import { storage } from "../../storage";
import { OrdersRepository } from "../../storage/orders.repo";
import { resolveOrderCustomerContactIds } from "../orderCustomerResolutionService";
import { orderChangesRequireOrderBackedInvoiceSynchronization } from "./orderHeaderUpdatePolicy";
import { getInvoiceBillingOwnerTransitionBlocker } from "./invoiceBillingOwnerTransition";

type CreateOrderPayload = Parameters<typeof storage.createOrder>[1];
type UpdateOrderPayload = Parameters<typeof storage.updateOrder>[2];
export type CanonicalQuoteConversionOptions = Parameters<typeof storage.convertQuoteToOrder>[3];

export class CanonicalOrderOperationError extends Error {
  constructor(readonly code: "ORDER_NOT_FOUND" | "ORDER_NOT_EDITABLE" | "ORDER_STALE" | "ORDER_IDENTITY_REQUIRED" | "ORDER_INVOICE_CUSTOMER_REVIEW_REQUIRED", message: string, readonly details?: { billingOwnershipOverride: BillingOwnershipOverrideContext }) { super(message); }
}

/** Shared boundary for Order header/create/conversion writes. */
class CanonicalOrderOperations {
  async normalizeOwnerIdentity(input: { organizationId: string; customerId?: string | null; contactId?: string | null; preserveExplicitCustomerClear?: boolean }) { return resolveOrderCustomerContactIds(input); }

  async create(input: { organizationId: string; actorUserId: string; actorOrgRole?: string | null; creditOverride?: boolean; creditOverrideReason?: string | null; payload: CreateOrderPayload; auditDescription?: string }) {
    const identity = await this.normalizeOwnerIdentity({ organizationId: input.organizationId, customerId: input.payload.customerId, contactId: input.payload.contactId, preserveExplicitCustomerClear: input.payload.customerId === null });
    const order = await storage.createOrder(input.organizationId, { ...input.payload, createdByUserId: input.actorUserId, customerId: identity.customerId, contactId: identity.contactId });
    await db.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "CREATE", entityType: "order", entityId: order.id, entityName: order.displayNumber || order.orderNumber, description: input.auditDescription ?? `Created order ${order.displayNumber || order.orderNumber}.` });
    return order;
  }

  async updateEditableHeader(input: { organizationId: string; actorUserId: string; actorOrgRole?: string | null; creditOverride?: boolean; creditOverrideReason?: string | null; orderId: string; changes: UpdateOrderPayload; expectedUpdatedAt?: Date | string | null; billingOwnershipOverride?: BillingOwnershipOverrideContext & { reason: string; confirmed: boolean }; allowNonNew?: boolean; auditDescription?: string }) {
    const override = input.billingOwnershipOverride;
    if (override) {
      requireBillingOwnershipReviewer(input.actorOrgRole);
      if (override.confirmed !== true || !override.reason?.trim()) throw new BillingOwnershipReviewError('Confirm the ownership override and provide a reason.', 400);
      if (Object.keys(input.changes).some(key => !['customerId', 'contactId'].includes(key))) throw new BillingOwnershipReviewError('The override may change only Customer and Contact.', 400);
    }
    const [existing] = await db.select().from(orders).where(and(eq(orders.id, input.orderId), eq(orders.organizationId, input.organizationId))).limit(1);
    if (!existing) throw new CanonicalOrderOperationError("ORDER_NOT_FOUND", "Order not found.");
    if (!input.allowNonNew && existing.status !== "new") throw new CanonicalOrderOperationError("ORDER_NOT_EDITABLE", "Only new orders can be changed by this operation.");
    if (input.expectedUpdatedAt && String(existing.updatedAt) !== String(input.expectedUpdatedAt)) throw new CanonicalOrderOperationError("ORDER_STALE", "The order changed after this proposal was prepared.");
    const ownerTouched = input.changes.customerId !== undefined || input.changes.contactId !== undefined;
    const identity = ownerTouched ? await resolveOrderCustomerContactIds({ organizationId: input.organizationId, customerId: input.changes.customerId !== undefined ? input.changes.customerId as string | null : existing.customerId, contactId: input.changes.contactId !== undefined ? input.changes.contactId as string | null : existing.contactId, preserveExplicitCustomerClear: input.changes.customerId === null || (existing.customerId === null && input.changes.customerId === undefined) }) : null;
    const nextCustomerId = identity ? identity.customerId : existing.customerId;
    const nextContactId = identity ? identity.contactId : existing.contactId;
    if (override && (nextCustomerId !== input.changes.customerId || nextContactId !== input.changes.contactId)) throw new BillingOwnershipReviewError('The selected Contact does not match the requested Customer. Review the intended billing owner.', 400);
    if (!nextCustomerId && !nextContactId) throw new CanonicalOrderOperationError("ORDER_IDENTITY_REQUIRED", "Select a customer or contact for this order.");
    const billingOwnerChanges = nextCustomerId !== existing.customerId || (!nextCustomerId && nextContactId !== existing.contactId);
    if (override && (!billingOwnerChanges || !Number.isFinite(Date.parse(override.orderUpdatedAt)))) throw new BillingOwnershipReviewError('Select a different billing owner and retry normal Save first.', 400);
    // Credit controls forward physical release, never commercial Order capture.
    return db.transaction(async (tx) => {
      if (ownerTouched) {
        // Lock the Order before inspecting the Invoice. A simultaneous send,
        // payment, or owner edit must not observe a partially changed owner.
        await tx.execute(sql`select id from ${orders} where ${orders.id} = ${input.orderId} and ${orders.organizationId} = ${input.organizationId} for update`);
        const [lockedOrder] = await tx.select().from(orders).where(and(eq(orders.id, input.orderId), eq(orders.organizationId, input.organizationId))).limit(1);
        if (!lockedOrder || lockedOrder.customerId !== existing.customerId || lockedOrder.contactId !== existing.contactId) {
          throw new CanonicalOrderOperationError("ORDER_STALE", "Order ownership changed while saving. Reload the Order and try again.");
        }
        if (override && new Date(lockedOrder.updatedAt).getTime() !== Date.parse(override.orderUpdatedAt)) throw new CanonicalOrderOperationError('ORDER_STALE', 'Order changed. Reload and attempt normal Save again.');
        const linkedInvoices = await tx.select().from(invoices).where(and(eq(invoices.organizationId, input.organizationId), eq(invoices.orderId, input.orderId), ne(invoices.status, "void")));
        if (linkedInvoices.length > 1) throw new CanonicalOrderOperationError("ORDER_INVOICE_CUSTOMER_REVIEW_REQUIRED", "This Order has multiple live Invoices. Resolve billing ownership through a reviewed correction.");
        let invoice = linkedInvoices[0];
        if (override && !invoice) throw new BillingOwnershipReviewError("No linked Invoice requires an override.");
        // Reselecting the current Order owner must also inspect a legacy stale
        // Invoice. Run the same financial-history protections, never a blind repair.
        if (invoice && (billingOwnerChanges || invoice.customerId !== nextCustomerId
          || invoice.contactId !== (nextCustomerId ? null : nextContactId))) {
          await lockInvoicePaymentContext(tx, input.organizationId, [invoice.id]);
          await tx.execute(sql`select id from ${invoices} where ${invoices.id} = ${invoice.id} for update`);
          [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId))).limit(1);
          if (!invoice) throw new CanonicalOrderOperationError("ORDER_INVOICE_CUSTOMER_REVIEW_REQUIRED", "Invoice changed while its billing owner was being reviewed. Retry the Order edit.");
          const [paymentRows, [email], [delivery], [autoCreated], [credit], [creditSource], [refund]] = await Promise.all([
            tx.select().from(payments).where(and(eq(payments.organizationId, input.organizationId), eq(payments.invoiceId, invoice.id))),
            tx.select({ id: invoiceEmailLogs.id }).from(invoiceEmailLogs).where(and(eq(invoiceEmailLogs.organizationId, input.organizationId), eq(invoiceEmailLogs.invoiceId, invoice.id), eq(invoiceEmailLogs.status, "sent"))).limit(1),
            tx.select({ id: invoiceEmailDeliveryJobs.id }).from(invoiceEmailDeliveryJobs).where(and(eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId), eq(invoiceEmailDeliveryJobs.invoiceId, invoice.id))).limit(1),
            tx.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, input.organizationId), eq(auditLogs.entityId, invoice.id), eq(auditLogs.entityType, "invoice"), eq(auditLogs.actionType, "invoice_order_backed_created"))).limit(1),
            tx.select({ id: customerAccountCreditApplications.id }).from(customerAccountCreditApplications).where(and(eq(customerAccountCreditApplications.organizationId, input.organizationId), eq(customerAccountCreditApplications.invoiceId, invoice.id))).limit(1),
            tx.select({ id: customerAccountCredits.id }).from(customerAccountCredits).where(and(eq(customerAccountCredits.organizationId, input.organizationId), eq(customerAccountCredits.sourceInvoiceId, invoice.id))).limit(1),
            tx.select({ id: stripeRefundRequests.id }).from(stripeRefundRequests).where(and(eq(stripeRefundRequests.organizationId, input.organizationId), eq(stripeRefundRequests.invoiceId, invoice.id))).limit(1),
          ]);
          const evidence = { paymentExists: paymentRows.some(hasAppliedInvoicePayment), creditExists: !!credit || !!creditSource, refundExists: !!refund, successfulEmailExists: !!email, deliveryJobExists: !!delivery, autoCreatedInvoiceEvidence: !!autoCreated };
          const reason = getInvoiceBillingOwnerTransitionBlocker(invoice, evidence);
          const synced = Boolean(invoice.lastQbSyncedVersion || invoice.syncedAt || invoice.syncStatus === 'synced' || invoice.qbSyncStatus === 'synced');
          let overrideEligible = false;
          if (synced && (override || hasAdminOrOwnerOperationalRole(input.actorOrgRole))) {
            // Only the export/approval checkpoints may be overridden. All other
            // immutable evidence (including delivery, money, credits) still blocks.
            const otherBlocker = getInvoiceBillingOwnerTransitionBlocker({ ...invoice, qbInvoiceId: null, externalAccountingId: null,
              lastQbSyncedVersion: null, syncedAt: null, syncStatus: null, qbSyncStatus: null,
              accountingApprovedAt: null, accountingApprovedVersion: null, termsStartedAt: null }, evidence);
            const [attempts, batches] = await Promise.all([
              tx.select().from(stripePaymentAttempts).where(and(eq(stripePaymentAttempts.organizationId, input.organizationId), eq(stripePaymentAttempts.invoiceId, invoice.id))),
              tx.select().from(customerPaymentBatches).where(and(eq(customerPaymentBatches.organizationId, input.organizationId),
                sql`${customerPaymentBatches.providerEvidence}->'allocations' @> ${JSON.stringify([{ invoiceId: invoice.id }])}::jsonb`)),
            ]);
            // This override never transfers/cancels payment records. Even an
            // unresolved checkout must be resolved through its existing workflow.
            const unresolved = paymentRows.some(row => !['failed', 'canceled', 'voided'].includes(row.status) || !!row.stripePaymentIntentId)
              || attempts.some(row => !['failed', 'canceled'].includes(row.status))
              || batches.some(row => !['failed', 'canceled'].includes(row.status));
            overrideEligible = !otherBlocker && !unresolved;
          }
          if (override) {
            if (!overrideEligible) throw new BillingOwnershipReviewError('Override is unavailable: only previously synchronized, unpaid Invoices without other immutable history or unresolved payment sessions qualify.');
            if (override.invoiceId !== invoice.id || override.invoiceVersion !== Number(invoice.invoiceVersion || 1)) throw new CanonicalOrderOperationError('ORDER_STALE', 'Invoice changed. Reload and attempt normal Save again.');
            await assertBillingOwnershipReconciled(input.organizationId, invoice.id, tx);
            await tx.update(invoiceGuestPaymentTokens).set({ revokedAt: new Date() }).where(and(eq(invoiceGuestPaymentTokens.organizationId, input.organizationId), eq(invoiceGuestPaymentTokens.invoiceId, invoice.id)));
          } else {
            if (reason) throw new CanonicalOrderOperationError('ORDER_INVOICE_CUSTOMER_REVIEW_REQUIRED', `${reason} Billing ownership cannot be changed through the Order editor; review the Invoice first.`,
              overrideEligible ? { billingOwnershipOverride: { invoiceId: invoice.id, invoiceVersion: Number(invoice.invoiceVersion || 1), orderUpdatedAt: new Date(lockedOrder.updatedAt).toISOString() } } : undefined);
            await retireInvoicePaymentSessions(tx, { organizationId: input.organizationId, invoiceId: invoice.id, expectedVersion: Number(invoice.invoiceVersion || 1), ownerChange: true });
          }
          await tx.update(invoices).set({
            ...(override ? { ...accountingApprovalRevocationPatch(invoice), accountingApprovedAt: null, accountingApprovedByUserId: null,
              accountingApprovalRevokedAt: new Date(), qbSyncStatus: 'needs_resync', qbLastError: BILLING_OWNERSHIP_REVIEW_MESSAGE,
              syncStatus: 'skipped', syncError: BILLING_OWNERSHIP_REVIEW_MESSAGE } : {}),
            customerId: nextCustomerId,
            contactId: nextCustomerId ? null : nextContactId,
            invoiceVersion: Number(invoice.invoiceVersion || 1) + 1,
            accountingUpdatedAt: new Date(),
            updatedAt: new Date(),
          }).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId)));
          if (override) await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId,
            actionType: 'invoice_billing_ownership_override', entityType: 'invoice', entityId: invoice.id,
            entityName: String(invoice.displayNumber || invoice.invoiceNumber), description: BILLING_OWNERSHIP_REVIEW_MESSAGE,
            oldValues: { orderCustomerId: lockedOrder.customerId, orderContactId: lockedOrder.contactId, customerId: invoice.customerId, contactId: invoice.contactId },
            newValues: { orderId: lockedOrder.id, orderNumber: lockedOrder.displayNumber || lockedOrder.orderNumber, invoiceId: invoice.id,
              invoiceNumber: invoice.displayNumber || invoice.invoiceNumber, orderCustomerId: nextCustomerId, orderContactId: nextContactId,
              customerId: nextCustomerId, contactId: nextCustomerId ? null : nextContactId, reason: override.reason.trim(),
              overriddenAt: new Date().toISOString(), accountingState: 'ownership_review_required',
              priorQuickBooks: { qbInvoiceId: invoice.qbInvoiceId, externalAccountingId: invoice.externalAccountingId,
                syncedAt: invoice.syncedAt, lastQbSyncedVersion: invoice.lastQbSyncedVersion } } });
          else await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "invoice_billing_owner_changed", entityType: "invoice", entityId: invoice.id, entityName: String(invoice.displayNumber || invoice.invoiceNumber), description: "Changed an untouched Invoice billing owner with its Order in one transaction.", oldValues: { customerId: invoice.customerId, contactId: invoice.contactId } as any, newValues: { customerId: nextCustomerId, contactId: nextCustomerId ? null : nextContactId } as any } as any);
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
      if (!override && (input.changes.customerId !== undefined || orderChangesRequireOrderBackedInvoiceSynchronization(input.changes))) {
        const { recalculateEditableOrderFinancialsInTransaction } = await import("./orderTaxCalculationService");
        order = await recalculateEditableOrderFinancialsInTransaction(tx, {
          organizationId: input.organizationId,
          orderId: order.id,
          actorUserId: input.actorUserId,
        }) ?? order;
      }
      await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "UPDATE", entityType: "order", entityId: order.id, entityName: order.displayNumber || order.orderNumber, description: input.auditDescription ?? `Updated order ${order.displayNumber || order.orderNumber}.`,
        ...(ownerTouched ? { oldValues: { customerId: existing.customerId, contactId: existing.contactId }, newValues: { customerId: nextCustomerId, contactId: nextContactId } } : {}) });
      return order;
    }).catch((error: unknown) => {
      if (error instanceof InvoicePaymentContextError) {
        throw new CanonicalOrderOperationError('ORDER_INVOICE_CUSTOMER_REVIEW_REQUIRED', error.message);
      }
      throw error;
    });
  }

  async convertQuoteToOrder(input: { organizationId: string; actorUserId: string; quoteId: string; options?: CanonicalQuoteConversionOptions }) {
    return storage.convertQuoteToOrder(input.organizationId, input.quoteId, input.actorUserId, input.options);
  }
}

export const canonicalOrderOperations = new CanonicalOrderOperations();
