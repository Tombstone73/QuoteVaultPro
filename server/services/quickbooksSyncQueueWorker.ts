import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLogs, invoices, oauthConnections, payments } from "../../shared/schema";
import {
  getValidAccessTokenForOrganization,
  isQuickBooksReauthRequiredForOrganization,
  syncSingleInvoiceToQuickBooksForOrganization,
  syncSinglePaymentToQuickBooksForOrganization,
} from "../quickbooksService";

export type QuickBooksSyncQueueCounts = {
  invoices: { pending: number; failed: number };
  payments: { pending: number; failed: number };
  nextEligibleCounts: { invoices: number; payments: number };
  settleWindowMinutes: number;
  stabilityWindowMs: number;
};

export type QuickBooksSyncWorkerRunResult = {
  settleWindowMinutes: number;
  stabilityWindowMs: number;
  ignoreSettleWindow: boolean;
  ignoreStabilityWindow: boolean;
  invoices: { attempted: number; succeeded: number; failed: number };
  payments: { attempted: number; succeeded: number; failed: number };
};

export type QuickBooksSyncQueueItem = {
  id: string;
  resourceType: 'invoice' | 'payment';
  displayNumber: string;
  status: string;
  syncStatus: string;
  updatedAt: Date;
  eligible: boolean;
  ineligibleReason: string | null;
  lastError: string | null;
};

export type QuickBooksSelectedSyncResult = {
  requested: number;
  synced: number;
  failed: number;
  skipped: number;
  rejected: number;
  results: Array<{ id: string; resourceType: 'invoice' | 'payment'; outcome: 'synced' | 'failed' | 'skipped' | 'rejected'; reason: string | null }>;
};

export const DEFAULT_QB_SYNC_STABILITY_WINDOW_MS = 30 * 60 * 1000;

function toOneLineHumanMessage(input: unknown, maxLen = 220): string {
  const text = String(input || "")
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .trim();
  if (!text) return "QuickBooks sync failed";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
}

export function getQuickBooksSyncStabilityWindowMs(): number {
  const explicit = Number(process.env.QUICKBOOKS_SYNC_STABILITY_WINDOW_MS);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;

  const legacyMinutes = Number(process.env.QB_SYNC_SETTLE_WINDOW_MINUTES);
  if (Number.isFinite(legacyMinutes) && legacyMinutes >= 0) {
    return legacyMinutes * 60 * 1000;
  }

  return DEFAULT_QB_SYNC_STABILITY_WINDOW_MS;
}

export function isUpdatedBeforeQuickBooksStabilityCutoff(updatedAt: Date, now: Date, stabilityWindowMs: number): boolean {
  return updatedAt.getTime() <= now.getTime() - Math.max(0, stabilityWindowMs);
}

function cutoffDate({ now, stabilityWindowMs, ignoreStabilityWindow }: { now: Date; stabilityWindowMs: number; ignoreStabilityWindow: boolean }) {
  if (ignoreStabilityWindow) return now;
  const ms = Math.max(0, stabilityWindowMs);
  return new Date(now.getTime() - ms);
}

export async function listQuickBooksConnectedOrganizationIds(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ organizationId: oauthConnections.organizationId })
    .from(oauthConnections)
    .where(eq(oauthConnections.provider, "quickbooks" as any));

  return rows.map((r) => String(r.organizationId));
}

