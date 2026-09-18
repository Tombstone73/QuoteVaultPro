function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const INVOICE_EMAIL_SUBJECT_MAX_LENGTH = 250;
export const INVOICE_EMAIL_MESSAGE_MAX_LENGTH = 10_000;

export type InvoiceEmailDraft = {
  subject: string;
  message: string;
};

/**
 * The human-authored portion of an Invoice email. Links, CTAs, attachment
 * handling, and the transactional shell are intentionally not part of this
 * draft: those stay under server control at send time.
 */
export function buildInvoiceEmailDraft(input: {
  invoiceNumber: string;
  companyName: string;
  customerName: string;
  totalFormatted: string;
  dueDate?: string | null;
}): InvoiceEmailDraft {
  const dueSentence = input.dueDate
    ? `Payment is due ${input.dueDate}.`
    : "Payment is due according to the invoice terms.";
  return {
    subject: `Invoice #${input.invoiceNumber} from ${input.companyName}`,
    message: [
      `Dear ${input.customerName},`,
      "",
      `Please find attached Invoice #${input.invoiceNumber} from ${input.companyName} for $${input.totalFormatted}.`,
      dueSentence,
      "",
      `If you have any questions about this invoice, please contact ${input.companyName}.`,
    ].join("\n"),
  };
}

function invalidComposeField(message: string, code: string): Error & { statusCode: number; code: string } {
  return Object.assign(new Error(message), { statusCode: 400, code });
}

/**
 * Validates browser-supplied plain-text overrides without treating browser
 * defaults as authoritative. Newlines are retained for both HTML and text.
 */
export function resolveInvoiceEmailCompose(input: {
  draft: InvoiceEmailDraft;
  subject?: unknown;
  message?: unknown;
}): InvoiceEmailDraft & { customizedSubject: boolean; customizedMessage: boolean } {
  const subjectProvided = input.subject != null;
  const messageProvided = input.message != null;
  if (subjectProvided && typeof input.subject !== "string") {
    throw invalidComposeField("Subject must be text.", "INVOICE_EMAIL_SUBJECT_INVALID");
  }
  if (messageProvided && typeof input.message !== "string") {
    throw invalidComposeField("Message must be text.", "INVOICE_EMAIL_MESSAGE_INVALID");
  }

  const subject = subjectProvided ? String(input.subject).trim() : input.draft.subject;
  // Normalize only line endings so staff-entered paragraph breaks are
  // preserved exactly across the HTML and plain-text representations.
  const message = messageProvided ? String(input.message).replace(/\r\n?/g, "\n") : input.draft.message;
  if (!subject) throw invalidComposeField("Subject is required.", "INVOICE_EMAIL_SUBJECT_REQUIRED");
  if (subject.length > INVOICE_EMAIL_SUBJECT_MAX_LENGTH) {
    throw invalidComposeField(`Subject must be ${INVOICE_EMAIL_SUBJECT_MAX_LENGTH} characters or fewer.`, "INVOICE_EMAIL_SUBJECT_TOO_LONG");
  }
  if (!message.trim()) throw invalidComposeField("Message is required.", "INVOICE_EMAIL_MESSAGE_REQUIRED");
  if (message.length > INVOICE_EMAIL_MESSAGE_MAX_LENGTH) {
    throw invalidComposeField(`Message must be ${INVOICE_EMAIL_MESSAGE_MAX_LENGTH} characters or fewer.`, "INVOICE_EMAIL_MESSAGE_TOO_LONG");
  }
  return {
    subject,
    message,
    customizedSubject: subject !== input.draft.subject,
    customizedMessage: message !== input.draft.message,
  };
}

function plainTextToHtml(value: string): string {
  return escapeHtml(value).replace(/\r\n?|\n/g, "<br>\n");
}

export function buildInvoicePortalInvoiceUrl(input: {
  publicWebOrigin: string | null;
  invoiceId: string;
}): string | null {
  if (!input.publicWebOrigin) return null;

  try {
    const parsed = new URL(input.publicWebOrigin);
    if (parsed.protocol !== "https:") return null;
    const origin = parsed.origin;
    return `${origin}/portal/invoices/${encodeURIComponent(input.invoiceId)}`;
  } catch {
    return null;
  }
}

export function buildCustomerPortalUrl(publicWebOrigin: string | null): string | null {
  if (!publicWebOrigin) return null;
  try {
    const parsed = new URL(publicWebOrigin);
    return parsed.protocol === "https:" ? `${parsed.origin}/portal` : null;
  } catch {
    return null;
  }
}

/** Compatibility helper for callers that use an authenticated portal payment route. */
export function buildInvoicePortalPaymentUrl(input: {
  publicWebOrigin: string | null;
  invoiceId: string;
  canPayOnline: boolean;
}): string | null {
  return input.canPayOnline ? buildInvoicePortalInvoiceUrl(input) : null;
}

