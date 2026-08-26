/**
 * invoiceReminderJob.ts
 *
 * Invoice reminder execution layer.
 *
 * SAFETY CONTRACT:
 * - Does not mutate invoice totals, status, or payment state.
 * - Does not store reminder state on invoices.
 * - Append-only writes to invoice_reminder_logs and invoice_email_logs.
 * - A failed send for one invoice never stops the entire job.
 * - No duplicate sends within the same interval window (idempotency guard).
 * - Does not register its own scheduler; see server/index.ts for the worker hook.
 *
 * TODO: Future customer credit limit module should be separate from invoice
 * reminders and should evaluate customer balance, unpaid invoices, order
 * approvals, and override permissions.
 */

import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { emailService } from './emailService';
import { createInvoiceEmailLog } from './invoicesService';
import {
  computeInvoiceReminderEligibility,
  createInvoiceReminderLog,
  getAllEnabledReminderSettings,
  getCandidateInvoicesForReminderRun,
  getInvoiceReminderSettingsForOrg,
  getSuccessfulReminderLogsForInvoice,
  type CandidateInvoice,
} from './invoiceReminderService';
import { generateInvoicePdfBytes } from './services/invoicePdf';
import { storage } from './storage';
import { computeInvoicePaymentRollup, getInvoicePaymentStatusLabel } from '../shared/rollups/invoicePaymentRollup';
import {
  auditLogs,
  companySettings,
  customers,
  invoiceLineItems,
  invoices,
  invoiceReminderLogs,
  payments,
  type InvoiceReminderSettings,
} from '../shared/schema';
import { desc } from 'drizzle-orm';
import { getInvoiceOrderContext } from './services/invoiceOrderContext';

// ---------------------------------------------------------------------------
// In-process singleton guard — prevents overlapping job runs.
// ---------------------------------------------------------------------------

let jobRunning = false;

function escapeEmailHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isJobRunning(): boolean {
  return jobRunning;
}

// ---------------------------------------------------------------------------
// Job result types
// ---------------------------------------------------------------------------

export interface ReminderJobSummary {
  organizationsChecked: number;
  invoicesChecked: number;
  remindersSent: number;
  remindersFailed: number;
  skipped: number;
  errors: Array<{ invoiceId: string; organizationId: string; error: string }>;
}

/** Injectable dependencies — real defaults used in production; mocks injected in tests. */
export interface ReminderJobDeps {
  /** Called to send the reminder email. Return messageId or null. Throw on hard failure. */
  sendEmail: (organizationId: string, opts: any) => Promise<string | null>;
  /** Called after successful send to write invoice_email_logs. */
  writeEmailLog: typeof createInvoiceEmailLog;
  /** Called to check email is configured for org before running. Return falsy to skip org. */
  getEmailConfig: (organizationId: string) => Promise<any>;
  /** Called to generate invoice PDF bytes. */
  generatePdf: typeof generateInvoicePdfBytes;
}

// ---------------------------------------------------------------------------
// Email helpers
// ---------------------------------------------------------------------------

