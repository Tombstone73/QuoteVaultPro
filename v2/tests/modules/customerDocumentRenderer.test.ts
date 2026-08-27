import assert from "node:assert/strict";
import { customerDocumentFilename, renderCustomerSalesPdf } from "../../infrastructure/sales/customerDocumentRenderer.js";
import { salesConfigurationPresentation } from "../../src/modules/sales/configurationPresentation.js";

const document = {
  kind: "quote" as const, number: "QT-101", issuedAt: "2026-08-26", currency: "USD",
  organization: { name: "Tenant Print", address: "1 Main St", email: "sales@example.test" },
  customer: { displayName: "QA Customer", contactName: "QA Contact", email: "qa@example.test", purchaseOrderNumber: "PO-7" },
  lines: [{ description: "Coroplast sign", quantity: 2, configuration: "48 × 96 in · Sides: Double Sided", unitCents: 5504, totalCents: 11008 }],
  lineSubtotalCents: 11008, adjustmentCents: 0, chargeCents: 0, taxCents: 880, totalCents: 11888,
};

assert.equal(customerDocumentFilename(document), "Quote_QT-101.pdf");
assert.match(Buffer.from(await renderCustomerSalesPdf(document)).subarray(0, 8).toString("ascii"), /^%PDF-/);
await assert.rejects(() => renderCustomerSalesPdf({ ...document, lines: [{ ...document.lines[0], configuration: "productId 2b4e166c-2034-4c42-9b2f-24a21d6d33cd" }] }), /internal identifier/i);
assert.equal(salesConfigurationPresentation({ presentation: { dimensions: { width: "48", height: "96", unit: "in" }, selections: [{ label: "Sides", value: "Double Sided" }] } }), "48 × 96 in · Sides: Double Sided");
assert.match(salesConfigurationPresentation({ selections: { opt_sides: "double_sided", productId: "2b4e166c-2034-4c42-9b2f-24a21d6d33cd" } }), /Legacy options: Double Sided/);
console.log("Customer Sales document rendering tests passed.");
