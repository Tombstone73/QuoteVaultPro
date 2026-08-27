import { generateInvoicePdfBytes, resolveInvoiceCompanyDisplayData } from "../lib/invoicePdf";
import { inflateSync } from "zlib";

const baseInvoiceParams = {
  invoice: {
    invoiceNumber: 77,
    status: "finalized",
    currency: "USD",
    issueDate: "2026-01-01T00:00:00.000Z",
    dueDate: "2026-01-15T00:00:00.000Z",
    subtotalCents: 2500,
    taxCents: 0,
    shippingCents: 0,
    totalCents: 2500,
    notesPublic: null,
    customTerms: null,
  },
  customer: {
    companyName: "Customer Co",
    billingStreet1: "9 Buyer St",
    billingCity: "Akron",
    billingState: "OH",
    billingPostalCode: "44308",
    billingCountry: "US",
  },
  paymentSummary: {
    totalCents: 2500,
    amountPaidCents: 0,
    amountDueCents: 2500,
    statusLabel: "Unpaid",
  },
  lineItems: [
    {
      description: "Invoice PDF data shaping test item",
      quantity: 1,
      unitPriceCents: 2500,
      lineTotalCents: 2500,
    },
  ],
};

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

describe("invoice PDF company info and remittance data", () => {
  test("renders order PO and wraps a long job label in the invoice metadata area", async () => {
    const bytes = await generateInvoicePdfBytes({
      ...baseInvoiceParams,
      companySettings: { companyDisplayName: "Context Print" },
      job: {
        poNumber: "Mike Gerdt Shipping",
        jobNumber: "ORD-20001",
        jobLabel: "Shipping cost for sending a box with a long descriptive job label that must wrap cleanly without crowding the bill-to address block",
      },
    } as any);

    const text = extractDecodedPdfContent(bytes);
    expect(text).toContain("PO # Mike Gerdt Shipping");
    expect(text).toContain("Job: Shipping cost for sending a box");
    expect(text).toContain("Order # ORD-20001");
    expect(text).toContain("must wrap cleanly");
  });

  test("omits order metadata cleanly when no linked order context exists", async () => {
    const bytes = await generateInvoicePdfBytes({
      ...baseInvoiceParams,
      companySettings: { companyDisplayName: "No Context Print" },
      job: null,
    } as any);

    const text = extractDecodedPdfContent(bytes);
    expect(text).not.toContain("PO #");
    expect(text).not.toContain("Order #");
  });

  test("uses physical address as payment address when remittance is disabled", () => {
    const resolved = resolveInvoiceCompanyDisplayData({
      companyDisplayName: "Acme Print",
      physicalAddress: {
        line1: "1 Physical Way",
        city: "Dayton",
        state: "OH",
        postalCode: "45402",
        country: "United States",
      },
      remittanceAddress: {
        enabled: false,
        line1: "PO Box 404",
      },
    });

    expect(resolved.paymentAddressLabel).toBe("Payment mailing address");
    expect(resolved.paymentAddress).toContain("1 Physical Way");
    expect(resolved.paymentAddress).not.toContain("United States");
    expect(resolved.paymentAddress).not.toContain("PO Box 404");
  });

  test("uses remittance address as Send payments to when enabled", () => {
    const resolved = resolveInvoiceCompanyDisplayData({
      companyDisplayName: "Acme Print",
      physicalAddress: {
        line1: "1 Physical Way",
        city: "Dayton",
        state: "OH",
        postalCode: "45402",
        country: "United States",
      },
      remittanceAddress: {
        enabled: true,
        line1: "PO Box 404",
        city: "Dayton",
        state: "OH",
        postalCode: "45401",
        country: "United States",
      },
    });

    expect(resolved.paymentAddressLabel).toBe("Send payments to");
    expect(resolved.paymentAddress).toContain("PO Box 404");
    expect(resolved.paymentAddress).not.toContain("1 Physical Way");
    expect(resolved.paymentAddress).not.toContain("United States");
  });

  test("missing logo does not break PDF generation", async () => {
    const bytes = await generateInvoicePdfBytes({
      ...baseInvoiceParams,
      companySettings: {
        companyDisplayName: "No Logo Print",
        invoiceLogoUrl: null,
      },
    } as any);

    expect(bytes.length).toBeGreaterThan(500);
    expect(extractDecodedPdfContent(bytes)).toContain("No Logo Print");
  });

  test("renders company branding in header without legacy FROM heading", async () => {
    const bytes = await generateInvoicePdfBytes({
      ...baseInvoiceParams,
      companySettings: {
        companyDisplayName: "Header Only Print",
        physicalAddress: {
          line1: "1 Header Way",
          city: "Dayton",
          state: "OH",
          postalCode: "45402",
        },
        phone: "555-0100",
        email: "hello@header.test",
        website: "https://header.test",
      },
    } as any);

    const text = extractDecodedPdfContent(bytes);
    expect(text.split("Header Only Print").length - 1).toBe(1);
    expect(text).toContain("1 Header Way");
    expect(text).toContain("555-0100 | hello@header.test");
    expect(text).not.toContain("FROM");
  });

  test("stable uploaded logo reference safely falls back when asset content is unavailable", async () => {
    const bytes = await generateInvoicePdfBytes({
      ...baseInvoiceParams,
      companySettings: {
        companyDisplayName: "Asset Logo Print",
        invoiceLogoAssetId: "asset_missing",
        invoiceLogoUrl: "/objects/uploads/org_1/invoice-logo/logo.png",
      },
    } as any);

    expect(bytes.length).toBeGreaterThan(500);
    expect(extractDecodedPdfContent(bytes)).toContain("Asset Logo Print");
  });

  test("legacy data URL logo does not break PDF generation", async () => {
    const bytes = await generateInvoicePdfBytes({
      ...baseInvoiceParams,
      companySettings: {
        companyDisplayName: "Legacy Logo Print",
        invoiceLogoUrl: "data:image/png;base64,bm90LWEtcmVhbC1wbmc=",
      },
    } as any);

    expect(bytes.length).toBeGreaterThan(500);
    expect(extractDecodedPdfContent(bytes)).toContain("Legacy Logo Print");
  });

  test("payment instructions, footer, checks payable, and remittance fields render when present", async () => {
    const bytes = await generateInvoicePdfBytes({
      ...baseInvoiceParams,
      companySettings: {
        companyDisplayName: "Render Test Print",
        legalCompanyName: "Render Test Print LLC",
        physicalAddress: {
          line1: "1 Physical Way",
          city: "Dayton",
          state: "OH",
          postalCode: "45402",
          country: "United States",
        },
        remittanceAddress: {
          enabled: true,
          line1: "PO Box 777",
          city: "Dayton",
          state: "OH",
          postalCode: "45401",
          country: "United States",
        },
        invoicePaymentInstructions: "WIRE_TEST_123",
        invoiceFooterNote: "FOOTER_TEST_456",
        checksPayableTo: "PAY_TO_TEST_LLC",
      },
    } as any);

    const text = extractDecodedPdfContent(bytes);
    expect(text).toContain("Send payments to");
    expect(text).toContain("PO Box 777");
    expect(text).not.toContain("United States");
    expect(text).toContain("WIRE_TEST_123");
    expect(text).toContain("FOOTER_TEST_456");
    expect(text).toContain("PAY_TO_TEST_LLC");
  });
});
