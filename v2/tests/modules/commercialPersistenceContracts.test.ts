import { describe, expect, test } from "@jest/globals";
import { assertExpectedSalesDocumentRevision, toQuoteCheckpointPersistenceEnvelope, toSalesDocumentTermsPersistence, toSalesLinePersistenceEnvelope } from "../../src/modules/sales/persistenceContracts";
import { brandedId, currencyCode, decimalText, money, type OrganizationId } from "../../src/modules/shared/commercialValues";
import type { PricingResult, ResolvedProductConfiguration } from "../../src/modules/pricing/contracts";
import type { QuoteCheckpoint, SalesLineSnapshot, SellingPriceDecision } from "../../src/modules/sales/contracts";

const organizationId = brandedId<"OrganizationId">("commercial-persistence-org");
const currency = currencyCode("USD");
const resolved: ResolvedProductConfiguration = {
  schemaVersion: 1, organizationId, productId: brandedId<"ProductId">("product"), pricingConfigurationId: brandedId<"PricingConfigurationId">("config"),
  pricingConfigurationVersion: "1", pricingConfigurationContentHash: "config-hash", quantity: 2, selections: {}, derivedFacts: {}, productFacts: {},
};
const pricing: PricingResult = {
  schemaVersion: 1, id: brandedId<"PricingResultId">("pricing"), evidenceFingerprint: "pricing-evidence", organizationId, currency,
  calculatedUnitAmount: money(currency, 1001), calculatedLineAmount: money(currency, 2001),
  unitAmountEvidence: { exactUnitCents: decimalText("1000.5"), allocation: "rounded_line_total_divided_by_quantity" },
  components: [{ kind: "base", label: "base", amount: money(currency, 2001) }], optionImpacts: [], minimumChargeApplied: false,
  evaluator: { id: "pricing", version: "1" }, rounding: { policyId: "half-up", policyVersion: "1", stages: [{ stage: "line", mode: "half-up", precision: 2 }] }, normalizedInput: resolved, warnings: [],
};
const decision: SellingPriceDecision = {
  kind: "total_override", pricingResultId: pricing.id, calculatedUnitAmount: pricing.calculatedUnitAmount, calculatedLineAmount: pricing.calculatedLineAmount,
  resultingUnitAmount: money(currency, 900), resultingLineAmount: money(currency, 1800), reason: "negotiated", decidedAt: "2026-08-15T00:00:00.000Z",
};
const line: SalesLineSnapshot = { lineId: brandedId<"SalesLineId">("line"), productId: resolved.productId, description: "Product", quantity: 2, resolvedConfiguration: resolved, pricingResult: pricing, sellingPriceDecision: decision, calculatedLineAmount: pricing.calculatedLineAmount, sellingLineAmount: decision.resultingLineAmount };

describe("M1.6 commercial persistence contracts", () => {
  test("freezes self-contained Pricing and Selling evidence while retaining queryable monetary projections", () => {
    const envelope = toSalesLinePersistenceEnvelope(line);
    expect(envelope.calculatedLineAmount.cents).toBe(2001);
    expect(envelope.sellingLineAmount.cents).toBe(1800);
    expect(envelope.canonicalPricingResult).toContain("pricing-evidence");
    expect(envelope.canonicalSellingPriceDecision).toContain("negotiated");
    expect(envelope.canonicalResolvedConfiguration).not.toContain("treeJson");
  });

  test("uses a revision state token rather than silently overwriting concurrent current state", () => {
    expect(() => assertExpectedSalesDocumentRevision("4", 4)).not.toThrow();
    expect(() => assertExpectedSalesDocumentRevision("3", 4)).toThrow(/STALE_STATE/);
    expect(() => assertExpectedSalesDocumentRevision("bad", 4)).toThrow(/STALE_STATE/);
  });

  test("maps terms once so scalar header facts cannot be duplicated in terms JSON", () => {
    expect(toSalesDocumentTermsPersistence({ termsCode: "NET30", taxContextReference: "tax-a", salesRepresentativeId: "rep-a", commercialNotes: "note" })).toEqual({
      termsJson: { termsCode: "NET30" }, taxContextReference: "tax-a", salesRepresentativeId: "rep-a", commercialNotes: "note",
    });
  });

  test("checkpoint persistence is a canonical immutable-boundary envelope, not current-state versioning", () => {
    const checkpoint: QuoteCheckpoint = {
      schemaVersion: 1, checkpointId: brandedId<"QuoteCheckpointId">("checkpoint"), evidenceFingerprint: "checkpoint-evidence", organizationId,
      occurredAt: "2026-08-15T00:00:00.000Z", principal: { principalKind: "staff", subjectId: "staff" }, customerPresentation: { customerDisplayName: "Customer" },
      commercial: { currency, terms: {}, lines: [line] }, kind: "quote_sent", sourceDocument: { quoteId: brandedId<"QuoteId">("quote") },
    };
    const envelope = toQuoteCheckpointPersistenceEnvelope(checkpoint);
    expect(envelope.checkpointKind).toBe("quote_sent");
    expect(envelope.canonicalPayload).toContain("checkpoint-evidence");
    expect(envelope.canonicalPayload).toContain("pricing-evidence");
  });
});
