import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolveInvoiceDetailJobContext } from "@/lib/invoiceDetailJobContext";

const invoiceDetailSource = readFileSync("client/src/pages/invoice-detail.tsx", "utf8");

describe("Invoice Detail job context", () => {
  test("uses the invoice PO snapshot while exposing the linked Order job context", () => {
    expect(resolveInvoiceDetailJobContext(
      { customerPoNumber: "PO-SNAPSHOT-101", sourceOrderNumber: 20197 },
      { displayNumber: "ORD-20197", poNumber: "PO-CHANGED-LATER", label: "Brainstorm Print launch" },
    )).toEqual({
      orderNumber: "20197",
      purchaseOrderNumber: "PO-SNAPSHOT-101",
      jobLabel: "Brainstorm Print launch",
    });
  });

  test("falls back to canonical linked Order values when an invoice has no historical PO snapshot", () => {
    expect(resolveInvoiceDetailJobContext(
      { customerPoNumber: null, sourceOrderNumber: null },
      { displayNumber: "ORD-20201", poNumber: "PO-20201", label: "Storefront graphics" },
    )).toEqual({
      orderNumber: "ORD-20201",
      purchaseOrderNumber: "PO-20201",
      jobLabel: "Storefront graphics",
    });
  });

  test("renders a safe empty context when linked Order data or a PO is unavailable", () => {
    expect(resolveInvoiceDetailJobContext(
      { customerPoNumber: " ", sourceOrderNumber: null },
      { orderNumber: "", poNumber: null, label: "  " },
    )).toEqual({
      orderNumber: null,
      purchaseOrderNumber: null,
      jobLabel: null,
    });
    expect(resolveInvoiceDetailJobContext({ customerPoNumber: null, sourceOrderNumber: 42 }, undefined)).toEqual({
      orderNumber: "42",
      purchaseOrderNumber: null,
      jobLabel: null,
    });
  });

  test("mounts read-only PO and job fields in Invoice Details while retaining View Order", () => {
    expect(invoiceDetailSource).toContain("resolveInvoiceDetailJobContext");
    expect(invoiceDetailSource).toContain('>PO #</span>');
    expect(invoiceDetailSource).toContain('>Job</span>');
    expect(invoiceDetailSource).toContain('>Order #</span>');
    expect(invoiceDetailSource).toContain("View Order");
  });
});