export function buildInvoiceEmailHtml(input: {
  invoiceNumber: string;
  companyName: string;
  customerName: string;
  totalFormatted: string;
  dueDate: string;
  poNumber?: string | null;
  jobLabel?: string | null;
  paymentUrl?: string | null;
  portalUrl?: string | null;
  portalMode?: "active" | "setup" | "login";
  hasBalanceDue?: boolean;
  guestPaymentUrl?: string | null;
  /** Plain-text operator message; arbitrary HTML is never accepted here. */
  message?: string | null;
}): string {
  const invoiceNumber = escapeHtml(input.invoiceNumber);
  const companyName = escapeHtml(input.companyName);
  const customerName = escapeHtml(input.customerName);
  const totalFormatted = escapeHtml(input.totalFormatted);
  const dueDate = escapeHtml(input.dueDate);
  const poNumber = String(input.poNumber || "").trim();
  const jobLabel = String(input.jobLabel || "").trim();
  const orderContextSection = poNumber || jobLabel
    ? `<p style="margin: 12px 0; color: #444;">${poNumber ? `<strong>PO #:</strong> ${escapeHtml(poNumber)}<br>` : ""}${jobLabel ? `<strong>Job:</strong> ${escapeHtml(jobLabel)}` : ""}</p>`
    : "";
  const portalUrl = input.portalUrl ? escapeHtml(input.portalUrl) : null;
  const guestPaymentUrl = input.guestPaymentUrl ? escapeHtml(input.guestPaymentUrl) : null;
  const humanMessage = plainTextToHtml(input.message || buildInvoiceEmailDraft({
    invoiceNumber: input.invoiceNumber,
    companyName: input.companyName,
    customerName: input.customerName,
    totalFormatted: input.totalFormatted,
    dueDate: input.dueDate,
  }).message);
  const canPay = input.hasBalanceDue ?? Boolean(input.paymentUrl);
  const ctaLabel = canPay ? "View &amp; Pay Invoice" : "View Invoice";
  const portalSection = (guestPaymentUrl || portalUrl)
    ? `<p style="margin: 24px 0 12px 0;">${canPay
      ? "Use the secure customer portal to review this invoice and pay its current balance."
      : "Use the secure customer portal to review this invoice."}</p>
      ${guestPaymentUrl && canPay ? `<p style="margin: 12px 0;"><a href="${guestPaymentUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 18px; border-radius: 6px; font-weight: 600; text-decoration: none;">Pay Invoice</a></p>` : ""}
      ${portalUrl ? `<p style="margin: 12px 0;"><a href="${portalUrl}" style="display: inline-block; background: #475569; color: #ffffff; padding: 12px 18px; border-radius: 6px; font-weight: 600; text-decoration: none;">${ctaLabel === "View &amp; Pay Invoice" ? "Customer Portal" : "View Invoice"}</a></p>` : ""}
      <p style="font-size: 13px; color: #666; word-break: break-all;">If a button does not work, copy and paste the secure link into your browser:${guestPaymentUrl ? `<br><a href="${guestPaymentUrl}">${guestPaymentUrl}</a>` : ""}${portalUrl ? `<br><a href="${portalUrl}">${portalUrl}</a>` : ""}</p>`
    : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice #${invoiceNumber}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
    <h1 style="margin: 0 0 10px 0; color: #2563eb;">Invoice #${invoiceNumber}</h1>
    <p style="margin: 0; color: #666;">
      From: ${companyName}<br>
      To: ${customerName}
    </p>
  </div>

  <div style="padding: 20px 0;">
    <p style="margin: 0 0 16px 0;">${humanMessage}</p>${orderContextSection}${portalSection}
  </div>

  <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #666; font-size: 14px;">
    <p style="margin: 0;">Thank you for your business!</p>
    <p style="margin: 5px 0 0 0;">${companyName}</p>
  </div>
</body>
</html>
  `.trim();
}

export function buildInvoiceEmailPlainText(input: {
  invoiceNumber: string;
  companyName: string;
  customerName: string;
  totalFormatted: string;
  dueDate: string;
  portalUrl?: string | null;
  guestPaymentUrl?: string | null;
  canPayOnline?: boolean;
  /** Same plain-text operator message that is rendered safely into HTML. */
  message?: string | null;
}): string {
  const cta = input.canPayOnline ? "View & Pay Invoice" : "View Invoice";
  const portalLine = `${input.guestPaymentUrl && input.canPayOnline ? `\nPay Invoice:\n${input.guestPaymentUrl}\n` : ""}${input.portalUrl ? `\n${cta === "View & Pay Invoice" ? "Customer Portal" : cta}:\n${input.portalUrl}\n` : ""}`;
  const message = input.message || buildInvoiceEmailDraft({
    invoiceNumber: input.invoiceNumber,
    companyName: input.companyName,
    customerName: input.customerName,
    totalFormatted: input.totalFormatted,
    dueDate: input.dueDate,
  }).message;
  return `Invoice #${input.invoiceNumber}\n\n${message}${portalLine}`;
}
