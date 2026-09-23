import { describe, expect, test } from "@jest/globals";
import { inflateSync } from "node:zlib";
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
    for (const amount of ["$328.44", "$96.13", "$424.57", "$10.00", "$334.57"]) expect(content).toContain(amount);
    expect(content).not.toContain("Hidden child");
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
