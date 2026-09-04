import { describe, expect, jest, test } from "@jest/globals";
import { PDFDocument } from "pdf-lib";

import { buildRawMessage, normalizeEmailAttachments } from "../lib/emailMime";
import { generateInvoicePdfBytes } from "../lib/invoicePdf";
import { createInvoicePdfEmailAttachment, INVOICE_PDF_CONTENT_TYPE } from "../services/invoiceEmailAttachment";
import { buildInvoiceEmailHtml, buildInvoiceEmailPlainText, buildInvoicePortalInvoiceUrl, buildInvoicePortalPaymentUrl } from "../services/invoiceEmailContent";

async function generateValidInvoicePdf() {
  return generateInvoicePdfBytes({
    invoice: {
      id: "invoice_20000",
      invoiceNumber: 20000,
      status: "sent",
      issueDate: "2026-07-16",
      dueDate: "2026-08-15",
      subtotalCents: 2500,
      taxCents: 0,
      shippingCents: 0,
      totalCents: 2500,
      currency: "USD",
    },
    customer: { companyName: "Test Customer", email: "customer@example.com" },
    companySettings: { companyName: "Test Print Shop" },
    paymentSummary: { totalCents: 2500, amountPaidCents: 0, amountDueCents: 2500, statusLabel: "Open" },
    lineItems: [{ description: "Shipping", quantity: 1, lineTotalCents: 2500 }],
  } as any);
}

