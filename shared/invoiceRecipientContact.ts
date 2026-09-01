const USABLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hasUsableInvoiceRecipientEmail(value: unknown): value is string {
  return typeof value === "string" && USABLE_EMAIL_PATTERN.test(value.trim());
}
