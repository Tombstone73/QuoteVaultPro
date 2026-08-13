export type CustomerCreditExposure = {
  outstandingArCents: number;
  pendingBillingCents: number;
  creditExposureCents: number;
  availableCreditCents: number;
  outstandingAr: string;
  pendingBilling: string;
  creditExposure: string;
  availableCredit: string;
};

const postedInvoiceStatuses = new Set(["finalized", "billed", "sent", "partially_paid", "overdue"]);

function cents(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

function money(centsValue: number) {
  return (centsValue / 100).toFixed(2);
}

export function buildCustomerCreditExposure(
  creditLimit: unknown,
  invoiceRows: Array<{ status: string | null; balanceDue: unknown }>,
): CustomerCreditExposure {
  const totals = { outstandingArCents: 0, pendingBillingCents: 0 };
  for (const invoice of invoiceRows) {
    const status = String(invoice.status || "").toLowerCase();
    if (status === "void" || status === "paid") continue;
    const amount = Math.max(0, cents(invoice.balanceDue));
    if (status === "draft") totals.pendingBillingCents += amount;
    else if (postedInvoiceStatuses.has(status)) totals.outstandingArCents += amount;
  }
  const creditLimitCents = cents(creditLimit);
  const creditExposureCents = totals.outstandingArCents + totals.pendingBillingCents;
  return {
    outstandingArCents: totals.outstandingArCents,
    pendingBillingCents: totals.pendingBillingCents,
    creditExposureCents,
    availableCreditCents: creditLimitCents - creditExposureCents,
    outstandingAr: money(totals.outstandingArCents),
    pendingBilling: money(totals.pendingBillingCents),
    creditExposure: money(creditExposureCents),
    availableCredit: money(creditLimitCents - creditExposureCents),
  };
}
