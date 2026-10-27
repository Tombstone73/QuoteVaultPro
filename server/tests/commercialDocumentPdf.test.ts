import { describe, expect, test } from "@jest/globals";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { generateQuotePdfBytes } from "../lib/quotePdf";
import { generateInvoicePdfBytes } from "../lib/invoicePdf";
import { readFileSync } from "node:fs";
import { renderQuoteEmailLineItems } from "../lib/quoteEmailLineItems";
import { sendQuoteEmailWithRecipientFallback, type QuoteEmailRecipientDeps } from "../lib/quoteEmailRecipientFallback";

function text(bytes: Uint8Array) {
  return [...Buffer.from(bytes).toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => {
    try { return inflateSync(Buffer.from(match[1], "latin1")).toString("latin1").replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_, hex) => Buffer.from(hex, "hex").toString("latin1")); }
    catch { return ""; }
  }).join("\n");
}
const lines = [
  { id: "a", productName: "Parent ACM", linePrice: "220.44", width: 54.21, height: 47.5 },
  { id: "a1", parentLineItemId: "a", productName: "Hidden child vinyl", linePrice: "108.00", width: 1, height: 1 },
  { id: "b", productName: "Parent Vinyl", linePrice: "30.00", width: 27.8, height: 24 },
  { id: "b1", parentLineItemId: "b", productName: "Hidden child ACM", linePrice: "66.13", width: 1, height: 1 },
].map((line, displayOrder) => ({ ...line, displayOrder, quantity: 2, productId: "product", status: "active" }));

