export type CustomerCreditExposure = {
  creditLimitConfigured: boolean;
  creditLimitCents: number | null;
  outstandingArCents: number;
  pendingBillingCents: number;
  unbilledOpenOrdersCents: number;
  openWorkCents: number;
  creditExposureCents: number;
  availableCreditCents: number | null;
  overLimitCents: number;
  creditLimit: string | null;
  outstandingAr: string;
  pendingBilling: string;
  unbilledOpenOrders: string;
  openWork: string;
  creditExposure: string;
  availableCredit: string | null;
};

export type CustomerExposureInvoice = {
  status: string | null;
  /** Set by the server from the canonical accounting-approval projection. */
  approvedForAccounting?: boolean;
  /** Canonical payment rollup / imported-QB balance, never a stale balance column. */
  remainingCents?: number;
  creditCents?: number;
  displayStatus?: string;
  /** Compatibility fallback for callers that have not yet enriched a row. */
  balanceDue?: unknown;
};

export function parseMoneyToCents(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100);
  }
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(-?)(\d+)(?:\.(\d{1,}))?$/);
  if (!match) return 0;
  const whole = Number(match[2]);
  if (!Number.isSafeInteger(whole)) return 0;
  const fraction = `${match[3] ?? ""}00`.slice(0, 2);
  const result = whole * 100 + Number(fraction);
  return match[1] === "-" ? -result : result;
}

function money(centsValue: number) {
  return (centsValue / 100).toFixed(2);
}

function isPositiveReceivable(invoice: CustomerExposureInvoice): boolean {
  const workflowStatus = String(invoice.status || "").trim().toLowerCase();
  const displayStatus = String(invoice.displayStatus || "").trim().toLowerCase();
  if (["void", "voided", "cancelled", "canceled", "paid", "credit"].includes(workflowStatus)) return false;
  if (["paid historical", "credit / refund due", "voided", "paid"].includes(displayStatus)) return false;
  if ((invoice.creditCents ?? 0) > 0) return false;
  const remainingCents = invoice.remainingCents ?? parseMoneyToCents(invoice.balanceDue);
  return remainingCents > 0;
}

/**
 * One financial classification per positive obligation. Approval moves an
 * invoice between A/R and pending billing; it never changes exposure itself.
 */
export function classifyCustomerExposureInvoice(invoice: CustomerExposureInvoice): "outstanding_ar" | "pending_billing" | null {
  if (!isPositiveReceivable(invoice)) return null;
  return invoice.approvedForAccounting ? "outstanding_ar" : "pending_billing";
}

export function buildCustomerCreditExposure(
  creditLimit: unknown,
  invoiceRows: CustomerExposureInvoice[],
  options?: {
    creditLimitConfigured?: boolean;
    /** Active billable orders that have no active invoice. These belong in Pending Billing. */
    unbilledOpenOrdersCents?: number;
    openWorkCents?: number;
  },
): CustomerCreditExposure {
  const totals = { outstandingArCents: 0, pendingBillingCents: 0 };
  for (const invoice of invoiceRows) {
    const remainingCents = Math.max(0, Math.round(invoice.remainingCents ?? parseMoneyToCents(invoice.balanceDue)));
    const bucket = classifyCustomerExposureInvoice(invoice);
    if (bucket === "outstanding_ar") totals.outstandingArCents += remainingCents;
    if (bucket === "pending_billing") totals.pendingBillingCents += remainingCents;
  }

  const creditLimitConfigured = options?.creditLimitConfigured ?? (creditLimit !== null && creditLimit !== undefined);
  const creditLimitCents = creditLimitConfigured ? parseMoneyToCents(creditLimit) : null;
  const unbilledOpenOrdersCents = Math.max(0, Math.round(options?.unbilledOpenOrdersCents ?? 0));
  const openWorkCents = Math.max(0, Math.round(options?.openWorkCents ?? 0));
  totals.pendingBillingCents += unbilledOpenOrdersCents;
  const creditExposureCents = totals.outstandingArCents + totals.pendingBillingCents;
  const availableCreditCents = creditLimitCents === null ? null : creditLimitCents - creditExposureCents;

  return {
    creditLimitConfigured,
    creditLimitCents,
    outstandingArCents: totals.outstandingArCents,
    pendingBillingCents: totals.pendingBillingCents,
    unbilledOpenOrdersCents,
    openWorkCents,
    creditExposureCents,
    availableCreditCents,
    overLimitCents: creditLimitCents === null ? 0 : Math.max(0, creditExposureCents - creditLimitCents),
    creditLimit: creditLimitCents === null ? null : money(creditLimitCents),
    outstandingAr: money(totals.outstandingArCents),
    pendingBilling: money(totals.pendingBillingCents),
    unbilledOpenOrders: money(unbilledOpenOrdersCents),
    openWork: money(openWorkCents),
    creditExposure: money(creditExposureCents),
    availableCredit: availableCreditCents === null ? null : money(availableCreditCents),
  };
}