export async function getQuickBooksSyncQueueCountsForOrg(params: {
  organizationId: string;
  settleWindowMinutes?: number;
  stabilityWindowMs?: number;
}): Promise<QuickBooksSyncQueueCounts> {
  const { organizationId } = params;
  const stabilityWindowMs = params.stabilityWindowMs ?? (
    typeof params.settleWindowMinutes === "number"
      ? Math.max(0, params.settleWindowMinutes) * 60 * 1000
      : getQuickBooksSyncStabilityWindowMs()
  );
  const settleWindowMinutes = Math.round(stabilityWindowMs / 60_000);
  const now = new Date();
  const cutoff = cutoffDate({ now, stabilityWindowMs, ignoreStabilityWindow: false });

  const [invoiceCounts] = await db
    .select({
      pending: sql<number>`sum(case when ${invoices.qbSyncStatus} = 'pending' then 1 else 0 end)::int`,
      failed: sql<number>`sum(case when ${invoices.qbSyncStatus} = 'failed' then 1 else 0 end)::int`,
      eligible: sql<number>`sum(case when ${invoices.qbSyncStatus} in ('pending','failed') and lower(${invoices.status}) <> 'draft' and ${invoices.updatedAt} <= ${cutoff} then 1 else 0 end)::int`,
    })
    .from(invoices)
    .where(eq(invoices.organizationId, organizationId));

  const [paymentCounts] = await db
    .select({
      pending: sql<number>`sum(case when ${payments.syncStatus} = 'pending' then 1 else 0 end)::int`,
      failed: sql<number>`sum(case when ${payments.syncStatus} = 'failed' then 1 else 0 end)::int`,
    })
    .from(payments)
    .where(eq(payments.organizationId, organizationId));

  const [eligiblePayments] = await db
    .select({
      eligible: sql<number>`count(*)::int`,
    })
    .from(payments)
    .innerJoin(invoices, and(eq(payments.invoiceId, invoices.id), eq(payments.organizationId, invoices.organizationId)))
    .where(
      and(
        eq(payments.organizationId, organizationId),
        sql`${payments.syncStatus} in ('pending','failed')`,
        sql`${payments.updatedAt} <= ${cutoff}`,
        sql`lower(${payments.status}) in ('succeeded','captured')`,
        sql`coalesce(${invoices.qbInvoiceId}, '') <> ''`
      )
    );

  return {
    settleWindowMinutes,
    stabilityWindowMs,
    invoices: { pending: Number(invoiceCounts?.pending || 0), failed: Number(invoiceCounts?.failed || 0) },
    payments: { pending: Number(paymentCounts?.pending || 0), failed: Number(paymentCounts?.failed || 0) },
    nextEligibleCounts: { invoices: Number(invoiceCounts?.eligible || 0), payments: Number(eligiblePayments?.eligible || 0) },
  };
}

