/**
 * Durable queue states are delivery-operation history. The successful
 * invoice_email_logs projection remains the authority for Last Sent.
 */
export type InvoiceEmailDeliveryStatus = "queued" | "processing" | "retrying" | "sent" | "failed" | "needs_review" | "canceled";

export type InvoiceEmailDeliveryState = {
  id: string;
  status: InvoiceEmailDeliveryStatus;
  failureReason: string | null;
  /** The timestamp at which this durable queue state became current. */
  updatedAt: Date | string | null;
};

/**
 * Projects a current Invoice List delivery state from queue history and the
 * provider-successful invoice email log. Queue rows remain immutable history;
 * a later direct send must not be masked by an earlier queue failure.
 */
export function resolveCurrentInvoiceEmailDeliveryState(input: {
  queueState: InvoiceEmailDeliveryState | null | undefined;
  lastSuccessfulDeliveryAt: Date | string | null | undefined;
}): InvoiceEmailDeliveryState | null {
  const queueState = input.queueState ?? null;
  if (!queueState) return null;

  const successAtMs = input.lastSuccessfulDeliveryAt ? new Date(input.lastSuccessfulDeliveryAt).getTime() : Number.NaN;
  const queueAtMs = queueState.updatedAt ? new Date(queueState.updatedAt).getTime() : Number.NaN;
  if (Number.isFinite(successAtMs) && (!Number.isFinite(queueAtMs) || successAtMs > queueAtMs)) return null;
  return queueState;
}
