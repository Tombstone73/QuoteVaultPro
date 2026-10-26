import { describe, expect, test } from "@jest/globals";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { generateOrderPdfBytes, getOrderPdfEligibility } from "../lib/orderPdf";

async function pdfText(bytes: Uint8Array) {
  const document = await getDocument({ data: bytes, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const content = await (await document.getPage(index)).getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
  }
  return { text: pages.join("\n"), pages, pageCount: document.numPages };
}

const validOrder = {
  id: "order_1",
  orderNumber: "ORD-10023",
  displayNumber: "ORD-10023",
  poNumber: "PO-77",
  shippingMethod: "pickup",
  subtotal: "25.00",
  taxAmount: "0.00",
  total: "25.00",
  lineItems: [
    {
      id: "line_1",
      productId: "product_1",
      product: { name: "Banner" },
      width: "24",
      height: "36",
      quantity: 1,
      totalPrice: "25.00",
      status: "new",
      selectedOptions: [{ optionName: "Grommets", value: "Corners", setupCost: 0, calculatedCost: 0 }],
      materialUsageJson: [{ materialName: "13oz Vinyl", quantityUsed: 6, unitOfMeasure: "sqft" }],
    },
  ],
};

describe("order PDF generation", () => {
  test("allows a saved order with valid saved line items", async () => {
    expect(getOrderPdfEligibility(validOrder).eligible).toBe(true);

    const bytes = await generateOrderPdfBytes({
      order: validOrder,
      organization: { name: "Titan Graphics", settings: { currency: "USD" } },
    });

    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("blocks unsaved and invalid orders", () => {
    expect(getOrderPdfEligibility({ ...validOrder, id: null }).eligible).toBe(false);
    expect(getOrderPdfEligibility({ ...validOrder, lineItems: [] }).eligible).toBe(false);
    expect(
      getOrderPdfEligibility({
        ...validOrder,
        lineItems: [{ ...validOrder.lineItems[0], status: "draft" }],
      }).eligible,
    ).toBe(false);
    expect(
      getOrderPdfEligibility({
        ...validOrder,
        lineItems: [{ ...validOrder.lineItems[0], id: null }],
      }).eligible,
    ).toBe(false);
  });

  test("excludes canceled line items from eligibility", () => {
    const eligibility = getOrderPdfEligibility({
      ...validOrder,
      lineItems: [
        { ...validOrder.lineItems[0], id: "canceled", status: "canceled" },
        { ...validOrder.lineItems[0], id: "active", status: "in_production" },
      ],
    });

    expect(eligibility.eligible).toBe(true);
    expect(eligibility.lineItems).toHaveLength(1);
    expect(eligibility.lineItems[0].id).toBe("active");
  });

  test("renders seven saved parent-child pairs as a paginated production ticket without changing totals", async () => {
    const parentPrices = [860, 480, 500, 500, 500, 500, 500];
    const childPrices = [2020, 1128, 1300, 1300, 1300, 1300, 1345];
    const lineItems = parentPrices.flatMap((price, index) => [
      { id: `parent-${index}`, productId: "vinyl", productName: `Vinyl ${index + 1}`, sortOrder: index * 2,
        description: `Three layer translucent printing with UV overlaminate mounted to .177 inch polycarbonate. ${"Carefully align the print layers and verify registration. ".repeat(index === 6 ? 50 : 2)}END-PARENT-${index}`,
        width: index === 0 ? 144 : 120, height: index === 0 ? 71.63 : 48, quantity: 2, totalPrice: String(price), status: "new",
        selectedOptions: [{ optionId: "lamination", optionName: "Lamination", value: "UV overlaminate" }], productionNotes: `Check orientation for set ${index + 1}.` },
      { id: `child-${index}`, parentLineItemId: `parent-${index}`, productId: "backer", productName: `Backer ${index + 1}`, sortOrder: index * 2 + 1,
        description: "Polycarbonate Backer", width: index === 0 ? 144 : 120, height: index === 0 ? 71.63 : 48, quantity: 2, totalPrice: String(childPrices[index]), status: "new" },
    ]);
    const order = { ...validOrder, label: "Polycarb Signs", subtotal: "13533.00", shippingCents: 104000, total: "14573.00", lineItems };
    const before = structuredClone(order);
    const bytes = await generateOrderPdfBytes({ order, artworkRefs: [{ orderLineItemId: "parent-0", filename: "front-artwork.pdf", role: "artwork" }] });
    const { text: content, pages, pageCount } = await pdfText(bytes);
    expect(pageCount).toBeGreaterThan(1);
    for (let index = 0; index < 7; index += 1) {
      expect(content.indexOf(`Vinyl ${index + 1}`)).toBeLessThan(content.indexOf(`Backer ${index + 1}`));
      expect(content).toContain(`END-PARENT-${index}`);
      expect(content).toContain(`$${childPrices[index].toLocaleString("en-US")}.00`);
      expect(pages.some((page) => page.includes(`Vinyl ${index + 1}`) && page.includes(`Backer ${index + 1}`))).toBe(true);
    }
    expect(content).toContain("Artwork: front-artwork.pdf");
    expect(content).toContain("Lamination: UV overlaminate");
    expect(content).toContain("$13,533.00");
    expect(content).toContain("$1,040.00");
    expect(content).toContain("$14,573.00");
    expect(order).toEqual(before);
  });
});
