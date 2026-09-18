import { readFileSync } from "node:fs";

const paymentsPage = readFileSync("client/src/pages/finance.tsx", "utf8");
const dashboardCard = readFileSync("client/src/components/dashboard/FulfillmentFinanceCard.tsx", "utf8");

describe("Payments page and dashboard shortcuts", () => {
  it("keeps list filters, sorting, and pagination server-backed in URL state", () => {
    expect(paymentsPage).toContain("useSearchParams");
    expect(paymentsPage).toContain("/api/payments?");
    expect(paymentsPage).toContain('next.set("pageSize", String(PAGE_SIZE))');
    expect(paymentsPage).toContain('next.set("datePreset", datePreset)');
    expect(paymentsPage).toContain("CustomerSelect");
    expect(paymentsPage).toContain("Payment Method");
    expect(paymentsPage).toContain("Custom Range");
    expect(paymentsPage).toContain("sortBy");
    expect(paymentsPage).toContain("sortDir");
    expect(paymentsPage).toContain("data.pagination.totalPages");
  });

  it("renders the required columns and association links safely", () => {
    for (const label of ["Payment Date", "Customer", "Invoice #", "Order #", "Job / Order Name", "Method", "Reference", "Amount"]) expect(paymentsPage).toContain(label);
    expect(paymentsPage).toContain("ROUTES.customers.detail(payment.customerId)");
    expect(paymentsPage).toContain("ROUTES.invoices.detail(payment.invoiceId)");
    expect(paymentsPage).toContain("ROUTES.orders.detail(payment.orderId)");
    expect(paymentsPage).toContain('"—"');
  });

  it("links only the collection rows to the matching Payments presets", () => {
    expect(dashboardCard).toContain("datePreset=today");
    expect(dashboardCard).toContain("datePreset=this-month");
    expect(dashboardCard).toContain("This Month");
    expect(dashboardCard).not.toContain("This Week");
  });
});
