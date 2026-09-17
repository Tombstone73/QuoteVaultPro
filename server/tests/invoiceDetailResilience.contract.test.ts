import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("invoice detail product enrichment does not depend on the nonexistent order-line name column", () => {
  const presentation = read("server/services/invoiceLinePresentation.service.ts");
  expect(presentation).toContain("id: orderLineItems.id, productId: orderLineItems.productId");
  expect(presentation).not.toContain("orderLineItems.name");
  expect(presentation).toContain("eq(orders.organizationId, input.organizationId)");
  expect(presentation).toContain("eq(products.organizationId, input.organizationId)");
});

test("invoice detail treats enrichment as optional and preserves stored snapshots", () => {
  const service = read("server/invoicesService.ts");
  expect(service).toContain("let lineItems: any[] = storedLineItems as any[]");
  expect(service).toContain("[InvoiceLinePresentation] enrichment failed; using invoice snapshots");
  expect(service).toContain("lineItems = await hydrateInvoiceLineItemsWithProductIdentity");
});

test("invoice detail still uses 404 only for a missing or cross-tenant invoice", () => {
  const route = read("server/routes/mvpInvoicing.routes.ts");
  const detailRoute = route.slice(route.indexOf('app.get("/api/invoices/:id"'), route.indexOf('// ------------------------------------------------------------', route.indexOf('app.get("/api/invoices/:id"')));
  expect(detailRoute).toContain('if (!rel) return res.status(404).json({ error: "Invoice not found" })');
  expect(detailRoute).toContain('if ((rel.invoice as any).organizationId !== organizationId) return res.status(404).json({ error: "Invoice not found" })');
  expect(detailRoute).toContain('res.status(500).json({ error: error.message || "Failed to fetch invoice" })');
});
