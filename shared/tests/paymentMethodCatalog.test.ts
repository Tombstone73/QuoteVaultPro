import { canonicalManualPaymentMethodValues, manualPaymentMethodDefinitions, staffPaymentMethodDefinitions } from "../paymentMethodCatalog";

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