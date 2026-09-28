import { describe, expect, test } from "@jest/globals";
import { emailTemplateVariables, renderEmailSubject, renderEmailTemplate, sampleEmailTemplateValues, unknownEmailTemplateVariables } from "../emailTemplateVariables";

describe("email template variables", () => {
  test("Quote and Invoice expose only their resolvable tokens", () => {
    const quote = emailTemplateVariables("quote").map(item => item.key);
    const invoice = emailTemplateVariables("invoice").map(item => item.key);
    expect(quote).toEqual(expect.arrayContaining(["quoteNumber", "companyName", "customerName", "recipientName", "jobLabel"]));
    expect(quote).not.toContain("invoiceNumber");
    expect(quote).not.toContain("poNumber");
    expect(invoice).toEqual(expect.arrayContaining(["invoiceNumber", "companyName", "customerName", "orderNumber", "poNumber", "jobLabel", "dueDate"]));
    expect(invoice).not.toContain("quoteNumber");
  });

  test("validates unknown tokens while leaving ordinary braces literal", () => {
    expect(unknownEmailTemplateVariables("{jobNmae} {poNumber} {jobNmae} {ordinary prose}", "invoice")).toEqual(["{jobNmae}"]);
    expect(unknownEmailTemplateVariables("{invoiceNumber}", "quote")).toEqual(["{invoiceNumber}"]);
    expect(renderEmailTemplate("Invoice #{invoiceNumber} | PO {poNumber} | {jobLabel} {ordinary prose}", "invoice", {
      invoiceNumber: "20552", poNumber: null, jobLabel: "Yard Signs",
    })).toBe("Invoice #20552 | PO  | Yard Signs {ordinary prose}");
  });

  test("sample preview uses the same substitution as saved templates", () => {
    expect(renderEmailSubject("Invoice #{invoiceNumber} | PO {poNumber} | {jobLabel}", "invoice", sampleEmailTemplateValues("invoice")))
      .toBe("Invoice #20552 | PO 152594 | Yard Signs");
  });

  test("omits missing optional subject segments and normalizes separators", () => {
    const subject = "  Invoice #{invoiceNumber}  |  PO {poNumber}  |  {jobLabel}  ";
    const values = { invoiceNumber: "20552", poNumber: "152594", jobLabel: "Yard Signs" };
    expect(renderEmailSubject(subject, "invoice", values)).toBe("Invoice #20552 | PO 152594 | Yard Signs");
    expect(renderEmailSubject(subject, "invoice", { ...values, poNumber: null })).toBe("Invoice #20552 | Yard Signs");
    expect(renderEmailSubject(subject, "invoice", { ...values, jobLabel: "  " })).toBe("Invoice #20552 | PO 152594");
    expect(renderEmailSubject(subject, "invoice", { ...values, poNumber: null, jobLabel: null })).toBe("Invoice #20552");
  });

  test("omits an entire segment when any optional dependency is missing", () => {
    expect(renderEmailSubject("Invoice #{invoiceNumber} | PO {poNumber} / Job {jobLabel}", "invoice", {
      invoiceNumber: "20552", poNumber: "152594", jobLabel: null,
    })).toBe("Invoice #20552");
  });

  test("leaves non-pipe subjects and body rendering unchanged", () => {
    const values = { invoiceNumber: "20552", poNumber: null };
    expect(renderEmailSubject("Invoice #{invoiceNumber}: PO {poNumber}", "invoice", values)).toBe("Invoice #20552: PO ");
    expect(renderEmailTemplate("Invoice #{invoiceNumber} | PO {poNumber}", "invoice", values)).toBe("Invoice #20552 | PO ");
  });
});
