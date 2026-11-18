import { expect, test } from "@jest/globals";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PurchaseOrderSnapshot } from "@shared/schema";
import { generatePurchaseOrderPdf } from "../lib/purchaseOrderPdf";

test("prints each frozen acquisition charge once alongside freight, tax, and the agreed total", async () => {
  const snapshot: PurchaseOrderSnapshot = {
    poNumber: "PO-1", issueDate: "2026-11-18", expectedDate: null, vendor: null,
    orderNumber: null, shipTo: null, notes: null, paymentTerms: null, paymentMethod: null, paymentInstructions: null,
    subtotal: "100.00", shippingTotal: "12.00", taxTotal: "6.00", grandTotal: "121.00",
    otherCharges: [{ id: "handling", description: "Vendor handling", amount: "3.00", allocatable: true }],
    lines: [{ id: "sheet", description: "Sheet stock", vendorSku: null, quantityOrdered: "5", unitCost: "20.0000", lineTotal: "100.0000" }],
  };
  const document = await getDocument({
    data: new Uint8Array(await generatePurchaseOrderPdf(snapshot, 0, new Date("2026-11-18T12:00:00Z"))),
    useSystemFonts: true,
  }).promise;
  try {
    const { items } = await (await document.getPage(1)).getTextContent();
    const text = items.map(item => "str" in item ? item.str : "").join(" ");
    expect(text).toContain("Shipping $12.00");
    expect(text).toContain("Tax $6.00");
    expect(text).toMatch(/Vendor handling\s+\|\s+\$3\.00/);
    expect(text.match(/Vendor handling/g)).toHaveLength(1);
    expect(text).toContain("Purchase order total $121.00");
  } finally {
    await document.destroy();
  }
});
