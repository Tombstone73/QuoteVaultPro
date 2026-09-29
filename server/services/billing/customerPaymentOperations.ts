import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { auditLogs, customerPaymentBatches, invoices, orders, payments } from "../../../shared/schema";
import { allocateCustomerPayment, type CustomerPaymentAllocation, type CustomerPaymentAllocationMode } from "../../../shared/customerPaymentAllocation";
import { computeInvoicePaymentRollup, getInvoiceFinancialLifecycleStatus } from "../../../shared/rollups/invoicePaymentRollup";
import { getInvoiceFinancialPaymentEligibility } from "../../../shared/paymentOrchestration";
import { resolveCanonicalInvoiceCustomerOwnership } from "../../../shared/invoiceCustomerOwnership";
import { lockInvoicePaymentContext } from "../invoicePaymentSession.service";
import { isCanceledOrder } from "../../../shared/operationalState";

export class CustomerPaymentOperationError extends Error { constructor(readonly code: string, message: string, readonly statusCode = 409) { super(message); } }
const heldQuickBooksReason = "Grouped customer payment is held for accounting review; grouped QuickBooks payment sync is not yet enabled.";
const cents = (value: number) => (value / 100).toFixed(2);
type Input = { staffSelection?: boolean; expectedCustomerId?: string; organizationId: string; actorUserId: string | null; invoiceIds: string[]; amountCents: number; allocationMode: CustomerPaymentAllocationMode; customAllocations?: CustomerPaymentAllocation[]; method: string; appliedAt: Date; notes?: string; reference?: string; idempotencyKey: string; expectedRemainingCents?: Record<string, number>; provider?: "manual" | "stripe"; stripePaymentIntentId?: string; stripeAccountId?: string; existingBatchId?: string };

