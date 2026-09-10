import { readFileSync } from "node:fs";

const invoicesPage = readFileSync("client/src/pages/portal/invoices.tsx", "utf8");
const dashboardPage = readFileSync("client/src/pages/portal/dashboard.tsx", "utf8");
const portalHooks = readFileSync("client/src/hooks/usePortal.ts", "utf8");

describe("Portal invoice identity cards", () => {
  test("renders PO and Job / Order context in the Invoice list without changing its existing actions", () => {
    expect(invoicesPage).toContain("Job / Order:");
    expect(invoicesPage).toContain("PO # {invoice.customerPoNumber || \"—\"}");
    expect(invoicesPage).toContain("View invoice");
    expect(invoicesPage).toContain("portalInvoicePdfUrl(invoice.id, true)");
  });

  test("renders the same identity context on Outstanding Invoices without changing Pay Invoice", () => {
    expect(dashboardPage).toContain("Job / Order:");
    expect(dashboardPage).toContain("PO # {invoice.customerPoNumber || \"—\"}");
    expect(dashboardPage).toContain("Pay invoice");
  });

  test("uses the shared invoice DTO, so list and dashboard need no per-invoice Order request", () => {
    expect(portalHooks).toContain("customerPoNumber: string | null");
    expect(portalHooks).toContain("jobLabel: string | null");
    expect(portalHooks).toContain("orderNumber: string | null");
    expect(invoicesPage).not.toContain("usePortalOrder(");
    expect(dashboardPage).not.toContain("usePortalOrder(");
  });
});
