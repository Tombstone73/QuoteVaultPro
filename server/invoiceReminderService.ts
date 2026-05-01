/**
 * invoiceReminderService.ts
 *
 * Manages invoice reminder settings and eligibility preview.
 *
 * SAFETY CONTRACT:
 * - No emails are sent from this file.
 * - No cron jobs are registered here.
 * - getInvoiceReminderPreviewForOrg is read-only — zero DB mutations.
 * - All functions that modify data are clearly named with "upsert" / "save".
 */

import { and, desc, eq, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { db } from './db';
import {
  invoiceReminderLogs,
  invoiceReminderSettings,
  invoices,
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
  dueDate: Date | null;
  daysOverdue: number | null;
  balanceDueCents: number;
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
// Eligibility logic (pure, injectable `now` for tests)
// ---------------------------------------------------------------------------

interface EligibilityInput {
  invoice: {
    id: string;
    invoiceNumber: number;
    customerName: string;
    status: string;
    dueDate: Date | string | null;
    totalCents: number;
    balanceDueCents?: number;
    // balanceDue decimal as string from postgres
    balanceDue?: string | null;
  };
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
      // First reminder: dueDate + firstReminderDaysAfterDue
      nextReminderDueAt = new Date(
        dueDate.getTime() + settings.firstReminderDaysAfterDue * 24 * 60 * 60 * 1000,
      );
    } else if (settings.repeatIntervalDays != null && settings.repeatIntervalDays > 0) {
      // Subsequent: lastSentAt + repeatIntervalDays
      nextReminderDueAt = new Date(
        lastReminderSentAt.getTime() + settings.repeatIntervalDays * 24 * 60 * 60 * 1000,
      );
    }
  }

  const base: Omit<InvoiceReminderEligibility, 'status'> = {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customerName,
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
    // draft or unknown — not yet sent to customer
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

  // First reminder threshold
  const firstThresholdDays = settings.firstReminderDaysAfterDue ?? 1;
  if (daysOverdue < firstThresholdDays) {
    return { ...base, status: 'not_overdue' };
  }

  // Max reminders cap
  if (settings.maxReminders != null && remindersSentCount >= settings.maxReminders) {
    return { ...base, status: 'max_reminders_reached' };
  }

  // Repeat interval: if a reminder was already sent, check cooldown
  if (lastReminderSentAt != null) {
    const repeatDays = settings.repeatIntervalDays ?? 0;
    if (repeatDays <= 0) {
      // No repeat — only one reminder ever
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
// ---------------------------------------------------------------------------

export async function getInvoiceReminderPreviewForOrg(
  organizationId: string,
  now: Date = new Date(),
): Promise<ReminderPreviewResult> {
  const settings = await getInvoiceReminderSettingsForOrg(organizationId);

  // Fetch all billed/overdue candidate invoices for this org.
  // We fetch all non-void, non-draft invoices with a balance due > 0 and a due date.
  const candidateRows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      dueDate: invoices.dueDate,
      totalCents: invoices.totalCents,
      balanceDueCents: sql<number>`ROUND(${invoices.balanceDue}::numeric * 100)`.as('balance_due_cents'),
      balanceDue: invoices.balanceDue,
      customerId: invoices.customerId,
      // We pull customer name via join below — using a raw SQL approach for now
      customerName: sql<string>`''`.as('customer_name'),
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        sql`${invoices.status} NOT IN ('draft', 'void')`,
        isNotNull(invoices.dueDate),
        sql`${invoices.balanceDue}::numeric > 0`,
      ),
    );

  if (candidateRows.length === 0) {
    return { settings, eligible: [], blocked: [] };
  }

  // Fetch reminder log counts for each invoice
  const invoiceIds = candidateRows.map((r) => r.id);

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
        sql`${invoiceReminderLogs.invoiceId} = ANY(ARRAY[${sql.join(
          invoiceIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::text[])`,
      ),
    );

  // Group logs by invoiceId
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
    const reminderLogs = logsByInvoice.get(row.id) ?? [];
    const result = computeInvoiceReminderEligibility({
      invoice: {
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        customerName: row.customerName || `Invoice #${row.invoiceNumber}`,
        status: row.status,
        dueDate: row.dueDate,
        totalCents: row.totalCents,
        balanceDueCents: Number(row.balanceDueCents),
        balanceDue: row.balanceDue,
      },
      reminderLogs: reminderLogs.map((l) => ({
        sentAt: l.sentAt,
        reminderNumber: l.reminderNumber,
      })),
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
