import { describe, expect, test } from "@jest/globals";
import { PDFDocument } from "pdf-lib";

import { normalizeEmailAttachments } from "../emailService";
import { generateInvoicePdfBytes } from "../lib/invoicePdf";
import { createInvoicePdfEmailAttachment, INVOICE_PDF_CONTENT_TYPE } from "../services/invoiceEmailAttachment";
import { buildInvoiceEmailHtml, buildInvoicePortalInvoiceUrl, buildInvoicePortalPaymentUrl } from "../services/invoiceEmailContent";
import { buildReminderEmailHtml } from "../invoiceReminderJob";

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

  test("includes an invoice-specific payment CTA and raw fallback only when online payment is available", () => {
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
    expect(payableHtml).toContain("View &amp; Pay Invoice");
    expect(payableHtml).toContain(paymentUrl as string);
    expect(payableHtml).toContain("PO #:</strong> Mike Gerdt Shipping");
    expect(payableHtml).toContain("Job:</strong> Shipping cost for sending box");
    expect(unavailableHtml).not.toContain("View &amp; Pay Invoice");
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

    expect(html).toContain("Set up secure customer portal access to view this invoice.");
    expect(html).toContain("Set Up Customer Portal");
    expect(html).toContain(portalUrl.replace(/&/g, "&amp;"));
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

  test("includes available PO and job context in invoice reminder emails", () => {
    const html = buildReminderEmailHtml({
      invoiceNumber: "INV-20000",
      customerName: "Test Customer",
      companyName: "Test Print Shop",
      balanceDue: "25.00",
      dueDate: "Aug 15, 2026",
      reminderNumber: 1,
      poNumber: "Mike Gerdt Shipping",
      jobLabel: "Shipping cost for sending box",
    });

    expect(html).toContain("PO #:</strong> Mike Gerdt Shipping");
    expect(html).toContain("Job:</strong> Shipping cost for sending box");
  });
});
