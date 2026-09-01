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
    const origin = new URL(input.publicWebOrigin).origin;
    return `${origin}/portal/invoices/${encodeURIComponent(input.invoiceId)}`;
  } catch {
    return null;
  }
}

export function buildCustomerPortalUrl(publicWebOrigin: string | null): string | null {
  if (!publicWebOrigin) return null;
  try {
    return `${new URL(publicWebOrigin).origin}/portal`;
  } catch {
    return null;
  }
}

/** The secure portal invoice route is also the existing hosted-payment route. */
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
  const paymentUrl = input.paymentUrl ? escapeHtml(input.paymentUrl) : null;
  const paymentSection = paymentUrl
    ? `
    <p style="margin: 24px 0 12px 0;">
      <a href="${paymentUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 18px; border-radius: 6px; font-weight: 600; text-decoration: none;">View &amp; Pay Invoice</a>
    </p>
    <p style="font-size: 13px; color: #666; word-break: break-all;">Sign in to the secure customer portal to view this invoice and pay its current balance. If the button does not work, copy and paste this link into your browser:<br><a href="${paymentUrl}">${paymentUrl}</a></p>`
    : "";
  const portalUrl = input.portalUrl ? escapeHtml(input.portalUrl) : null;
  const portalSection = !paymentUrl && portalUrl
    ? `<p style="margin: 24px 0 12px 0;">${input.portalMode === "setup"
      ? "Set up secure customer portal access to view this invoice."
      : input.portalMode === "login"
        ? "Sign in to the secure customer portal to view your invoices and current balances. Contact the shop if you need portal access."
        : "View this invoice in the secure customer portal."}</p>
      <p style="margin: 12px 0;"><a href="${portalUrl}" style="display: inline-block; background: #475569; color: #ffffff; padding: 12px 18px; border-radius: 6px; font-weight: 600; text-decoration: none;">${input.portalMode === "setup" ? "Set Up Customer Portal" : input.portalMode === "login" ? "Open Customer Portal" : "View Invoice"}</a></p>`
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
    <p>Payment is due ${dueDate}.</p>${orderContextSection}${paymentSection}${portalSection}
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
