import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLogs, customers, invoices, oauthConnections, payments } from "../../shared/schema";
import {
  getValidAccessTokenForOrganization,
  isQuickBooksReauthRequiredForOrganization,
  syncSingleInvoiceToQuickBooksForOrganization,
  syncSinglePaymentToQuickBooksForOrganization,
} from "../quickbooksService";
import {
  INVOICE_UNSYNCED_STATUSES,
  matchesQueueView,
  PAYMENT_FAILED_STATUSES,
  paymentQueueState,
  PAYMENT_UNSYNCED_STATUSES,
  type QuickBooksSyncQueueState,
  type QuickBooksSyncQueueView,
  VALID_PAYMENT_STATUSES,
  invoiceQueueState,
} from "./quickbooksSyncQueueState";

export type QuickBooksSyncQueueCounts = {
  invoices: { unsynced: number; pending: number; failed: number; synced: number };
  payments: { unsynced: number; pending: number; failed: number; synced: number };
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
  queueState: QuickBooksSyncQueueState;
  updatedAt: Date;
  eligible: boolean;
  canTransmit: boolean;
  ineligibleReason: string | null;
  lastError: string | null;
};

export type { QuickBooksSyncQueueView } from "./quickbooksSyncQueueState";

export type QuickBooksSelectedSyncResult = {
  requested: number;
  synced: number;
  failed: number;
  skipped: number;
  rejected: number;
  results: Array<{ id: string; resourceType: 'invoice' | 'payment'; outcome: 'synced' | 'failed' | 'skipped' | 'rejected'; reason: string | null }>;
};

export type QuickBooksEnqueueSelectedResult = {
  requested: number;
  queued: number;
  skipped: number;
  rejected: number;
  results: Array<{ id: string; resourceType: 'invoice' | 'payment'; outcome: 'queued' | 'skipped' | 'rejected'; reason: string | null }>;
};

export const DEFAULT_QB_SYNC_STABILITY_WINDOW_MS = 30 * 60 * 1000;

const TERMINAL_INVOICE_STATUSES = ['void', 'canceled', 'cancelled'];

