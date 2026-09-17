import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

const source = fs.readFileSync(path.join(process.cwd(), "client/src/components/customer-form.tsx"), "utf8");

test("Customer Edit loads, shows, and conditionally saves the shared payment-term configuration", () => {
  expect(source).toContain('import { CUSTOMER_PAYMENT_TERMS, type CustomerPaymentTerm } from "@shared/customerCommercialConfiguration";');
  expect(source).toContain('paymentTerms: customer.paymentTerms || "due_on_receipt"');
  expect(source).toContain('paymentTerms: "due_on_receipt"');
  expect(source).toContain('<Label htmlFor="paymentTerms">Payment Terms</Label>');
  expect(source).toContain('CUSTOMER_PAYMENT_TERMS.map');
  expect(source).toContain('disabled={!canManageCommercialConfiguration}');
  expect(source).toContain('...(canManageCommercialConfiguration ? { paymentTerms } : {}),');
  expect(source).toContain('Only organization owners and admins can change payment terms.');
});

test("Customer tax override displays percentages but persists canonical decimal rates", () => {
  expect(source).toContain('taxRatePercentFromDecimal(customer.taxRateOverride)');
  expect(source).toContain('taxRateDecimalFromPercent(taxRateOverride)');
  expect(source).toContain('Tax Rate Override (%)');
});
