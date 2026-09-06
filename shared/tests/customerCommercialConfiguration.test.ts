import { describe, expect, test } from "@jest/globals";
import { bulkCustomerCommercialConfigurationSchema } from "../customerCommercialConfiguration";

describe("bulk customer commercial configuration contract", () => {
  test("accepts a bounded, explicit payment-terms update", () => {
    expect(bulkCustomerCommercialConfigurationSchema.parse({
      customerIds: ["customer-1", "customer-2"],
      operation: "set_payment_terms",
      paymentTerms: "net_30",
    })).toMatchObject({ operation: "set_payment_terms", paymentTerms: "net_30" });
  });

  test("accepts a configured zero credit limit separately from Not set", () => {
    expect(bulkCustomerCommercialConfigurationSchema.parse({ customerIds: ["customer-1"], operation: "set_credit_limit", creditLimit: 0 }).creditLimit).toBe(0);
    expect(bulkCustomerCommercialConfigurationSchema.parse({ customerIds: ["customer-1"], operation: "set_credit_limit", creditLimit: null }).creditLimit).toBeNull();
  });

  test.each([
    [{ customerIds: [], operation: "set_payment_terms", paymentTerms: "net_30" }],
    [{ customerIds: ["customer-1", "customer-1"], operation: "set_payment_terms", paymentTerms: "net_30" }],
    [{ customerIds: ["customer-1"], operation: "set_payment_terms", paymentTerms: "net_60" }],
    [{ customerIds: ["customer-1"], operation: "set_credit_limit", creditLimit: -1 }],
    [{ customerIds: ["customer-1"], operation: "set_credit_limit", creditLimit: 100_000_000 }],
    [{ customerIds: ["customer-1"], operation: "set_credit_limit", creditLimit: "50" }],
    [{ customerIds: ["customer-1"], operation: "set_credit_limit", creditLimit: 10, paymentTerms: "net_30" }],
  ])("rejects invalid or uncontrolled bulk input: %p", (payload) => {
    expect(bulkCustomerCommercialConfigurationSchema.safeParse(payload).success).toBe(false);
  });
});
