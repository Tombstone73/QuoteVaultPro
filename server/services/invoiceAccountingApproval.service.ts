import { and, eq } from 'drizzle-orm';
import { auditLogs, invoices } from '@shared/schema';
import { db } from '../db';
export { accountingApprovalRevocationPatch, getInvoiceAccountingApprovalState, isInvoiceApprovedForAccounting } from '../lib/invoiceAccountingApproval';
import { getInvoiceAccountingApprovalState } from '../lib/invoiceAccountingApproval';

export async function approveInvoicesForAccounting(input: {
  organizationId: string;
  invoiceIds: string[];
  actorUserId: string;
  actorUserName?: string | null;
}) {
  const uniqueIds = [...new Set(input.invoiceIds.map(String).filter(Boolean))];
  return db.transaction(async (tx) => {
    const results: Array<{ id: string; outcome: 'approved' | 'skipped' | 'failed'; reason: string | null }> = [];
    for (const invoiceId of uniqueIds) {
      const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, input.organizationId))).limit(1);
      if (!invoice) { results.push({ id: invoiceId, outcome: 'failed', reason: 'Invoice not found.' }); continue; }
      if (String(invoice.importSource || '').toLowerCase() === 'quickbooks' || invoice.isHistorical) {
        results.push({ id: invoiceId, outcome: 'skipped', reason: 'Imported QuickBooks invoices do not require accounting approval.' }); continue;
      }
      if (['void', 'canceled', 'cancelled'].includes(String(invoice.status || '').toLowerCase())) {
        results.push({ id: invoiceId, outcome: 'skipped', reason: 'Void or canceled invoices cannot be approved for accounting.' }); continue;
      }
      if (getInvoiceAccountingApprovalState(invoice as any) === 'approved') {
        results.push({ id: invoiceId, outcome: 'skipped', reason: 'Invoice is already approved for its current accounting version.' }); continue;
      }
      const now = new Date();
      const approvedVersion = Number(invoice.invoiceVersion || 1);
      await tx.update(invoices).set({
        accountingApprovedAt: now,
        accountingApprovedByUserId: input.actorUserId,
        accountingApprovedVersion: approvedVersion,
        accountingApprovalRevokedAt: null,
        updatedAt: now,
      } as any).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId)));
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId,
        userId: input.actorUserId,
        userName: input.actorUserName || null,
        actionType: 'invoice_accounting_approved',
        entityType: 'invoice',
        entityId: invoice.id,
        entityName: String(invoice.displayNumber || invoice.invoiceNumber),
        description: 'Invoice approved for accounting for its current commercial version.',
        newValues: { approvedAccountingVersion: approvedVersion, approvedAt: now.toISOString() } as any,
      } as any);
      results.push({ id: invoiceId, outcome: 'approved', reason: null });
    }
    return {
      requested: uniqueIds.length,
      approved: results.filter((result) => result.outcome === 'approved').length,
      skipped: results.filter((result) => result.outcome === 'skipped').length,
      failed: results.filter((result) => result.outcome === 'failed').length,
      results,
    };
  });
}