function assertInput(input: Input) {
  if (!Array.isArray(input.invoiceIds) || input.invoiceIds.length === 0) throw new CustomerPaymentOperationError("INVOICES_REQUIRED", "Select at least one invoice.", 400);
  if (input.invoiceIds.length > 100) throw new CustomerPaymentOperationError("BULK_LIMIT_EXCEEDED", "A customer payment can allocate to at most 100 invoices.", 400);
  if (new Set(input.invoiceIds).size !== input.invoiceIds.length) throw new CustomerPaymentOperationError("DUPLICATE_INVOICE_IDS", "Invoice IDs must be unique.", 400);
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new CustomerPaymentOperationError("PAYMENT_AMOUNT_INVALID", "Payment amount must be a positive number of cents.", 400);
  if (!input.idempotencyKey.trim()) throw new CustomerPaymentOperationError("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.", 400);
}
async function load(tx: any, organizationId: string, ids: string[], staffSelection = false) {
  const rows = await tx.select({ invoice: invoices, order: orders }).from(invoices).leftJoin(orders, and(eq(orders.id, invoices.orderId), eq(orders.organizationId, organizationId))).where(and(eq(invoices.organizationId, organizationId), inArray(invoices.id, ids)));
  if (rows.length !== ids.length) throw new CustomerPaymentOperationError("INVOICE_NOT_FOUND", "One or more invoices are unavailable.", 404);
  const paymentRows = await tx.select().from(payments).where(and(eq(payments.organizationId, organizationId), inArray(payments.invoiceId, ids)));
  const byInvoice = new Map<string, any[]>(); for (const row of paymentRows) byInvoice.set(row.invoiceId, [...(byInvoice.get(row.invoiceId) || []), row]);
  return rows.map((row: any) => {
    const invoice = row.invoice; const order = row.order;
    if (!staffSelection && String(invoice.importSource || "").toLowerCase() === "quickbooks") throw new CustomerPaymentOperationError("IMPORTED_QB_PAYMENT_RECONCILIATION_REQUIRED", "Imported QuickBooks invoices must be reconciled from QuickBooks.");
    if (invoice.orderId && (!order || (!staffSelection && isCanceledOrder(order)))) throw new CustomerPaymentOperationError(order ? "ORDER_CANCELLED" : "ORDER_NOT_FOUND", order ? "Cancelled orders cannot receive payments." : "The invoice order is unavailable.");
    const owner = resolveCanonicalInvoiceCustomerOwnership({ invoiceCustomerId: invoice.customerId, invoiceContactId: invoice.contactId, invoiceImportSource: invoice.importSource, linkedOrderId: invoice.orderId, linkedOrderCustomerId: order?.customerId, linkedOrderContactId: order?.contactId });
    if (!owner.customerId) throw new CustomerPaymentOperationError("CONTACT_INVOICE_CUSTOMER_PAYMENT_UNSUPPORTED", "Contact-owned Invoices cannot enter a Customer payment batch. Record an invoice-scoped payment instead.");
    if (owner.customerId !== invoice.customerId) throw new CustomerPaymentOperationError("BILLING_OWNERSHIP_REVIEW_REQUIRED", "Invoice billing ownership differs from its Order. Review billing ownership before accepting payment.");
    const rollup = computeInvoicePaymentRollup({ invoiceTotalCents: Number(invoice.totalCents || 0), payments: (byInvoice.get(invoice.id) || []).map((p: any) => ({ id: p.id, status: p.status, amountCents: Number(p.amountCents || 0) })) });
    const eligibility = getInvoiceFinancialPaymentEligibility({ invoiceStatus: invoice.status, remainingCents: rollup.amountDueCents });
    if (!staffSelection && !eligibility.payable) throw new CustomerPaymentOperationError("INVOICE_NOT_PAYABLE", eligibility.blockedReason || "Invoice cannot accept payment.");
    const excludedReason = String(invoice.importSource || "").toLowerCase() === "quickbooks"
      ? "Imported QuickBooks invoices must be reconciled from QuickBooks."
      : order && isCanceledOrder(order) ? "Cancelled orders cannot receive payments." : eligibility.blockedReason;
    return { invoice, order, owner, payments: byInvoice.get(invoice.id) || [], rollup, excludedReason };
  });
}
/** Validate the entire selection before filtering: paid rows never hide another Customer. */
function selectPayable(rows: any[], input: { staffSelection?: boolean; expectedCustomerId?: string }) {
  const customers = new Set(rows.map(row => row.owner.customerId));
  if (customers.size !== 1 || (input.expectedCustomerId && !customers.has(input.expectedCustomerId))) {
    throw new CustomerPaymentOperationError("CUSTOMER_MISMATCH", "All selected invoices must belong to the same customer. Select one customer's invoices and try again.");
  }
  const eligible = input.staffSelection ? rows.filter(row => !row.excludedReason) : rows;
  return { rows: eligible, selectedCount: rows.length, eligibleCount: eligible.length,
    excludedCount: rows.length - eligible.length,
    excludedInvoices: input.staffSelection ? rows.filter(row => row.excludedReason).map(row => ({ invoiceId: row.invoice.id, reason: row.excludedReason })) : [] };
}
function allocations(rows: any[], input: Input) {
  const customers = new Set(rows.map((x) => x.owner.customerId));
  if (customers.size !== 1) throw new CustomerPaymentOperationError("CUSTOMER_MISMATCH", "Selected invoices must belong to the same customer.");
  const totalOutstandingCents = rows.reduce((sum, row) => sum + row.rollup.amountDueCents, 0);
  try {
    const result = allocateCustomerPayment({ invoices: rows.map((x) => ({ invoiceId: x.invoice.id, remainingCents: x.rollup.amountDueCents, dueDate: x.invoice.dueDate, issueDate: x.invoice.issueDate, invoiceNumber: x.invoice.invoiceNumber })), amountCents: input.amountCents, mode: input.allocationMode, customAllocations: input.customAllocations });
    const totalAllocatedCents = result.reduce((sum, allocation) => sum + allocation.amountCents, 0);
    if (totalAllocatedCents > input.amountCents || totalAllocatedCents > totalOutstandingCents) throw new CustomerPaymentOperationError("ALLOCATION_EXCEEDS_OUTSTANDING", "Payment allocations cannot exceed the payment or current invoice balances.", 400);
    return result;
  }
  catch (error: any) {
    if (error instanceof CustomerPaymentOperationError) throw error;
    throw new CustomerPaymentOperationError(error.message === "Overpayment not allowed." ? "OVERPAYMENT_NOT_ALLOWED" : "ALLOCATION_INVALID", error.message, 400);
  }
}
export async function previewCustomerPayment(input: Omit<Input, "actorUserId" | "idempotencyKey" | "method" | "appliedAt">) {
  assertInput({ ...input, actorUserId: "preview", idempotencyKey: "preview", method: "other", appliedAt: new Date() });
  return db.transaction(async (tx) => {
    const selected = await load(tx, input.organizationId, input.invoiceIds, input.staffSelection);
    const { rows, ...selection } = selectPayable(selected, input);
    const totalOutstandingCents = rows.reduce((sum, row) => sum + row.rollup.amountDueCents, 0);
    // Preview caps tendered money. Staff posting recomputes this cap under locks;
    // provider finalization retains its strict exact-allocation contract.
    const appliedAmountCents = Math.min(input.amountCents, totalOutstandingCents);
    const result = rows.length ? allocations(rows, { ...input, amountCents: appliedAmountCents } as Input) : [];
    return { ...selection, customerId: selected[0].owner.customerId, message: rows.length ? null : "No selected invoices have an open balance.", totalOutstandingCents, tenderedAmountCents: input.amountCents, appliedAmountCents, allocations: result, invoices: rows.map((x) => ({ invoiceId: x.invoice.id, invoiceNumber: x.invoice.invoiceNumber, remainingCents: x.rollup.amountDueCents, status: x.invoice.status })) };
  });
}
export async function recordCustomerPayment(input: Input) {
  assertInput(input);
  // Only the staff route opts into tendered-money recomputation. Provider batches
  // retain their exact frozen allocations and strict stale/overpayment guards.
  const staffSelection = input.staffSelection === true && input.provider !== "stripe" && !input.existingBatchId;
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`customer-payment:${input.organizationId}:${[...input.invoiceIds].sort().join(",")}`}))`);
    if (staffSelection) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`customer-payment-key:${input.organizationId}:${input.idempotencyKey}`}))`);
      await lockInvoicePaymentContext(tx, input.organizationId, input.invoiceIds);
      for (const id of [...input.invoiceIds].sort()) {
        // Share the existing single-payment and reversal/reconciliation locks.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`payment:${input.organizationId}:${id}`}))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice-rollup:${id}`}))`);
      }
      await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.organizationId, input.organizationId), inArray(invoices.id, input.invoiceIds))).orderBy(invoices.id).for("update");
    }
    const [existing] = await tx.select().from(customerPaymentBatches).where(and(eq(customerPaymentBatches.organizationId, input.organizationId), eq(customerPaymentBatches.idempotencyKey, input.idempotencyKey))).limit(1);
    if (existing && ((input.expectedCustomerId && existing.customerId !== input.expectedCustomerId)
      || (!input.existingBatchId && existing.status !== 'succeeded'))) {
      throw new CustomerPaymentOperationError('CUSTOMER_MISMATCH', 'The previous payment request is not reusable for this billing context. Start a new request.');
    }
    if (existing && (!input.existingBatchId || existing.id !== input.existingBatchId || String(existing.status) === "succeeded")) return { batch: existing, payments: await tx.select().from(payments).where(eq(payments.customerPaymentBatchId, existing.id)), newlyPaid: [], reused: true, appliedAmountCents: Number(existing.amountCents), changeDueCents: Math.max(0, input.amountCents - Number(existing.amountCents)) };
    if (!staffSelection) {
      // Webhook finalization also serializes with the ownership writer. Do not
      // reacquire the advisory lock held by browser confirmation's outer context.
      await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.organizationId, input.organizationId), inArray(invoices.id, input.invoiceIds))).orderBy(invoices.id).for("update");
    }
    const selected = await load(tx, input.organizationId, input.invoiceIds, staffSelection);
    const selection = selectPayable(selected, { ...input, staffSelection });
    const rows = selection.rows;
    if (!rows.length) throw new CustomerPaymentOperationError("NO_PAYABLE_BALANCE", "No selected invoices have an open balance.");
    if ((!staffSelection || input.allocationMode === "custom") && input.expectedRemainingCents && rows.some((x) => Number(input.expectedRemainingCents![x.invoice.id]) !== x.rollup.amountDueCents)) throw new CustomerPaymentOperationError("PAYMENT_ALLOCATION_STALE", "Invoice balances changed. Refresh the allocation preview and try again.");
    const totalOutstandingCents = rows.reduce((sum, row) => sum + row.rollup.amountDueCents, 0);
    const appliedAmountCents = staffSelection ? Math.min(input.amountCents, totalOutstandingCents) : input.amountCents;
    // Explicit custom allocations must be reviewed again if eligibility changed.
    if (staffSelection && input.allocationMode === "custom" && input.customAllocations?.some(x => !rows.some(row => row.invoice.id === x.invoiceId))) {
      throw new CustomerPaymentOperationError("PAYMENT_ALLOCATION_STALE", "Invoice balances changed. Refresh the allocation preview and try again.");
    }
    const result = allocations(rows, { ...input, amountCents: appliedAmountCents }); const customerId = rows[0].owner.customerId;
    let batch: any = existing;
    if (input.existingBatchId) {
      if (!existing || existing.id !== input.existingBatchId || String(existing.status) !== "pending") throw new CustomerPaymentOperationError("PAYMENT_BATCH_UNAVAILABLE", "Portal payment batch is unavailable.");
      if (existing.customerId !== customerId) throw new CustomerPaymentOperationError("CUSTOMER_MISMATCH", "The payment batch billing owner changed. Review the original payment context before allocation.");
      [batch] = await tx.update(customerPaymentBatches).set({ status: "succeeded", confirmedAt: input.appliedAt, providerEvidence: { ...(existing.providerEvidence as any), confirmedAt: input.appliedAt.toISOString() }, updatedAt: new Date() } as any).where(and(eq(customerPaymentBatches.id, input.existingBatchId), eq(customerPaymentBatches.status, "pending"))).returning();
      if (!batch) throw new CustomerPaymentOperationError("PAYMENT_BATCH_RACE", "Portal payment batch was already finalized.");
    } else {
      [batch] = await tx.insert(customerPaymentBatches).values({ organizationId: input.organizationId, customerId, amountCents: appliedAmountCents, method: input.method, allocationMode: input.allocationMode, provider: input.provider || "manual", status: "succeeded", currency: rows[0].invoice.currency || "USD", stripePaymentIntentId: input.stripePaymentIntentId || null, stripeAccountId: input.stripeAccountId || null, confirmedAt: input.provider === "stripe" ? input.appliedAt : null, idempotencyKey: input.idempotencyKey, reference: input.reference?.trim() || null, notes: input.notes?.trim() || null, appliedAt: input.appliedAt, createdByUserId: input.actorUserId } as any).returning();
    }
    const byId = new Map(rows.map((x) => [x.invoice.id, x])); const created: any[] = []; const newlyPaid: any[] = [];
    for (const allocation of result) { const row = byId.get(allocation.invoiceId)!; const [payment] = await tx.insert(payments).values({ organizationId: input.organizationId, invoiceId: row.invoice.id, customerPaymentBatchId: batch.id, provider: input.provider || "manual", providerIdempotencyKey: `customer-batch:${batch.id}:invoice:${row.invoice.id}`, status: "succeeded", currency: row.invoice.currency || "USD", amount: cents(allocation.amountCents), amountCents: allocation.amountCents, method: input.method, notes: input.notes?.trim() || null, note: input.notes?.trim() || null, paidAt: input.appliedAt, createdByUserId: input.actorUserId, syncStatus: "skipped", syncError: heldQuickBooksReason, metadata: { source: "customer_payment_batch", customerPaymentBatchId: batch.id, allocationMode: input.allocationMode, ...(input.stripeAccountId ? { stripeAccountId: input.stripeAccountId } : {}), ...(input.reference ? { reference: input.reference } : {}) } } as any).returning();
      const next = computeInvoicePaymentRollup({ invoiceTotalCents: Number(row.invoice.totalCents || 0), payments: [...row.payments, payment].map((p: any) => ({ id: p.id, status: p.status, amountCents: Number(p.amountCents || 0) })) });
      await tx.update(invoices).set({ amountPaid: cents(next.amountPaidCents), balanceDue: cents(next.amountDueCents), status: (staffSelection ? getInvoiceFinancialLifecycleStatus({ invoiceStatus: row.invoice.status, rollup: next }) : next.status) as any, updatedAt: new Date() }).where(and(eq(invoices.id, row.invoice.id), eq(invoices.organizationId, input.organizationId)));
      if (String(staffSelection ? getInvoiceFinancialLifecycleStatus({ invoiceStatus: row.invoice.status, rollup: next }) : (next as any).status).toLowerCase() === "paid") newlyPaid.push({ invoiceId: row.invoice.id, orderId: row.invoice.orderId, paymentId: payment.id }); created.push(payment);
    }
    await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "customer_payment_allocated", entityType: "customer_payment_batch", entityId: batch.id, entityName: String(customerId), description: `Allocated one customer payment across ${created.length} invoices.`, newValues: { customerId, amountCents: appliedAmountCents, ...(staffSelection ? { tenderedAmountCents: input.amountCents, changeDueCents: input.amountCents - appliedAmountCents, selectedInvoiceIds: input.invoiceIds, excludedInvoices: selection.excludedInvoices } : {}), allocationMode: input.allocationMode, invoiceIds: result.map((x) => x.invoiceId), allocations: result, quickBooksSync: "held_for_accounting_review" } as any } as any);
    return { batch, payments: created, newlyPaid, reused: false, appliedAmountCents, changeDueCents: input.amountCents - appliedAmountCents };
  });
  if (!outcome.reused) for (const paid of outcome.newlyPaid) if (paid.orderId) { try { const { applyWorkflowStatusPillFailSoft } = await import("../workflowStatusPillService"); await applyWorkflowStatusPillFailSoft({ organizationId: input.organizationId, orderId: paid.orderId, triggerKey: "payment_received", actorUserId: input.actorUserId, actorUserName: "System", source: "system", reason: "Invoice paid", metadata: { invoiceId: paid.invoiceId, paymentId: paid.paymentId, customerPaymentBatchId: outcome.batch.id } }); const { reconcileOrderAutoCloseFailSoft } = await import("../orderAutoCloseService"); await reconcileOrderAutoCloseFailSoft({ organizationId: input.organizationId, orderId: paid.orderId, actorUserId: input.actorUserId, actorUserName: "System", source: "manual_payment", metadata: { invoiceId: paid.invoiceId, paymentId: paid.paymentId, customerPaymentBatchId: outcome.batch.id } }); } catch (error) { console.error("Customer payment auto-close reconciliation failed", error); } }
  return outcome;
}