export function buildReminderEmailHtml(opts: {
  invoiceNumber: string | number;
  customerName: string;
  companyName: string;
  balanceDue: string;
  dueDate: string;
  reminderNumber: number;
  poNumber?: string | null;
  jobLabel?: string | null;
}): string {
  const { invoiceNumber, customerName, companyName, balanceDue, reminderNumber } = opts;
  const dueDate = opts.dueDate;
  const poNumber = String(opts.poNumber || '').trim();
  const jobLabel = String(opts.jobLabel || '').trim();
  const orderContext = poNumber || jobLabel
    ? `<p>${poNumber ? `<strong>PO #:</strong> ${escapeEmailHtml(poNumber)}<br>` : ''}${jobLabel ? `<strong>Job:</strong> ${escapeEmailHtml(jobLabel)}` : ''}</p>`
    : '';
  const ordinal = reminderNumber === 1 ? 'First' : reminderNumber === 2 ? 'Second' : reminderNumber === 3 ? 'Third' : `${reminderNumber}th`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Reminder — Invoice #${invoiceNumber}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #fff7ed; padding: 30px; border-radius: 8px; margin-bottom: 30px; border-left: 4px solid #f97316;">
    <h1 style="margin: 0 0 8px 0; color: #c2410c; font-size: 20px;">${ordinal} Payment Reminder</h1>
    <p style="margin: 0; color: #666; font-size: 15px;">
      Invoice #${invoiceNumber} &mdash; ${companyName}
    </p>
  </div>

  <div style="padding: 20px 0;">
    <p>Dear ${customerName},</p>
    <p>
      This is a friendly reminder that <strong>Invoice #${invoiceNumber}</strong> has an outstanding
      balance of <strong>$${balanceDue}</strong> that was due on <strong>${dueDate}</strong>.
    </p>
    ${orderContext}
    <p>Please find the invoice attached for your reference. If payment has already been sent, please disregard this reminder.</p>
    <p>If you have any questions or concerns, please don't hesitate to contact us.</p>
  </div>

  <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #666; font-size: 14px;">
    <p style="margin: 0;">Thank you for your business!</p>
    <p style="margin: 5px 0 0 0;">${companyName}</p>
  </div>
</body>
</html>`.trim();
}

// ---------------------------------------------------------------------------
// Core per-invoice reminder send
// ---------------------------------------------------------------------------

async function sendReminderForInvoice(opts: {
  inv: CandidateInvoice;
  organizationId: string;
  settings: InvoiceReminderSettings;
  reminderNumber: number;
  now: Date;
  deps: ReminderJobDeps;
}): Promise<{ sent: boolean; messageId: string | null; failureReason?: string }> {
  const { inv, organizationId, settings, reminderNumber, now, deps } = opts;

  if (!inv.recipientEmail) {
    return { sent: false, messageId: null, failureReason: 'No recipient email on customer record' };
  }

  // Load full invoice row for PDF generation
  const [fullInv] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
  if (!fullInv) {
    return { sent: false, messageId: null, failureReason: 'Invoice not found' };
  }

  const [orgCompany] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.organizationId, organizationId));

  const lineItems = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, inv.id))
    .orderBy(invoiceLineItems.sortOrder, desc(invoiceLineItems.createdAt));

  const orderContext = await getInvoiceOrderContext({
    organizationId,
    orderId: (fullInv as any).orderId,
  });
  const job = orderContext
    ? { poNumber: orderContext.poNumber, jobNumber: orderContext.orderNumber, jobLabel: orderContext.jobLabel }
    : null;

  const paymentRows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.invoiceId, inv.id), eq(payments.organizationId, organizationId)))
    .orderBy(desc(payments.createdAt));

  const rollup = computeInvoicePaymentRollup({
    invoiceTotalCents: Number(fullInv.totalCents || 0),
    payments: paymentRows.map((p: any) => ({
      id: p.id,
      status: String(p.status || 'succeeded'),
      amountCents: Number(p.amountCents || 0),
    })),
  });

  const statusLabel = getInvoicePaymentStatusLabel({ invoiceStatus: fullInv.status, rollup });

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await deps.generatePdf({
      invoice: fullInv as any,
      customer: null,
      companySettings: (orgCompany as any) || null,
      paymentSummary: {
        amountPaidCents: rollup.amountPaidCents,
        amountDueCents: rollup.amountDueCents,
        statusLabel,
      },
      lineItems: lineItems as any,
      job,
    });
  } catch (pdfErr: any) {
    return { sent: false, messageId: null, failureReason: `PDF generation failed: ${pdfErr?.message}` };
  }

  const invoiceNumber = String((fullInv as any).displayNumber || fullInv.invoiceNumber || fullInv.id);
  const filename = `invoice-${invoiceNumber}.pdf`;
  const pdfBase64 = Buffer.from(pdfBytes).toString('base64');
  const companyName = orgCompany?.companyName || 'TitanOS';
  const balanceDue = (inv.balanceDueCents / 100).toFixed(2);
  const dueDateStr = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : 'upon receipt';

  const emailHtml = buildReminderEmailHtml({
    invoiceNumber,
    customerName: inv.customerName || inv.recipientEmail,
    companyName,
    balanceDue,
    dueDate: dueDateStr,
    reminderNumber,
    poNumber: orderContext?.poNumber,
    jobLabel: orderContext?.jobLabel,
  });

  const subject = `REMINDER: Invoice #${invoiceNumber} — Balance Due $${balanceDue}`;
  let messageId: string | null = null;

  try {
    messageId = await deps.sendEmail(organizationId, {
      to: inv.recipientEmail,
      subject,
      html: emailHtml,
      attachments: [
        {
          filename,
          content: pdfBase64,
          encoding: 'base64',
          contentType: 'application/pdf',
        },
      ] as any,
    });
  } catch (sendErr: any) {
    try {
      await deps.writeEmailLog({
        organizationId,
        invoiceId: inv.id,
        recipientEmail: inv.recipientEmail,
        status: 'failed',
        type: 'reminder_send',
        messageId: null,
        sentAt: now,
      });
    } catch (_) { /* best-effort */ }
    return { sent: false, messageId: null, failureReason: sendErr?.message || 'Email send failed' };
  }

  try {
    await deps.writeEmailLog({
      organizationId,
      invoiceId: inv.id,
      recipientEmail: inv.recipientEmail,
      status: 'sent',
      type: 'reminder_send',
      messageId,
      sentAt: now,
    });
  } catch (_) { /* best-effort */ }

  // Send internal copy if configured
  if (settings.sendCopyToInternalEmail && settings.internalCopyEmail) {
    try {
      await deps.sendEmail(organizationId, {
        to: settings.internalCopyEmail,
        subject: `[Internal Copy] ${subject}`,
        html: emailHtml,
        attachments: [
          {
            filename,
            content: pdfBase64,
            encoding: 'base64',
            contentType: 'application/pdf',
          },
        ] as any,
      });
    } catch (copyErr) {
      console.warn(`[ReminderJob] Internal copy send failed for invoice ${inv.id}:`, copyErr);
    }
  }

  return { sent: true, messageId };
}

