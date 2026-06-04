import { describe, expect, test } from "@jest/globals";
import { inflateSync } from "zlib";
import { generateQuotePdfBytes, getQuotePdfEligibility, resolveQuotePdfCompanyBranding } from "../lib/quotePdf";

const validDraftQuote = {
  id: "quote_1",
  quoteNumber: 1001,
  status: "draft",
  customerName: "Acme Print Buyer",
  subtotal: "25.00",
  taxAmount: "0.00",
  totalPrice: "25.00",
  lineItems: [
    {
      id: "line_1",
      productId: "product_1",
      productName: "Banner",
      width: "24",
      height: "36",
      quantity: 1,
      linePrice: "25.00",
      status: "active",
    },
  ],
};

const logoDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function extractDecodedPdfContent(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const chunks: string[] = [];
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(raw))) {
    try {
      chunks.push(inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"));
    } catch {
      chunks.push(match[1]);
    }
  }
  const decoded = chunks.join("\n");
  const textOperands = Array.from(decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g))
    .map((match) => Buffer.from(match[1], "hex").toString("latin1"));
  return `${decoded}\n${textOperands.join("\n")}`;
}

describe("quote PDF generation", () => {
  test("allows a saved draft quote with valid line items", async () => {
    expect(getQuotePdfEligibility(validDraftQuote).eligible).toBe(true);

    const bytes = await generateQuotePdfBytes({
      quote: validDraftQuote,
      organization: { name: "Titan Graphics", settings: { currency: "USD" } },
    });

    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("includes company branding in quote PDF without invoice-only payment fields", async () => {
    const bytes = await generateQuotePdfBytes({
      quote: validDraftQuote,
      organization: { id: "org_1", name: "Fallback Org", settings: { currency: "USD" } },
      companySettings: {
        organizationId: "org_1",
        companyDisplayName: "Acme Print",
        legalCompanyName: "Acme Print LLC",
        physicalAddress: {
          line1: "1 Shop Way",
          city: "Dayton",
          state: "OH",
          postalCode: "45402",
        },
        phone: "555-0100",
        email: "sales@acme.test",
        website: "https://acme.test",
        remittanceAddress: { enabled: true, line1: "PO Box 404" },
        invoicePaymentInstructions: "WIRE_TO_INVOICE_ONLY",
        checksPayableTo: "CHECKS_INVOICE_ONLY",
      } as any,
    });

    const text = extractDecodedPdfContent(bytes);
    expect(text).toContain("Acme Print");
    expect(text).toContain("Acme Print LLC");
    expect(text).toContain("1 Shop Way");
    expect(text).toContain("555-0100");
    expect(text).toContain("sales@acme.test");
    expect(text).not.toContain("WIRE_TO_INVOICE_ONLY");
    expect(text).not.toContain("CHECKS_INVOICE_ONLY");
    expect(text).not.toContain("PO Box 404");
    expect(text).not.toContain("Send payments to");
  });

  test("quote document branding uses logo data when available", async () => {
    const branding = await resolveQuotePdfCompanyBranding({
      quote: validDraftQuote,
      organization: { id: "org_1", name: "Fallback Org", settings: { currency: "USD" } },
      companySettings: {
        organizationId: "org_1",
        companyDisplayName: "Acme Print",
        invoiceLogoUrl: logoDataUrl,
      },
    });

    expect(branding.companyDisplayName).toBe("Acme Print");
    expect(branding.logoDataUrl).toBe(logoDataUrl);
  });

  test("does not require quote status to be sent", () => {
    expect(getQuotePdfEligibility({ ...validDraftQuote, status: "draft" }).eligible).toBe(true);
    expect(getQuotePdfEligibility({ ...validDraftQuote, status: "pending" }).eligible).toBe(true);
  });

  test("blocks unsaved and invalid quotes", () => {
    expect(getQuotePdfEligibility({ ...validDraftQuote, id: null }).eligible).toBe(false);
    expect(getQuotePdfEligibility({ ...validDraftQuote, lineItems: [] }).eligible).toBe(false);
    expect(
      getQuotePdfEligibility({
        ...validDraftQuote,
        lineItems: [{ ...validDraftQuote.lineItems[0], status: "draft" }],
      }).eligible,
    ).toBe(false);
  });
});
