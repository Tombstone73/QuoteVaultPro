import React from "react";
import { TextDecoder, TextEncoder } from "node:util";

import type { PortalInvoiceDto } from "@/hooks/usePortal";
import { mergeTableColumnConfig } from "@/hooks/useTableColumnConfig";

Object.assign(globalThis, { TextDecoder, TextEncoder, IS_REACT_ACT_ENVIRONMENT: true });
jest.mock("@/components/payments/StripePayDialog", () => () => null);
jest.mock("@/hooks/usePortalDownload", () => ({
  usePortalDownload: () => ({ download: jest.fn(), downloading: false }),
}));
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const { createRoot } = require("react-dom/client") as typeof import("react-dom/client");
const { MemoryRouter } = require("react-router-dom") as typeof import("react-router-dom");
const {
  DEFAULT_PORTAL_INVOICE_COLUMNS,
  DEFAULT_PORTAL_INVOICE_SORT,
  PortalInvoiceDesktopTable,
  PortalInvoiceMobileCard,
  PortalInvoicePaymentActionTray,
  clearPortalInvoiceSortPreference,
  nextPortalInvoiceSort,
  persistPortalInvoiceSortPreference,
  portalInvoiceSortStorageKey,
  portalInvoiceSelectionTotal,
  readPortalInvoiceSortPreference,
  sanitizePortalInvoiceSelection,
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
  paymentEligibility: { payable: (overrides.amountDue ?? 69) > 0 && overrides.status !== "void", blockedReason: null },
  ...overrides,
});

function render(component: React.ReactElement) {
  document.body.innerHTML = renderToStaticMarkup(
    React.createElement(MemoryRouter, null, component),
  );
}