// ---------------------------------------------------------------------------
// Manual per-invoice reminder send (called by the API endpoint, not the job)
// ---------------------------------------------------------------------------

export interface ManualReminderResult {
  success: boolean;
  message?: string;
  lastReminderSentAt?: Date;
  reminderCount?: number;
}

/**
 * Send a reminder for a single invoice triggered by a user action.
 *
 * Safety rules (same as the job):
 * - Append-only writes — no invoice mutations.
 * - Idempotency window: block if a successful reminder was sent within the last
 *   5 minutes (prevents double-click spam).
 * - Paid / void invoices are blocked.
 * - Both sent and failed outcomes are logged.
 * - The userId is written to the audit log.
 */
export async function sendManualInvoiceReminder(opts: {
  invoiceId: string;
  organizationId: string;
  userId: string;
  userName: string;
  deps?: ReminderJobDeps;
}): Promise<ManualReminderResult> {
  const { invoiceId, organizationId, userId, userName } = opts;
  const deps = opts.deps ?? makeDefaultDeps();
  const now = new Date();

  // --- Load invoice + customer -------------------------------------------------
  const [fullInv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)));

  if (!fullInv) {
    return { success: false, message: 'Invoice not found' };
  }

  if (fullInv.status === 'paid') {
    return { success: false, message: 'Invoice is already paid — no reminder needed' };
  }
  if (fullInv.status === 'void') {
    return { success: false, message: 'Invoice is void — reminders cannot be sent' };
  }

  // Resolve recipient email from customer record
  const [customer] = await db
    .select({ email: customers.email, companyName: customers.companyName })
    .from(customers)
    .where(and(eq(customers.id, fullInv.customerId), eq(customers.organizationId, organizationId)));

  const recipientEmail = customer?.email ?? null;
  if (!recipientEmail) {
    return { success: false, message: 'No email address on customer record' };
  }

  // --- Idempotency: block if sent within the last 5 minutes -------------------
  const successfulLogs = await getSuccessfulReminderLogsForInvoice(invoiceId, organizationId);
  const lastLog = successfulLogs.length > 0
    ? successfulLogs.reduce((a, b) => new Date(a.sentAt) > new Date(b.sentAt) ? a : b)
    : null;

  if (lastLog) {
    const msSinceLastSend = now.getTime() - new Date(lastLog.sentAt).getTime();
    const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
    if (msSinceLastSend < IDEMPOTENCY_WINDOW_MS) {
      return {
        success: false,
        message: 'A reminder was recently sent. Please wait a few minutes before sending again.',
        lastReminderSentAt: new Date(lastLog.sentAt),
        reminderCount: successfulLogs.length,
      };
    }
  }

  const reminderNumber = successfulLogs.length + 1;

  // Build a CandidateInvoice-shaped object for sendReminderForInvoice
  const balanceDueCents = fullInv.balanceDue != null
    ? Math.round(parseFloat(String(fullInv.balanceDue)) * 100)
    : Number(fullInv.totalCents ?? 0);

  // Load org reminder settings (best-effort — non-fatal if missing)
  const orgSettings = await getInvoiceReminderSettingsForOrg(organizationId).catch(() => null);

  const settingsForSend: InvoiceReminderSettings = orgSettings ?? {
    id: '',
    organizationId,
    enabled: true,
    firstReminderDaysAfterDue: null,
    repeatIntervalDays: null,
    maxReminders: null,
    sendCopyToInternalEmail: false,
    internalCopyEmail: null,
    pauseForManualBillingCustomers: false,
    createdAt: now,
    updatedAt: now,
  };

  const candidate: CandidateInvoice = {
    id: fullInv.id,
    invoiceNumber: fullInv.invoiceNumber ?? 0,
    status: fullInv.status,
    dueDate: fullInv.dueDate ? new Date(fullInv.dueDate) : null,
    totalCents: Number(fullInv.totalCents ?? 0),
    balanceDueCents,
    balanceDue: fullInv.balanceDue ?? null,
    customerId: fullInv.customerId,
    customerName: customer?.companyName ?? recipientEmail,
    recipientEmail,
  };

  // --- Send -------------------------------------------------------------------
  const result = await sendReminderForInvoice({
    inv: candidate,
    organizationId,
    settings: settingsForSend,
    reminderNumber,
    now,
    deps,
  });

  if (result.sent) {
    await createInvoiceReminderLog({
      organizationId,
      invoiceId,
      reminderNumber,
      sentAt: now,
      status: 'sent',
      recipientEmail,
      messageId: result.messageId,
      failureReason: null,
    });

    try {
      await db.insert(auditLogs).values({
        organizationId,
        userId,
        userName,
        actionType: 'invoice.reminder_sent',
        entityType: 'invoice',
        entityId: invoiceId,
        entityName: String(fullInv.invoiceNumber ?? invoiceId),
        description: `Manual reminder #${reminderNumber} sent to ${recipientEmail}`,
        newValues: { reminderNumber, recipientEmail, messageId: result.messageId, triggeredBy: 'manual' } as any,
        createdAt: now,
      } as any);
    } catch (auditErr) {
      console.error('[ManualReminder] Audit log failed:', auditErr);
    }

    const freshCount = reminderNumber; // we just sent this one
    console.log(`[ManualReminder] ✅ Reminder #${reminderNumber} sent for invoice ${fullInv.invoiceNumber} (${invoiceId}) → ${recipientEmail} by user ${userId}`);
    return { success: true, lastReminderSentAt: now, reminderCount: freshCount };
  } else {
    // Log failure but do not throw — endpoint returns success: false with message
    try {
      await createInvoiceReminderLog({
        organizationId,
        invoiceId,
        reminderNumber,
        sentAt: now,
        status: 'failed',
        recipientEmail,
        messageId: null,
        failureReason: result.failureReason ?? 'Unknown send failure',
      });
    } catch (logErr) {
      console.error('[ManualReminder] Failed to write failure log:', logErr);
    }

    console.warn(`[ManualReminder] ⚠️ Reminder failed for invoice ${fullInv.invoiceNumber} (${invoiceId}): ${result.failureReason}`);
    return { success: false, message: result.failureReason ?? 'Failed to send reminder email' };
  }
}

