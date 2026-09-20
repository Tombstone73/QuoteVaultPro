import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { customers, invoiceLineItems, invoices, orderLineItems, orders, payments } from "@shared/schema";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("Order commercial financial repair command", () => {
  it("defaults to dry run and requires explicit production identity and apply attribution", () => {
    const repair = source("scripts/repair-order-commercial-financials.ts");

    expect(repair).toContain('const apply = process.argv.includes("--apply")');
    expect(repair).toContain('if (apply && !actorUserId)');
    expect(repair).toContain('environment.databaseRuntime !== "production-cloud" || environment.appRuntime !== "production"');
    expect(repair).toContain('dry run only; rerun with --apply and --actor-user-id');
  });

  it("uses the canonical persisted-line snapshot and transactional recalculator rather than hard-coded Order 20365 arithmetic", () => {
    const repair = source("scripts/repair-order-commercial-financials.ts");
    const taxService = source("server/services/orders/orderTaxCalculationService.ts");

    expect(repair).toContain("calculateEditableOrderFinancialSnapshot");
    expect(repair).toContain("recalculateEditableOrderFinancialsInTransaction");
    expect(repair).toContain("FOR UPDATE");
    expect(repair).not.toContain("445.25");
    expect(repair).not.toContain("460.00");
    expect(taxService).toContain("export async function calculateEditableOrderFinancialSnapshot");
    expect(taxService).toContain("total: totals.subtotal - discount + totals.taxAmount + shipping,");
  });

  it("uses only current Drizzle column objects in its diagnostic projections", () => {
    const repair = source("scripts/repair-order-commercial-financials.ts");
    const columns = [
      orders.id, orders.organizationId, orders.orderNumber, orders.customerId, orders.subtotal, orders.discount,
      orders.tax, orders.shippingCents, orders.total, orders.fulfillmentStatus, orders.shippingMethod,
      customers.companyName,
      orderLineItems.id, orderLineItems.productId, orderLineItems.description, orderLineItems.quantity,
      orderLineItems.totalPrice, orderLineItems.workflowState, orderLineItems.status, orderLineItems.parentLineItemId,
      orderLineItems.lineItemRole,
      invoices.id, invoices.invoiceNumber, invoices.status, invoices.total, invoices.totalCents, invoices.balanceDue,
      invoices.amountPaid, invoices.issuedAt, invoices.lastSentAt, invoices.accountingApprovedAt,
      invoiceLineItems.invoiceId, invoiceLineItems.orderLineItemId, invoiceLineItems.lineTotalCents,
      payments.invoiceId, payments.id, payments.status, payments.amountCents, payments.provider,
    ];

    expect(columns.every(Boolean)).toBe(true);
    expect(repair).toContain("customerName: customers.companyName");
    expect(repair).not.toContain("customers.name");
    expect(repair).toContain("redactDiagnostic");
    expect(repair).toContain("stack:");
  });
});
