import { currentTurnProductFact, currentTurnProductResolution, existingProductIdForMutation, taskForCurrentProductEvidence } from "../services/assistant/trustedProductState";

const productObservation = (id: string, status: "active" | "inactive" = "inactive") => ({
  step: 1, toolName: "products.get_summary", status: "succeeded" as const,
  result: { status: "succeeded" as const, data: { product: { id, name: id === "styrene" ? ".040 Styrene Signs" : "Product", active: status === "active", status } }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-13T00:00:00.000Z" } } },
});

describe("trusted current-turn Product state", () => {
  it("prefers the current inactive Product over a retained active Product", () => {
    const observations = [productObservation("styrene")];
    expect(existingProductIdForMutation({ context: {}, task: { entityReferences: [{ type: "product", id: "coroplast" }] }, analysisObservations: observations })).toBe("styrene");
    expect(currentTurnProductResolution(observations)).toEqual({ attempted: true, productId: "styrene", ambiguous: false });
    expect(currentTurnProductFact(observations)).toEqual({ productId: "styrene", name: ".040 Styrene Signs", lifecycle: "inactive" });
    expect(currentTurnProductFact([productObservation("active_product", "active")])).toMatchObject({ productId: "active_product", lifecycle: "active" });
  });

  it("fails closed after an ambiguous or unsuccessful current Product read", () => {
    const ambiguous = { ...productObservation("one"), result: { ...productObservation("one").result, data: { product: {} } } };
    expect(existingProductIdForMutation({ context: {}, task: { entityReferences: [{ type: "product", id: "coroplast" }] }, analysisObservations: [ambiguous] })).toBeNull();
    expect(existingProductIdForMutation({ context: {}, task: { entityReferences: [{ type: "product", id: "coroplast" }] }, analysisObservations: [{ step: 1, toolName: "products.get_summary", status: "not_found" }] as any })).toBeNull();
  });

  it("accepts only a unique Product-only global search result", () => {
    const search = { step: 1, toolName: "search.global", status: "succeeded" as const, result: { status: "succeeded" as const, data: { matches: [{ entityType: "product", recordId: "styrene" }] }, provenance: { sourceLinks: [], freshness: { capturedAt: "2026-08-13T00:00:00.000Z" } } } };
    expect(currentTurnProductResolution([search] as any).productId).toBe("styrene");
    const mixed = { ...search, result: { ...search.result, data: { matches: [{ entityType: "product", recordId: "styrene" }, { entityType: "customer", recordId: "customer" }] } } };
    expect(currentTurnProductResolution([mixed] as any)).toMatchObject({ attempted: true, productId: null, ambiguous: true });
  });

  it("masks stale Product task state for provider continuation", () => {
    const task: any = { id: "task", domain: "products", canonicalProductIntentProposalId: null, entityReferences: [{ type: "product", id: "coroplast" }], trustedObservations: [{ toolName: "products.get_summary", data: { product: { id: "coroplast", active: true } }, capturedAt: "2026-08-12T00:00:00.000Z" }], businessContext: { existingProduct: { name: "Coroplast", lifecycle: "active", pricingLifecycle: "ACTIVE", optionGroups: [] }, recentCompletedTurn: { response: "active" } } };
    const normalized = taskForCurrentProductEvidence(task, [productObservation("styrene")]);
    expect(normalized?.entityReferences).toEqual([{ type: "product", id: "styrene" }]);
    expect(normalized?.trustedObservations).toEqual([]);
    expect(normalized?.businessContext?.existingProduct).toBeNull();
    expect(normalized?.businessContext?.recentCompletedTurn).toBeNull();
    expect(normalized?.businessContext?.businessStateSummary).toBe('Current trusted Product ".040 Styrene Signs" is inactive.');
  });
});