export async function runQuickBooksSyncWorkerForOrg(params: {
  organizationId: string;
  settleWindowMinutes?: number;
  stabilityWindowMs?: number;
  limitPerRun: number;
  ignoreSettleWindow?: boolean;
  ignoreStabilityWindow?: boolean;
  includeFailed?: boolean;
  log?: boolean;
}): Promise<QuickBooksSyncWorkerRunResult> {
  const {
    organizationId,
    limitPerRun,
    ignoreSettleWindow = false,
    ignoreStabilityWindow = ignoreSettleWindow,
    includeFailed = true,
    log = false,
  } = params;
  const stabilityWindowMs = params.stabilityWindowMs ?? (
    typeof params.settleWindowMinutes === "number"
      ? Math.max(0, params.settleWindowMinutes) * 60 * 1000
      : getQuickBooksSyncStabilityWindowMs()
  );
  const settleWindowMinutes = Math.round(stabilityWindowMs / 60_000);

  const now = new Date();
  const cutoff = cutoffDate({ now, stabilityWindowMs, ignoreStabilityWindow });
  const invoiceStatuses = includeFailed ? ["pending", "failed"] : ["pending"];
  const paymentStatuses = includeFailed ? ["pending", "failed"] : ["pending"];

  // Query eligible items first. IMPORTANT: do not call QuickBooks at all if nothing is eligible.
  const eligibleInvoices = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        inArray(invoices.qbSyncStatus, invoiceStatuses as any),
        sql`lower(${invoices.status}) <> 'draft'`,
        sql`${invoices.updatedAt} <= ${cutoff}`
      )
    )
    .orderBy(asc(invoices.updatedAt))
    .limit(Math.max(0, limitPerRun));

  const eligiblePayments = await db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(invoices, and(eq(payments.invoiceId, invoices.id), eq(payments.organizationId, invoices.organizationId)))
    .where(
      and(
        eq(payments.organizationId, organizationId),
        inArray(payments.syncStatus, paymentStatuses as any),
        sql`${payments.updatedAt} <= ${cutoff}`,
        sql`lower(${payments.status}) in ('succeeded','captured')`,
        sql`coalesce(${invoices.qbInvoiceId}, '') <> ''`
      )
    )
    .orderBy(asc(payments.updatedAt))
    .limit(Math.max(0, limitPerRun));

  if (eligibleInvoices.length === 0 && eligiblePayments.length === 0) {
    return {
      settleWindowMinutes,
      stabilityWindowMs,
      ignoreSettleWindow,
      ignoreStabilityWindow,
      invoices: { attempted: 0, succeeded: 0, failed: 0 },
      payments: { attempted: 0, succeeded: 0, failed: 0 },
    };
  }

  if (log) {
    console.log(`[QB Queue] start org=${organizationId} ignoreStability=${ignoreStabilityWindow} cutoff=${cutoff.toISOString()} inv=${eligibleInvoices.length} pay=${eligiblePayments.length}`);
  }

  const result: QuickBooksSyncWorkerRunResult = {
    settleWindowMinutes,
    stabilityWindowMs,
    ignoreSettleWindow,
    ignoreStabilityWindow,
    invoices: { attempted: 0, succeeded: 0, failed: 0 },
    payments: { attempted: 0, succeeded: 0, failed: 0 },
  };

  const reauth = await isQuickBooksReauthRequiredForOrganization(organizationId);
  if (reauth.needsReauth) {
    if (log) {
      console.log(`[QB Queue] skip org=${organizationId} needs_reauth`);
    }
    return result;
  }

  // Ensure QB connected only once we have work to do.
  const token = await getValidAccessTokenForOrganization(organizationId);
  if (!token) {
    const reauthAfter = await isQuickBooksReauthRequiredForOrganization(organizationId);
    if (reauthAfter.needsReauth) {
      if (log) {
        console.log(`[QB Queue] skip org=${organizationId} needs_reauth`);
      }
      return result;
    }

    const message = "QuickBooks is not connected for this organization";

    if (eligibleInvoices.length > 0) {
      await db
        .update(invoices)
        .set({
          qbSyncStatus: "failed",
          qbLastError: message,
          syncStatus: "error",
          syncError: message,
          updatedAt: new Date(),
        } as any)
        .where(and(eq(invoices.organizationId, organizationId), inArray(invoices.id, eligibleInvoices.map((r) => String(r.id)))));
      result.invoices.attempted += eligibleInvoices.length;
      result.invoices.failed += eligibleInvoices.length;
    }

    if (eligiblePayments.length > 0) {
      await db
        .update(payments)
        .set({
          syncStatus: "failed",
          syncError: message,
          updatedAt: new Date(),
        } as any)
        .where(and(eq(payments.organizationId, organizationId), inArray(payments.id, eligiblePayments.map((r) => String(r.id)))));
      result.payments.attempted += eligiblePayments.length;
      result.payments.failed += eligiblePayments.length;
    }

    if (log) {
      console.log(`[QB Queue] end org=${organizationId} not-connected invFailed=${result.invoices.failed} payFailed=${result.payments.failed}`);
    }

    return result;
  }

  // Invoices
  for (const row of eligibleInvoices) {
    const invoiceId = String(row.id);
    result.invoices.attempted += 1;

    try {
      const qb = await syncSingleInvoiceToQuickBooksForOrganization(organizationId, invoiceId);
      await db
        .update(invoices)
        .set({
          qbInvoiceId: qb.qbInvoiceId,
          externalAccountingId: qb.qbInvoiceId,
          qbSyncStatus: "synced",
          qbLastError: null,
          syncStatus: "synced",
          syncError: null,
          syncedAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .where(and(eq(invoices.organizationId, organizationId), eq(invoices.id, invoiceId)));

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: null,
          userName: "qb_queue_worker",
          actionType: "invoice_qb_sync_worker",
          entityType: "invoice",
          entityId: invoiceId,
          entityName: String(invoiceId),
          description: "QuickBooks invoice sync succeeded (worker)",
          newValues: { qbInvoiceId: qb.qbInvoiceId } as any,
          createdAt: new Date(),
        } as any);
      } catch {}

      result.invoices.succeeded += 1;
    } catch (e: any) {
      const msg = toOneLineHumanMessage(e?.message || e);
      await db
        .update(invoices)
        .set({
          qbSyncStatus: "failed",
          qbLastError: msg,
          syncStatus: "error",
          syncError: msg,
          updatedAt: new Date(),
        } as any)
        .where(and(eq(invoices.organizationId, organizationId), eq(invoices.id, invoiceId)));

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: null,
          userName: "qb_queue_worker",
          actionType: "invoice_qb_sync_failed",
          entityType: "invoice",
          entityId: invoiceId,
          entityName: String(invoiceId),
          description: "QuickBooks invoice sync failed (worker)",
          newValues: { error: msg } as any,
          createdAt: new Date(),
        } as any);
      } catch {}

      result.invoices.failed += 1;
    }
  }

  // Payments
  for (const row of eligiblePayments) {
    const paymentId = String(row.id);
    result.payments.attempted += 1;

    try {
      const qb = await syncSinglePaymentToQuickBooksForOrganization(organizationId, paymentId);
      await db
        .update(payments)
        .set({
          externalAccountingId: qb.qbPaymentId,
          syncStatus: "synced",
          syncError: null,
          syncedAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .where(and(eq(payments.organizationId, organizationId), eq(payments.id, paymentId)));

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: null,
          userName: "qb_queue_worker",
          actionType: "quickbooks.payment.sync.succeeded",
          entityType: "payment",
          entityId: paymentId,
          entityName: String(paymentId),
          description: "QuickBooks payment sync succeeded (worker)",
          newValues: { qbPaymentId: qb.qbPaymentId } as any,
          createdAt: new Date(),
        } as any);
      } catch {}

      result.payments.succeeded += 1;
    } catch (e: any) {
      const msg = toOneLineHumanMessage(e?.message || e);
      await db
        .update(payments)
        .set({
          syncStatus: "failed",
          syncError: msg,
          updatedAt: new Date(),
        } as any)
        .where(and(eq(payments.organizationId, organizationId), eq(payments.id, paymentId)));

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: null,
          userName: "qb_queue_worker",
          actionType: "quickbooks.payment.sync.failed",
          entityType: "payment",
          entityId: paymentId,
          entityName: String(paymentId),
          description: "QuickBooks payment sync failed (worker)",
          newValues: { error: msg } as any,
          createdAt: new Date(),
        } as any);
      } catch {}

      result.payments.failed += 1;
    }
  }

  if (log) {
    console.log(
      `[QB Queue] end org=${organizationId} inv=${result.invoices.succeeded}/${result.invoices.failed} pay=${result.payments.succeeded}/${result.payments.failed}`
    );
  }

  return result;
}

