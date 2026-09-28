import { assessOrderCloseEligibility, type OrderCloseEligibility } from "./orderCloseEligibility";

import { deriveOrderPaymentSummary, isApplicableOrderInvoice } from '@shared/orderPaymentSummary';
import type { InvoiceAccountingDisplayInput } from '@shared/invoiceAccountingDisplay';
export { isApplicableOrderInvoice } from '@shared/orderPaymentSummary';
type ReconciliationInvoice = InvoiceAccountingDisplayInput;

export type OrderAutoCloseDecision =
  | { action: "closed"; eligibility: Extract<OrderCloseEligibility, { ok: true }>; unpaidInvoiceCount: 0 }
  | { action: "no_op"; reason: "ORDER_CLOSED" | "ORDER_CANCELED" | "ORDER_NOT_FOUND" }
  | { action: "not_eligible"; reason: string; eligibility?: OrderCloseEligibility; unpaidInvoiceCount?: number };

function isTerminalFulfillment(fulfillmentStatus: unknown): boolean {
  return ["shipped", "delivered"].includes(String(fulfillmentStatus ?? "").trim().toLowerCase());
}

function isFinanciallySettled(invoice: ReconciliationInvoice): boolean {
  return deriveOrderPaymentSummary([invoice]).remainingCents === 0;
}

/** Uses the existing close policy with durable operational and invoice facts. */
export function assessOrderAutoClose(input: {
  state?: string | null;
  fulfillmentStatus?: string | null;
  routingTarget?: string | null;
  lineItems: Array<{ workflowIntent?: string | null; status?: string | null }>;
  invoices: ReconciliationInvoice[];
}): OrderAutoCloseDecision {
  const state = String(input.state ?? "").trim().toLowerCase();
  if (state === "closed") return { action: "no_op", reason: "ORDER_CLOSED" };
  if (state === "canceled" || state === "cancelled") return { action: "no_op", reason: "ORDER_CANCELED" };

  const applicableInvoices = input.invoices.filter(isApplicableOrderInvoice);
  const unpaidInvoiceCount = applicableInvoices.filter((invoice) => !isFinanciallySettled(invoice)).length;
  const eligibility = assessOrderCloseEligibility({
    state: input.state,
    // Close eligibility represents operational completion through routing.
    // A terminal fulfillment record is the authoritative fact for that gate.
    routingTarget: isTerminalFulfillment(input.fulfillmentStatus) ? null : input.routingTarget,
    lineItems: input.lineItems,
    invoiceCount: applicableInvoices.length,
    unpaidInvoiceCount,
  });
  if (!eligibility.ok) return { action: "not_eligible", reason: eligibility.code, eligibility, unpaidInvoiceCount };
  if (eligibility.requiresUnpaidConfirmation) return { action: "not_eligible", reason: "UNPAID_INVOICES", eligibility, unpaidInvoiceCount };
  return { action: "closed", eligibility, unpaidInvoiceCount: 0 };
}
