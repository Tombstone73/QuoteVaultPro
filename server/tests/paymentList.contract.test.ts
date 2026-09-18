import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("canonical payments list", () => {
  test("uses the same succeeded-payment query service for dashboard collections and the Payments endpoint", () => {
    const service = source("server/services/paymentListService.ts");
    const dashboard = source("server/services/dashboardSummaryService.ts");
    const routes = source("server/routes/mvpInvoicing.routes.ts");

    expect(service).toContain("eq(payments.status, 'succeeded')");
    expect(service).toContain("gte(payments.appliedAt, window.start)");
    expect(service).toContain("lt(payments.appliedAt, window.endExclusive)");
    expect(service).toContain("getOrganizationTimezone(input.organizationId)");
    expect(service).toContain("sum(${payments.amountCents})");
    expect(service).toContain("direction(payments.id)");
    expect(routes).toContain("app.get('/api/payments', isAuthenticated, tenantContext");
    expect(routes).toContain("listPayments({");
    expect(dashboard).toContain('listPayments({ organizationId, datePreset: "today", pageSize: 1, now })');
    expect(dashboard).toContain('listPayments({ organizationId, datePreset: "this-month", pageSize: 1, now })');
  });

  test("keeps filters, linked canonical associations, and bounded server pagination tenant scoped", () => {
    const service = source("server/services/paymentListService.ts");
    const routes = source("server/routes/mvpInvoicing.routes.ts");

    expect(service).toContain("eq(payments.organizationId, input.organizationId)");
    expect(service).toContain("eq(invoices.customerId, input.customerId)");
    expect(service).toContain("ilike(customers.companyName, like)");
    expect(service).toContain("leftJoin(orders, eq(invoices.orderId, orders.id))");
    expect(service).toContain("Math.min(Math.max(Number(input.pageSize || 50), 1), 200)");
    expect(routes).toContain("manualPaymentMethodSchema.safeParse(method)");
    expect(routes).toContain("Math.min(200");
  });
});
