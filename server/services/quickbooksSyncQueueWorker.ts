import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
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
  PAYMENT_FAILED_STATUSES,
  PAYMENT_UNSYNCED_STATUSES,
  type QuickBooksSyncQueueState,
  type QuickBooksSyncQueueView,
  invoiceQueueState,
} from "./quickbooksSyncQueueState";
import {
  getQuickBooksSyncQueueTotalPages,
  normalizeQuickBooksSyncQueueListFilters,
  type QuickBooksSyncQueueEligibilityFilter,
  type QuickBooksSyncQueueListFilters,
  type QuickBooksSyncQueueSort,
} from './quickbooksSyncQueueList';

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
  customerName: string | null;
  amountCents: number;
  status: string;
  syncStatus: string;
  queueState: QuickBooksSyncQueueState;
  updatedAt: Date;
  eligible: boolean;
  canTransmit: boolean;
  eligibility: QuickBooksSyncQueueEligibilityFilter;
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
  filters?: QuickBooksSyncQueueListFilters;
}): Promise<{ items: QuickBooksSyncQueueItem[]; total: number; totalCount: number; totalPages: number; page: number; pageSize: number }> {
  const stabilityWindowMs = getQuickBooksSyncStabilityWindowMs();
  const cutoff = cutoffDate({ now: new Date(), stabilityWindowMs, ignoreStabilityWindow: false });
  const requestedPage = Number(params.page);
  const requestedPageSize = Number(params.pageSize);
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
  const pageSize = Number.isFinite(requestedPageSize) ? Math.max(1, Math.min(100, Math.floor(requestedPageSize))) : 25;
  const view: QuickBooksSyncQueueView = ['unsynced', 'queued', 'failed', 'synced'].includes(String(params.view))
    ? params.view as QuickBooksSyncQueueView
    : 'all';
  const filters = normalizeQuickBooksSyncQueueListFilters(params.filters ?? {});
  const needle = String(params.search || '').trim();
  const searchPattern = `%${needle}%`;
  const effectiveState = filters.state === 'all' ? view : filters.state;
  const conditions = [sql`true`];
  if (effectiveState !== 'all') conditions.push(sql`queue_state = ${effectiveState}`);
  if (filters.type !== 'all') conditions.push(sql`resource_type = ${filters.type}`);
  if (filters.eligibility !== 'all') conditions.push(sql`eligibility_key = ${filters.eligibility}`);
  if (filters.error === 'has_error') conditions.push(sql`last_error is not null and btrim(last_error) <> ''`);
  if (filters.error === 'no_error') conditions.push(sql`(last_error is null or btrim(last_error) = '')`);
  if (needle) conditions.push(sql`(
    display_number ilike ${searchPattern}
    or customer_name ilike ${searchPattern}
    or coalesce(reference, '') ilike ${searchPattern}
  )`);
  const where = sql.join(conditions, sql` and `);
  const sortColumns: Record<QuickBooksSyncQueueSort, string> = {
    record: 'lower(display_number)',
    customer: "lower(coalesce(customer_name, ''))",
    type: 'resource_type',
    state: 'queue_state',
    eligibility: 'eligibility_key',
    amount: 'amount_cents',
    updatedAt: 'updated_at',
    createdAt: 'created_at',
  };
  const sortColumn = sql.raw(sortColumns[filters.sortBy]);
  const sortDirection = sql.raw(filters.sortDir);
  const offset = (page - 1) * pageSize;

  const accountingWorkCte = sql`
    with source_work as (
      select
        i.id::text as id,
        'invoice'::text as resource_type,
        coalesce(i.display_number, i.invoice_number::text) as display_number,
        coalesce(c.company_name, '')::text as customer_name,
        coalesce(i.total_cents, round(coalesce(i.total, 0)::numeric * 100)::int)::int as amount_cents,
        i.status::text as status,
        i.qb_sync_status::text as sync_status,
        case
          when i.qb_sync_status = 'pending' then 'queued'
          when i.qb_sync_status = 'failed' then 'failed'
          when i.qb_sync_status = 'synced' then 'synced'
          else 'unsynced'
        end::text as queue_state,
        i.updated_at as updated_at,
        i.created_at as created_at,
        i.qb_last_error::text as last_error,
        coalesce(i.job_number::text, i.invoice_number::text, '')::text as reference,
        (lower(i.status) not in ('void', 'canceled', 'cancelled') and i.qb_sync_status <> 'synced') as eligible,
        (lower(i.status) not in ('void', 'canceled', 'cancelled') and i.qb_sync_status in ('pending', 'failed') and i.updated_at <= ${cutoff}) as can_transmit,
        null::text as ineligible_reason
      from invoices i
      left join customers c on c.id = i.customer_id and c.organization_id = i.organization_id
      where i.organization_id = ${params.organizationId}
        and (i.import_source is null or i.import_source <> 'quickbooks')
        and i.is_historical = false
        and (
          (
            i.qb_sync_status in ('not_synced', 'needs_resync')
            and lower(i.status) not in ('void', 'canceled', 'cancelled')
          )
          or i.qb_sync_status in ('pending', 'failed', 'synced')
        )

      union all

      select
        p.id::text as id,
        'payment'::text as resource_type,
        ('Payment for ' || coalesce(i.display_number, i.invoice_number::text))::text as display_number,
        coalesce(c.company_name, '')::text as customer_name,
        coalesce(p.amount_cents, round(coalesce(p.amount, 0)::numeric * 100)::int)::int as amount_cents,
        p.status::text as status,
        p.sync_status::text as sync_status,
        case
          when p.external_accounting_id is not null or p.sync_status = 'synced' then 'synced'
          when p.sync_status = 'pending' then 'queued'
          when p.sync_status in ('failed', 'error') then 'failed'
          else 'unsynced'
        end::text as queue_state,
        p.updated_at as updated_at,
        p.created_at as created_at,
        p.sync_error::text as last_error,
        coalesce(p.provider_transaction_id, i.display_number, i.invoice_number::text, '')::text as reference,
        (lower(p.status) in ('succeeded', 'captured')
          and p.external_accounting_id is null
          and p.sync_status <> 'synced'
          and coalesce(i.qb_invoice_id, '') <> '') as eligible,
        (lower(p.status) in ('succeeded', 'captured')
          and p.external_accounting_id is null
          and p.sync_status in ('pending', 'failed')
          and coalesce(i.qb_invoice_id, '') <> ''
          and p.updated_at <= ${cutoff}) as can_transmit,
        case
          when lower(p.status) not in ('succeeded', 'captured') then 'Only captured or succeeded payments can sync.'
          when coalesce(i.qb_invoice_id, '') = '' then 'Invoice must sync first.'
          when p.external_accounting_id is not null or p.sync_status = 'synced' then 'Already synchronized.'
          else null
        end::text as ineligible_reason
      from payments p
      inner join invoices i on i.id = p.invoice_id and i.organization_id = p.organization_id
      left join customers c on c.id = i.customer_id and c.organization_id = i.organization_id
      where p.organization_id = ${params.organizationId}
        and (i.import_source is null or i.import_source <> 'quickbooks')
        and i.is_historical = false
        and (
          p.external_accounting_id is not null
          or p.sync_status in ('synced', 'pending', 'failed', 'error')
          or (
            p.sync_status in ('not_synced', 'skipped')
            and lower(p.status) in ('succeeded', 'captured')
          )
        )
    ), accounting_work as (
      select *, case
        when queue_state = 'unsynced' and eligible then 'queueable'
        when can_transmit then 'syncable'
        else 'blocked'
      end::text as eligibility_key
      from source_work
    )`;

  const [rowResult, countResult] = await Promise.all([
    db.execute(sql`${accountingWorkCte}
      select id, resource_type, display_number, customer_name, amount_cents, status, sync_status,
        queue_state, updated_at, created_at, eligible, can_transmit, eligibility_key, last_error,
        case
          when eligible and (can_transmit or queue_state = 'unsynced') then null
          when ineligible_reason is not null then ineligible_reason
          when eligible then 'Waiting for the stability window.'
          else 'Void, canceled, or synchronized records cannot sync.'
        end as ineligible_reason
      from accounting_work where ${where}
      order by ${sortColumn} ${sortDirection}, updated_at desc, resource_type asc, id asc
      limit ${pageSize} offset ${offset}`),
    db.execute(sql`${accountingWorkCte}
      select count(*)::int as count from accounting_work where ${where}`),
  ]);
  const rows = ((rowResult as any).rows ?? rowResult) as any[];
  const countRows = ((countResult as any).rows ?? countResult) as Array<{ count: number }>;
  const totalCount = Number(countRows[0]?.count || 0);
  const items: QuickBooksSyncQueueItem[] = rows.map((row) => ({
    id: String(row.id),
    resourceType: row.resource_type as 'invoice' | 'payment',
    displayNumber: String(row.display_number),
    customerName: String(row.customer_name || '') || null,
    amountCents: Number(row.amount_cents || 0),
    status: String(row.status),
    syncStatus: String(row.sync_status),
    queueState: row.queue_state as QuickBooksSyncQueueState,
    updatedAt: new Date(row.updated_at),
    eligible: Boolean(row.eligible),
    canTransmit: Boolean(row.can_transmit),
    eligibility: row.eligibility_key as QuickBooksSyncQueueEligibilityFilter,
    ineligibleReason: row.ineligible_reason == null ? null : String(row.ineligible_reason),
    lastError: row.last_error == null ? null : String(row.last_error),
  }));
  return {
    items,
    total: totalCount,
    totalCount,
    totalPages: getQuickBooksSyncQueueTotalPages(totalCount, pageSize),
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
