import { and, eq, sql } from 'drizzle-orm';
import { auditLogs, customers, invoices, organizations } from '@shared/schema';
import { db } from '../db';
export { accountingApprovalRevocationPatch, getInvoiceAccountingApprovalState, getInvoiceQuickBooksApprovalEligibility, isInvoiceApprovedForAccounting } from '../lib/invoiceAccountingApproval';
import { getInvoiceAccountingApprovalState } from '../lib/invoiceAccountingApproval';
import { resolveQuickBooksPreferencesFromOrgPreferences } from '@shared/quickBooksPreferences';
import {
  hasInvoicePaymentTermsStartedOrApprovalHistory,
  resolveFirstInvoiceTermsStart,
} from '@shared/invoicePaymentTerms';

export async function approveInvoicesForAccounting(input: {
  organizationId: string;
  invoiceIds: string[];
  actorUserId?: string | null;
  actorUserName?: string | null;
  source?: "manual" | "invoice_delivery_automation";
}, options?: { tx?: any }) {
  const uniqueIds = [...new Set(input.invoiceIds.map(String).filter(Boolean))];
  const approve = async (tx: any) => {
    const [organization] = await tx
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1);
    const preferences = (organization?.settings as any)?.preferences;
    const { autoQueueApprovedInvoices } = resolveQuickBooksPreferencesFromOrgPreferences(preferences);
    const results: Array<{ id: string; outcome: 'approved' | 'skipped' | 'failed'; reason: string | null; code?: string }> = [];
    for (const invoiceId of uniqueIds) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice-accounting-approval:${input.organizationId}:${invoiceId}`}))`);
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
      const startsTermsOnThisApproval = !hasInvoicePaymentTermsStartedOrApprovalHistory(invoice as Record<string, unknown>);
      const [customer] = invoice.customerId
        ? await tx.select({ paymentTerms: customers.paymentTerms }).from(customers).where(and(
          eq(customers.id, invoice.customerId),
          eq(customers.organizationId, input.organizationId),
        )).limit(1)
        : [null];
      const termsStart = startsTermsOnThisApproval
        ? resolveFirstInvoiceTermsStart({
          customerPaymentTerms: customer?.paymentTerms,
          invoiceTerms: invoice.terms,
          approvalAt: now,
          existingDueDate: invoice.dueDate,
        })
        : null;
      if (termsStart?.validationError) {
        results.push({ id: invoiceId, outcome: 'failed', reason: termsStart.validationError, code: 'CUSTOM_PAYMENT_TERMS_DUE_DATE_REQUIRED' }); continue;
      }
      const approvedVersion = Number(invoice.invoiceVersion || 1);
      const hasProviderInvoiceLink = Boolean(String(invoice.qbInvoiceId || invoice.externalAccountingId || '').trim());
      const shouldQueueInitialSync = autoQueueApprovedInvoices && !hasProviderInvoiceLink;
      await tx.update(invoices).set({
        accountingApprovedAt: now,
        accountingApprovedByUserId: input.actorUserId,
        accountingApprovedVersion: approvedVersion,
        accountingApprovalRevokedAt: null,
        ...(termsStart ? {
          termsStartedAt: now,
          terms: termsStart.terms,
          dueDate: termsStart.dueDate,
        } : {}),
        // Approval changes only local queue state. Existing provider-linked
        // invoices retain their established update/resync behavior.
        ...(shouldQueueInitialSync
          ? { qbSyncStatus: 'pending', qbLastError: null, syncStatus: 'pending', syncError: null }
          : String(invoice.qbSyncStatus || '').toLowerCase() === 'pending'
            ? { qbSyncStatus: 'not_synced', qbLastError: null, syncStatus: 'pending', syncError: null }
            : {}),
        updatedAt: now,
      } as any).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId)));
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId,
        userId: input.actorUserId || null,
        userName: input.actorUserName || null,
        actionType: 'invoice_accounting_approved',
        entityType: 'invoice',
        entityId: invoice.id,
        entityName: String(invoice.displayNumber || invoice.invoiceNumber),
        description: input.source === 'invoice_delivery_automation'
          ? 'Invoice automatically approved for accounting after provider-confirmed customer delivery.'
          : 'Invoice approved for accounting for its current commercial version.',
        newValues: {
          approvedAccountingVersion: approvedVersion,
          approvedAt: now.toISOString(),
          source: input.source || 'manual',
          quickBooksAutoQueued: shouldQueueInitialSync,
          ...(termsStart ? {
            terms: termsStart.terms,
            termsStartedAt: now.toISOString(),
            dueDate: termsStart.dueDate?.toISOString() ?? null,
          } : {}),
        } as any,
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
  };
  return options?.tx ? approve(options.tx) : db.transaction(approve);
}
