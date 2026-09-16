import {
  calculateInvoiceDueDateFromTerms,
  hasInvoicePaymentTermsStartedOrApprovalHistory,
  resolveFirstInvoiceTermsStart,
  resolveInvoicePaymentTerms,
} from "../invoicePaymentTerms";

const approvalAt = new Date("2026-09-16T12:00:00.000Z");

describe("invoice payment terms start", () => {
  test.each([
    ["due_on_receipt", "2026-09-16T12:00:00.000Z"],
    ["net_15", "2026-10-01T12:00:00.000Z"],
    ["net_30", "2026-10-16T12:00:00.000Z"],
    ["net_45", "2026-10-31T12:00:00.000Z"],
  ] as const)("calculates %s from the approval timestamp", (terms, expectedDueDate) => {
    expect(calculateInvoiceDueDateFromTerms({ termsStartedAt: approvalAt, terms })?.toISOString()).toBe(expectedDueDate);
  });

  test("uses customer terms before invoice terms and falls back to due on receipt", () => {
    expect(resolveInvoicePaymentTerms({ customerPaymentTerms: "net_30", invoiceTerms: "net_15" })).toBe("net_30");
    expect(resolveInvoicePaymentTerms({ customerPaymentTerms: null, invoiceTerms: "net_15" })).toBe("net_15");
    expect(resolveInvoicePaymentTerms({ customerPaymentTerms: null, invoiceTerms: null })).toBe("due_on_receipt");
  });

  test("preserves a custom manual due date and rejects an unset custom due date", () => {
    const manualDueDate = new Date("2026-10-07T12:00:00.000Z");
    expect(resolveFirstInvoiceTermsStart({ customerPaymentTerms: "custom", invoiceTerms: "net_30", approvalAt, existingDueDate: manualDueDate })).toMatchObject({ terms: "custom", dueDate: manualDueDate, validationError: null });
    expect(resolveFirstInvoiceTermsStart({ customerPaymentTerms: "custom", invoiceTerms: "net_30", approvalAt, existingDueDate: null }).validationError).toContain("manually entered due date");
  });

  test("does not classify reapproval or legacy approval evidence as a first terms start", () => {
    expect(hasInvoicePaymentTermsStartedOrApprovalHistory({ termsStartedAt: approvalAt })).toBe(true);
    expect(hasInvoicePaymentTermsStartedOrApprovalHistory({ accountingApprovalRevokedAt: approvalAt })).toBe(true);
    expect(hasInvoicePaymentTermsStartedOrApprovalHistory({ accountingApprovedVersion: 2 })).toBe(true);
    expect(hasInvoicePaymentTermsStartedOrApprovalHistory({})).toBe(false);
  });
});