function isQuickBooksInvoiceExportableStatus(status: unknown): boolean {
  return !TERMINAL_INVOICE_STATUSES.includes(String(status ?? '').trim().toLowerCase());
}

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
  const invoiceUnsynced = and(
    inArray(invoices.qbSyncStatus, INVOICE_UNSYNCED_STATUSES as any),
    sql`lower(${invoices.status}) not in ('void', 'canceled', 'cancelled')`,
  );
  const paymentUnsynced = and(
    isNull(payments.externalAccountingId),
    inArray(payments.syncStatus, PAYMENT_UNSYNCED_STATUSES as any),
    sql`lower(${payments.status}) in ('succeeded', 'captured')`,
  );
  const paymentQueued = and(isNull(payments.externalAccountingId), eq(payments.syncStatus, 'pending'));
  const paymentFailed = and(isNull(payments.externalAccountingId), inArray(payments.syncStatus, PAYMENT_FAILED_STATUSES as any));
  const paymentSynced = or(isNotNull(payments.externalAccountingId), eq(payments.syncStatus, 'synced'));

  const [invoiceCounts] = await db
    .select({
      unsynced: sql<number>`coalesce(sum(case when ${invoiceUnsynced} then 1 else 0 end), 0)::int`,
      pending: sql<number>`coalesce(sum(case when ${eq(invoices.qbSyncStatus, 'pending')} then 1 else 0 end), 0)::int`,
      failed: sql<number>`coalesce(sum(case when ${eq(invoices.qbSyncStatus, 'failed')} then 1 else 0 end), 0)::int`,
      synced: sql<number>`coalesce(sum(case when ${eq(invoices.qbSyncStatus, 'synced')} then 1 else 0 end), 0)::int`,
      eligible: sql<number>`sum(case when ${invoices.qbSyncStatus} in ('pending','failed') and lower(${invoices.status}) not in ('void', 'canceled', 'cancelled') and ${invoices.updatedAt} <= ${cutoff} then 1 else 0 end)::int`,
    })
    .from(invoices)
    .where(and(
      eq(invoices.organizationId, organizationId),
      or(isNull(invoices.importSource), ne(invoices.importSource, 'quickbooks')),
      eq(invoices.isHistorical, false),
    ));

  const [paymentCounts] = await db
    .select({
      unsynced: sql<number>`coalesce(sum(case when ${paymentUnsynced} then 1 else 0 end), 0)::int`,
      pending: sql<number>`coalesce(sum(case when ${paymentQueued} then 1 else 0 end), 0)::int`,
      failed: sql<number>`coalesce(sum(case when ${paymentFailed} then 1 else 0 end), 0)::int`,
      synced: sql<number>`coalesce(sum(case when ${paymentSynced} then 1 else 0 end), 0)::int`,
      eligible: sql<number>`sum(case when ${payments.syncStatus} in ('pending','failed') and ${payments.updatedAt} <= ${cutoff} and lower(${payments.status}) in ('succeeded','captured') and coalesce(${invoices.qbInvoiceId}, '') <> '' then 1 else 0 end)::int`,
    })
    .from(payments)
    .innerJoin(invoices, and(eq(payments.invoiceId, invoices.id), eq(payments.organizationId, invoices.organizationId)))
    .where(and(
      eq(payments.organizationId, organizationId),
      or(isNull(invoices.importSource), ne(invoices.importSource, 'quickbooks')),
      eq(invoices.isHistorical, false),
    ));

  return {
    settleWindowMinutes,
    stabilityWindowMs,
    invoices: { unsynced: Number(invoiceCounts?.unsynced || 0), pending: Number(invoiceCounts?.pending || 0), failed: Number(invoiceCounts?.failed || 0), synced: Number(invoiceCounts?.synced || 0) },
    payments: { unsynced: Number(paymentCounts?.unsynced || 0), pending: Number(paymentCounts?.pending || 0), failed: Number(paymentCounts?.failed || 0), synced: Number(paymentCounts?.synced || 0) },
    nextEligibleCounts: { invoices: Number(invoiceCounts?.eligible || 0), payments: Number(paymentCounts?.eligible || 0) },
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
        sql`lower(${invoices.status}) not in ('void', 'canceled', 'cancelled')`,
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

    if (log) {
      console.log(`[QB Queue] deferred org=${organizationId} not-connected; retained local queue work`);
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
          lastQbSyncedVersion: sql`${invoices.invoiceVersion}`,
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
  view?: QuickBooksSyncQueueView;
}): Promise<{ items: QuickBooksSyncQueueItem[]; total: number; totalCount: number; totalPages: number; page: number; pageSize: number }> {
  const stabilityWindowMs = getQuickBooksSyncStabilityWindowMs();
  const cutoff = cutoffDate({ now: new Date(), stabilityWindowMs, ignoreStabilityWindow: false });
  const page = Math.max(1, params.page);
  const pageSize = Math.max(1, Math.min(100, params.pageSize));
  const view: QuickBooksSyncQueueView = ['unsynced', 'queued', 'failed', 'synced'].includes(String(params.view))
    ? params.view as QuickBooksSyncQueueView
    : 'all';
  const needle = String(params.search || '').trim();
  const searchPattern = `%${needle}%`;
  const fetchLimit = page * pageSize;
  const invoiceConditions = [
    eq(invoices.organizationId, params.organizationId),
    or(isNull(invoices.importSource), ne(invoices.importSource, 'quickbooks')),
    eq(invoices.isHistorical, false),
  ];
  const invoiceUnsynced = and(
    inArray(invoices.qbSyncStatus, INVOICE_UNSYNCED_STATUSES as any),
    sql`lower(${invoices.status}) not in ('void', 'canceled', 'cancelled')`,
  );
  const invoiceQueued = eq(invoices.qbSyncStatus, 'pending');
  const invoiceFailed = eq(invoices.qbSyncStatus, 'failed');
  const invoiceSynced = eq(invoices.qbSyncStatus, 'synced');
  if (view === 'unsynced') invoiceConditions.push(invoiceUnsynced);
  else if (view === 'queued') invoiceConditions.push(invoiceQueued);
  else if (view === 'failed') invoiceConditions.push(invoiceFailed);
  else if (view === 'synced') invoiceConditions.push(invoiceSynced);
  else invoiceConditions.push(or(invoiceUnsynced, invoiceQueued, invoiceFailed, invoiceSynced)!);
  if (needle) invoiceConditions.push(or(ilike(invoices.displayNumber, searchPattern), sql`cast(${invoices.invoiceNumber} as text) ilike ${searchPattern}`, ilike(invoices.jobNumber, searchPattern), ilike(customers.companyName, searchPattern))!);
  const paymentConditions = [
    eq(payments.organizationId, params.organizationId),
    or(isNull(invoices.importSource), ne(invoices.importSource, 'quickbooks')),
    eq(invoices.isHistorical, false),
  ];
  const paymentUnsynced = and(
    isNull(payments.externalAccountingId),
    inArray(payments.syncStatus, PAYMENT_UNSYNCED_STATUSES as any),
    sql`lower(${payments.status}) in ('succeeded', 'captured')`,
  );
  const paymentQueued = and(isNull(payments.externalAccountingId), eq(payments.syncStatus, 'pending'));
  const paymentFailed = and(isNull(payments.externalAccountingId), inArray(payments.syncStatus, PAYMENT_FAILED_STATUSES as any));
  const paymentSynced = or(isNotNull(payments.externalAccountingId), eq(payments.syncStatus, 'synced'));
  if (view === 'unsynced') paymentConditions.push(paymentUnsynced);
  else if (view === 'queued') paymentConditions.push(paymentQueued);
  else if (view === 'failed') paymentConditions.push(paymentFailed);
  else if (view === 'synced') paymentConditions.push(paymentSynced!);
  else paymentConditions.push(or(paymentUnsynced, paymentQueued, paymentFailed, paymentSynced)!);
  if (needle) paymentConditions.push(or(ilike(invoices.displayNumber, searchPattern), sql`cast(${invoices.invoiceNumber} as text) ilike ${searchPattern}`, ilike(payments.providerTransactionId, searchPattern), ilike(customers.companyName, searchPattern))!);

  // Each source query is bounded and searched in PostgreSQL. The small merged
  // page is then deterministically sorted across invoices and payments.
  const [invoiceRows, paymentRows, invoiceTotalRows, paymentTotalRows] = await Promise.all([
    db.select({ id: invoices.id, displayNumber: invoices.displayNumber, invoiceNumber: invoices.invoiceNumber, status: invoices.status, syncStatus: invoices.qbSyncStatus, updatedAt: invoices.updatedAt, lastError: invoices.qbLastError })
      .from(invoices).leftJoin(customers, and(eq(invoices.customerId, customers.id), eq(invoices.organizationId, customers.organizationId)))
      .where(and(...invoiceConditions)).orderBy(desc(invoices.updatedAt)).limit(fetchLimit),
    db.select({ id: payments.id, invoiceDisplayNumber: invoices.displayNumber, invoiceNumber: invoices.invoiceNumber, status: payments.status, syncStatus: payments.syncStatus, updatedAt: payments.updatedAt, lastError: payments.syncError, qbInvoiceId: invoices.qbInvoiceId, externalAccountingId: payments.externalAccountingId })
      .from(payments).innerJoin(invoices, and(eq(payments.invoiceId, invoices.id), eq(payments.organizationId, invoices.organizationId)))
      .leftJoin(customers, and(eq(invoices.customerId, customers.id), eq(invoices.organizationId, customers.organizationId)))
      .where(and(...paymentConditions)).orderBy(desc(payments.updatedAt)).limit(fetchLimit),
    db.select({ count: sql<number>`count(*)::int` }).from(invoices)
      .leftJoin(customers, and(eq(invoices.customerId, customers.id), eq(invoices.organizationId, customers.organizationId)))
      .where(and(...invoiceConditions)),
    db.select({ count: sql<number>`count(*)::int` }).from(payments)
      .innerJoin(invoices, and(eq(payments.invoiceId, invoices.id), eq(payments.organizationId, invoices.organizationId)))
      .leftJoin(customers, and(eq(invoices.customerId, customers.id), eq(invoices.organizationId, customers.organizationId)))
      .where(and(...paymentConditions)),
  ]);

  const items: QuickBooksSyncQueueItem[] = [
    ...invoiceRows.map((row: any) => {
      const queueState = invoiceQueueState(row.syncStatus);
      const eligible = isQuickBooksInvoiceExportableStatus(row.status) && queueState !== 'synced';
      const canTransmit = eligible && new Date(row.updatedAt).getTime() <= cutoff.getTime() && queueState !== 'unsynced';
      return { id: String(row.id), resourceType: 'invoice' as const, displayNumber: String(row.displayNumber || row.invoiceNumber), status: String(row.status), syncStatus: String(row.syncStatus), queueState, updatedAt: row.updatedAt, eligible, canTransmit, ineligibleReason: eligible ? (canTransmit || queueState === 'unsynced' ? null : 'Waiting for the stability window.') : 'Void or canceled invoices cannot sync.', lastError: row.lastError ?? null };
    }),
    ...paymentRows.map((row: any) => {
      const queueState = paymentQueueState(row.syncStatus, row.externalAccountingId);
      const validPayment = VALID_PAYMENT_STATUSES.includes(String(row.status || '').toLowerCase() as typeof VALID_PAYMENT_STATUSES[number]);
      const eligible = validPayment && queueState !== 'synced' && Boolean(row.qbInvoiceId);
      const canTransmit = eligible && new Date(row.updatedAt).getTime() <= cutoff.getTime() && queueState !== 'unsynced';
      return { id: String(row.id), resourceType: 'payment' as const, displayNumber: `Payment for ${String(row.invoiceDisplayNumber || row.invoiceNumber)}`, status: String(row.status), syncStatus: String(row.syncStatus), queueState, updatedAt: row.updatedAt, eligible, canTransmit, ineligibleReason: eligible ? (canTransmit || queueState === 'unsynced' ? null : 'Waiting for the stability window.') : !validPayment ? 'Only captured or succeeded payments can sync.' : !row.qbInvoiceId ? 'Invoice must sync first.' : 'Already synchronized.', lastError: row.lastError ?? null };
    }),
  ].filter((item) => matchesQueueView(item.queueState, view));
  const sorted = items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const totalCount = Number(invoiceTotalRows[0]?.count || 0) + Number(paymentTotalRows[0]?.count || 0);
  return {
    items: sorted.slice((page - 1) * pageSize, page * pageSize),
    total: totalCount,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
    page,
    pageSize,
  };
}

