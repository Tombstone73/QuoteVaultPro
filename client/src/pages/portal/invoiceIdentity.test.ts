import React from "react";
import { TextDecoder, TextEncoder } from "node:util";

import type { PortalInvoiceDto } from "@/hooks/usePortal";

Object.assign(globalThis, { TextDecoder, TextEncoder });
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const { MemoryRouter } = require("react-router-dom") as typeof import("react-router-dom");
const { PortalInvoiceDesktopTable, PortalInvoiceMobileCard } = require("./invoices") as typeof import("./invoices");

const invoice = (overrides: Partial<PortalInvoiceDto> = {}): PortalInvoiceDto => ({
  id: "invoice-1",
  invoiceNumber: 20155,
  displayNumber: "INV-20155",
  numberCore: 20155,
  status: "sent",
  issueDate: "2026-09-07T12:00:00.000Z",
  dueDate: "2026-09-22T12:00:00.000Z",
  subtotal: 69,
  tax: 0,
  total: 69,
  amountPaid: 0,
  amountDue: 69,
  currency: "USD",
  customerPoNumber: "152235",
  jobLabel: "Titan Revolution Marketing Signs",
  orderNumber: "ORD-20047",
  pdfAvailable: true,
  paymentStatusLabel: "Unpaid",
  ...overrides,
});

function render(component: React.ReactElement) {
  document.body.innerHTML = renderToStaticMarkup(
    React.createElement(MemoryRouter, null, component),
  );
}

describe("V1 Portal invoice list presentation", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("renders a subtle aligned desktop header in the requested scan order", () => {
    render(React.createElement(PortalInvoiceDesktopTable, { invoices: [invoice()] }));

    expect([...document.querySelectorAll("thead th")].map((header) => header.textContent)).toEqual([
      "Invoice",
      "Job / Order",
      "PO #",
      "Issued",
      "Due",
      "Amount Due",
      "Total",
      "Status",
      "Actions",
    ]);
    const desktopRegion = document.querySelector("table")?.parentElement;
    expect(desktopRegion?.className).toContain("2xl:block");
    expect(document.querySelector("table")?.className).toContain("table-fixed");
    expect(document.querySelector("table")?.className).toContain("min-w-[72rem]");
    expect([...document.querySelectorAll("col")].map((column) => column.className)).toEqual([
      "w-[10%]",
      "w-[16%]",
      "w-[10%]",
      "w-[10%]",
      "w-[10%]",
      "w-[11%]",
      "w-[10%]",
      "w-[10%]",
      "w-[13%]",
    ]);
  });

  test("keeps invoice identity, context, dates, money, status, and actions in stable columns", () => {
    render(React.createElement(PortalInvoiceDesktopTable, { invoices: [invoice()] }));

    const cells = [...document.querySelectorAll("tbody td")];
    expect(cells).toHaveLength(9);
    expect(cells[0]?.textContent).toBe("INV-20155");
    expect(cells[1]?.textContent).toContain("Titan Revolution Marketing Signs");
    expect(cells[1]?.textContent).toContain("ORD-20047");
    expect(cells[2]?.textContent).toBe("152235");
    expect(cells[3]?.textContent).toContain("Sep 7, 2026");
    expect(cells[4]?.textContent).toContain("Sep 22, 2026");
    expect(cells[5]?.textContent).toBe("$69.00");
    expect(cells[6]?.textContent).toBe("$69.00");
    expect(cells[7]?.textContent).toBe("Unpaid");
    expect(cells[5]?.className).toContain("text-right");
    expect(cells[6]?.className).toContain("text-right");
    expect(cells[8]?.querySelector('a[href="/portal/invoices/invoice-1"]')?.textContent).toContain("View invoice");
    expect(cells[8]?.querySelector('a[href="/api/portal/invoices/invoice-1/pdf?download=1"]')).not.toBeNull();
  });

  test("truncates long desktop Job and PO values without dropping their full titles", () => {
    const longJob = "A very long customer-facing campaign name for signs across every regional location";
    const longPo = "152227 Titan MCAI Yard Sign Replacement Program Phase Two";
    render(React.createElement(PortalInvoiceDesktopTable, { invoices: [invoice({ jobLabel: longJob, customerPoNumber: longPo })] }));

    expect(document.querySelector(`p[title="${longJob}"]`)?.className).toContain("truncate");
    expect(document.querySelector(`p[title="${longPo}"]`)?.className).toContain("truncate");
  });

  test("falls back safely for missing Job and PO and preserves numeric-only display numbers", () => {
    render(React.createElement(PortalInvoiceDesktopTable, {
      invoices: [invoice({ displayNumber: "20352", invoiceNumber: 99999, jobLabel: null, orderNumber: null, customerPoNumber: null, status: "paid", paymentStatusLabel: "Paid", amountDue: 0 })],
    }));

    const cells = [...document.querySelectorAll("tbody td")];
    expect(cells[0]?.textContent).toBe("20352");
    expect(cells[1]?.textContent).toBe("—");
    expect(cells[2]?.textContent).toBe("—");
    expect(cells[5]?.textContent).toBe("$0.00");
    expect(cells[7]?.textContent).toBe("Paid");
  });

  test("uses a stacked, wrapping mobile card with separate dates and tap-friendly actions", () => {
    render(React.createElement(PortalInvoiceMobileCard, { invoice: invoice() }));

    const card = document.querySelector("article");
    expect(card?.className).toContain("2xl:hidden");
    expect(card?.textContent).toContain("Invoice INV-20155");
    expect(card?.textContent).toContain("Titan Revolution Marketing Signs");
    expect(card?.textContent).toContain("PO # 152235");
    expect(card?.textContent).toContain("Order ORD-20047");
    expect(card?.querySelectorAll("dl > div")).toHaveLength(4);
    const invoiceLinks = [...(card?.querySelectorAll('a[href="/portal/invoices/invoice-1"]') ?? [])];
    expect(invoiceLinks.some((link) => link.textContent?.includes("View invoice"))).toBe(true);
    expect(card?.querySelector('a[href="/api/portal/invoices/invoice-1/pdf?download=1"]')?.textContent).toContain("Download");
    const actionLinks = [...(card?.querySelectorAll("a.min-h-11") ?? [])];
    expect(actionLinks).toHaveLength(2);
    expect(actionLinks.every((link) => link.className.includes("flex-1"))).toBe(true);
    expect(card?.querySelector(".break-words")).not.toBeNull();
    expect(card?.querySelector("table")).toBeNull();
  });
});
