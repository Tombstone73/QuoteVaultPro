import { describe, expect, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertPricingCalculationRequest, assertPricingResultEvidence, type PricingResult, type ResolvedProductConfiguration } from "../../src/modules/pricing/contracts";
import type { OrderBackedInvoiceSynchronizationInput } from "../../src/modules/billing/contracts";
import { assertSalesLineSnapshot, assertSellingPriceDecision, type ConvertQuoteCommand, type SellingPriceDecision } from "../../src/modules/sales/contracts";
import { brandedId, currencyCode, decimalText, freezeCheckpoint, money, type OrganizationId } from "../../src/modules/shared/commercialValues";

const usd = currencyCode("USD");
const org = brandedId<"OrganizationId">("org-a");
const resolved: ResolvedProductConfiguration = {
  schemaVersion: 1, organizationId: org, productId: brandedId<"ProductId">("product-a"), pricingConfigurationId: brandedId<"PricingConfigurationId">("config-a"),
  pricingConfigurationVersion: "v1", pricingConfigurationContentHash: "hash", quantity: 2,
  selections: { grommets: 4 }, derivedFacts: { billableSqft: "12" }, productFacts: { printed: true },
};
const pricing: PricingResult = {
  schemaVersion: 1, id: brandedId<"PricingResultId">("price-a"), organizationId: org, currency: usd,
  evidenceFingerprint: "pricing-evidence-a",
  calculatedUnitAmount: money(usd, 1250), calculatedLineAmount: money(usd, 2500), components: [{ kind: "base", label: "Base", amount: money(usd, 2500) }],
  unitAmountEvidence: { exactUnitCents: decimalText("1250"), allocation: "rounded_line_total_divided_by_quantity" },
  optionImpacts: [], minimumChargeApplied: false, evaluator: { id: "pbv2-adapter", version: "1" },
  rounding: { policyId: "half-up", policyVersion: "1", stages: [{ stage: "line-total", mode: "half-up", precision: 2 }] },
  normalizedInput: resolved, warnings: [],
};

