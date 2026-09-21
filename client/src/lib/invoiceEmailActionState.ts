export type InvoiceEmailActionState = {
  label: "Send" | "Resend" | "Queued" | "Sending" | "Retrying";
  /** An active durable delivery job is the authority for suppressing a second click. */
  disabled: boolean;
};

/**
 * Keeps the row action honest about the durable queue. `lastSentAt` remains
 * the successful-provider checkpoint, so it must not be used to decide
 * whether a currently queued send can be clicked again.
 */
export function getInvoiceEmailActionState(input: {
  lastSentAt: string | Date | null | undefined;
  emailDeliveryStatus: string | null | undefined;
}): InvoiceEmailActionState {
  switch (String(input.emailDeliveryStatus || "").toLowerCase()) {
    case "queued":
      return { label: "Queued", disabled: true };
    case "processing":
      return { label: "Sending", disabled: true };
    case "retrying":
      return { label: "Retrying", disabled: true };
    default:
      return { label: input.lastSentAt ? "Resend" : "Send", disabled: false };
  }
}
