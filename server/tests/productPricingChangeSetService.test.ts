import { ProductPricingChangeSetService, applyPricingOperation, fingerprintProductPricingTarget, type ProductPricingCanonicalService, type ProductPricingChangeSet, type ProductPricingChangeSetStore } from "../services/assistant/productPricingChangeSetService";

function target(id: string, cents = 450, active = true) { const value: any = { productId: id, productName: id, active, activeTreeVersionId: "tree-1", pricing: { perSqftCents: cents, perPieceCents: null, minimumChargeCents: 2500 }, fingerprint: "" }; value.fingerprint = fingerprintProductPricingTarget(value); return value; }

describe("product pricing change sets", () => {
  it("rounds a persisted 5% scalar increase in integer cents", () => {
    expect(applyPricingOperation({ perSqftCents: 475 }, { kind: "percent", field: "perSqftCents", percent: 5 })).toEqual({ perSqftCents: 499 });
  });

  it("uses exact proposed values once and preserves active lifecycle state", async () => {
    const current = target("active-flatbed"); let saved: ProductPricingChangeSet | null = null;
    const canonical: ProductPricingCanonicalService = { loadExactTargets: async () => [current], loadProduct: async () => current, applyConfirmedPricing: async ({ values }) => { current.pricing = { ...current.pricing, ...values }; current.fingerprint = fingerprintProductPricingTarget(current); return { fingerprint: current.fingerprint, values, active: true, activeTreeVersionId: "tree-2" }; } };
    const store: ProductPricingChangeSetStore = { create: async (input) => (saved = { id: "set-1", ...input }), get: async () => saved, markConfirmed: async () => {}, markRow: async () => {}, complete: async () => {}, markRollback: async () => {} };
    const service = new ProductPricingChangeSetService(canonical, store);
    const proposal = await service.createProposal({ organizationId: "org", requestSummary: "Increase active Flatbed by 5%", selector: { active: true, route: "Flatbed" }, operation: { kind: "percent", field: "perSqftCents", percent: 5 } });
    await expect(service.execute({ organizationId: "org", actorUserId: "actor", changeSetId: proposal.id, fingerprint: proposal.fingerprint, planId: "plan", idempotencyKey: "key", correlationId: "corr" })).resolves.toMatchObject({ succeeded: 1, failed: 0, conflicted: 0 });
    expect(current.pricing.perSqftCents).toBe(473);
    expect(current.active).toBe(true);
  });

  it("does not roll back a later manual edit", async () => {
    const current = target("active-flatbed", 473); const saved: ProductPricingChangeSet = { id: "set-1", organizationId: "org", requestSummary: "x", selector: {}, operation: { kind: "percent", field: "perSqftCents", percent: 5 }, fingerprint: "f", rows: [{ productId: current.productId, productName: current.productName, activeSnapshot: true, activeTreeVersionId: "tree-1", beforeValues: { perSqftCents: 450 }, proposedValues: { perSqftCents: 473 }, sourceFingerprint: "old", executionState: "succeeded" }] };
    const canonical: ProductPricingCanonicalService = { loadExactTargets: async () => [], loadProduct: async () => ({ ...current, pricing: { ...current.pricing, perSqftCents: 500 } }), applyConfirmedPricing: async () => { throw new Error("must not apply"); } };
    const marks: any[] = []; const store: ProductPricingChangeSetStore = { create: async () => saved, get: async () => saved, markConfirmed: async () => {}, markRow: async () => {}, complete: async () => {}, markRollback: async (value) => { marks.push(value); } };
    await expect(new ProductPricingChangeSetService(canonical, store).rollback({ organizationId: "org", actorUserId: "actor", changeSetId: "set-1", correlationId: "corr" })).resolves.toEqual({ restored: 0, conflicted: 1, failed: 0 });
    expect(marks[0].state).toBe("conflicted");
  });
});
