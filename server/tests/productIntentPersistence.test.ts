import { ProductIntentPersistenceService, type CanonicalProductIntentProposalRow, type CanonicalProductIntentProposalStore } from "../services/productIntentCompiler/productIntentPersistence";

function intent() {
  return {
    contractVersion: 1, intentId: "intent-1", organizationId: "org-1", revision: 0, state: "ready_for_review", operation: "new_product",
    identity: { name: "Stickers", description: "", category: { state: "resolved", id: "cat-1", label: "Print" } }, lifecycle: { productStatus: "inactive", published: false },
    measurement: { mode: "quantity_only" }, quantity: { behavior: "customer_entered", minimum: 1 }, pricing: { model: "scalar", unit: "per_piece", priceCents: 300 },
    material: { state: "explicitly_unset" }, optionGroups: [], workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: false },
    production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: {}, revisionMetadata: { parentRevision: null }, operationContext: {},
  } as const;
}
class MemoryStore implements CanonicalProductIntentProposalStore {
  rows = new Map<string, CanonicalProductIntentProposalRow>();
  async insert(input: Omit<CanonicalProductIntentProposalRow, "createdAt" | "updatedAt">) { const row = { ...structuredClone(input), createdAt: new Date(), updatedAt: new Date() }; if (Array.from(this.rows.values()).some((item) => item.organizationId === row.organizationId && item.conversationId && item.conversationId === row.conversationId)) throw new Error("unique"); this.rows.set(row.id, row); return structuredClone(row); }
  async getById(input: { organizationId: string; proposalId: string }) { const row = this.rows.get(input.proposalId); return row?.organizationId === input.organizationId ? structuredClone(row) : null; }
  async getByConversation(input: { organizationId: string; conversationId: string }) { return structuredClone(Array.from(this.rows.values()).find((row) => row.organizationId === input.organizationId && row.conversationId === input.conversationId) ?? null); }
  async compareAndSet(input: Parameters<CanonicalProductIntentProposalStore["compareAndSet"]>[0]) { const row = this.rows.get(input.proposalId); const revision = (row?.specification as any)?.session?.currentRevision; if (!row || row.organizationId !== input.organizationId || row.actorUserId !== input.actorUserId || row.fingerprint !== input.expectedFingerprint || revision !== input.expectedRevision) return null; const next = { ...row, specification: structuredClone(input.specification), fingerprint: input.fingerprint, status: input.status, updatedAt: new Date() }; this.rows.set(next.id, next); return structuredClone(next); }
}

describe("ProductIntentPersistenceService", () => {
  test("keeps canonical revisions append-only and rejects a stale patch", async () => {
    const service = new ProductIntentPersistenceService(new MemoryStore());
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "conversation-1", intent: intent() });
    const updated = await service.appendPatch({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.proposalId, expectedRevision: 0, expectedFingerprint: created.fingerprint, reason: "correction", patch: { contractVersion: 1, baseRevision: 0, preserveUnchanged: true, operations: [{ op: "set_pricing", value: { model: "scalar", unit: "per_piece", priceCents: 250 } }] } });
    expect(updated.specification.session.revisions).toHaveLength(2);
    await expect(service.appendPatch({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.proposalId, expectedRevision: 0, expectedFingerprint: created.fingerprint, reason: "correction", patch: { contractVersion: 1, baseRevision: 0, preserveUnchanged: true, operations: [{ op: "set_visibility", value: { catalogVisible: false } }] } })).rejects.toMatchObject({ code: "PRODUCT_INTENT_STALE_REVISION" });
  });

  test("loads historical V1 JSONB without canonical state and upgrades it on the next write", async () => {
    const store = new MemoryStore();
    const service = new ProductIntentPersistenceService(store);
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "historical-v1", intent: intent() });
    expect(created.specification.canonicalProposalState).toBeDefined();
    const historical = store.rows.get(created.proposalId)!;
    delete (historical.specification as any).canonicalProposalState;
    store.rows.set(created.proposalId, historical);
    const loaded = await service.load({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.proposalId });
    expect(loaded.specification.canonicalProposalState).toBeUndefined();
    const upgraded = await service.appendPatch({
      organizationId: "org-1", actorUserId: "user-1", proposalId: created.proposalId,
      expectedRevision: 0, expectedFingerprint: loaded.fingerprint, reason: "correction",
      patch: { contractVersion: 1, baseRevision: 0, preserveUnchanged: true, operations: [{ op: "set_pricing", value: { model: "scalar", unit: "per_piece", priceCents: 275 } }] },
    });
    expect(upgraded.specification.canonicalProposalState).toMatchObject({
      productConfiguration: { name: "Stickers", category: "Print", measurementMode: "quantity_only" },
      pbv2OptionConfigurationBatches: [],
    });
    expect(upgraded.specification.session.revisions.at(-1)!.intent.pricing).toEqual({ model: "scalar", unit: "per_piece", priceCents: 275 });
  });
});
