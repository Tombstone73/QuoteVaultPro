/**
 * invoiceReminderService.ts
 *
 * Manages invoice reminder settings, eligibility logic, repository functions,
 * and the read-only preview.
 *
 * SAFETY CONTRACT:
 * - No emails are sent from this file.
 * - No cron jobs are registered here.
 * - getInvoiceReminderPreviewForOrg is read-only — zero DB mutations.
 * - All functions that modify data are clearly named with "upsert" / "create".
 * - Reminder eligibility counts ONLY status = 'sent' logs (not failed attempts).
 *
 * TODO: Future customer credit limit module should be separate from invoice
 * reminders and should evaluate customer balance, unpaid invoices, order
 * approvals, and override permissions.
 */

import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from './db';
import {
  customers,
  invoiceReminderLogs,
  invoiceReminderSettings,
  invoices,
  type InsertInvoiceReminderLog,
  type InvoiceReminderLog,
  type InvoiceReminderSettings,
  type UpdateInvoiceReminderSettings,
} from '../shared/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReminderEligibilityStatus =
  | 'eligible'
  | 'settings_disabled'
  | 'not_billed'
  | 'not_overdue'
  | 'no_due_date'
  | 'paid'
  | 'void'
  | 'max_reminders_reached'
  | 'too_soon';

export interface InvoiceReminderEligibility {
  invoiceId: string;
  invoiceNumber: number;
  customerName: string;
  recipientEmail: string | null;
  dueDate: Date | null;
  daysOverdue: number | null;
  balanceDueCents: number;
  /** Only counts status = 'sent' logs — failed attempts are excluded. */
  remindersSentCount: number;
  lastReminderSentAt: Date | null;
  nextReminderDueAt: Date | null;
  status: ReminderEligibilityStatus;
}

export interface ReminderPreviewResult {
  settings: InvoiceReminderSettings | null;
  eligible: InvoiceReminderEligibility[];
  blocked: InvoiceReminderEligibility[];
}

/** Invoice row enriched with customer info for job processing. */
export interface CandidateInvoice {
  id: string;
  invoiceNumber: number;
  status: string;
  dueDate: Date | null;
  totalCents: number;
  balanceDueCents: number;
  balanceDue: string | null;
  customerId: string;
  customerName: string;
  recipientEmail: string | null;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export async function getInvoiceReminderSettingsForOrg(
  organizationId: string,
): Promise<InvoiceReminderSettings | null> {
  const rows = await db
    .select()
    .from(invoiceReminderSettings)
    .where(eq(invoiceReminderSettings.organizationId, organizationId))
    .limit(1);

  return rows[0] ?? null;
}

export async function upsertInvoiceReminderSettingsForOrg(
  organizationId: string,
  patch: UpdateInvoiceReminderSettings,
): Promise<InvoiceReminderSettings> {
  const now = new Date();

  const rows = await db
    .insert(invoiceReminderSettings)
    .values({
      organizationId,
      enabled: patch.enabled ?? false,
      firstReminderDaysAfterDue: patch.firstReminderDaysAfterDue ?? null,
      repeatIntervalDays: patch.repeatIntervalDays ?? null,
      maxReminders: patch.maxReminders ?? null,
      sendCopyToInternalEmail: patch.sendCopyToInternalEmail ?? false,
      internalCopyEmail: patch.internalCopyEmail ?? null,
      pauseForManualBillingCustomers: patch.pauseForManualBillingCustomers ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: invoiceReminderSettings.organizationId,
      set: {
        enabled: patch.enabled ?? false,
        firstReminderDaysAfterDue: patch.firstReminderDaysAfterDue ?? null,
        repeatIntervalDays: patch.repeatIntervalDays ?? null,
        maxReminders: patch.maxReminders ?? null,
        sendCopyToInternalEmail: patch.sendCopyToInternalEmail ?? false,
        internalCopyEmail: patch.internalCopyEmail ?? null,
        pauseForManualBillingCustomers: patch.pauseForManualBillingCustomers ?? false,
        updatedAt: now,
      },
    })
    .returning();

  return rows[0];
}

// ---------------------------------------------------------------------------
// Repository functions (all DB access for the job layer)
// ---------------------------------------------------------------------------

/**
 * Returns only status = 'sent' logs for an invoice.
 * Failed attempts are excluded — they do not count toward repeat intervals or max caps.
 */
export async function getSuccessfulReminderLogsForInvoice(
  invoiceId: string,
  organizationId: string,
): Promise<InvoiceReminderLog[]> {
  return db
    .select()
    .from(invoiceReminderLogs)
    .where(
      and(
        eq(invoiceReminderLogs.invoiceId, invoiceId),
        eq(invoiceReminderLogs.organizationId, organizationId),
        eq(invoiceReminderLogs.status, 'sent'),
      ),
    )
    .orderBy(asc(invoiceReminderLogs.sentAt));
}

/**
 * Returns the most recent successful reminder for an invoice.
 */
export async function getLastSuccessfulReminderForInvoice(
  invoiceId: string,
  organizationId: string,
): Promise<InvoiceReminderLog | null> {
  const rows = await db
    .select()
    .from(invoiceReminderLogs)
    .where(
      and(
        eq(invoiceReminderLogs.invoiceId, invoiceId),
        eq(invoiceReminderLogs.organizationId, organizationId),
        eq(invoiceReminderLogs.status, 'sent'),
      ),
    )
    .orderBy(desc(invoiceReminderLogs.sentAt))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Count of successfully sent reminders for an invoice (excludes failed attempts).
 */
export async function getReminderCountForInvoice(
  invoiceId: string,
  organizationId: string,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invoiceReminderLogs)
    .where(
      and(
        eq(invoiceReminderLogs.invoiceId, invoiceId),
        eq(invoiceReminderLogs.organizationId, organizationId),
        eq(invoiceReminderLogs.status, 'sent'),
      ),
    );

  return rows[0]?.count ?? 0;
}

/**
 * Write a single reminder log entry (sent or failed).
 * Both outcomes are recorded for audit purposes.
 */
export async function createInvoiceReminderLog(
  input: InsertInvoiceReminderLog,
): Promise<InvoiceReminderLog> {
  const rows = await db
    .insert(invoiceReminderLogs)
    .values(input)
    .returning();

  return rows[0];
}

/**
 * Fetch all candidate invoices for a reminder run for one org.
 *
 * Returns billed invoices with a balance > 0 and a due date.
 * Joins customer for email and name.
 * Excludes void and draft.
 */
export async function getCandidateInvoicesForReminderRun(
  organizationId: string,
): Promise<CandidateInvoice[]> {
  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      dueDate: invoices.dueDate,
      totalCents: invoices.totalCents,
      balanceDueCents: sql<number>`ROUND(${invoices.balanceDue}::numeric * 100)::int`.as('balance_due_cents'),
      balanceDue: invoices.balanceDue,
      customerId: invoices.customerId,
      customerName: customers.companyName,
      recipientEmail: customers.email,
    })
    .from(invoices)
    .innerJoin(customers, and(
      eq(customers.id, invoices.customerId),
      eq(customers.organizationId, organizationId),
    ))
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        sql`${invoices.status} NOT IN ('draft', 'void')`,
        isNotNull(invoices.dueDate),
        sql`${invoices.balanceDue}::numeric > 0`,
      ),
    );

  return rows.map((r) => ({
    ...r,
    dueDate: r.dueDate ? new Date(r.dueDate) : null,
    balanceDueCents: Number(r.balanceDueCents),
  }));
}