describe("M1.1 commercial contracts", () => {
  test("PricingResult cannot silently lose evaluator or rounding evidence", () => {
    expect(assertPricingResultEvidence(pricing)).toBe(pricing);
    expect(() => assertPricingResultEvidence({ ...pricing, evaluator: { id: "", version: "" } })).toThrow(/evaluator/i);
    expect(() => assertPricingResultEvidence({ ...pricing, rounding: { ...pricing.rounding, stages: [] } })).toThrow(/rounding/i);
  });

  test("money accepts only integer minor units", () => {
    expect(money(usd, 1234)).toEqual({ currency: usd, cents: 1234 });
    expect(() => money(usd, 12.34)).toThrow(/integer/i);
  });

  test("SellingPriceDecision remains distinct from calculated price", () => {
    const decision: SellingPriceDecision = {
      kind: "unit_override", pricingResultId: pricing.id, calculatedUnitAmount: pricing.calculatedUnitAmount,
      calculatedLineAmount: pricing.calculatedLineAmount, resultingUnitAmount: money(usd, 1100), resultingLineAmount: money(usd, 2200),
      reason: "negotiated", decidedAt: "2026-08-15T00:00:00.000Z",
    };
    expect(assertSellingPriceDecision(decision, pricing)).toBe(decision);
    expect(() => assertSellingPriceDecision({ ...decision, kind: "calculated", resultingLineAmount: money(usd, 2200), resultingUnitAmount: money(usd, 1100) }, pricing)).toThrow(/cannot alter/i);
    expect(pricing.calculatedLineAmount.cents).toBe(2500);
    expect(decision.resultingLineAmount.cents).toBe(2200);
    expect(() => assertSalesLineSnapshot({ lineId: brandedId<"SalesLineId">("line-a"), productId: resolved.productId, description: "Fixture", quantity: 2, resolvedConfiguration: resolved, pricingResult: pricing, sellingPriceDecision: decision, calculatedLineAmount: pricing.calculatedLineAmount, sellingLineAmount: money(usd, 2300) })).toThrow(/totals/i);
    expect(() => assertSalesLineSnapshot({ lineId: brandedId<"SalesLineId">("line-b"), productId: resolved.productId, description: "Fixture", quantity: 3, resolvedConfiguration: resolved, pricingResult: pricing, sellingPriceDecision: decision, calculatedLineAmount: pricing.calculatedLineAmount, sellingLineAmount: decision.resultingLineAmount })).toThrow(/lineage/i);
  });

  test("checkpoint payload is frozen and line configuration exposes normalized facts, not a PBV2 tree", () => {
    const nested = { quantity: 2 };
    const checkpoint = freezeCheckpoint(Object.freeze({ schemaVersion: 1, lines: [{ resolvedConfiguration: resolved, nested }] }));
    expect(Object.isFrozen(checkpoint)).toBe(true);
    expect(Object.isFrozen(checkpoint.lines)).toBe(true);
    expect(Object.isFrozen(checkpoint.lines[0]!.nested)).toBe(true);
    expect(JSON.stringify(resolved)).not.toContain("treeJson");
  });

  test("pricing validates organization/product/configuration lineage", () => {
    const sellable = { organizationId: org, productId: resolved.productId, displayName: "Fixture", lifecycle: "active" as const, pricingConfiguration: { id: resolved.pricingConfigurationId, version: resolved.pricingConfigurationVersion, contentHash: "hash" }, requiresDimensions: false, pricingCurrency: usd };
    expect(assertPricingCalculationRequest({ organizationId: org, sellableProduct: sellable, resolvedConfiguration: resolved, pricingContext: { channel: "staff", effectiveAt: "2026-08-15T00:00:00.000Z" }, rules: { base: { perPieceCents: 100 } } })).toBeTruthy();
    expect(() => assertPricingCalculationRequest({ organizationId: brandedId<"OrganizationId">("org-b"), sellableProduct: sellable, resolvedConfiguration: resolved, pricingContext: { channel: "staff", effectiveAt: "2026-08-15T00:00:00.000Z" }, rules: { base: { perPieceCents: 100 } } })).toThrow(/organization/i);
  });

  test("quote conversion requires a preserved checkpoint identity rather than a repricing input", () => {
    const command: ConvertQuoteCommand = {
      organizationId: org, quoteId: brandedId<"QuoteId">("quote-a"), sourceCheckpointId: brandedId<"QuoteCheckpointId">("checkpoint-a"),
      businessRequestId: brandedId<"BusinessRequestId">("convert-a"), expectedStateToken: "quote-state-1",
    };
    expect(command.sourceCheckpointId).toBe("checkpoint-a");
    expect("pricingRequest" in command).toBe(false);
  });

  test("Order-backed synchronization is an input projection and does not make Sales own invoice rows", () => {
    const input: OrderBackedInvoiceSynchronizationInput = {
      organizationId: org, orderId: brandedId<"OrderId">("order-a"), businessRequestId: brandedId<"BusinessRequestId">("request-a"),
      customerContact: { organizationId: org, contactId: brandedId<"ContactId">("contact-a") }, currency: usd,
      salesLines: [], taxInput: {}, sourceSalesStateToken: "sales-state-1",
    };
    expect("invoiceLines" in input).toBe(false);
    expect("invoiceId" in input).toBe(false);
  });

  test("commercial module contracts do not import V1, POC, or persistence implementations", async () => {
    const sources = await Promise.all([
      "pricing/contracts.ts", "sales/contracts.ts", "billing/contracts.ts", "products/contracts.ts", "customers/contracts.ts", "routing/contracts.ts",
    ].map((file) => readFile(path.join(process.cwd(), "v2", "src", "modules", file), "utf8")));
    for (const source of sources) {
      expect(source).not.toMatch(/v2-poc|server\/(?:routes|services)|infrastructure\/persistence|from ["']pg["']/);
    }
  });
});
