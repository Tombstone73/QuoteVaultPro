import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("first accounting approval starts and audits the invoice terms clock without changing QuickBooks queue behavior", () => {
  const schema = read("shared/schema.ts");
  const service = read("server/services/invoiceAccountingApproval.service.ts");
  const migration = read("server/db/migrations_v2/0203_invoice_terms_started_at.sql");

  expect(schema).toContain('termsStartedAt: timestamp("terms_started_at"');
  expect(migration).toContain("ADD COLUMN IF NOT EXISTS terms_started_at timestamptz");
  expect(service).toContain("resolveFirstInvoiceTermsStart");
  expect(service).toContain("hasInvoicePaymentTermsStartedOrApprovalHistory");
  expect(service).toContain("termsStartedAt: now");
  expect(service).toContain("terms: termsStart.terms");
  expect(service).toContain("dueDate: termsStart.dueDate");
  expect(service).toContain("CUSTOM_PAYMENT_TERMS_DUE_DATE_REQUIRED");
  expect(service).toContain("quickBooksAutoQueued: shouldQueueInitialSync");
});

test("invoice creation and successful-send automation cannot age an approved or legacy invoice payment clock", () => {
  const invoiceService = read("server/invoicesService.ts");
  const sendLifecycle = read("server/services/invoiceSendLifecycleAutomation.ts");

  expect(invoiceService).toContain("const dueDate = opts.terms === 'custom' ? opts.customDueDate || null : null;");
  expect(sendLifecycle).toContain("!hasInvoicePaymentTermsStartedOrApprovalHistory(invoice as Record<string, unknown>)");
  expect(sendLifecycle).toContain("shouldRecalculateInvoiceDueDateAfterSuccessfulSend");
});
