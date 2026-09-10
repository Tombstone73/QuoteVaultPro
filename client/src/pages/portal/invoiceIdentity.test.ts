import React from "react";
import { TextDecoder, TextEncoder } from "node:util";

import type { PortalInvoiceDto } from "@/hooks/usePortal";

Object.assign(globalThis, { TextDecoder, TextEncoder });
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const { MemoryRouter } = require("react-router-dom") as typeof import("react-router-dom");
const {
  DEFAULT_PORTAL_INVOICE_COLUMNS,
  DEFAULT_PORTAL_INVOICE_SORT,
  PortalInvoiceDesktopTable,
  PortalInvoiceMobileCard,
  clearPortalInvoiceSortPreference,
  nextPortalInvoiceSort,
  persistPortalInvoiceSortPreference,
  portalInvoiceSortStorageKey,
  readPortalInvoiceSortPreference,
  sortPortalInvoices,
} = require("./invoices") as typeof import("./invoices");

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
      "PO #",
      "Job / Order",
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
      "w-[10%]",
      "w-[16%]",
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
    expect(cells[1]?.textContent).toBe("152235");
    expect(cells[2]?.textContent).toContain("Titan Revolution Marketing Signs");
    expect(cells[2]?.textContent).toContain("ORD-20047");
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

  test("makes all data headers except Actions keyboard-usable sort controls with direction state", () => {
    render(React.createElement(PortalInvoiceDesktopTable, {
      invoices: [invoice()],
      preference: { key: "po", direction: "asc" },
    }));

    expect(document.querySelectorAll("thead button")).toHaveLength(8);
    expect(document.querySelector('th[aria-sort="ascending"]')?.textContent).toContain("PO #");
    expect(document.querySelector('th[aria-sort="ascending"] .lucide-arrow-up')).not.toBeNull();
    expect([...document.querySelectorAll('th[aria-sort="none"]')]).toHaveLength(7);
    expect([...document.querySelectorAll("thead th")].at(-1)?.textContent).toBe("Actions");
    expect([...document.querySelectorAll("thead th")].at(-1)?.querySelector("button")).toBeNull();
  });

  test("reorders only informational columns while Invoice and Actions remain anchored", () => {
    const reversed = [...DEFAULT_PORTAL_INVOICE_COLUMNS].reverse().map((column, order) => ({ ...column, order }));
    render(React.createElement(PortalInvoiceDesktopTable, { invoices: [invoice()], columns: reversed }));
    const labels = [...document.querySelectorAll("thead th")].map((header) => header.textContent);
    expect(labels[0]).toBe("Invoice");
    expect(labels.slice(1, -1)).toEqual(["Status", "Total", "Amount Due", "Due", "Issued", "Job / Order", "PO #"]);
    expect(labels.at(-1)).toBe("Actions");
  });
});

describe("V1 Portal invoice sorting and preferences", () => {
  beforeEach(() => localStorage.clear());

  test("defaults to Issued descending and toggles each header asc/desc", () => {
    expect(DEFAULT_PORTAL_INVOICE_SORT).toEqual({ key: "issued", direction: "desc" });
    expect(nextPortalInvoiceSort(DEFAULT_PORTAL_INVOICE_SORT, "issued")).toEqual({ key: "issued", direction: "asc" });
    expect(nextPortalInvoiceSort({ key: "po", direction: "asc" }, "po")).toEqual({ key: "po", direction: "desc" });
    expect(nextPortalInvoiceSort({ key: "po", direction: "desc" }, "total")).toEqual({ key: "total", direction: "asc" });
  });

  test("sorts every supported field with natural, numeric, timestamp, and canonical semantics", () => {
    const rows = [
      invoice({ id: "z", displayNumber: "INV-10", numberCore: 10, customerPoNumber: "PO 10", jobLabel: "Sign 10", issueDate: "2026-02-10T00:00:00Z", dueDate: "2026-03-10T00:00:00Z", amountDue: 10, total: 100, status: "sent", paymentStatusLabel: "Unpaid" }),
      invoice({ id: "a", displayNumber: "INV-2", numberCore: 2, customerPoNumber: "po 2", jobLabel: "sign 2", issueDate: "2026-02-02T00:00:00Z", dueDate: "2026-03-02T00:00:00Z", amountDue: 2, total: 20, status: "paid", paymentStatusLabel: "Paid" }),
      invoice({ id: "m", displayNumber: "A-3", numberCore: 3, customerPoNumber: " PO-3 ", jobLabel: "Banner 3", issueDate: "2026-02-03T00:00:00Z", dueDate: "2026-03-03T00:00:00Z", amountDue: 3, total: 30, status: "overdue", paymentStatusLabel: "Overdue" }),
    ];
    expect(sortPortalInvoices(rows, { key: "invoice", direction: "asc" }).map((row) => row.id)).toEqual(["a", "m", "z"]);
    expect(sortPortalInvoices(rows, { key: "po", direction: "asc" }).map((row) => row.id)).toEqual(["a", "z", "m"]);
    expect(sortPortalInvoices(rows, { key: "job", direction: "asc" }).map((row) => row.id)).toEqual(["m", "a", "z"]);
    for (const key of ["issued", "due", "amountDue", "total"] as const) {
      expect(sortPortalInvoices(rows, { key, direction: "asc" }).map((row) => row.id)).toEqual(["a", "m", "z"]);
    }
    expect(sortPortalInvoices(rows, { key: "status", direction: "asc" }).map((row) => row.id)).toEqual(["m", "a", "z"]);
  });

  test("keeps missing values last in both directions and preserves server order for ties", () => {
    const rows = [invoice({ id: "first", customerPoNumber: "PO 2" }), invoice({ id: "missing", customerPoNumber: null }), invoice({ id: "tied", customerPoNumber: "po 2" })];
    expect(sortPortalInvoices(rows, { key: "po", direction: "asc" }).map((row) => row.id)).toEqual(["first", "tied", "missing"]);
    expect(sortPortalInvoices(rows, { key: "po", direction: "desc" }).map((row) => row.id)).toEqual(["first", "tied", "missing"]);
  });

  test("persists per portal user/customer, survives remount reads, and resets safely", () => {
    persistPortalInvoiceSortPreference("user-1", "customer-1", { key: "total", direction: "asc" });
    expect(readPortalInvoiceSortPreference("user-1", "customer-1")).toEqual({ key: "total", direction: "asc" });
    expect(readPortalInvoiceSortPreference("user-1", "customer-2")).toEqual(DEFAULT_PORTAL_INVOICE_SORT);
    expect(portalInvoiceSortStorageKey("user-1", "customer-1")).toContain("portalInvoiceSort:user_user-1:customer_customer-1");
    clearPortalInvoiceSortPreference("user-1", "customer-1");
    expect(readPortalInvoiceSortPreference("user-1", "customer-1")).toEqual(DEFAULT_PORTAL_INVOICE_SORT);
    localStorage.setItem(portalInvoiceSortStorageKey("user-1", "customer-1"), "{malformed");
    expect(readPortalInvoiceSortPreference("user-1", "customer-1")).toEqual(DEFAULT_PORTAL_INVOICE_SORT);
  });
});
