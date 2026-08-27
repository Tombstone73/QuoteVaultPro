import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from '../server/db';
import { invoices } from '../shared/schema';
import { resolveHistoricalQuickBooksInvoiceNumber } from '../shared/quickBooksHistoricalNumbering';
import { findHistoricalQuickBooksInvoiceNumberConflicts } from '../server/services/quickBooksHistoricalInvoiceNumbering.service';

const apply = process.argv.includes('--apply');

type RepairableInvoice = {
  id: string;
  organizationId: string;
  invoiceNumber: number;
  displayNumber: string | null;
  numberCore: number | null;
  jobNumber: number | null;
  invoiceSequence: number | null;
  qbDocNumber: string | null;
};

async function main() {
  const candidates = await db
    .select({
      id: invoices.id,
      organizationId: invoices.organizationId,
      invoiceNumber: invoices.invoiceNumber,
      displayNumber: invoices.displayNumber,
      numberCore: invoices.numberCore,
      jobNumber: invoices.jobNumber,
      invoiceSequence: invoices.invoiceSequence,
      qbDocNumber: invoices.qbDocNumber,
    })
    .from(invoices)
    .where(and(
      eq(invoices.importSource, 'quickbooks'),
      eq(invoices.isHistorical, true),
    ));

  const report = { affected: 0, safelyRepairable: 0, collisions: 0, malformedOrMissing: 0, alreadyCorrect: 0, repaired: 0 };
  const repairs: Array<{ row: RepairableInvoice; identity: { sourceDocNumber: string; displayNumber: string; numberCore: number | null; invoiceNumber: number } }> = [];

  for (const row of candidates as RepairableInvoice[]) {
    const resolved = resolveHistoricalQuickBooksInvoiceNumber(row.qbDocNumber);
    if ('error' in resolved) {
      report.malformedOrMissing++;
      console.log(`[historical-qb-numbering] malformed invoice=${row.id}: ${resolved.error}`);
      continue;
    }

    const identity = resolved.value;
    const isCorrect = row.displayNumber === identity.displayNumber
      && row.numberCore === identity.numberCore
      && row.invoiceNumber === identity.invoiceNumber
      && row.jobNumber == null
      && row.invoiceSequence == null;
    if (isCorrect) {
      report.alreadyCorrect++;
      continue;
    }

    report.affected++;
    const conflicts = await findHistoricalQuickBooksInvoiceNumberConflicts({
      organizationId: row.organizationId,
      identity,
      excludeInvoiceId: row.id,
    });
    if (conflicts.length > 0) {
      report.collisions++;
      console.log(`[historical-qb-numbering] collision invoice=${row.id} doc=${identity.sourceDocNumber} conflicts=${conflicts.map((conflict) => `${conflict.kind}:${conflict.entity}:${conflict.id}`).join(',')}`);
      continue;
    }

    report.safelyRepairable++;
    repairs.push({ row, identity });
  }

  console.log('[historical-qb-numbering] audit', JSON.stringify(report));
  if (!apply) {
    console.log('[historical-qb-numbering] dry run only; rerun with --apply after reviewing this audit.');
    return;
  }

  for (const repair of repairs) {
    await db.transaction(async (tx) => {
      const conflicts = await findHistoricalQuickBooksInvoiceNumberConflicts({
        organizationId: repair.row.organizationId,
        identity: repair.identity,
        excludeInvoiceId: repair.row.id,
        executor: tx,
      });
      if (conflicts.length > 0) {
        throw new Error(`Invoice ${repair.row.id} acquired a historical-number conflict: ${conflicts.map((conflict) => `${conflict.kind}:${conflict.entity}:${conflict.id}`).join(', ')}`);
      }
      await tx
        .update(invoices)
        .set({
          invoiceNumber: repair.identity.invoiceNumber,
          displayNumber: repair.identity.displayNumber,
          numberCore: repair.identity.numberCore,
          jobNumber: null,
          invoiceSequence: null,
          updatedAt: new Date(),
        })
        .where(and(eq(invoices.id, repair.row.id), eq(invoices.organizationId, repair.row.organizationId)));
    });
    report.repaired++;
  }

  console.log('[historical-qb-numbering] applied', JSON.stringify(report));
}

main().catch((error) => {
  console.error('[historical-qb-numbering] failed', error instanceof Error ? error.message : error);
  process.exit(1);
});