export async function listQuickBooksSyncQueueItemsForOrg(params: {
  organizationId: string;
  page: number;
  pageSize: number;
  search?: string;
}): Promise<{ items: QuickBooksSyncQueueItem[]; total: number; page: number; pageSize: number }> {
  const stabilityWindowMs = getQuickBooksSyncStabilityWindowMs();
  const cutoff = cutoffDate({ now: new Date(), stabilityWindowMs, ignoreStabilityWindow: false });
  const [invoiceRows, paymentRows] = await Promise.all([
    db.select({ id: invoices.id, displayNumber: invoices.displayNumber, invoiceNumber: invoices.invoiceNumber, status: invoices.status, syncStatus: invoices.qbSyncStatus, updatedAt: invoices.updatedAt, lastError: invoices.qbLastError })
      .from(invoices)
      .where(and(eq(invoices.organizationId, params.organizationId), inArray(invoices.qbSyncStatus, ['pending', 'failed'] as any))),
    db.select({ id: payments.id, invoiceDisplayNumber: invoices.displayNumber, invoiceNumber: invoices.invoiceNumber, status: payments.status, syncStatus: payments.syncStatus, updatedAt: payments.updatedAt, lastError: payments.syncError, qbInvoiceId: invoices.qbInvoiceId })
      .from(payments)
      .innerJoin(invoices, and(eq(payments.invoiceId, invoices.id), eq(payments.organizationId, invoices.organizationId)))
      .where(and(eq(payments.organizationId, params.organizationId), inArray(payments.syncStatus, ['pending', 'failed'] as any))),
  ]);

  const items: QuickBooksSyncQueueItem[] = [
    ...invoiceRows.map((row: any) => {
      const eligible = String(row.status || '').toLowerCase() !== 'draft' && new Date(row.updatedAt).getTime() <= cutoff.getTime();
      return { id: String(row.id), resourceType: 'invoice' as const, displayNumber: String(row.displayNumber || row.invoiceNumber), status: String(row.status), syncStatus: String(row.syncStatus), updatedAt: row.updatedAt, eligible, ineligibleReason: eligible ? null : String(row.status || '').toLowerCase() === 'draft' ? 'Draft invoices cannot sync.' : 'Waiting for the stability window.', lastError: row.lastError ?? null };
    }),
    ...paymentRows.map((row: any) => {
      const eligible = ['succeeded', 'captured'].includes(String(row.status || '').toLowerCase()) && Boolean(row.qbInvoiceId) && new Date(row.updatedAt).getTime() <= cutoff.getTime();
      return { id: String(row.id), resourceType: 'payment' as const, displayNumber: `Payment for ${String(row.invoiceDisplayNumber || row.invoiceNumber)}`, status: String(row.status), syncStatus: String(row.syncStatus), updatedAt: row.updatedAt, eligible, ineligibleReason: eligible ? null : !row.qbInvoiceId ? 'Invoice must sync first.' : 'Waiting for eligibility.', lastError: row.lastError ?? null };
    }),
  ];
  const needle = String(params.search || '').trim().toLowerCase();
  const filtered = items
    .filter((item) => !needle || `${item.displayNumber} ${item.resourceType} ${item.status} ${item.syncStatus}`.toLowerCase().includes(needle))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const page = Math.max(1, params.page);
  const pageSize = Math.max(1, Math.min(100, params.pageSize));
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
}

