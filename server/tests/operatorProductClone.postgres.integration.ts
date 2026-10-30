import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, jest, test } from "@jest/globals";
import { and, eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { optionTreeV2Schema } from "@shared/optionTreeV2";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import { organizations, users, products, materials, pbv2TreeVersions, aiConfigurableProductProposals, productOptions, aiExecutionPlans } from "@shared/schema";
import { db } from "../db";

import { createDrizzleCloneInactiveProductDraftStore } from "../services/assistant/cloneInactiveProductDraftPersistence";
import { CloneInactiveProductDraftService } from "../services/assistant/cloneInactiveProductDraftService";
import { createProductCloneApplicationTool } from "../services/assistant/productCloneApplicationTool";
import { resolveAssistantActorAuthority } from "../services/assistant/actorAuthorityResolver";

// Only native image processing is unrelated to this synthetic Product test.
jest.unstable_mockModule("sharp", () => ({ default: jest.fn() }));
let DrizzleAssistantRepository: typeof import("../storage/assistant.repo").DrizzleAssistantRepository;
let AssistantService: typeof import("../services/assistant/assistantService").AssistantService;
let ConfiguredAssistantOperatorDecisionProvider: typeof import("../services/assistant/operatorDecisionProvider").ConfiguredAssistantOperatorDecisionProvider;
let registerAssistantExecutionRoutes: typeof import("../routes/assistantExecution.routes").registerAssistantExecutionRoutes;
beforeAll(async () => {
  ({ DrizzleAssistantRepository } = await import("../storage/assistant.repo"));
  ({ AssistantService } = await import("../services/assistant/assistantService"));
  ({ ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider"));
  ({ registerAssistantExecutionRoutes } = await import("../routes/assistantExecution.routes"));
}, 120000);

const created: Array<{ orgId: string; userId: string }> = [];
const newName = "Transparent PET Film (non-adhesive)";
const permission = "assistant.products.clone_to_inactive_draft";
const context = assistantContextEnvelopeSchema.parse({ contextVersion: "v1", route: "/products", pageTitle: "Products", selectedRecordIds: [], activeFilters: [], capturedAt: new Date().toISOString(), unsavedChanges: false });

async function fixture() {
  const suffix = randomUUID();
  const [org] = await db.insert(organizations).values({ name: `Clone acceptance ${suffix}`, slug: `clone-${suffix}` }).returning();
  const [user] = await db.insert(users).values({ email: `clone-${suffix}@example.test`, firstName: "Clone", lastName: "Acceptance", role: "admin" }).returning();
  created.push({ orgId: org.id, userId: user.id });
  const [material] = await db.insert(materials).values({ organizationId: org.id, name: "Synthetic PET", sku: suffix, type: "roll", costPerUnit: "0.3712" }).returning();
  const [source] = await db.insert(products).values({ organizationId: org.id, name: "Translucent", description: "Synthetic configurable source", category: "Films", primaryMaterialId: material.id, requiresProductionJob: true, requiresProofApproval: true, artworkPolicy: "required", isTaxable: true, pricingMode: "area", measurementMode: "dimensions_required", sheetWidth: "54.00", sheetHeight: "120.00", pricingProfileConfig: { allowRotation: true, productionRoute: "synthetic-roll-print" }, optionsJson: [], priceBreaks: { enabled: true, type: "quantity", tiers: [{ minValue: 10, discountType: "percentage", discountValue: 7.5 }] } }).returning();
  const treeJson = {
    schemaVersion: 2, status: "ACTIVE", rootNodeIds: ["finish", "contour", "weed"], edges: [],
    nodes: {
      finish: { id: "finish", kind: "question", type: "INPUT", status: "ENABLED", key: "finish", label: "Finish", input: { type: "select", required: true, selectionKey: "finish", defaultValue: "gloss" }, choices: [{ value: "gloss", label: "Gloss", isDefault: true, pricingImpact: [] }, { value: "matte", label: "Matte", pricingImpact: [{ mode: "addPerSqft", amountCents: 75 }] }] },
      contour: { id: "contour", kind: "question", type: "INPUT", status: "ENABLED", key: "contour", label: "Contour", input: { type: "select", required: false, selectionKey: "contour", defaultValue: "no" }, choices: [{ value: "no", label: "No", pricingImpact: [] }, { value: "yes", label: "Yes", pricingImpact: [{ mode: "addPercent", basis: "base", percent: 10 }] }] },
      weed: { id: "weed", kind: "question", type: "INPUT", status: "ENABLED", key: "weed", label: "Weed and tape", input: { type: "select", required: false, selectionKey: "weed", defaultValue: "no" }, visibility: { rules: [{ type: "equals", selectionKey: "contour", value: "yes" }] }, choices: [{ value: "no", label: "No", pricingImpact: [] }, { value: "yes", label: "Yes", pricingImpact: [{ mode: "addPercent", basis: "base", percent: 20 }] }] },
    },
    meta: { pricingV2: { base: { perSqftCents: 437, perPieceCents: 0, minimumChargeCents: 1925 } }, materialId: material.id, productionRoute: "synthetic-roll-print", requiresProofApproval: true },
    pricingMatrix: { dimensions: ["finish"], rows: [{ id: "gloss", when: { finish: "gloss" }, variables: { base_price: 437 }, qtyTiers: [{ minQty: 1, maxQty: 9, perSqftCents: 437 }, { minQty: 10, perSqftCents: 391 }] }, { id: "matte", when: { finish: "matte" }, variables: { base_price: 512 } }] },
  };
  expect(optionTreeV2Schema.safeParse(treeJson).success).toBe(true);
  const [tree] = await db.insert(pbv2TreeVersions).values({ organizationId: org.id, productId: source.id, status: "ACTIVE", schemaVersion: 2, treeJson }).returning();
  await db.update(products).set({ pbv2ActiveTreeVersionId: tree.id }).where(eq(products.id, source.id));
  const repo = new DrizzleAssistantRepository();
  const scope = { organizationId: org.id, userId: user.id };
  const conversation = await repo.createConversation(scope);
  const authority = resolveAssistantActorAuthority({ actorUserId: user.id, organizationId: org.id, organizationRole: "admin", authenticationSource: "authenticated_request", tenantSource: "tenant_context" });
  expect(authority.grants).toContain(permission);
  const actor = { userId: user.id, email: user.email, permissions: authority.grants, ipAddress: null, userAgent: null };
  const trusted = { scope, actor, permissions: authority.grants, conversationId: conversation.id, context: { ...context, entityType: "product" as const, entityId: source.id }, correlationId: randomUUID(), goal: "Duplicate this Product" };
  const app = express(); app.use(express.json());
  let currentRole = "admin";
  registerAssistantExecutionRoutes(app, { isAuthenticated: (req, _res, next) => { Object.assign(req, { user: { id: user.id } }); next(); }, tenantContext: (req, _res, next) => { Object.assign(req, { organizationId: org.id, orgRole: currentRole }); next(); } });
  return { org, user, source, tree, treeJson, repo, scope, actor, trusted, app, conversation, changeRole: (role: string) => { currentRole = role; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function operator(f: Fixture, message: string, args: Record<string, unknown>, retainedId?: string) {
  const calls: string[] = [];
  const resolver = { resolveProvider: async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://provider.test", apiKey: "synthetic", model: "test" }) };
  // The provider transport is mocked. Actual AssistantService, configured
  // decision provider, capability discovery, adapters, resolver and stores run.
  const generateJson = jest.fn(async (input: any) => {
    const turn = JSON.parse(input.user);
    expect(turn.goal).toBe(message);
    expect(input.system).toContain("is a CLONE");
    expect(input.system).toContain("Never call products.begin_draft or products.apply_operations to reconstruct a clone");
    const names = turn.tools.map((tool: any) => tool.name);
    expect(names).toContain("application.operations");
    const observations = turn.observations;
    let decision: any;
    if (!observations.length) {
      calls.push("application.operations");
      decision = { kind: "call_tools", calls: [{ toolName: "application.operations", arguments: { query: "clone" } }] };
    } else if (observations.length === 1) {
      const operations = observations[0].result.operations;
      const clone = operations.find((operation: any) => operation.name === "products.clone_to_inactive_draft");
      expect(clone).toMatchObject({ confirmation: "GO after review" });
      expect(clone.inputSchema.properties.requestedChanges.additionalProperties).toBe(false);
      calls.push(clone.name);
      decision = { kind: "call_tools", calls: [{ toolName: "application.prepare_change", arguments: { operation: clone.name, arguments: args } }] };
    } else {
      const result = observations.at(-1);
      expect(result.status).toBe("succeeded");
      decision = result.result.candidates
        ? { kind: "ask_user", question: "Which saved source Product should I clone?", missingInformation: ["source Product selection"] }
        : { kind: "complete", response: "Review the protected clone proposal; GO is required. No Product has been created." };
    }
    return { rawText: JSON.stringify(decision) };
  });
  const provider = new ConfiguredAssistantOperatorDecisionProvider(f.org.id, { generateJson } as any, resolver as any);
  const dispatcher = { beginCanonicalProductDraft: jest.fn(), applyCanonicalProductOperations: jest.fn(), respondPlannedCanonicalProductIntent: jest.fn() };
  const service = new AssistantService(f.repo, { getCapabilities: async () => ({ enabled: true, toolsEnabled: true, providerConfigured: true }) }, undefined, undefined, undefined, undefined, dispatcher as any, () => provider, undefined, undefined, undefined, resolver as any);
  const result = await service.createTurn(f.scope, f.conversation.id, f.actor, { message, attachmentIds: [], context: retainedId ? { ...f.trusted.context, entityId: retainedId } : f.trusted.context });
  expect(dispatcher.beginCanonicalProductDraft).not.toHaveBeenCalled();
  expect(dispatcher.applyCanonicalProductOperations).not.toHaveBeenCalled();
  expect(generateJson).toHaveBeenCalledTimes(3);
  expect(calls).toEqual(["application.operations", "products.clone_to_inactive_draft"]);
  return result;
}

async function prepareGo(f: Fixture, turnId: string) {
  const response = await request(f.app).post(`/api/assistant/conversations/${f.conversation.id}/plans`).send({ turnId, context: f.trusted.context });
  expect(response.status).toBe(201);
  expect(response.body.data.plan.status).toBe("awaiting_confirmation");
  return response.body.data;
}
async function go(f: Fixture, prepared: any) {
  return request(f.app).post(`/api/assistant/plans/${prepared.plan.id}/confirmations`).send({ expectedPlanVersion: prepared.plan.planVersion, confirmationToken: prepared.confirmationToken, context: f.trusted.context });
}
async function rows(f: Fixture) { return db.select().from(products).where(eq(products.organizationId, f.org.id)); }
async function sourceReadback(f: Fixture) { return { product: (await rows(f)).find((row) => row.id === f.source.id), tree: (await db.select().from(pbv2TreeVersions).where(eq(pbv2TreeVersions.id, f.tree.id)))[0] }; }

afterEach(async () => {
  for (const row of created.splice(0)) {
    await db.delete(organizations).where(eq(organizations.id, row.orgId));
    await db.delete(users).where(eq(users.id, row.userId));
  }
});

describe("Operator clone integration on disposable PostgreSQL 16", () => {
  test.each([
    "Duplicate this Product and name it Transparent PET Film (non-adhesive). Keep everything else the same.",
    "Clone Translucent and name the copy Transparent PET Film (non-adhesive).",
    "Copy Translucent and rename it Transparent PET Film (non-adhesive). Keep all existing pricing and options.",
    "Make another Product identical to Translucent called Transparent PET Film (non-adhesive).",
    "Use Translucent as the starting point for Transparent PET Film (non-adhesive).",
  ])("natural-language → actual Operator discovery → clone → HTTP GO → persisted readback: %s", async (message) => {
    const f = await fixture(); const original = await sourceReadback(f);
    const result = await operator(f, message, { ...(message.includes("this Product") ? {} : { sourceQuery: "Translucent" }), requestedChanges: { newName } });
    const card: any = result.assistantMessage.structuredCards?.find((item: any) => item.kind === "action_proposal");
    expect(card.plan.action).toBe("products.clone_to_inactive_draft");
    expect(card.summary).toContain("Source unchanged");
    const store = createDrizzleCloneInactiveProductDraftStore();
    const proposal = await store.getProposal({ organizationId: f.org.id, proposalId: card.plan.proposalId });
    expect(proposal?.sourceProductId).toBe(f.source.id);
    expect(proposal?.preview.requestedChanges).toEqual({ newName });
    expect(proposal?.preview.source.pbv2Tree.treeJson).toEqual(f.treeJson);
    expect(await rows(f)).toHaveLength(1);
    const prepared = await prepareGo(f, result.turnId);
    expect(await rows(f)).toHaveLength(1); // even plan issuance cannot clone
    const executed = await go(f, prepared);
    expect(executed.status).toBe(200);
    expect(executed.body.data.result.status).toBe("succeeded");
    const details = executed.body.data.result.details.cloneInactiveDraft;
    expect(details).toMatchObject({ productName: newName, inactive: true, pbv2Status: "DRAFT", readbackVerified: true, sourceUnchanged: true });
    expect(details.editorLink).toBe(`/products/${details.productId}/edit?draftTreeVersionId=${details.pbv2TreeVersionId}`);
    const clone = (await rows(f)).find((row) => row.id === details.productId)!;
    expect(clone).toBeDefined(); expect(clone.isActive).toBe(false); expect(clone.pbv2ActiveTreeVersionId).toBeNull();
    for (const [key, value] of Object.entries(original.product!)) if (!["id", "name", "isActive", "pbv2ActiveTreeVersionId", "createdAt", "updatedAt"].includes(key)) expect((clone as any)[key]).toEqual(value);
    const [tree] = await db.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.productId, clone.id), eq(pbv2TreeVersions.id, details.pbv2TreeVersionId)));
    expect(tree.status).toBe("DRAFT"); expect(tree.treeJson).toEqual({ ...f.treeJson, status: "DRAFT" });
    expect(await sourceReadback(f)).toEqual(original);
    expect((await go(f, prepared)).body.data.result.details.cloneInactiveDraft.productId).toBe(clone.id);
    expect(await rows(f)).toHaveLength(2);
  });

  test("explicit current source wins over retained Product context", async () => {
    const f = await fixture();
    const [retained] = await db.insert(products).values({ organizationId: f.org.id, name: "Old unrelated context", description: "Must not clone" }).returning();
    const result = await operator(f, "Duplicate Translucent, name it Transparent PET Film (non-adhesive).", { sourceQuery: "Translucent", requestedChanges: { newName } }, retained.id);
    const card: any = result.assistantMessage.structuredCards?.find((item: any) => item.kind === "action_proposal");
    expect((await createDrizzleCloneInactiveProductDraftStore().getProposal({ organizationId: f.org.id, proposalId: card.plan.proposalId }))?.sourceProductId).toBe(f.source.id);
  });

  test("ambiguous sources use saved candidates and retain exact requested changes", async () => {
    const f = await fixture();
    await db.update(products).set({ name: "Translucent Gloss" }).where(eq(products.id, f.source.id));
    const [other] = await db.insert(products).values({ organizationId: f.org.id, name: "Translucent Matte", description: "Second candidate" }).returning();
    await db.insert(pbv2TreeVersions).values({ organizationId: f.org.id, productId: other.id, status: "DRAFT", schemaVersion: 2, treeJson: { ...f.treeJson, status: "DRAFT" } });
    const result = await operator(f, "Copy Translucent as Transparent PET Film (non-adhesive) at $4 per square foot.", { sourceQuery: "Translucent", requestedChanges: { newName, basePricing: { perSqftCents: 400 } } });
    const selection: any = result.assistantMessage.structuredCards?.find((item: any) => item.kind === "product_candidate_selection");
    expect(selection.details.candidates).toHaveLength(2);
    expect(result.assistantMessage.content).toContain("Translucent Gloss");
    expect(result.assistantMessage.content).toContain("Translucent Matte");
    expect(result.assistantMessage.content).toContain(f.source.id);
    expect(await rows(f)).toHaveLength(2);
    const continued = await operator(f, `Select ${f.source.id}`, { candidateId: f.source.id });
    const card: any = continued.assistantMessage.structuredCards?.find((item: any) => item.kind === "action_proposal");
    const proposal = await createDrizzleCloneInactiveProductDraftStore().getProposal({ organizationId: f.org.id, proposalId: card.plan.proposalId });
    expect(proposal?.preview.requestedChanges).toEqual({ newName, basePricing: { perSqftCents: 400 } });
    const executed = await go(f, await prepareGo(f, continued.turnId));
    expect(executed.body.data.result.status).toBe("succeeded");
    const readback = await createDrizzleCloneInactiveProductDraftStore().loadSource({ organizationId: f.org.id, productId: executed.body.data.result.details.cloneInactiveDraft.productId });
    expect(readback?.pbv2Tree.treeJson).toEqual({ ...f.treeJson, status: "DRAFT", meta: { ...f.treeJson.meta, pricingV2: { base: { ...f.treeJson.meta.pricingV2.base, perSqftCents: 400 } } } });
  });

  test.each(["tree", "proof", "name_collision", "expired"])("GO blocks %s changes without creating a clone", async (failure) => {
    const f = await fixture();
    const result = await operator(f, "Duplicate this Product and rename the copy.", { requestedChanges: { newName } });
    const prepared = await prepareGo(f, result.turnId);
    if (failure === "tree") await db.update(pbv2TreeVersions).set({ treeJson: { ...f.treeJson, nodes: {} }, updatedAt: new Date() }).where(eq(pbv2TreeVersions.id, f.tree.id));
    if (failure === "proof") await db.update(products).set({ requiresProofApproval: false }).where(eq(products.id, f.source.id));
    if (failure === "name_collision") await db.insert(products).values({ organizationId: f.org.id, name: newName, description: "Conflicting name" });
    if (failure === "expired") await db.update(aiExecutionPlans).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(aiExecutionPlans.id, prepared.plan.id));
    const response = await go(f, prepared);
    expect(response.status).toBe(409);
    expect(await rows(f)).toHaveLength(failure === "name_collision" ? 2 : 1);
  });

  test("unsupported related configuration is explicit and cannot produce partial success", async () => {
    const f = await fixture();
    await db.insert(productOptions).values({ productId: f.source.id, name: "Legacy option", type: "select" });
    const result = await createProductCloneApplicationTool().execute({ arguments: { requestedChanges: { newName } }, context: f.trusted });
    expect(result).toMatchObject({ status: "rejected", failureCode: "CLONE_CONFIGURATION_UNSUPPORTED", warning: expect.stringContaining("options") });
    expect(await rows(f)).toHaveLength(1);
  });

  test("missing source, cross-tenant source, invalid changes and unauthorized preparation fail closed", async () => {
    const f = await fixture(); const foreign = await fixture(); const tool = createProductCloneApplicationTool();
    const invoke = (args: Record<string, unknown>, trusted = f.trusted) => tool.execute({ arguments: args, context: trusted });
    expect(await invoke({ sourceQuery: "No such source", requestedChanges: { newName } })).toMatchObject({ status: "rejected", failureCode: "CLONE_SOURCE_NOT_FOUND" });
    expect(await invoke({ requestedChanges: { newName } }, { ...f.trusted, context: { ...f.trusted.context, entityId: foreign.source.id } })).toMatchObject({ status: "rejected", failureCode: "CLONE_SOURCE_NOT_FOUND" });
    expect(await invoke({ requestedChanges: { newName, inventedOptions: [] } })).toMatchObject({ status: "rejected", failureCode: "CLONE_ARGUMENTS_INVALID" });
    expect(await invoke({ requestedChanges: { newName } }, { ...f.trusted, permissions: [] })).toMatchObject({ status: "permission_denied" });
    expect(await rows(f)).toHaveLength(1);
  });

  test("permission loss before GO prevents execution", async () => {
    const f = await fixture();
    const turn = await operator(f, "Clone this Product and rename it.", { requestedChanges: { newName } });
    const prepared = await prepareGo(f, turn.turnId);
    f.changeRole("employee");
    expect((await go(f, prepared)).status).toBe(409);
    expect(await rows(f)).toHaveLength(1);
  });

  test("concurrent canonical clone transactions create only one Product", async () => {
    const f = await fixture();
    const result = await operator(f, "Duplicate this Product and rename it.", { requestedChanges: { newName } });
    // Exercise the canonical transaction race itself; UI GO gating is verified above.
    const card: any = result.assistantMessage.structuredCards?.find((item: any) => item.kind === "action_proposal");
    const clones = new CloneInactiveProductDraftService(createDrizzleCloneInactiveProductDraftStore());
    const replay = () => clones.execute({ organizationId: f.org.id, actorUserId: f.user.id, proposalId: card.plan.proposalId, proposalFingerprint: card.plan.proposalFingerprint, idempotencyKey: randomUUID() });
    const [first, second] = await Promise.all([replay(), replay()]);
    expect(first.productId).toBe(second.productId); expect([first.reused, second.reused].sort()).toEqual([false, true]); expect(await rows(f)).toHaveLength(2);
  });
});
