export type InvoiceEmailRecipientSource =
  | "order_contact"
  | "customer_primary_contact"
  | "billing_contact"
  | "customer_account"
  | "customer_contact";

export type InvoiceEmailRecipient = {
  email: string;
  name: string;
  source: InvoiceEmailRecipientSource;
};

export type InvoiceEmailRecipientCandidate = {
  email?: string | null;
  name?: string | null;
  source: InvoiceEmailRecipientSource;
};

/** Matches the existing recipient dialogs' deliberately simple email check. */
export function isValidInvoiceRecipientEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Keeps the first valid candidate for an address. Callers supply candidates in
 * business-priority order, so the first entry remains a compatibility default.
 */
export function buildInvoiceEmailRecipients(
  candidates: InvoiceEmailRecipientCandidate[],
): InvoiceEmailRecipient[] {
  const seen = new Set<string>();
  const recipients: InvoiceEmailRecipient[] = [];

  for (const candidate of candidates) {
    const email = candidate.email?.trim();
    if (!email || !isValidInvoiceRecipientEmail(email)) continue;

    const dedupeKey = email.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    recipients.push({
      email,
      name: candidate.name?.trim() || email,
      source: candidate.source,
    });
  }

  return recipients;
}