export async function runSelectedQuickBooksSyncForOrg(params: {
  organizationId: string;
  items: Array<{ id: string; resourceType: 'invoice' | 'payment' }>;
}): Promise<QuickBooksSelectedSyncResult> {
  const unique = Array.from(new Map(params.items.map((item) => [`${item.resourceType}:${item.id}`, item])).values());
  const result: QuickBooksSelectedSyncResult = { requested: unique.length, synced: 0, failed: 0, skipped: 0, rejected: 0, results: [] };
  if (unique.length === 0) return result;
  const cutoff = cutoffDate({ now: new Date(), stabilityWindowMs: getQuickBooksSyncStabilityWindowMs(), ignoreStabilityWindow: false });

  for (const item of unique) {
    if (item.resourceType === 'invoice') {
      const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, item.id), eq(invoices.organizationId, params.organizationId))).limit(1);
      if (!invoice) { result.rejected++; result.results.push({ ...item, outcome: 'rejected', reason: 'Record not found or not permitted.' }); continue; }
      if (!['pending', 'failed'].includes(String(invoice.qbSyncStatus))) { result.skipped++; result.results.push({ ...item, outcome: 'skipped', reason: 'Invoice is no longer pending sync.' }); continue; }
      if (String(invoice.status).toLowerCase() === 'draft' || new Date(invoice.updatedAt).getTime() > cutoff.getTime()) { result.skipped++; result.results.push({ ...item, outcome: 'skipped', reason: 'Invoice is not currently eligible.' }); continue; }
      try {
        const qb = await syncSingleInvoiceToQuickBooksForOrganization(params.organizationId, item.id);
        await db.update(invoices).set({ qbInvoiceId: qb.qbInvoiceId, externalAccountingId: qb.qbInvoiceId, qbSyncStatus: 'synced', qbLastError: null, syncStatus: 'synced', syncError: null, syncedAt: new Date(), updatedAt: new Date() } as any).where(and(eq(invoices.id, item.id), eq(invoices.organizationId, params.organizationId)));
        result.synced++; result.results.push({ ...item, outcome: 'synced', reason: null });
      } catch (error: any) {
        const reason = toOneLineHumanMessage(error?.message || error);
        await db.update(invoices).set({ qbSyncStatus: 'failed', qbLastError: reason, syncStatus: 'error', syncError: reason, updatedAt: new Date() } as any).where(and(eq(invoices.id, item.id), eq(invoices.organizationId, params.organizationId)));
        result.failed++; result.results.push({ ...item, outcome: 'failed', reason });
      }
      continue;
    }

    const [payment] = await db.select({ id: payments.id, status: payments.status, syncStatus: payments.syncStatus, updatedAt: payments.updatedAt, qbInvoiceId: invoices.qbInvoiceId }).from(payments).innerJoin(invoices, and(eq(payments.invoiceId, invoices.id), eq(payments.organizationId, invoices.organizationId))).where(and(eq(payments.id, item.id), eq(payments.organizationId, params.organizationId))).limit(1);
    if (!payment) { result.rejected++; result.results.push({ ...item, outcome: 'rejected', reason: 'Record not found or not permitted.' }); continue; }
    if (!['pending', 'failed'].includes(String(payment.syncStatus)) || !['succeeded', 'captured'].includes(String(payment.status).toLowerCase()) || !payment.qbInvoiceId || new Date(payment.updatedAt).getTime() > cutoff.getTime()) { result.skipped++; result.results.push({ ...item, outcome: 'skipped', reason: 'Payment is not currently eligible.' }); continue; }
    try {
      const qb = await syncSinglePaymentToQuickBooksForOrganization(params.organizationId, item.id);
      await db.update(payments).set({ externalAccountingId: qb.qbPaymentId, syncStatus: 'synced', syncError: null, syncedAt: new Date(), updatedAt: new Date() } as any).where(and(eq(payments.id, item.id), eq(payments.organizationId, params.organizationId)));
      result.synced++; result.results.push({ ...item, outcome: 'synced', reason: null });
    } catch (error: any) {
      const reason = toOneLineHumanMessage(error?.message || error);
      await db.update(payments).set({ syncStatus: 'failed', syncError: reason, updatedAt: new Date() } as any).where(and(eq(payments.id, item.id), eq(payments.organizationId, params.organizationId)));
      result.failed++; result.results.push({ ...item, outcome: 'failed', reason });
    }
  }
  return result;
}