describe("shared customer document rendering", () => {
  test("Quote email HTML and its actual generated PDF attachment both collapse commercial groups", async () => {
    const html = renderQuoteEmailLineItems(lines);
    expect(html.match(/<tr>/g)).toHaveLength(2);
    expect(html).toContain("$328.44"); expect(html).toContain("$96.13");
    expect(html).toContain("$164.22"); expect(html).toContain("$48.07");
    expect(html).not.toContain("Hidden child");
    let attachmentText = "";
    const deps: QuoteEmailRecipientDeps = {
      getQuoteById: async () => ({ id: "q", customerId: "customer", lineItems: lines }),
      getOrganizationById: async () => ({ id: "org", name: "Printer" }),
      getCustomerContacts: async () => [], updateCustomerContactForOrganization: async () => { throw new Error("not used"); },
      createCustomerContactForOrganization: async () => { throw new Error("not used"); }, createAuditLog: async () => undefined,
      sendQuoteEmail: async (_org, _id, _to, _user, options) => { attachmentText = text(options!.attachments![0].content); },
    };
    await sendQuoteEmailWithRecipientFallback(deps, { organizationId: "org", quoteId: "q", isInternalUser: true,
      payload: { recipientEmail: "buyer@example.test", attachPdf: true } });
    expect(attachmentText).toContain("$328.44");
    expect(attachmentText).not.toContain("Hidden child");
  });
  test("Quote PDF collapses rows in persisted order without changing stored subtotal or lines", async () => {
    const quote = { id: "quote", subtotal: "424.57", taxAmount: "10.00", totalPrice: "434.57", lineItems: lines };
    const before = structuredClone(quote);
    const content = text(await generateQuotePdfBytes({ quote }));
    expect(content).toContain("$328.44"); expect(content).toContain("$96.13");
    expect(content).toContain("$164.22"); expect(content).toContain("$48.07");
    expect(content).toContain("$424.57"); expect(content).toContain("$434.57");
    expect(content).toContain("54.21 x 47.5");
    expect(content).not.toContain("Hidden child");
    expect(quote).toEqual(before);
    const reordered = lines.map((line) => ({ ...line, displayOrder: line.id.startsWith("b") ? line.displayOrder - 2 : line.displayOrder + 2 }));
    const moved = text(await generateQuotePdfBytes({ quote: { ...quote, lineItems: reordered } }));
    expect(moved.indexOf("Parent Vinyl")).toBeLessThan(moved.indexOf("Parent ACM"));
  });
  test("issued Invoice PDF uses immutable Order linkage and preserves subtotal/tax/balance", async () => {
    const params = {
      invoice: { invoiceNumber: 101, status: "partial", subtotalCents: 42457, taxCents: 1000, totalCents: 43457 },
      customer: { companyName: "Customer" }, companySettings: { companyName: "Printer" },
      paymentSummary: { totalCents: 43457, amountPaidCents: 10000, amountDueCents: 33457 },
      lineItems: lines.map((line) => ({ ...line, id: `invoice-${line.id}`, orderLineItemId: line.id, sortOrder: line.displayOrder, lineTotalCents: Math.round(Number(line.linePrice) * 100) })),
    };
    const before = structuredClone(params);
    const content = text(await generateInvoicePdfBytes(params));
    for (const amount of ["$220.44", "$108.00", "$30.00", "$66.13", "$424.57", "$10.00", "$334.57"]) expect(content).toContain(amount);
    expect(content).toContain("Hidden child");
    expect(params).toEqual(before);
  });
  test("historical Invoice rows without trustworthy lineage remain visible", async () => {
    const content = text(await generateInvoicePdfBytes({ invoice: { subtotalCents: 42457, totalCents: 42457 }, customer: null, companySettings: null,
      paymentSummary: { totalCents: 42457, amountPaidCents: 0, amountDueCents: 42457 },
      lineItems: lines.map((line) => ({ ...line, id: `invoice-${line.id}`, lineTotalCents: Math.round(Number(line.linePrice) * 100) })),
    }));
    expect(content).toContain("Hidden child");
    expect(content).toContain("$108.00");
  });
  test("Invoice PDF renders each saved billable child with dimensions, options, and its own price across pages", async () => {
    const parentPrices = [860, 480, 500, 500, 500, 500, 500];
    const childPrices = [2020, 1128, 1300, 1300, 1300, 1300, 1345];
    const invoiceLines = Array.from({ length: 7 }, (_, index) => [
      { id: `invoice-parent-${index}`, orderLineItemId: `order-parent-${index}`, sortOrder: index * 2,
        productName: "Translucent vinyl - Avery 2050", description: `Three-layer translucent print with UV overlaminate mounted to polycarbonate. ${"Keep color consistent across every print panel. ".repeat(index === 6 ? 35 : 1)}END-INVOICE-${index}`,
        width: index === 0 ? 144 : 120, height: index === 0 ? 71.63 : 48, quantity: 2, lineTotalCents: parentPrices[index] * 100,
        unitPriceCents: parentPrices[index] * 50,
        selectedOptions: [{ optionId: "lamination", optionName: "Lamination", value: "UV overlaminate" }, { optionId: "machine", optionName: "Machine Routing", value: "Flatbed 2" }] },
      { id: `invoice-child-${index}`, orderLineItemId: `order-child-${index}`, parentLineItemId: `order-parent-${index}`, sortOrder: index * 2 + 1,
        productName: "Polycarbonate Backer", description: "Clear .177 inch backer", width: index === 0 ? 144 : 120, height: index === 0 ? 71.63 : 48,
        quantity: 2, lineTotalCents: childPrices[index] * 100, unitPriceCents: childPrices[index] * 50 },
    ]).flat();
    const params = { invoice: { invoiceNumber: 20727, subtotalCents: 1353300, shippingCents: 104000, taxCents: 0, totalCents: 1457300 },
      customer: { companyName: "Lloyd Waters" }, companySettings: { companyName: "Printer" },
      paymentSummary: { totalCents: 1457300, amountPaidCents: 0, amountDueCents: 1457300 }, lineItems: invoiceLines };
    const before = structuredClone(params);
    const bytes = await generateInvoicePdfBytes(params);
    const content = text(bytes);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
    expect(content.indexOf("Translucent vinyl - Avery 2050")).toBeLessThan(content.indexOf("Polycarbonate Backer"));
    for (let index = 0; index < 7; index += 1) expect(content).toContain(`END-INVOICE-${index}`);
    expect(content).toContain("144 x 71.63 in");
    expect(content).toContain("120 x 48 in");
    expect(content).toContain("Lamination: UV overlaminate");
    expect(content).not.toContain("Machine Routing: Flatbed 2");
    for (const amount of ["$860.00", "$2,020.00", "$480.00", "$1,128.00", "$13,533.00", "$1,040.00", "$14,573.00"]) expect(content).toContain(amount);
    expect(params).toEqual(before);
  });
  test("seven concise Invoice pairs keep prices and payment on two legible pages", async () => {
    const amounts = [860, 2020, 480, 1128, 500, 1300, 500, 1300, 500, 1300, 500, 1300, 500, 1345];
    const lineItems = amounts.map((amount, index) => ({
      id: `invoice-${index}`, orderLineItemId: `order-${index}`,
      parentLineItemId: index % 2 ? `order-${index - 1}` : null,
      sortOrder: index, productName: index % 2 ? "Polycarbonate Backer" : "Translucent vinyl - Avery 2050",
      description: `${index % 2 ? "CHILD" : "PARENT"}-${Math.floor(index / 2)}`,
      width: 144, height: 71.63, quantity: 2,
      lineTotalCents: amount * 100, unitPriceCents: amount * 50,
      optionSelectionsJson: index % 2 ? null : { selected: { lamination: { value: "UV overlaminate", label: "UV overlaminate" } } },
    }));
    const bytes = await generateInvoicePdfBytes({
      invoice: { invoiceNumber: 20727, subtotalCents: 1353300, shippingCents: 104000, taxCents: 0, totalCents: 1457300 },
      customer: { companyName: "Disposable QA Customer" },
      companySettings: { companyName: "Disposable QA Printer", invoicePaymentInstructions: "Include the invoice number with payment." },
      paymentSummary: { totalCents: 1457300, amountPaidCents: 0, amountDueCents: 1457300 },
      lineItems,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    const content = text(bytes);
    for (let index = 0; index < 7; index += 1) {
      expect(content.indexOf(`PARENT-${index}`)).toBeLessThan(content.indexOf(`CHILD-${index}`));
      if (index < 6) expect(content.indexOf(`CHILD-${index}`)).toBeLessThan(content.indexOf(`PARENT-${index + 1}`));
    }
    for (const amount of ["$860.00", "$2,020.00", "$13,533.00", "$1,040.00", "$14,573.00"])
      expect(content).toContain(amount);
    expect(content).toContain("Include the invoice number with payment.");
  });
  test("preview/download, emailed attachments/reminders and portal Invoice all delegate to the same renderer", () => {
    for (const file of ["server/routes/mvpInvoicing.routes.ts", "server/invoiceReminderJob.ts", "server/services/portal.service.ts"]) {
      expect(readFileSync(file, "utf8")).toContain("generateInvoicePdfBytes");
    }
    for (const file of ["server/routes/quotes.routes.ts", "server/lib/quoteEmailRecipientFallback.ts"]) {
      expect(readFileSync(file, "utf8")).toContain("generateQuotePdfBytes");
    }
    const portal = readFileSync("server/services/portal.service.ts", "utf8");
    expect(portal.slice(portal.indexOf("function mapQuoteDetail"), portal.indexOf("function mapQuoteList"))).toContain("projectCommercialDocumentLines");
  });
});
