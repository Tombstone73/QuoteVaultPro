/**
 * Failure classification crosses the provider/queue boundary. Keeping it in
 * this neutral module prevents the provider from importing the queue worker
 * during module initialization.
 */
export type InvoiceEmailDeliveryFailureKind = "retryable" | "needs_review";

export function markInvoiceEmailDeliveryFailure<T extends Error>(error: T, kind: InvoiceEmailDeliveryFailureKind): T {
  (error as T & { invoiceEmailDeliveryFailureKind?: InvoiceEmailDeliveryFailureKind }).invoiceEmailDeliveryFailureKind = kind;
  return error;
}

export function getInvoiceEmailDeliveryFailureKind(error: unknown): InvoiceEmailDeliveryFailureKind | null {
  const explicit = (error as { invoiceEmailDeliveryFailureKind?: unknown } | null)?.invoiceEmailDeliveryFailureKind;
  return explicit === "needs_review" || explicit === "retryable" ? explicit : null;
}