/**
 * Fetch all enabled reminder settings across all organizations.
 * Used by the job to determine which orgs to process.
 */
export async function getAllEnabledReminderSettings(): Promise<InvoiceReminderSettings[]> {
  return db
    .select()
    .from(invoiceReminderSettings)
    .where(eq(invoiceReminderSettings.enabled, true));
}

// ---------------------------------------------------------------------------
// Eligibility logic (pure, injectable `now` for tests)
//
// IMPORTANT: reminderLogs passed here must be SUCCESSFUL logs only
// (status = 'sent'). Failed attempts must NOT be passed in.
// ---------------------------------------------------------------------------

export interface EligibilityInput {
  invoice: {
    id: string;
    invoiceNumber: number;
    customerName: string;
    recipientEmail?: string | null;
    status: string;
    dueDate: Date | string | null;
    totalCents: number;
    balanceDueCents?: number;
    balanceDue?: string | null;
  };
  /** Only status = 'sent' logs — callers must filter before passing. */
  reminderLogs: Array<{ sentAt: Date | string; reminderNumber: number }>;
  settings: InvoiceReminderSettings;
  now: Date;
}

export function computeInvoiceReminderEligibility(
  input: EligibilityInput,
): InvoiceReminderEligibility {
  const { invoice, reminderLogs, settings, now } = input;

  const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
  const balanceDueCents =
    invoice.balanceDueCents != null
      ? invoice.balanceDueCents
      : invoice.balanceDue != null
      ? Math.round(parseFloat(invoice.balanceDue) * 100)
      : 0;

  const remindersSentCount = reminderLogs.length;
  const lastLog =
    reminderLogs.length > 0
      ? reminderLogs.reduce((a, b) =>
          new Date(a.sentAt) > new Date(b.sentAt) ? a : b,
        )
      : null;
  const lastReminderSentAt = lastLog ? new Date(lastLog.sentAt) : null;

  let daysOverdue: number | null = null;
  if (dueDate) {
    const msOverdue = now.getTime() - dueDate.getTime();
    daysOverdue = Math.floor(msOverdue / (1000 * 60 * 60 * 24));
  }

  // Compute nextReminderDueAt based on settings
  let nextReminderDueAt: Date | null = null;
  if (dueDate && settings.firstReminderDaysAfterDue != null) {
    if (lastReminderSentAt == null) {
      nextReminderDueAt = new Date(
        dueDate.getTime() + settings.firstReminderDaysAfterDue * 24 * 60 * 60 * 1000,
      );
    } else if (settings.repeatIntervalDays != null && settings.repeatIntervalDays > 0) {
      nextReminderDueAt = new Date(
        lastReminderSentAt.getTime() + settings.repeatIntervalDays * 24 * 60 * 60 * 1000,
      );
    }
  }

  const base: Omit<InvoiceReminderEligibility, 'status'> = {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customerName,
    recipientEmail: invoice.recipientEmail ?? null,
    dueDate,
    daysOverdue,
    balanceDueCents,
    remindersSentCount,
    lastReminderSentAt,
    nextReminderDueAt,
  };

  // --- Eligibility checks (order matters: most definitive first) ---

  if (!settings.enabled) {
    return { ...base, status: 'settings_disabled' };
  }

  if (invoice.status === 'void') {
    return { ...base, status: 'void' };
  }

  if (invoice.status !== 'billed') {
    return { ...base, status: 'not_billed' };
  }

  if (balanceDueCents <= 0) {
    return { ...base, status: 'paid' };
  }

  if (!dueDate) {
    return { ...base, status: 'no_due_date' };
  }

  if (daysOverdue == null || daysOverdue < 0) {
    return { ...base, status: 'not_overdue' };
  }

  const firstThresholdDays = settings.firstReminderDaysAfterDue ?? 1;
  if (daysOverdue < firstThresholdDays) {
    return { ...base, status: 'not_overdue' };
  }

  if (settings.maxReminders != null && remindersSentCount >= settings.maxReminders) {
    return { ...base, status: 'max_reminders_reached' };
  }

  if (lastReminderSentAt != null) {
    const repeatDays = settings.repeatIntervalDays ?? 0;
    if (repeatDays <= 0) {
      return { ...base, status: 'max_reminders_reached' };
    }
    const msSinceLast = now.getTime() - lastReminderSentAt.getTime();
    const daysSinceLast = msSinceLast / (1000 * 60 * 60 * 24);
    if (daysSinceLast < repeatDays) {
      return { ...base, status: 'too_soon' };
    }
  }

  return { ...base, status: 'eligible' };
}

