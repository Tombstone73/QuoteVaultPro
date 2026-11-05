import { describe, expect, test } from '@jest/globals';
import { canonicalManualPaymentMethodValues, manualPaymentMethodDefinitions, staffPaymentMethodDefinitions, formatRecordedPaymentMethod, paymentMethodFilterKey } from "../paymentMethodCatalog";

describe("staff payment methods", () => {
  test("retains every supported manual identifier and stable labels", () => {
    expect(canonicalManualPaymentMethodValues).toEqual(["cash", "check", "wire", "bank_transfer", "ach", "other"]);
    expect(manualPaymentMethodDefinitions.find((method) => method.id === "bank_transfer")?.label).toBe("ACH / Bank Transfer");
    expect(new Set(staffPaymentMethodDefinitions.map((method) => method.id)).size).toBe(staffPaymentMethodDefinitions.length);
  });

  test("single-invoice and bulk manual methods share labels for the same identifier", () => {
    const single = staffPaymentMethodDefinitions.filter((method) => method.singleInvoice);
    for (const method of single.filter((item) => item.kind === "manual")) {
      expect(manualPaymentMethodDefinitions.find((item) => item.id === method.id)?.label).toBe(method.label);
    }
    expect(single.find((method) => method.id === "credit_card")?.kind).toBe("processor");
  });
});

test.each([
  ['cash', 'Cash'], ['check', 'Check'], ['credit_card', 'Credit Card'], ['ach', 'ACH'],
  ['bank_transfer', 'ACH / Bank Transfer'], ['wire', 'Wire'], ['other', 'Other'], ['', 'Unknown'], [null, 'Unknown'],
])('formats recorded method %s consistently in Payments and Sync', (method, label) => {
  expect(formatRecordedPaymentMethod(method)).toBe(label);
});

test('filter families preserve explicit wire and bank-transfer identities', () => {
  expect(paymentMethodFilterKey('bank_transfer')).toBe('ach');
  expect(paymentMethodFilterKey('wire')).toBe('other');
  expect(paymentMethodFilterKey('credit_card')).toBe('credit_card');
});
