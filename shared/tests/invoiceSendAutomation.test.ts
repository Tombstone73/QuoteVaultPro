import { expect, test } from "@jest/globals";
import {
  calculateDueDateFromSuccessfulCustomerSend,
  DEFAULT_INVOICE_SEND_AUTOMATION_PREFERENCES,
  resolveInvoiceCustomerDeliveryTerms,
  resolveInvoiceSendAutomationPreferences,
  shouldRecalculateInvoiceDueDateAfterSuccessfulSend,
} from "../invoiceSendAutomation";

const sentAt = new Date("2026-09-04T15:30:00.000Z");

test("existing organizations default to manual approval and keep their due date", () => {
  expect(resolveInvoiceSendAutomationPreferences({})).toEqual(DEFAULT_INVOICE_SEND_AUTOMATION_PREFERENCES);
  expect(shouldRecalculateInvoiceDueDateAfterSuccessfulSend({
    isFirstSuccessfulCustomerDelivery: true,
    automation: DEFAULT_INVOICE_SEND_AUTOMATION_PREFERENCES,
  })).toBe(false);
});

test("calculates due dates from the first provider-successful delivery", () => {
  expect(calculateDueDateFromSuccessfulCustomerSend({ successfulSentAt: sentAt, terms: "due_on_receipt" })?.toISOString()).toBe(sentAt.toISOString());
  expect(calculateDueDateFromSuccessfulCustomerSend({ successfulSentAt: sentAt, terms: "net_15" })?.toISOString()).toBe("2026-09-19T15:30:00.000Z");
  expect(calculateDueDateFromSuccessfulCustomerSend({ successfulSentAt: sentAt, terms: "net_30" })?.toISOString()).toBe("2026-10-04T15:30:00.000Z");
  expect(calculateDueDateFromSuccessfulCustomerSend({ successfulSentAt: sentAt, terms: "net_45" })?.toISOString()).toBe("2026-10-19T15:30:00.000Z");
  expect(calculateDueDateFromSuccessfulCustomerSend({ successfulSentAt: sentAt, terms: "custom" })).toBeNull();
});

test("uses customer terms before the invoice/default snapshot and never recalculates a resend", () => {
  expect(resolveInvoiceCustomerDeliveryTerms({ invoiceTerms: "due_on_receipt", customerPaymentTerms: "net_30" })).toBe("net_30");
  expect(resolveInvoiceCustomerDeliveryTerms({ invoiceTerms: "net_15", customerPaymentTerms: null })).toBe("net_15");
  expect(resolveInvoiceCustomerDeliveryTerms({ invoiceTerms: null, customerPaymentTerms: null })).toBe("due_on_receipt");
  expect(shouldRecalculateInvoiceDueDateAfterSuccessfulSend({
    isFirstSuccessfulCustomerDelivery: false,
    automation: { approveForAccountingAfterSuccessfulSend: true, dueDateOnFirstSuccessfulCustomerSend: "recalculate_from_terms" },
  })).toBe(false);
});