// ---------------------------------------------------------------------------
// Preview (READ-ONLY — no mutations, no email sends)
//
// Uses only successful logs for eligibility to match job execution behavior.
// ---------------------------------------------------------------------------

export async function getInvoiceReminderPreviewForOrg(
  organizationId: string,
  now: Date = new Date(),
): Promise<ReminderPreviewResult> {
  const settings = await getInvoiceReminderSettingsForOrg(organizationId);

  const candidateRows = await getCandidateInvoicesForReminderRun(organizationId);

  if (candidateRows.length === 0) {
    return { settings, eligible: [], blocked: [] };
  }

  const invoiceIds = candidateRows.map((r) => r.id);

  // Only fetch successful logs — failed attempts don't count for eligibility
  const logRows = await db
    .select({
      invoiceId: invoiceReminderLogs.invoiceId,
      reminderNumber: invoiceReminderLogs.reminderNumber,
      sentAt: invoiceReminderLogs.sentAt,
    })
    .from(invoiceReminderLogs)
    .where(
      and(
        eq(invoiceReminderLogs.organizationId, organizationId),
        inArray(invoiceReminderLogs.invoiceId, invoiceIds),
        eq(invoiceReminderLogs.status, 'sent'),
      ),
    );

  const logsByInvoice = new Map<string, typeof logRows>();
  for (const row of logRows) {
    if (!logsByInvoice.has(row.invoiceId)) logsByInvoice.set(row.invoiceId, []);
    logsByInvoice.get(row.invoiceId)!.push(row);
  }

  const defaultSettings: InvoiceReminderSettings = settings ?? {
    id: '',
    organizationId,
    enabled: false,
    firstReminderDaysAfterDue: null,
    repeatIntervalDays: null,
    maxReminders: null,
    sendCopyToInternalEmail: false,
    internalCopyEmail: null,
    pauseForManualBillingCustomers: false,
    createdAt: now,
    updatedAt: now,
  };

  const eligible: InvoiceReminderEligibility[] = [];
  const blocked: InvoiceReminderEligibility[] = [];

  for (const row of candidateRows) {
    const successfulLogs = logsByInvoice.get(row.id) ?? [];
    const result = computeInvoiceReminderEligibility({
      invoice: {
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        customerName: row.customerName,
        recipientEmail: row.recipientEmail,
        status: row.status,
        dueDate: row.dueDate,
        totalCents: row.totalCents,
        balanceDueCents: row.balanceDueCents,
        balanceDue: row.balanceDue,
      },
      reminderLogs: successfulLogs,
      settings: defaultSettings,
      now,
    });

    if (result.status === 'eligible') {
      eligible.push(result);
    } else {
      blocked.push(result);
    }
  }

  return { settings, eligible, blocked };
}
