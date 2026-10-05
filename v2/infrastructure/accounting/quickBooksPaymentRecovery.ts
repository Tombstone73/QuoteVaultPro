export type QuickBooksPaymentRecoveryContext = Readonly<{
  schemaVersion: 1;
  organizationId: string;
  jobId: string;
  paymentId: string;
  realmId: string;
  environment: "sandbox" | "production";
  reference: string;
  customerId: string;
  amountCents: number;
  currency: string;
  allocations: readonly Readonly<{ invoiceId: string; amountCents: number }>[];
}>;
export type QuickBooksPaymentRead = Readonly<{
  organizationId: string;
  realmId: string;
  environment: "sandbox" | "production";
  complete: boolean;
  payments: readonly unknown[];
}>;
export type QuickBooksPaymentMatch = Readonly<{ state: "matched"; providerId: string }> | Readonly<{ state: "missing" | "unknown" | "mismatch" | "ambiguous" }>;

const cents = (value: unknown): number | undefined => {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return undefined;
  const result = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : undefined;
};
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const allocationKey = (allocations: QuickBooksPaymentRecoveryContext["allocations"]) => JSON.stringify([...allocations].sort((a, b) => a.invoiceId.localeCompare(b.invoiceId)));

/** Reference selects candidates, never establishes identity. Missing evidence is not a zero balance or a safe retry. */
export const matchQuickBooksPayment = (expected: QuickBooksPaymentRecoveryContext, read: QuickBooksPaymentRead, externalId?: string): QuickBooksPaymentMatch => {
  if (expected.schemaVersion !== 1 || !expected.organizationId || !expected.jobId || !expected.paymentId || !expected.realmId || !expected.customerId
    || !/^PMT-[1-9]\d{0,16}$/.test(expected.reference) || !/^[A-Z]{3}$/.test(expected.currency)
    || !Number.isSafeInteger(expected.amountCents) || expected.amountCents <= 0 || !expected.allocations.length
    || expected.allocations.some(a => !a.invoiceId || !Number.isSafeInteger(a.amountCents) || a.amountCents <= 0)
    || new Set(expected.allocations.map(a => a.invoiceId)).size !== expected.allocations.length
    || expected.allocations.reduce((sum, a) => sum + a.amountCents, 0) !== expected.amountCents
    || !read.complete || read.organizationId !== expected.organizationId || read.realmId !== expected.realmId || read.environment !== expected.environment) return { state: "unknown" };
  if (!read.payments.length) return { state: "missing" };
  if (read.payments.length !== 1) return { state: "ambiguous" };
  const payment = record(read.payments[0]);
  const providerId = typeof payment.Id === "string" && payment.Id.trim() ? payment.Id : undefined;
  if (!providerId || !Array.isArray(payment.Line)) return { state: "unknown" };
  const allocations: { invoiceId: string; amountCents: number }[] = [];
  for (const raw of payment.Line) {
    const line = record(raw), amountCents = cents(line.Amount);
    if (amountCents === undefined || amountCents <= 0 || !Array.isArray(line.LinkedTxn) || line.LinkedTxn.length !== 1) return { state: "unknown" };
    const linked = record(line.LinkedTxn[0]);
    if (linked.TxnType !== "Invoice" || typeof linked.TxnId !== "string" || !linked.TxnId) return { state: "mismatch" };
    allocations.push({ invoiceId: linked.TxnId, amountCents });
  }
  if (new Set(allocations.map(a => a.invoiceId)).size !== allocations.length) return { state: "ambiguous" };
  if ((externalId !== undefined && providerId !== externalId) || payment.PaymentRefNum !== expected.reference
    || payment.PrivateNote !== `PrintersHero V2 payment ${expected.paymentId}`
    || record(payment.CustomerRef).value !== expected.customerId || record(payment.CurrencyRef).value !== expected.currency
    || cents(payment.TotalAmt) !== expected.amountCents || cents(payment.UnappliedAmt) !== 0
    || allocationKey(allocations) !== allocationKey(expected.allocations)) return { state: "mismatch" };
  return { state: "matched", providerId };
};

export const quickBooksPaymentReconciliationRequired = (reason: string): Error & { statusCode: number } =>
  Object.assign(new Error(`QUICKBOOKS_PAYMENT_RECONCILIATION_REQUIRED: ${reason}. No new Payment export is allowed; an Accounting operator must reconcile the original request.`), { statusCode: 409 });
