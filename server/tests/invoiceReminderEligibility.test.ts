/**
 * Unit tests for computeInvoiceReminderEligibility.
 *
 * These tests exercise the pure eligibility function only —
 * no DB connections, no network calls, no email sends.
 */

import { describe, expect, test } from "@jest/globals";
import { computeInvoiceReminderEligibility } from "../invoiceReminderService";
import type { InvoiceReminderSettings } from "../../shared/schema";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-05-01T12:00:00Z");
const DUE_5_DAYS_AGO = new Date("2026-04-26T00:00:00Z");
const DUE_TODAY = new Date("2026-05-01T00:00:00Z");
const DUE_TOMORROW = new Date("2026-05-02T00:00:00Z");

function makeSettings(overrides: Partial<InvoiceReminderSettings> = {}): InvoiceReminderSettings {
  return {
    id: "settings-1",
    organizationId: "org-1",
    enabled: true,
    firstReminderDaysAfterDue: 3,
    repeatIntervalDays: 7,
    maxReminders: 5,
    sendCopyToInternalEmail: false,
    internalCopyEmail: null,
    pauseForManualBillingCustomers: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    invoiceNumber: 42,
    customerName: "Acme Corp",
    status: "billed",
    dueDate: DUE_5_DAYS_AGO,
    totalCents: 5000,
    balanceDueCents: 5000,
    ...overrides,
  };
}

function run(
  invoiceOverrides: Record<string, unknown> = {},
  settingsOverrides: Partial<InvoiceReminderSettings> = {},
  reminderLogs: Array<{ sentAt: Date; reminderNumber: number }> = [],
) {
  return computeInvoiceReminderEligibility({
    invoice: makeInvoice(invoiceOverrides),
    reminderLogs,
    settings: makeSettings(settingsOverrides),
    now: NOW,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeInvoiceReminderEligibility", () => {
  // 1. Happy path: overdue invoice, no reminders sent yet
  test("eligible: billed, overdue past threshold, no reminders sent yet", () => {
    const result = run(); // DUE_5_DAYS_AGO, threshold = 3 days
    expect(result.status).toBe("eligible");
    expect(result.daysOverdue).toBe(5);
    expect(result.remindersSentCount).toBe(0);
  });

  // 2. Settings disabled
  test("blocked: settings.enabled = false", () => {
    const result = run({}, { enabled: false });
    expect(result.status).toBe("settings_disabled");
  });

  // 3. Invoice is draft (not billed)
  test("blocked: draft invoice", () => {
    const result = run({ status: "draft" });
    expect(result.status).toBe("not_billed");
  });

  // 4. Invoice is void
  test("blocked: void invoice", () => {
    const result = run({ status: "void" });
    expect(result.status).toBe("void");
  });

  // 5. Invoice is paid (balanceDue = 0)
  test("blocked: balance due is zero (paid)", () => {
    const result = run({ balanceDueCents: 0 });
    expect(result.status).toBe("paid");
  });

  // 6. No due date
  test("blocked: no due date", () => {
    const result = run({ dueDate: null });
    expect(result.status).toBe("no_due_date");
  });

  // 7. Not yet overdue (due tomorrow)
  test("blocked: due date in the future", () => {
    const result = run({ dueDate: DUE_TOMORROW });
    expect(result.status).toBe("not_overdue");
  });

  // 8. Overdue but hasn't reached firstReminderDaysAfterDue threshold
  test("blocked: overdue but within first-reminder threshold (1 day past due, threshold = 3)", () => {
    const dueYesterday = new Date("2026-04-30T00:00:00Z");
    const result = run({ dueDate: dueYesterday }, { firstReminderDaysAfterDue: 3 });
    expect(result.status).toBe("not_overdue");
  });

  // 9. Max reminders reached
  test("blocked: max reminders already sent", () => {
    const logs = [
      { sentAt: new Date("2026-04-20T12:00:00Z"), reminderNumber: 1 },
      { sentAt: new Date("2026-04-27T12:00:00Z"), reminderNumber: 2 },
    ];
    const result = run({}, { maxReminders: 2 }, logs);
    expect(result.status).toBe("max_reminders_reached");
  });

  // 10. Too soon to re-send (repeat interval not elapsed)
  test("blocked: last reminder sent 2 days ago, repeat interval = 7", () => {
    const logs = [
      { sentAt: new Date("2026-04-29T12:00:00Z"), reminderNumber: 1 },
    ];
    const result = run({}, { repeatIntervalDays: 7 }, logs);
    expect(result.status).toBe("too_soon");
  });

  // 11. Eligible for second reminder (repeat interval elapsed)
  test("eligible: last reminder 8 days ago, repeat interval = 7", () => {
    const logs = [
      { sentAt: new Date("2026-04-23T12:00:00Z"), reminderNumber: 1 },
    ];
    const result = run({}, { repeatIntervalDays: 7, maxReminders: 5 }, logs);
    expect(result.status).toBe("eligible");
  });

  // 12. No repeat configured: one reminder sent → max_reminders_reached
  test("blocked: no repeat interval, one reminder already sent", () => {
    const logs = [
      { sentAt: new Date("2026-04-26T12:00:00Z"), reminderNumber: 1 },
    ];
    const result = run({}, { repeatIntervalDays: null }, logs);
    expect(result.status).toBe("max_reminders_reached");
  });

  // 13. balanceDue string field (from postgres decimal column)
  test("eligible: reads balanceDue as string decimal", () => {
    const result = computeInvoiceReminderEligibility({
      invoice: {
        id: "inv-2",
        invoiceNumber: 99,
        customerName: "Test Co",
        status: "billed",
        dueDate: DUE_5_DAYS_AGO,
        totalCents: 1000,
        balanceDue: "10.00",    // string from Drizzle decimal
        // no balanceDueCents
      },
      reminderLogs: [],
      settings: makeSettings(),
      now: NOW,
    });
    expect(result.status).toBe("eligible");
  });

  // 14. balanceDue = "0.00" → treated as paid
  test("blocked: balanceDue string '0.00' treated as paid", () => {
    const result = computeInvoiceReminderEligibility({
      invoice: {
        id: "inv-3",
        invoiceNumber: 100,
        customerName: "Test Co",
        status: "billed",
        dueDate: DUE_5_DAYS_AGO,
        totalCents: 1000,
        balanceDue: "0.00",
      },
      reminderLogs: [],
      settings: makeSettings(),
      now: NOW,
    });
    expect(result.status).toBe("paid");
  });

  // 15. nextReminderDueAt computed correctly for first reminder
  test("nextReminderDueAt = dueDate + firstReminderDaysAfterDue when no logs", () => {
    const result = run({}, { firstReminderDaysAfterDue: 3 });
    const expected = new Date(DUE_5_DAYS_AGO.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(result.nextReminderDueAt?.toISOString()).toBe(expected.toISOString());
  });

  // 16. nextReminderDueAt computed correctly for repeat reminder
  test("nextReminderDueAt = lastSentAt + repeatIntervalDays when logs exist", () => {
    const lastSent = new Date("2026-04-23T12:00:00Z");
    const logs = [{ sentAt: lastSent, reminderNumber: 1 }];
    const result = run({}, { repeatIntervalDays: 7 }, logs);
    const expected = new Date(lastSent.getTime() + 7 * 24 * 60 * 60 * 1000);
    expect(result.nextReminderDueAt?.toISOString()).toBe(expected.toISOString());
  });

  // 17. daysOverdue is null when dueDate is null
  test("daysOverdue is null when dueDate is null", () => {
    const result = run({ dueDate: null });
    expect(result.daysOverdue).toBeNull();
  });
});
