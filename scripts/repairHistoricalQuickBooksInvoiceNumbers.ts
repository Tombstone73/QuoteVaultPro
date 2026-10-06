import 'dotenv/config';
import { and, eq, isNull } from 'drizzle-orm';
import { auditLogs, invoices, organizations } from '../shared/schema';
import { resolveHistoricalQuickBooksInvoiceNumber } from '../shared/quickBooksHistoricalNumbering';

const apply = process.argv.includes('--apply');
const organizationId = process.argv.find((value) => value.startsWith('--organization-id='))?.slice('--organization-id='.length) || null;
const confirmedOrganizationId = process.argv.find((value) => value.startsWith('--confirm-organization-id='))?.slice('--confirm-organization-id='.length) || null;
const actorUserId = process.argv.find((value) => value.startsWith('--actor-user-id='))?.slice('--actor-user-id='.length) || null;

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
  if (!organizationId) throw new Error('Explicit --organization-id=<uuid> is required. Never infer a tenant from candidate rows.');
  if (apply && (confirmedOrganizationId !== organizationId || !actorUserId)) {
    throw new Error('--apply requires matching --confirm-organization-id and --actor-user-id after dry-run review.');
  }
  const [{ db }, { findHistoricalQuickBooksInvoiceNumberConflicts }] = await Promise.all([
    import('../server/db'), import('../server/services/quickBooksHistoricalInvoiceNumbering.service'),
  ]);
  const target = await db.select({ id: organizations.id, name: organizations.name })
    .from(organizations).where(eq(organizations.id, organizationId));
  if (target.length !== 1) throw new Error('Target organization must resolve exactly once.');
  const allCandidateOrganizations = await db.select({ organizationId: invoices.organizationId })
    .from(invoices).where(and(eq(invoices.organizationId, organizationId), eq(invoices.importSource, 'quickbooks'), eq(invoices.isHistorical, true)));
  const countsByOrganization = Object.fromEntries(Array.from(new Set(allCandidateOrganizations.map((row) => row.organizationId)))
    .sort().map((id) => [id, allCandidateOrganizations.filter((row) => row.organizationId === id).length]));
  console.log('[historical-qb-numbering] target', JSON.stringify({ organizationId, organizationName: target[0]!.name, countsByOrganization, mode: apply ? 'APPLY' : 'DRY_RUN' }));
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
      eq(invoices.organizationId, organizationId),
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
      organizationId,
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
        organizationId,
        identity: repair.identity,
        excludeInvoiceId: repair.row.id,
        executor: tx,
      });
      if (conflicts.length > 0) {
        throw new Error(`Invoice ${repair.row.id} acquired a historical-number conflict: ${conflicts.map((conflict) => `${conflict.kind}:${conflict.entity}:${conflict.id}`).join(', ')}`);
      }
      const updated = await tx
        .update(invoices)
        .set({
          invoiceNumber: repair.identity.invoiceNumber,
          displayNumber: repair.identity.displayNumber,
          numberCore: repair.identity.numberCore,
          jobNumber: null,
          invoiceSequence: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(invoices.id, repair.row.id), eq(invoices.organizationId, organizationId),
          eq(invoices.importSource, 'quickbooks'), eq(invoices.isHistorical, true),
          eq(invoices.invoiceNumber, repair.row.invoiceNumber),
          repair.row.displayNumber == null ? isNull(invoices.displayNumber) : eq(invoices.displayNumber, repair.row.displayNumber),
        )).returning({ id: invoices.id });
      if (updated.length !== 1) throw new Error(`Invoice ${repair.row.id} changed after dry run; transaction aborted.`);
      await tx.insert(auditLogs).values({
        organizationId, userId: actorUserId,
        actionType: 'historical_qb_invoice_number_repaired', entityType: 'invoice',
        entityId: repair.row.id, entityName: repair.identity.displayNumber,
        description: 'Tenant-scoped historical QuickBooks Invoice numbering repair.',
        oldValues: { invoiceNumber: repair.row.invoiceNumber, displayNumber: repair.row.displayNumber },
        newValues: { invoiceNumber: repair.identity.invoiceNumber, displayNumber: repair.identity.displayNumber },
      });
    });
    report.repaired++;
  }

  console.log('[historical-qb-numbering] applied', JSON.stringify(report));
}

main().catch((error) => {
  console.error('[historical-qb-numbering] failed', error instanceof Error ? error.message : error);
  process.exit(1);
});