export async function runSelectedQuickBooksSyncForOrg(params: {
  organizationId: string;
  items: Array<{ id: string; resourceType: 'invoice' | 'payment' }>;
}): Promise<QuickBooksSelectedSyncResult> {
  const unique = Array.from(new Map(params.items.map((item) => [`${item.resourceType}:${item.id}`, item])).values());
  const result: QuickBooksSelectedSyncResult = { requested: unique.length, synced: 0, failed: 0, skipped: 0, rejected: 0, results: [] };
  if (unique.length === 0) return result;
  const reauth = await isQuickBooksReauthRequiredForOrganization(params.organizationId);
  if (reauth.needsReauth) {
    for (const item of unique) result.results.push({ ...item, outcome: 'skipped', reason: 'QuickBooks authorization requires reconnection. The local queue item was retained.' });
    result.skipped = unique.length;
    return result;
  }
  const token = await getValidAccessTokenForOrganization(params.organizationId);
  if (!token) {
    for (const item of unique) result.results.push({ ...item, outcome: 'skipped', reason: 'QuickBooks is not connected. The local queue item was retained.' });
    result.skipped = unique.length;
    return result;
  }
  const cutoff = cutoffDate({ now: new Date(), stabilityWindowMs: getQuickBooksSyncStabilityWindowMs(), ignoreStabilityWindow: false });

  for (const item of unique) {
    if (item.resourceType === 'invoice') {
      const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, item.id), eq(invoices.organizationId, params.organizationId))).limit(1);
      if (!invoice) { result.rejected++; result.results.push({ ...item, outcome: 'rejected', reason: 'Record not found or not permitted.' }); continue; }
      if (!['pending', 'failed'].includes(String(invoice.qbSyncStatus))) { result.skipped++; result.results.push({ ...item, outcome: 'skipped', reason: 'Invoice is no longer pending sync.' }); continue; }
      if (!isQuickBooksInvoiceExportableStatus(invoice.status) || new Date(invoice.updatedAt).getTime() > cutoff.getTime()) { result.skipped++; result.results.push({ ...item, outcome: 'skipped', reason: 'Invoice is not currently eligible.' }); continue; }
      try {
        const qb = await syncSingleInvoiceToQuickBooksForOrganization(params.organizationId, item.id);
        await db.update(invoices).set({ qbInvoiceId: qb.qbInvoiceId, externalAccountingId: qb.qbInvoiceId, qbSyncStatus: 'synced', qbLastError: null, syncStatus: 'synced', syncError: null, syncedAt: new Date(), lastQbSyncedVersion: sql`${invoices.invoiceVersion}`, updatedAt: new Date() } as any).where(and(eq(invoices.id, item.id), eq(invoices.organizationId, params.organizationId)));
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

/**
 * Convert locally discoverable accounting work into the derived outbox. This
 * deliberately makes no Intuit call, so operators can repair/backfill their
 * queue even while QuickBooks authorization is disconnected or needs reauth.
 */
export async function enqueueSelectedQuickBooksSyncForOrg(params: {
  organizationId: string;
  items: Array<{ id: string; resourceType: 'invoice' | 'payment' }>;
}): Promise<QuickBooksEnqueueSelectedResult> {
  const unique = Array.from(new Map(params.items.map((item) => [`${item.resourceType}:${item.id}`, item])).values());
  const result: QuickBooksEnqueueSelectedResult = { requested: unique.length, queued: 0, skipped: 0, rejected: 0, results: [] };

  for (const item of unique) {
    if (item.resourceType === 'invoice') {
      const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, item.id), eq(invoices.organizationId, params.organizationId))).limit(1);
      if (!invoice) { result.rejected++; result.results.push({ ...item, outcome: 'rejected', reason: 'Record not found or not permitted.' }); continue; }
      if (String(invoice.importSource || '').toLowerCase() === 'quickbooks' || invoice.isHistorical) { result.skipped++; result.results.push({ ...item, outcome: 'skipped', reason: 'QuickBooks-imported invoices are not exported back to QuickBooks.' }); continue; }
      if (!isQuickBooksInvoiceExportableStatus(invoice.status)) { result.skipped++; result.results.push({ ...item, outcome: 'skipped', reason: 'Void or canceled invoices cannot sync.' }); continue; }
      const state = invoiceQueueState(invoice.qbSyncStatus);
      if (state === 'synced') { result.skipped++; result.results.push({ ...item, outcome: 'skipped', reason: 'Invoice is already synchronized.' }); continue; }
      await db.update(invoices).set({ qbSyncStatus: 'pending', qbLastError: null, syncStatus: 'pending', syncError: null, updatedAt: new Date() } as any).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, params.organizationId)));
      result.queued++; result.results.push({ ...item, outcome: 'queued', reason: null });
      continue;
    }

    const [payment] = await db.select({ id: payments.id, status: payments.status, syncStatus: payments.syncStatus, externalAccountingId: payments.externalAccountingId, qbInvoiceId: invoices.qbInvoiceId, importSource: invoices.importSource, isHistorical: invoices.isHistorical }).from(payments).innerJoin(invoices, and(eq(payments.invoiceId, invoices.id), eq(payments.organizationId, invoices.organizationId))).where(and(eq(payments.id, item.id), eq(payments.organizationId, params.organizationId))).limit(1);
    if (!payment) { result.rejected++; result.results.push({ ...item, outcome: 'rejected', reason: 'Record not found or not permitted.' }); continue; }
    if (String(payment.importSource || '').toLowerCase() === 'quickbooks' || payment.isHistorical) { result.skipped++; result.results.push({ ...item, outcome: 'skipped', reason: 'Payments on imported QuickBooks invoices are not exported back.' }); continue; }
    if (!['succeeded', 'captured'].includes(String(payment.status).toLowerCase())) { result.skipped++; result.results.push({ ...item, outcome: 'skipped', reason: 'Only captured or succeeded payments can sync.' }); continue; }
    if (!payment.qbInvoiceId) { result.skipped++; result.results.push({ ...item, outcome: 'skipped', reason: 'Invoice must synchronize before its payment can queue.' }); continue; }
    if (String(payment.externalAccountingId || '').trim()) { result.skipped++; result.results.push({ ...item, outcome: 'skipped', reason: 'Payment is already synchronized.' }); continue; }
    await db.update(payments).set({ syncStatus: 'pending', syncError: null, updatedAt: new Date() } as any).where(and(eq(payments.id, payment.id), eq(payments.organizationId, params.organizationId)));
    result.queued++; result.results.push({ ...item, outcome: 'queued', reason: null });
  }

  return result;
}