function clickActionTrayButton(label: string, props: React.ComponentProps<typeof PortalInvoicePaymentActionTray>) {
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  const root = createRoot(container);
  React.act(() => root.render(React.createElement(PortalInvoicePaymentActionTray, props)));
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  React.act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  React.act(() => root.unmount());
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
      "",
      "Invoice",
      "PO #",
      "Job Info",
      "Order #",
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
      "w-[4%]",
      "w-[8%]",
      "w-[9%]",
      "w-[15%]",
      "w-[9%]",
      "w-[9%]",
      "w-[9%]",
      "w-[10%]",
      "w-[9%]",
      "w-[8%]",
      "w-[10%]",
    ]);
  });

  test("keeps invoice identity, context, dates, money, status, and actions in stable columns", () => {
    render(React.createElement(PortalInvoiceDesktopTable, { invoices: [invoice()] }));

    const cells = [...document.querySelectorAll("tbody td")];
    expect(cells).toHaveLength(11);
    expect(cells[0]?.querySelector('input[aria-label="Select invoice INV-20155"]')).not.toBeNull();
    expect(cells[1]?.textContent).toBe("INV-20155");
    expect(cells[2]?.textContent).toBe("152235");
    expect(cells[3]?.textContent).toContain("Titan Revolution Marketing Signs");
    expect(cells[4]?.textContent).toBe("ORD-20047");
    expect(cells[5]?.textContent).toContain("Sep 7, 2026");
    expect(cells[6]?.textContent).toContain("Sep 22, 2026");
    expect(cells[7]?.textContent).toBe("$69.00");
    expect(cells[8]?.textContent).toBe("$69.00");
    expect(cells[9]?.textContent).toBe("Unpaid");
    expect(cells[7]?.className).toContain("text-right");
    expect(cells[8]?.className).toContain("text-right");
    expect(cells[10]?.querySelector('a[href="/portal/invoices/invoice-1"]')?.textContent).toContain("View invoice");
    expect(cells[10]?.querySelector('button[aria-label="Download PDF for invoice INV-20155"]')).not.toBeNull();
    expect(cells[10]?.querySelector('a[href="/api/portal/invoices/invoice-1/pdf?download=1"]')).toBeNull();
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
    expect(cells[1]?.textContent).toBe("20352");
    expect(cells[2]?.textContent).toBe("—");
    expect(cells[3]?.textContent).toBe("—");
    expect(cells[4]?.textContent).toBe("—");
    expect(cells[7]?.textContent).toBe("$0.00");
    expect(cells[9]?.textContent).toBe("Paid");
    expect(cells[0]?.querySelector("input")?.disabled).toBe(true);
  });

  test("uses a stacked, wrapping mobile card with separate dates and tap-friendly actions", () => {
    render(React.createElement(PortalInvoiceMobileCard, { invoice: invoice() }));

    const card = document.querySelector("article");
    expect(card?.className).toContain("2xl:hidden");
    expect(card?.textContent).toContain("Invoice INV-20155");
    expect(card?.textContent).toContain("Titan Revolution Marketing Signs");
    expect(card?.textContent).toContain("PO # 152235");
    expect(card?.textContent).toContain("Order # ORD-20047");
    expect(card?.querySelectorAll("dl > div")).toHaveLength(4);
    const invoiceLinks = [...(card?.querySelectorAll('a[href="/portal/invoices/invoice-1"]') ?? [])];
    expect(invoiceLinks.some((link) => link.textContent?.includes("View invoice"))).toBe(true);
    expect(card?.querySelector('button[aria-label="Download PDF for invoice INV-20155"]')?.textContent).toContain("Download");
    const actions = [...(card?.querySelectorAll("a.min-h-11, button.min-h-11") ?? [])];
    expect(actions).toHaveLength(2);
    expect(actions.every((action) => action.className.includes("flex-1"))).toBe(true);
    expect(card?.querySelector(".break-words")).not.toBeNull();
    expect(card?.querySelector("table")).toBeNull();
  });

  test("makes all data headers except Actions keyboard-usable sort controls with direction state", () => {
    render(React.createElement(PortalInvoiceDesktopTable, {
      invoices: [invoice()],
      preference: { key: "po", direction: "asc" },
    }));

    expect(document.querySelectorAll("thead button")).toHaveLength(9);
    expect(document.querySelector('th[aria-sort="ascending"]')?.textContent).toContain("PO #");
    expect(document.querySelector('th[aria-sort="ascending"] .lucide-arrow-up')).not.toBeNull();
    expect([...document.querySelectorAll('th[aria-sort="none"]')]).toHaveLength(8);
    expect([...document.querySelectorAll("thead th")].at(-1)?.textContent).toBe("Actions");
    expect([...document.querySelectorAll("thead th")].at(-1)?.querySelector("button")).toBeNull();
  });

  test("reorders only informational columns while Invoice and Actions remain anchored", () => {
    const reversed = [...DEFAULT_PORTAL_INVOICE_COLUMNS].reverse().map((column, order) => ({ ...column, order }));
    render(React.createElement(PortalInvoiceDesktopTable, { invoices: [invoice()], columns: reversed }));
    const labels = [...document.querySelectorAll("thead th")].map((header) => header.textContent);
    expect(labels[0]).toBe("");
    expect(labels[1]).toBe("Invoice");
    expect(labels.slice(2, -1)).toEqual(["Status", "Total", "Amount Due", "Due", "Issued", "Order #", "Job Info", "PO #"]);
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
    expect(sortPortalInvoices(rows, { key: "order", direction: "asc" }).map((row) => row.id)).toEqual(["z", "a", "m"]);
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

  test("preserves the stable Job preference key and adds the new Order column to saved layouts", () => {
    const previousLayout = DEFAULT_PORTAL_INVOICE_COLUMNS
      .filter((column) => column.id !== "order")
      .map((column, order) => ({ ...column, label: column.id === "job" ? "Job / Order" : column.label, visible: column.id !== "job", required: true, order }));
    const merged = mergeTableColumnConfig(DEFAULT_PORTAL_INVOICE_COLUMNS, previousLayout);

    expect(merged.filter((column) => column.id === "job")).toEqual([
      expect.objectContaining({ id: "job", label: "Job Info", visible: false }),
    ]);
    expect(merged.at(-1)).toEqual(expect.objectContaining({ id: "order", label: "Order #", visible: true }));
  });

  test("renders only informational columns selected by the customer", () => {
    const columns = DEFAULT_PORTAL_INVOICE_COLUMNS.map((column) => ({
      ...column,
      visible: column.id === "job" || column.id === "order",
    }));
    render(React.createElement(PortalInvoiceDesktopTable, { invoices: [invoice()], columns }));

    expect([...document.querySelectorAll("thead th")].map((header) => header.textContent)).toEqual([
      "",
      "Invoice",
      "Job Info",
      "Order #",
      "Actions",
    ]);
  });
});

