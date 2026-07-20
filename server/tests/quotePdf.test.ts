import { describe, expect, test } from "@jest/globals";
import { inflateSync } from "zlib";
import {
  buildQuotePdfBillToLines,
  generateQuotePdfBytes,
  getQuotePdfEligibility,
  resolveQuotePdfCompanyBranding,
} from "../lib/quotePdf";

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

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
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
          country: "United States",
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
    expect(text).not.toContain("United States");
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

  test("renders customer name once in Bill To when no address exists", () => {
    const lines = buildQuotePdfBillToLines({
      ...validDraftQuote,
      customerName: "Eye 4 Group",
      billToCompany: "Eye 4 Group",
      billToName: "Eye 4 Group",
      billToEmail: "ap@eye4group.com",
    });

    expect(lines).toEqual(["Eye 4 Group", "ap@eye4group.com"]);
  });

  test("renders real billing address fields in quote PDF", async () => {
    const bytes = await generateQuotePdfBytes({
      quote: {
        ...validDraftQuote,
        customerName: "Eye 4 Group",
        billToCompany: "Eye 4 Group",
        billToName: "Accounts Payable",
        billToAddress1: "123 Market St",
        billToAddress2: "Suite 400",
        billToCity: "Akron",
        billToState: "OH",
        billToPostalCode: "44308",
        billToCountry: "US",
        billToPhone: "555-1212",
        billToEmail: "ap@eye4group.com",
      },
      organization: { id: "org_1", name: "Fallback Org", settings: { currency: "USD" } },
    });

    const text = extractDecodedPdfContent(bytes);
    expect(text).toContain("Eye 4 Group");
    expect(text).toContain("Accounts Payable");
    expect(text).toContain("123 Market St");
    expect(text).toContain("Suite 400");
    expect(text).toContain("Akron, OH 44308");
    expect(text).not.toContain("US");
    expect(text).toContain("555-1212");
    expect(text).toContain("ap@eye4group.com");
  });

  test("quote PDF company and Bill To addresses omit United States by default", async () => {
    const bytes = await generateQuotePdfBytes({
      quote: {
        ...validDraftQuote,
        customerName: "Eye 4 Group",
        billToCompany: "Eye 4 Group",
        billToAddress1: "123 Market St",
        billToCity: "Akron",
        billToState: "OH",
        billToPostalCode: "44308",
        billToCountry: "United States",
      },
      organization: { id: "org_1", name: "Fallback Org", settings: { currency: "USD" } },
      companySettings: {
        companyDisplayName: "Header Display",
        physicalAddress: {
          line1: "7 Compact Way",
          city: "Dayton",
          state: "OH",
          postalCode: "45402",
          country: "United States",
        },
      },
    });

    const text = extractDecodedPdfContent(bytes);
    expect(text).toContain("7 Compact Way");
    expect(text).toContain("123 Market St");
    expect(text).not.toContain("United States");
  });

  test("missing billing address fields do not fall back to customer name", () => {
    const lines = buildQuotePdfBillToLines({
      ...validDraftQuote,
      customerName: "Eye 4 Group",
      billToCompany: "Eye 4 Group",
      billToName: null,
      billToAddress1: "Eye 4 Group",
      billToAddress2: "Eye 4 Group",
      billToCity: null,
      billToState: null,
      billToPostalCode: null,
      billToCountry: null,
      billToEmail: "ap@eye4group.com",
    });

    expect(lines).toEqual(["Eye 4 Group", "ap@eye4group.com"]);
  });

  test("company header renders compact company info without a duplicate large title", async () => {
    const bytes = await generateQuotePdfBytes({
      quote: validDraftQuote,
      organization: { id: "org_1", name: "Fallback Org", settings: { currency: "USD" } },
      companySettings: {
        organizationId: "org_1",
        companyDisplayName: "Header Display",
        legalCompanyName: "Header Legal LLC",
        physicalAddress: { line1: "7 Compact Way" },
        phone: "555-0100",
        email: "hello@header.test",
      },
    });

    const text = extractDecodedPdfContent(bytes);
    expect(countOccurrences(text, "Header Display")).toBe(1);
    expect(countOccurrences(text, "Header Legal LLC")).toBe(1);
    expect(text).toContain("7 Compact Way");
    expect(text).toContain("555-0100 | hello@header.test");
  });

  test("does not require quote status to be sent", () => {
    expect(getQuotePdfEligibility({ ...validDraftQuote, status: "draft" }).eligible).toBe(true);
    expect(getQuotePdfEligibility({ ...validDraftQuote, status: "pending" }).eligible).toBe(true);
  });

  test("includes quantity-only lines and derives PDF totals from effective overrides", async () => {
    const priceOverride = (
      mode: "override_unit_after_margin" | "override_total_after_margin",
      valueCents: number,
      baseCalculatedTotalCents: number,
    ) => ({
      priceOverride: {
        schemaVersion: 1,
        mode,
        valueCents,
        valuePercent: null,
        baseCalculatedTotalCents,
      },
    });
    const quote = {
      ...validDraftQuote,
      subtotal: "139.00",
      totalPrice: "139.00",
      lineItems: [
        {
          id: "line_coroplast_1",
          productId: "product_coroplast",
          productName: "Coroplast",
          width: 24,
          height: 18,
          quantity: 2,
          linePrice: "100.00",
          pbv2SnapshotJson: { pricing: { totalCents: 10000 } },
          specsJson: priceOverride("override_unit_after_margin", 9000, 10000),
          status: "active",
        },
        {
          id: "line_banner",
          productId: "product_banner",
          productName: "Banner",
          width: 60,
          height: 36,
          quantity: 1,
          linePrice: "80.00",
          pbv2SnapshotJson: { pricing: { totalCents: 8000 } },
          specsJson: priceOverride("override_total_after_margin", 4000, 8000),
          status: "active",
        },
        {
          id: "line_coroplast_2",
          productId: "product_coroplast",
          productName: "Coroplast Small",
          width: 12,
          height: 12,
          quantity: 2,
          linePrice: "20.00",
          pbv2SnapshotJson: { pricing: { totalCents: 2000 } },
          specsJson: priceOverride("override_unit_after_margin", 1100, 2000),
          status: "active",
        },
        {
          id: "line_stakes",
          productId: "product_stakes",
          productName: "Economy Yard Sign Stakes",
          width: 0,
          height: 0,
          quantity: 25,
          linePrice: "0.00",
          pbv2SnapshotJson: { pricing: { totalCents: 0 } },
          specsJson: {
            ...priceOverride("override_unit_after_margin", 100, 0),
            staffReviewedDraft: { inboundRecordId: "inbound_1" },
          },
          status: "active",
        },
      ],
    };

    expect(getQuotePdfEligibility(quote).lineItems).toHaveLength(4);
    const bytes = await generateQuotePdfBytes({
      quote,
      organization: { name: "Titan Graphics", settings: { currency: "USD" } },
    });
    const text = extractDecodedPdfContent(bytes);

    expect(text).toContain("Economy Yard Sign Stakes");
    expect(text).toContain("$267.00");
    expect(text).not.toContain("$139.00");
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
