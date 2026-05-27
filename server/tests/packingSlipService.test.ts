import { describe, expect, test } from "@jest/globals";

import { buildPackingSlipHtml } from "../services/packingSlipService";

describe("packing slip generation", () => {
  test("renders order, customer, contact, PO, ship-to, quantities, size, and material without pricing", () => {
    const html = buildPackingSlipHtml({
      orderNumber: "ORD-1001",
      customerName: "Titan Graphics",
      contactName: "Avery Print",
      contactEmail: "avery@example.com",
      poNumber: "PO-77",
      shipToLines: ["Titan Graphics", "123 Main St", "Brooklyn, NY 11201"],
      lineItems: [
        {
          description: "Reflective sign",
          quantity: 2,
          size: "24&quot; &times; 36&quot;",
          material: "Reflective Vinyl",
        },
      ],
    });

    expect(html).toContain("Packing Slip");
    expect(html).toContain("ORD-1001");
    expect(html).toContain("Titan Graphics");
    expect(html).toContain("Avery Print");
    expect(html).toContain("PO-77");
    expect(html).toContain("Reflective sign");
    expect(html).toContain("Reflective Vinyl");
    expect(html).toContain("@page { size: 80mm auto; margin: 0; }");
    expect(html).toContain("thermal-feed-spacer");
    expect(html).toContain("--thermal-feed-spacer: 1.5in");
    expect(html).not.toMatch(/price|subtotal|total|invoice amount/i);
  });

  test("escapes unsafe optional data and renders missing values safely", () => {
    const html = buildPackingSlipHtml({
      orderNumber: "ORD-1002",
      customerName: "<script>alert(1)</script>",
      lineItems: [{ description: "Banner", quantity: 1 }],
    });

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&mdash;");
  });
});