describe("V1 Portal invoice payment selection", () => {
  test("keeps selection and the remaining-balance total limited to payable invoices", () => {
    const payable = invoice({ id: "payable", amountDue: 165, status: "sent" });
    const partiallyPaid = invoice({ id: "partial", amountDue: 56.88, status: "partially_paid" });
    const paid = invoice({ id: "paid", amountDue: 0, status: "paid", paymentStatusLabel: "Paid" });
    const voided = invoice({ id: "void", amountDue: 204.7, status: "void", paymentStatusLabel: "Void" });
    const selected = sanitizePortalInvoiceSelection([payable, partiallyPaid, paid, voided], new Set(["payable", "partial", "paid", "void", "stale"]));

    expect([...selected]).toEqual(["payable", "partial"]);
    expect(portalInvoiceSelectionTotal([payable, partiallyPaid, paid, voided], selected)).toBeCloseTo(221.88);
  });

  test("renders payable mobile checkboxes while disabling paid and non-payable rows", () => {
    render(React.createElement(React.Fragment, null,
      React.createElement(PortalInvoiceMobileCard, { invoice: invoice({ id: "payable", displayNumber: "INV-P", amountDue: 10, status: "sent" }) }),
      React.createElement(PortalInvoiceMobileCard, { invoice: invoice({ id: "paid", displayNumber: "INV-PAID", amountDue: 0, status: "paid" }) }),
      React.createElement(PortalInvoiceMobileCard, { invoice: invoice({ id: "void", displayNumber: "INV-VOID", amountDue: 10, status: "void" }) }),
    ));

    expect(document.querySelector('input[aria-label="Select invoice INV-P"]')?.disabled).toBe(false);
    expect(document.querySelector('input[aria-label="Select invoice INV-PAID"]')?.disabled).toBe(true);
    expect(document.querySelector('input[aria-label="Select invoice INV-VOID"]')?.disabled).toBe(true);
  });

  test("hides the payment action tray until an invoice is selected", () => {
    render(React.createElement(PortalInvoicePaymentActionTray, {
      selectedCount: 0,
      selectedTotal: 0,
      currency: "USD",
      onClear: jest.fn(),
      onPay: jest.fn(),
    }));

    expect(document.querySelector('[data-testid="portal-invoice-selection-tray"]')).toBeNull();
  });

  test("keeps the selected count, total, and checkout actions fixed in the portal content region", () => {
    render(React.createElement(PortalInvoicePaymentActionTray, {
      selectedCount: 3,
      selectedTotal: 426.58,
      currency: "USD",
      onClear: jest.fn(),
      onPay: jest.fn(),
    }));

    const tray = document.querySelector('[data-testid="portal-invoice-selection-tray"]');
    expect(tray?.className).toContain("fixed");
    expect(tray?.className).toContain("bottom-0");
    expect(tray?.className).toContain("md:left-64");
    expect(tray?.getAttribute("aria-label")).toBe("Selected invoice payment actions");
    expect(tray?.textContent).toContain("3 invoices selected");
    expect(tray?.textContent).toContain("Total Due: $426.58");
    expect(tray?.textContent).toContain("Clear Selection");
    expect(tray?.textContent).toContain("Pay Selected Invoices");

    const actions = [...(tray?.querySelectorAll("button") ?? [])];
    expect(actions).toHaveLength(2);
    expect(actions.every((action) => action.className.includes("w-full") && action.className.includes("sm:w-auto"))).toBe(true);
  });

  test("uses singular selection copy without changing the total hierarchy", () => {
    render(React.createElement(PortalInvoicePaymentActionTray, {
      selectedCount: 1,
      selectedTotal: 165,
      currency: "USD",
      onClear: jest.fn(),
      onPay: jest.fn(),
    }));

    const tray = document.querySelector('[data-testid="portal-invoice-selection-tray"]');
    expect(tray?.textContent).toContain("1 invoice selected");
    expect(tray?.textContent).toContain("Total Due: $165.00");
  });

  test("wires Clear Selection and checkout opening to the existing action callbacks", () => {
    const onClear = jest.fn();
    const onPay = jest.fn();
    const props = { selectedCount: 2, selectedTotal: 221.88, currency: "USD", onClear, onPay };

    clickActionTrayButton("Clear Selection", props);
    clickActionTrayButton("Pay Selected Invoices", props);

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onPay).toHaveBeenCalledTimes(1);
  });
});

test('unapproved invoice remains visible with its balance but cannot enter grouped selection', () => {
  const awaiting = invoice({ paymentEligibility: { payable: false, blockedReason: 'Awaiting approval' } });
  render(React.createElement(PortalInvoiceMobileCard, { invoice: awaiting }));
  expect(document.body.textContent).toContain('Awaiting approval');
  expect(document.body.textContent).toContain('$69.00');
  expect(document.querySelector('input')?.disabled).toBe(true);
  expect(sanitizePortalInvoiceSelection([awaiting], new Set([awaiting.id])).size).toBe(0);
});
