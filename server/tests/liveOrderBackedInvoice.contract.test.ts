import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('live Order-backed Invoice contract', () => {
  test('V1 creates a live billed receivable and synchronizes it from Order facts', () => {
    const source = read('server/invoicesService.ts');

    expect(source).toContain("status: 'billed'");
    expect(source).toContain('issuedAt: issueDate');
    expect(source).toContain('computeInvoiceFinancialState(nextInvoice, paymentRows as any)');
    expect(source).toContain('actionType: "invoice_order_backed_synchronized"');
  });

  test('V1 payment action has no manual-finalization gate and preserves credit', () => {
    const paymentPolicy = read('shared/paymentOrchestration.ts');
    const rollup = read('shared/rollups/invoicePaymentRollup.ts');
    const invoiceUi = read('client/src/pages/invoice-detail.tsx');

    expect(paymentPolicy).not.toContain('Draft invoices must be finalized before payment can be collected.');
    expect(rollup).toContain("paymentStatus = 'credit'");
    expect(invoiceUi).not.toContain("'Finalizing…'");
  });

  test('V2 carries the same Order-backed Invoice vocabulary while retaining adapters', () => {
    const billingContracts = read('v2/src/modules/billing/contracts.ts');
    const salesContracts = read('v2/src/modules/sales/contracts.ts');

    expect(billingContracts).toContain('OrderBackedInvoiceSynchronizationInput');
    expect(billingContracts).toContain('OrderBackedInvoiceSynchronizationResult');
    expect(salesContracts).toContain('orderBackedInvoiceId');
  });

  test('QuickBooks stays on its canonical queue and records the version it synchronized', () => {
    const worker = read('server/services/quickbooksSyncQueueWorker.ts');

    expect(worker).toContain('syncSingleInvoiceToQuickBooksForOrganization');
    expect(worker).toContain('lastQbSyncedVersion: sql`${invoices.invoiceVersion}`');
  });
});
