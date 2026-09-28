import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

function source(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

test("auto-close is locked, transitions canonical state, audits, and applies the closed workflow pill", () => {
  const service = source("server/services/orderAutoCloseService.ts");
  expect(service).toContain("pg_advisory_xact_lock");
  expect(service).toContain('.for("update")');
  expect(service).toContain('state: "closed"');
  expect(service).toContain('closedAt: now');
  expect(service).toContain('status: mapStateToLegacyStatus("closed")');
  expect(service).toContain("order_auto_closed");
  expect(service).toContain('triggerKey: "order_closed"');
  expect(service).toContain("reconcileOrderAutoCloseFailSoft");
  expect(service).toContain("assessOrderAutoClose");
  expect(service).toContain("invoices: invoiceRows");
});

test("new payment and terminal fulfillment events use the same fail-soft reconciler", () => {
  const invoices = source("server/invoicesService.ts");
  const stripe = source("server/services/stripePaymentReconciliationService.ts");
  const eps = source("server/services/payments/paymentProvider.service.ts");
  const fulfillment = source("server/services/fulfillment/service.ts");
  expect(invoices).toContain("source: 'manual_payment'");
  expect(invoices).toContain("&& !result.reused");
  expect(invoices).toContain("reconcileOrderAutoClose?: boolean");
  expect(stripe).toContain('source: "stripe_payment"');
  expect(eps).toContain("reconcileOrderAutoClose: true");
  expect(fulfillment).toContain("'shipment_shipped'");
  expect(fulfillment).toContain("'pickup_handoff_recorded'");
  expect(fulfillment).toContain("'historical_fulfillment_reconciliation'");
});

test("closed is displayed before terminal fulfillment without erasing fulfillment history", () => {
  const jobStatus = source("client/src/components/orders/CloseJobOverrideDialog.tsx");
  const invoiceSort = source("server/invoicesService.ts");
  expect(jobStatus.indexOf('return "Closed"')).toBeLessThan(jobStatus.indexOf('return "Fulfillment Complete"'));
  expect(invoiceSort).toContain("= 'closed' then 'closed'");
});

test('manual closure shares operational and canonical financial gates without an unpaid bypass', () => {
  const routes = source('server/routes/orders.routes.ts');
  const close = routes.slice(routes.indexOf('app.post("/api/orders/:orderId/close"'), routes.indexOf('app.post("/api/orders/:orderId/reopen"'));
  expect(close).toContain('await reconcileOrderAutoClose(');
  expect(close).not.toContain('transitionOrderState');
  expect(close).not.toContain('confirmUnpaidInvoices');
  expect(routes).toContain('source: "manual_operational_completion"');
  const qb = source('server/quickbooksService.ts');
  expect(qb.match(/source: 'quickbooks_invoice_balance'/g)).toHaveLength(2);
});
