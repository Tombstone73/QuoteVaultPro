import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('historical fulfillment reconciliation uses canonical quantities without terminal billing side effects', () => {
  const service = read('server/services/fulfillment/service.ts');
  const routes = read('server/routes/orders.routes.ts');

  const reconciliation = service.slice(
    service.indexOf('async reconcileHistoricalFulfillment'),
    service.indexOf('private isOrderProductionComplete'),
  );

  expect(reconciliation).toContain('productionCompleteQuantity < line.projection.orderedQuantity');
  expect(reconciliation).toContain('fulfilledQuantity: line.projection.productionCompleteQuantity');
  expect(reconciliation).toContain('administrativeReconciliation: true');
  expect(reconciliation).toContain("fulfillmentStatus: 'delivered'");
  expect(reconciliation).toContain("eventType: 'FULFILLMENT_HISTORICAL_RECONCILED'");
  expect(reconciliation).toContain("source: 'administrative_historical_reconciliation'");
  expect(reconciliation).toContain('sourceInvoiceId: input.sourceInvoiceId ?? null');
  expect(reconciliation).toContain('shipmentOrPickupEvidenceCreated: false');
  expect(reconciliation).toContain('billingAutomationSuppressed: true');
  expect(reconciliation).not.toContain('ensureTerminalBilling(');
  expect(reconciliation).not.toContain('createShipment(');
  expect(reconciliation).not.toContain('createOrGetPickupTicket(');

  expect(routes).toContain('/api/orders/:orderId/historical-fulfillment-reconciliation');
  expect(routes).toContain('/api/orders/:orderId/reconcile-historical-fulfillment');
  expect(routes).toContain("HISTORICAL_RECONCILIATION_FORBIDDEN");
  expect(routes).toContain("hasAdminOrOwnerOperationalRole(req)");
});

test('the reconciliation preview reports live quantity deltas before confirmation', () => {
  const service = read('server/services/fulfillment/service.ts');
  const preview = service.slice(
    service.indexOf('async getHistoricalFulfillmentReconciliationPreview'),
    service.indexOf('async reconcileHistoricalFulfillment'),
  );

  expect(preview).toContain('remainingProductionQuantity');
  expect(preview).toContain('remainingFulfillmentQuantity');
  expect(preview).toContain('listLineEligibility');
  expect(preview).toContain('productionComplete: remainingProductionQuantity === 0');
});

test('invoice list enriches Customer Detail with invoice snapshot PO and linked Order state', () => {
  const invoiceService = read('server/invoicesService.ts');
  expect(invoiceService).toContain('coalesce(${invoices.customerPoNumber}, ${orders.poNumber})');
  expect(invoiceService).toContain('orderStatusPillValue: orders.statusPillValue');
  expect(invoiceService).toContain('orderFulfillmentStatus: orders.fulfillmentStatus');
});
