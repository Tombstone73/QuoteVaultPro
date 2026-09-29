import { readFileSync } from 'node:fs';
import { expect, test } from '@jest/globals';

const queue = readFileSync('server/services/quickbooksSyncQueueWorker.ts', 'utf8');
test('unsynced grouped payments use their tenant-scoped payer and expose ownership blockers', () => {
  expect(queue).toContain('b.id = p.customer_payment_batch_id and b.organization_id = p.organization_id');
  expect(queue).toContain('bc.id = b.customer_id and bc.organization_id = b.organization_id');
  expect(queue).toContain("p.external_accounting_id is null and p.sync_status <> 'synced' and b.id is not null");
  expect(queue).toContain("then coalesce(bc.company_name, '') else coalesce(c.company_name, '') end");
  for (const flag of ['eligible', 'can_transmit', 'can_manual_force']) expect(queue).toContain(`(${flag} and ownership_aligned) as ${flag}`);
  expect(queue).toContain('Billing ownership mismatch. Accounting reconciliation required.');
});
test('commercial recalculation cannot bypass the audited owner transition', () => {
  const source = readFileSync('server/invoicesService.ts', 'utf8');
  const synchronization = source.slice(source.indexOf('export async function synchronizeOrderBackedInvoiceFromOrderInTransaction'), source.indexOf('export async function synchronizeOrderBackedInvoiceFromOrder(input'));
  expect(synchronization).not.toContain('customerId: order.customerId');
  expect(synchronization).not.toContain('contactId: order.customerId');
  expect(synchronization).toContain('amountPaidCents > 0');
});