describe("invoice email delivery", () => {
  test("uses valid renderer bytes for the PDF email attachment", async () => {
    const attachment = await createInvoicePdfEmailAttachment({
      filename: "invoice-INV-20000.pdf",
      pdfBytes: await generateValidInvoicePdf(),
    });
    const normalized = normalizeEmailAttachments([attachment]);

    expect(attachment.filename).toBe("invoice-INV-20000.pdf");
    expect(attachment.contentType).toBe(INVOICE_PDF_CONTENT_TYPE);
    expect(attachment.content.length).toBeGreaterThan(0);
    expect(attachment.content.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(normalized).toHaveLength(1);
    expect(normalized?.[0].content).toEqual(attachment.content);
    await expect(PDFDocument.load(normalized?.[0].content as Buffer)).resolves.toBeDefined();
  });

  test("decodes legacy base64 attachment content exactly once", async () => {
    const pdf = Buffer.from(await generateValidInvoicePdf());
    const normalized = normalizeEmailAttachments([{
      filename: "invoice-INV-20000.pdf",
      content: pdf.toString("base64"),
      encoding: "base64",
      contentType: INVOICE_PDF_CONTENT_TYPE,
    }]);

    expect(normalized?.[0].content).toEqual(pdf);
    expect(normalized?.[0].content.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  test("rejects corrupt PDF bytes before an email is sent", async () => {
    await expect(createInvoicePdfEmailAttachment({
      filename: "invoice-INV-20000.pdf",
      pdfBytes: Buffer.from("<html>PDF unavailable</html>"),
    })).rejects.toMatchObject({ code: "INVOICE_PDF_INVALID", statusCode: 500 });
  });

  test("includes a guest payment CTA and distinct portal fallback only when online payment is available", () => {
    const paymentUrl = buildInvoicePortalPaymentUrl({
      publicWebOrigin: "https://app.example.test",
      invoiceId: "invoice_20000",
      canPayOnline: true,
    });
    const payableHtml = buildInvoiceEmailHtml({
      invoiceNumber: "INV-20000",
      companyName: "Test Print Shop",
      customerName: "Test Customer",
      totalFormatted: "25.00",
      dueDate: "Aug 15, 2026",
      poNumber: "Mike Gerdt Shipping",
      jobLabel: "Shipping cost for sending box",
      paymentUrl,
      portalUrl: paymentUrl,
      guestPaymentUrl: "https://app.example.test/pay/invoice/opaque-token",
    });
    const unavailableHtml = buildInvoiceEmailHtml({
      invoiceNumber: "INV-20000",
      companyName: "Test Print Shop",
      customerName: "Test Customer",
      totalFormatted: "25.00",
      dueDate: "Aug 15, 2026",
      paymentUrl: buildInvoicePortalPaymentUrl({
        publicWebOrigin: "https://app.example.test",
        invoiceId: "invoice_20000",
        canPayOnline: false,
      }),
    });

    expect(paymentUrl).toBe("https://app.example.test/portal/invoices/invoice_20000");
    expect(payableHtml).toContain("Pay Invoice");
    expect(payableHtml).toContain("https://app.example.test/pay/invoice/opaque-token");
    expect(payableHtml).toContain("Customer Portal");
    expect(payableHtml).toContain("PO #:</strong> Mike Gerdt Shipping");
    expect(payableHtml).toContain("Job:</strong> Shipping cost for sending box");
    expect(unavailableHtml).not.toContain("Pay Invoice");
    expect(unavailableHtml).not.toContain("PO #:</strong>");
    expect(unavailableHtml).not.toContain("Job:</strong>");
  });

  test("includes the secure customer portal CTA when a portal setup or login URL is available", () => {
    const portalUrl = "https://app.example.test/accept-invite?token=opaque-token&kind=portal";
    const html = buildInvoiceEmailHtml({
      invoiceNumber: "INV-20001",
      companyName: "Test Print Shop",
      customerName: "Test Customer",
      totalFormatted: "25.00",
      dueDate: "Aug 15, 2026",
      portalUrl,
    });

    expect(html).toContain("View Invoice");
    expect(html).not.toContain("Set Up Customer Portal");
    expect(html).toContain(portalUrl.replace(/&/g, "&amp;"));
  });

  test("keeps a token-bearing invoice CTA intact in actual Gmail MIME and supplies a plain-text fallback", () => {
    const portalUrl = "https://app.example.test/accept-invite?token=ab12cdef&kind=portal&returnTo=%2Fportal%2Finvoices%2Finvoice_20000";
    const html = buildInvoiceEmailHtml({
      invoiceNumber: "INV-20000", companyName: "Test Print Shop", customerName: "Test Customer",
      totalFormatted: "25.00", dueDate: "Aug 15, 2026", portalUrl, guestPaymentUrl: "https://app.example.test/pay/invoice/guest-token", hasBalanceDue: true,
    });
    const text = buildInvoiceEmailPlainText({
      invoiceNumber: "INV-20000", companyName: "Test Print Shop", customerName: "Test Customer",
      totalFormatted: "25.00", dueDate: "Aug 15, 2026", portalUrl, guestPaymentUrl: "https://app.example.test/pay/invoice/guest-token", canPayOnline: true,
    });
    const raw = buildRawMessage({ from: "Shop <shop@example.test>", to: "customer@example.test", subject: "Invoice", html, text });
    const mime = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

    expect(mime).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(mime).toContain("Content-Type: text/html; charset=UTF-8");
    expect(mime).not.toContain("quoted-printable");
    expect(mime.replace(/\r\n/g, "")).toContain(Buffer.from(html).toString("base64"));
    expect(mime.replace(/\r\n/g, "")).toContain(Buffer.from(text).toString("base64"));
    expect(html).toContain("Pay Invoice");
    expect(text).toContain("Pay Invoice:");
    expect(text).toContain(portalUrl);
  });

  test("keeps a paid invoice viewable without presenting a payment CTA", () => {
    const portalUrl = buildInvoicePortalInvoiceUrl({
      publicWebOrigin: "https://app.example.test/ignored-path",
      invoiceId: "invoice_paid",
    });
    const html = buildInvoiceEmailHtml({
      invoiceNumber: "INV-PAID",
      companyName: "Test Print Shop",
      customerName: "Test Customer",
      totalFormatted: "25.00",
      dueDate: "Aug 15, 2026",
      portalUrl,
      portalMode: "setup",
    });

    expect(portalUrl).toBe("https://app.example.test/portal/invoices/invoice_paid");
    expect(html).toContain("View Invoice");
    expect(html).not.toContain("View &amp; Pay Invoice");
  });

  test("invokes the Gmail provider adapter and returns its provider message id", async () => {
    // The service imports the DB-backed storage facade, but this isolated
    // provider-boundary test replaces storage before any database operation.
    process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
    const { emailService } = await import("../emailService");
    const { storage } = await import("../storage");
    const originalClient = (emailService as any).createGmailClient;
    const originalTemplates = (emailService as any).getEmailTemplates;
    const previousClientId = process.env.GOOGLE_CLIENT_ID;
    const previousClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const send = jest.fn().mockResolvedValue({ data: { id: "gmail-message-123", threadId: "thread-123" } });
    const settings = jest.spyOn(storage, "getDefaultEmailSettings").mockResolvedValue({
      provider: "gmail",
      fromAddress: "shop@example.test",
      fromName: "Test Print Shop",
      refreshToken: "test-refresh-token",
      connectionStatus: "connected",
    } as any);
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    (emailService as any).getEmailTemplates = jest.fn().mockResolvedValue({});
    (emailService as any).createGmailClient = jest.fn().mockResolvedValue({ users: { messages: { send } } });

    try {
      await expect(emailService.sendEmail("org-1", {
        to: "customer@example.test",
        subject: "Invoice",
        html: "<p>Invoice</p>",
      })).resolves.toBe("gmail-message-123");
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ userId: "me", requestBody: expect.objectContaining({ raw: expect.any(String) }) }));
    } finally {
      settings.mockRestore();
      (emailService as any).createGmailClient = originalClient;
      (emailService as any).getEmailTemplates = originalTemplates;
      if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = previousClientSecret;
    }
  });

  test("marks an uncertain Gmail submission timeout as needs review", async () => {
    process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
    const { emailService } = await import("../emailService");
    const { storage } = await import("../storage");
    const originalClient = (emailService as any).createGmailClient;
    const originalTemplates = (emailService as any).getEmailTemplates;
    const previousClientId = process.env.GOOGLE_CLIENT_ID;
    const previousClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const settings = jest.spyOn(storage, "getDefaultEmailSettings").mockResolvedValue({
      provider: "gmail", fromAddress: "shop@example.test", fromName: "Test Print Shop", refreshToken: "test-refresh-token", connectionStatus: "connected",
    } as any);
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    (emailService as any).getEmailTemplates = jest.fn().mockResolvedValue({});
    (emailService as any).createGmailClient = jest.fn().mockResolvedValue({ users: { messages: { send: jest.fn().mockRejectedValue(new Error("Gmail API send operation timed out after 20000ms")) } } });
    try {
      await expect(emailService.sendEmail("org-1", { to: "customer@example.test", subject: "Invoice", html: "<p>Invoice</p>" }))
        .rejects.toMatchObject({ invoiceEmailDeliveryFailureKind: "needs_review" });
    } finally {
      settings.mockRestore();
      (emailService as any).createGmailClient = originalClient;
      (emailService as any).getEmailTemplates = originalTemplates;
      if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = previousClientSecret;
    }
  });

});
