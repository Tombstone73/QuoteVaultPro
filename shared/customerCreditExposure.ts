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

const postedInvoiceStatuses = new Set(["finalized", "billed", "sent", "partially_paid", "overdue"]);

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

export function buildCustomerCreditExposure(
  creditLimit: unknown,
  invoiceRows: Array<{ status: string | null; balanceDue: unknown }>,
  options?: {
    creditLimitConfigured?: boolean;
    unbilledOpenOrdersCents?: number;
    openWorkCents?: number;
  },
): CustomerCreditExposure {
  const totals = { outstandingArCents: 0, pendingBillingCents: 0 };
  for (const invoice of invoiceRows) {
    const status = String(invoice.status || "").toLowerCase();
    if (status === "void" || status === "paid") continue;
    const amount = Math.max(0, parseMoneyToCents(invoice.balanceDue));
    if (status === "draft") totals.pendingBillingCents += amount;
    else if (postedInvoiceStatuses.has(status)) totals.outstandingArCents += amount;
  }
  const creditLimitConfigured = options?.creditLimitConfigured ?? (creditLimit !== null && creditLimit !== undefined);
  const creditLimitCents = creditLimitConfigured ? parseMoneyToCents(creditLimit) : null;
  const unbilledOpenOrdersCents = Math.max(0, Math.round(options?.unbilledOpenOrdersCents ?? 0));
  const openWorkCents = Math.max(0, Math.round(options?.openWorkCents ?? 0));
  const creditExposureCents = totals.outstandingArCents + totals.pendingBillingCents + unbilledOpenOrdersCents;
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