// ---------------------------------------------------------------------------
// Main job function
// ---------------------------------------------------------------------------

/** Default production dependencies. */
function makeDefaultDeps(): ReminderJobDeps {
  return {
    sendEmail: (orgId, opts) => emailService.sendEmail(orgId, opts),
    writeEmailLog: createInvoiceEmailLog,
    getEmailConfig: (orgId) => storage.getDefaultEmailSettings(orgId),
    generatePdf: generateInvoicePdfBytes,
  };
}

export async function runInvoiceReminderJob(
  now: Date = new Date(),
  deps: ReminderJobDeps = makeDefaultDeps(),
  organizationId?: string,
): Promise<ReminderJobSummary> {
  if (isJobRunning()) {
    console.log('[ReminderJob] Skipping — job is already running');
    return {
      organizationsChecked: 0,
      invoicesChecked: 0,
      remindersSent: 0,
      remindersFailed: 0,
      skipped: 0,
      errors: [],
    };
  }

  jobRunning = true;
  const summary: ReminderJobSummary = {
    organizationsChecked: 0,
    invoicesChecked: 0,
    remindersSent: 0,
    remindersFailed: 0,
    skipped: 0,
    errors: [],
  };

  console.log(`[ReminderJob] Starting at ${now.toISOString()}`);

  try {
    // Scheduled execution intentionally processes every enabled tenant. A
    // human-triggered run supplies an active organization and must never send
    // reminders for any other tenant.
    const allSettings = organizationId
      ? [await getInvoiceReminderSettingsForOrg(organizationId)].filter((settings): settings is InvoiceReminderSettings => Boolean(settings?.enabled))
      : await getAllEnabledReminderSettings();
    summary.organizationsChecked = allSettings.length;

    if (allSettings.length === 0) {
      console.log('[ReminderJob] No organizations have reminders enabled. Done.');
      return summary;
    }

    for (const orgSettings of allSettings) {
      const { organizationId } = orgSettings;
      console.log(`[ReminderJob] Processing org ${organizationId}`);

      try {
        const emailConfig = await deps.getEmailConfig(organizationId);
        if (!emailConfig) {
          console.log(`[ReminderJob] Skipping org ${organizationId} — no email settings configured`);
          continue;
        }

        const candidates = await getCandidateInvoicesForReminderRun(organizationId);
        summary.invoicesChecked += candidates.length;

        for (const inv of candidates) {
          try {
            // Load only successful logs — failed attempts don't count toward max/interval
            const successfulLogs = await getSuccessfulReminderLogsForInvoice(inv.id, organizationId);

            const eligibility = computeInvoiceReminderEligibility({
              invoice: {
                id: inv.id,
                invoiceNumber: inv.invoiceNumber,
                customerName: inv.customerName,
                recipientEmail: inv.recipientEmail,
                status: inv.status,
                dueDate: inv.dueDate,
                totalCents: inv.totalCents,
                balanceDueCents: inv.balanceDueCents,
                balanceDue: inv.balanceDue,
              },
              reminderLogs: successfulLogs,
              settings: orgSettings,
              now,
            });

            if (eligibility.status !== 'eligible') {
              summary.skipped++;
              continue;
            }

            // Idempotency guard: re-fetch right before sending to protect against
            // double runs, restarts, and concurrent workers.
            const freshLogs = await getSuccessfulReminderLogsForInvoice(inv.id, organizationId);
            const freshEligibility = computeInvoiceReminderEligibility({
              invoice: {
                id: inv.id,
                invoiceNumber: inv.invoiceNumber,
                customerName: inv.customerName,
                recipientEmail: inv.recipientEmail,
                status: inv.status,
                dueDate: inv.dueDate,
                totalCents: inv.totalCents,
                balanceDueCents: inv.balanceDueCents,
                balanceDue: inv.balanceDue,
              },
              reminderLogs: freshLogs,
              settings: orgSettings,
              now,
            });

            if (freshEligibility.status !== 'eligible') {
              console.log(`[ReminderJob] Invoice ${inv.id} no longer eligible after re-check (${freshEligibility.status}). Skipping.`);
              summary.skipped++;
              continue;
            }

            if (
              freshEligibility.nextReminderDueAt &&
              now < freshEligibility.nextReminderDueAt
            ) {
              console.log(`[ReminderJob] Invoice ${inv.id} nextReminderDueAt is in the future. Skipping.`);
              summary.skipped++;
              continue;
            }

            const reminderNumber = freshLogs.length + 1;

            const result = await sendReminderForInvoice({
              inv,
              organizationId,
              settings: orgSettings,
              reminderNumber,
              now,
              deps,
            });

            if (result.sent) {
              await createInvoiceReminderLog({
                organizationId,
                invoiceId: inv.id,
                reminderNumber,
                sentAt: now,
                status: 'sent',
                recipientEmail: inv.recipientEmail ?? null,
                messageId: result.messageId,
                failureReason: null,
              });

              try {
                await db.insert(auditLogs).values({
                  organizationId,
                  userId: null,
                  userName: 'System (Reminder Job)',
                  actionType: 'invoice.reminder_sent',
                  entityType: 'invoice',
                  entityId: inv.id,
                  entityName: String(inv.invoiceNumber),
                  description: `Reminder #${reminderNumber} sent to ${inv.recipientEmail}`,
                  newValues: { reminderNumber, recipientEmail: inv.recipientEmail, messageId: result.messageId } as any,
                  createdAt: now,
                } as any);
              } catch (auditErr) {
                console.error('[ReminderJob] Audit log failed:', auditErr);
              }

              summary.remindersSent++;
              console.log(`[ReminderJob] ✅ Reminder #${reminderNumber} sent for invoice ${inv.invoiceNumber} (${inv.id}) → ${inv.recipientEmail}`);
            } else {
              try {
                await createInvoiceReminderLog({
                  organizationId,
                  invoiceId: inv.id,
                  reminderNumber,
                  sentAt: now,
                  status: 'failed',
                  recipientEmail: inv.recipientEmail ?? null,
                  messageId: null,
                  failureReason: result.failureReason ?? 'Unknown send failure',
                });
              } catch (logErr) {
                console.error('[ReminderJob] Failed to write failure log:', logErr);
              }

              summary.remindersFailed++;
              console.warn(`[ReminderJob] ⚠️ Reminder failed for invoice ${inv.invoiceNumber} (${inv.id}): ${result.failureReason}`);
            }
          } catch (invoiceErr: any) {
            summary.remindersFailed++;
            summary.errors.push({
              invoiceId: inv.id,
              organizationId,
              error: invoiceErr?.message || 'Unknown error',
            });
            console.error(`[ReminderJob] Error processing invoice ${inv.id}:`, invoiceErr);
          }
        }
      } catch (orgErr: any) {
        console.error(`[ReminderJob] Error processing org ${organizationId}:`, orgErr);
        summary.errors.push({
          invoiceId: '',
          organizationId,
          error: `Org-level error: ${orgErr?.message || 'Unknown'}`,
        });
      }
    }
  } finally {
    jobRunning = false;
  }

  console.log(
    `[ReminderJob] Done. orgs=${summary.organizationsChecked} invoices=${summary.invoicesChecked} sent=${summary.remindersSent} failed=${summary.remindersFailed} skipped=${summary.skipped}`,
  );

  return summary;
}
