import assert from "node:assert/strict";
import { CustomerCommercialPricingAdapter, type CustomerCommercialStore } from "../../src/modules/products/customerCommercial.js";
import { currencyCode, money } from "../../src/modules/shared/commercialValues.js";
import type { PricingPort, PricingResult } from "../../src/modules/pricing/contracts.js";

const USD = currencyCode("USD");
const base: PricingResult = {
  schemaVersion: 1, id: "base" as PricingResult["id"], evidenceFingerprint: "sha256:base", organizationId: "org" as never,
  currency: USD, calculatedUnitAmount: money(USD, 1000), calculatedLineAmount: money(USD, 2000),
  unitAmountEvidence: { exactUnitCents: "1000" as never, allocation: "rounded_line_total_divided_by_quantity" },
  components: [{ kind: "base", label: "Base", amount: money(USD, 2000) }], optionImpacts: [], minimumChargeApplied: false,
  evaluator: { id: "test", version: "1" }, rounding: { policyId: "test", policyVersion: "1", stages: [{ stage: "final", mode: "half-up", precision: 0 }] },
  normalizedInput: { schemaVersion: 1, organizationId: "org" as never, productId: "product" as never, pricingConfigurationId: "version" as never, pricingConfigurationVersion: "1", pricingConfigurationContentHash: "hash", quantity: 2, selections: {}, derivedFacts: {}, productFacts: {} }, warnings: [],
};
const request = { organizationId: "org" as never, sellableProduct: { organizationId: "org" as never, productId: "product" as never }, resolvedConfiguration: base.normalizedInput, pricingContext: { channel: "portal" as const, effectiveAt: "2026-09-07T00:00:00.000Z" }, rules: {} } as never;
const port: PricingPort = { calculate: async () => base };
const store = (enabled: boolean, agreement: unknown): CustomerCommercialStore => ({
  isEntitled: async () => enabled,
  resolveAgreement: async () => agreement as never,
  setEntitlement: async (value) => value,
  replaceAgreement: async (value) => ({ ...value, id: "agreement", active: true, createdAt: "2026-09-07T00:00:00.000Z" }),
  listEntitlements: async () => [],
  listActivePricingAgreements: async () => [],
});

const adjustment = { id: "agreement", organizationId: "org" as never, customerId: "customer" as never, productId: "product" as never, currency: USD, mode: "percent_adjustment" as const, value: -1000, active: true, effectiveFrom: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" };
const priced = await new CustomerCommercialPricingAdapter(port, store(true, adjustment)).calculateForCustomer("customer" as never, request);
assert.equal(priced.calculatedLineAmount.cents, 1800, "agreement adjustment is server-pricing evidence, not UI arithmetic");
assert.equal(priced.customerPricing?.agreementId, "agreement");
assert.equal(priced.components.at(-1)?.kind, "customer_agreement");
await assert.rejects(() => new CustomerCommercialPricingAdapter(port, store(false, adjustment)).calculateForCustomer("customer" as never, request), /not available/);
const staffPriced = await new CustomerCommercialPricingAdapter(port, store(false, adjustment)).calculateForCustomer(
  "customer" as never,
  { ...request, pricingContext: { ...request.pricingContext, channel: "staff" } },
);
assert.equal(staffPriced.calculatedLineAmount.cents, 1800, "staff Orders receive the same customer agreement without requiring portal catalog entitlement");
console.log("customer commercial pricing contract passed");
