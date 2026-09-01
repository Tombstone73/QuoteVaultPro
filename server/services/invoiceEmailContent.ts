function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
    <p>Dear ${customerName},</p>
    <p>Please find attached Invoice #${invoiceNumber} for the amount of <strong>$${totalFormatted}</strong>.</p>
    <p>Payment is due ${dueDate}.</p>${orderContextSection}${portalSection}
    <p>If you have any questions about this invoice, please don't hesitate to contact us.</p>
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
}): string {
  const cta = input.canPayOnline ? "View & Pay Invoice" : "View Invoice";
  const portalLine = `${input.guestPaymentUrl && input.canPayOnline ? `\nPay Invoice:\n${input.guestPaymentUrl}\n` : ""}${input.portalUrl ? `\n${cta === "View & Pay Invoice" ? "Customer Portal" : cta}:\n${input.portalUrl}\n` : ""}`;
  return `Invoice #${input.invoiceNumber}\n\nDear ${input.customerName},\n\nPlease find attached Invoice #${input.invoiceNumber} from ${input.companyName} for $${input.totalFormatted}. Payment is due ${input.dueDate}.${portalLine}\nIf you have questions about this invoice, please contact ${input.companyName}.`;
}
