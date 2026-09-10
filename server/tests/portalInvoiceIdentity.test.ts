import { readFileSync } from "node:fs";
import path from "node:path";

import { resolvePortalInvoiceIdentity } from "../lib/portalInvoiceIdentity";

describe("portal invoice identity", () => {
  test("uses the invoice PO snapshot ahead of the mutable linked Order PO", () => {
    expect(resolvePortalInvoiceIdentity({
      invoiceCustomerPoNumber: "PO-SNAPSHOT-101",
      linkedOrderPoNumber: "PO-CURRENT-999",
      linkedOrderLabel: "Titan Revolution Marketing Signs",
      linkedOrderNumber: "ORD-20047",
    })).toEqual({
      customerPoNumber: "PO-SNAPSHOT-101",
      jobLabel: "Titan Revolution Marketing Signs",
      orderNumber: "ORD-20047",
    });
  });

  test("falls back to the scoped Order PO when no invoice snapshot exists", () => {
    expect(resolvePortalInvoiceIdentity({
      invoiceCustomerPoNumber: "  ",
      linkedOrderPoNumber: "PO-ORDER-202",
      linkedOrderLabel: "Window Graphics",
      linkedOrderNumber: "ORD-202",
    }).customerPoNumber).toBe("PO-ORDER-202");
  });

  test("preserves useful Order context when the Job Label is unavailable", () => {
    expect(resolvePortalInvoiceIdentity({
      linkedOrderNumber: "ORD-303",
    })).toEqual({
      customerPoNumber: null,
      jobLabel: null,
      orderNumber: "ORD-303",
    });
  });

  test("handles legacy invoices with no Order or PO safely", () => {
    expect(resolvePortalInvoiceIdentity({})).toEqual({
      customerPoNumber: null,
      jobLabel: null,
      orderNumber: null,
    });
  });

  test("keeps the query scoped to the invoice customer when joining Order facts", () => {
    const source = readFileSync(path.join(process.cwd(), "server/services/portal.service.ts"), "utf8");

    expect(source).toContain(".leftJoin(orders, and(");
    expect(source).toContain("eq(orders.organizationId, scope.organizationId)");
    expect(source).toContain("eq(orders.customerId, scope.customerId)");
    expect(source).toContain("customerPoNumber: invoices.customerPoNumber");
  });
});
