import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import type { OperationContext } from "../../src/application/operation.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import { calculatedDecision } from "../../src/modules/sales/quoteApplication.js";
import { orderEditWorkspaceChangeSet } from "../../src/modules/sales/orderEditWorkspace.js";
import { SalesWorkspaceApplicationService, authorizeSalesWorkspace, getAuthorizedSalesWorkspace, validateSalesWorkspaceHeader } from "../../src/modules/sales/workspaceApplication.js";
import { SalesWorkspaceLineService, workspaceLineCommercialChanged, workspaceSourceLineInput } from "../../src/modules/sales/workspaceLines.js";
import type { SalesWorkspace, SalesWorkspaceStore, SalesWorkspaceTransaction } from "../../src/modules/sales/workspaceContracts.js";
import type { SalesLineSnapshot } from "../../src/modules/sales/contracts.js";
import { brandedId, currencyCode, money } from "../../src/modules/shared/commercialValues.js";

const org = "61000000-0000-4000-8000-000000000001", user = "61000000-0000-4000-8000-000000000002";
const context: OperationContext = { organizationId: org, operationId: "sales.workspace.order_edit", principal: {
  kind: "staff", organizationId: org, userId: user, authority: { membershipId: "verified", capabilities: ["order.view", "order.edit"] },
} };
describe("Order edit workspace source-aware TEMP commands", () => {
  let workspace: SalesWorkspace;
  let source: SalesLineSnapshot;
  let previews = 0;
  let store: SalesWorkspaceStore;
  let lines: SalesWorkspaceLineService;
  beforeEach(async () => {
    const organizationId = brandedId<"OrganizationId">(org), productId = brandedId<"ProductId">(randomUUID());
    const pricingConfigurationId = brandedId<"PricingConfigurationId">(randomUUID());
    const resolvedConfiguration = { schemaVersion: 1 as const, organizationId, productId, pricingConfigurationId,
      pricingConfigurationVersion: "historical", pricingConfigurationContentHash: "historical-inactive", quantity: 2,
      selections: { finish: "retired-option" }, derivedFacts: {}, productFacts: {} };
    const pricingResult = await new V2PricingParityAdapter().calculate({ organizationId, resolvedConfiguration,
      sellableProduct: { organizationId, productId, lifecycle: "active", displayName: "Historical", requiresDimensions: false,
        pricingConfiguration: { id: pricingConfigurationId, version: "historical", contentHash: "historical-inactive" }, pricingCurrency: currencyCode("USD") },
      rules: { base: { perPieceCents: 100 } }, pricingContext: { channel: "staff", effectiveAt: "2026-10-01T00:00:00Z" } });
    const calculated = calculatedDecision(pricingResult, { kind: "calculated" }, { principalKind: "staff", subjectId: user });
    source = { lineId: brandedId<"SalesLineId">(randomUUID()), productId, description: "Frozen line", quantity: 2,
      resolvedConfiguration, pricingResult, sellingPriceDecision: { ...calculated, kind: "locked", reason: "Historic approval",
        resultingUnitAmount: money(currencyCode("USD"), 75), resultingLineAmount: money(currencyCode("USD"), 150) },
      calculatedLineAmount: pricingResult.calculatedLineAmount, sellingLineAmount: money(currencyCode("USD"), 150),
      operationalNote: "Original staff note", taxability: { taxable: false, source: "product" } };
    const id = randomUUID(), orderId = brandedId<"OrderId">(randomUUID());
    const sourceHeader = { organizationId, orderId, customerContact: { organizationId, customerId: brandedId<"CustomerId">(randomUUID()) },
      jobLabel: "Original label", currency: currencyCode("USD"), terms: { commercialNotes: "Existing commercial note" }, commercialState: "open" as const };
    workspace = { id, organizationId: org, creatorUserId: user, kind: "order_edit", state: "draft", sourceDocumentKind: "order",
      sourceDocumentId: orderId, baseRevision: "7", sourceHeader, sourceArtifactFingerprint: "a".repeat(64),
      revision: 1, header: { customerContact: sourceHeader.customerContact, jobLabel: sourceHeader.jobLabel, terms: sourceHeader.terms },
      lines: [{ id: randomUUID(), workspaceId: id, position: 0, sourcePosition: 0, sourceLineId: source.lineId,
        sourceLineSnapshot: source, operationalNote: source.operationalNote, input: workspaceSourceLineInput(source), revision: 1 }],
      removedLines: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
    previews = 0;
    const tx = { getKind: async () => workspace.kind, get: async () => workspace, getRequest: async () => null,
      putLine: async () => {}, invalidatePreviews: async () => {}, recordRequest: async () => {},
      update: async (next: SalesWorkspace) => { workspace = next; }, reorderLines: async () => {}, deleteLine: async () => {},
    } as unknown as SalesWorkspaceTransaction;
    store = { run: async (action) => action(tx), withWorkspace: async (_context, _id, _revision, action) => action(tx, workspace) };
    lines = new SalesWorkspaceLineService(store, { pricing: () => ({ preview: async () => { previews++; throw new Error("ACTIVE Product lookup must not occur"); } }), releaseLineArtwork: async () => {} });
  });
  it("retains full locked historical evidence without manufacturing a calculated instruction", () => {
    expect(workspace.lines[0].input.selling).toBeUndefined();
    expect(workspace.lines[0].sourceLineSnapshot).toEqual(source);
    expect(workspaceLineCommercialChanged(workspace.lines[0])).toBe(false);
    expect(orderEditWorkspaceChangeSet(workspace)).toMatchObject({ changed: false, repricesLines: false, lineChanges: [], patch: {} });
  });
  it("edits source descriptions/operational notes and headers without ACTIVE resolution", async () => {
    const sourceInput = workspace.lines[0].input;
    const edited = await lines.update(context, workspace.id, { requestId: randomUUID(), expectedRevision: 1,
      lineId: workspace.lines[0].id, line: { ...sourceInput, description: "Presentation only" }, operationalNote: "Updated note",
      header: { ...workspace.header, jobLabel: "Updated label", notes: "Workspace-only note" } });
    expect(previews).toBe(0);
    expect(edited.lines[0].sourceLineSnapshot).toEqual(source);
    expect(orderEditWorkspaceChangeSet(edited)).toMatchObject({ changed: true, repricesLines: false,
      patch: { jobLabel: "Updated label" },
      lineChanges: [{ kind: "update_description", lineId: source.lineId, description: "Presentation only" },
        { kind: "update_note", lineId: source.lineId, note: "Updated note" }] });
    const refreshed = await lines.refresh(context, workspace.id, { requestId: randomUUID(), expectedRevision: edited.revision });
    expect(previews).toBe(0);
    expect(refreshed.lines[0].sourceLineSnapshot).toEqual(source);
  });
  it("workspace notes remain metadata while canonical commercial notes use terms only", () => {
    const metadata = { ...workspace, header: { ...workspace.header, notes: "Workspace-only note" } };
    expect(orderEditWorkspaceChangeSet(metadata)).toMatchObject({ changed: false, lineChanges: [], patch: {} });
    const commercial = { ...metadata, header: { ...metadata.header, terms: { commercialNotes: "Canonical commercial note" } } };
    expect(orderEditWorkspaceChangeSet(commercial)).toMatchObject({ changed: true, patch: { terms: { commercialNotes: "Canonical commercial note" } } });
  });
  it.each<[string | undefined, string | undefined]>([
    [undefined, ""], [undefined, "   "], ["  Historical Job  ", "Historical Job"], ["   ", undefined],
  ])("Job Label owner equivalence (%p, %p) does not rewrite source evidence", (original, edited) => {
    const candidate = { ...workspace, sourceHeader: { ...workspace.sourceHeader!, jobLabel: original },
      header: { ...workspace.header, jobLabel: edited } };
    expect(orderEditWorkspaceChangeSet(candidate)).toMatchObject({ changed: false, patch: {}, lineChanges: [] });
    expect(candidate.sourceHeader.jobLabel).toBe(original);
    expect(candidate.header.jobLabel).toBe(edited);
  });
  it("blocks a historical locked reprice without changing the canonical generic policy", async () => {
    await expect(lines.update(context, workspace.id, { requestId: randomUUID(), expectedRevision: 1, lineId: workspace.lines[0].id,
      line: { ...workspace.lines[0].input, quantity: 3 } })).rejects.toMatchObject({ code: "CONFLICT", context: { reason: "unsupported_source_selling_rebuild" } });
    expect(previews).toBe(0);
    expect(workspace.revision).toBe(1);
  });
  it("does not coerce discounted source evidence either", () => {
    const discounted = { ...source, sellingPriceDecision: { ...source.sellingPriceDecision, kind: "discount" as const, discountBasisPoints: 2500 as never, reason: "Historical discount" } };
    const line = { ...workspace.lines[0], sourceLineSnapshot: discounted, input: workspaceSourceLineInput(discounted) };
    expect(line.input.selling).toBeUndefined();
    expect(workspaceLineCommercialChanged(line)).toBe(false);
  });
  it.each(["locked", "discount"] as const)("blocks %s rebuilds even if a UI supplies its calculated default", async (kind) => {
    const frozen: SalesLineSnapshot = { ...source, sellingPriceDecision: kind === "locked" ? source.sellingPriceDecision
      : { ...source.sellingPriceDecision, kind: "discount", reason: "Historical discount", discountBasisPoints: 2500 as never } };
    workspace = { ...workspace, lines: [{ ...workspace.lines[0], sourceLineSnapshot: frozen, input: workspaceSourceLineInput(frozen) }] };
    const replacement = { ...workspace.lines[0].input, quantity: 3, selling: { kind: "calculated" as const } };
    await expect(lines.update(context, workspace.id, { requestId: randomUUID(), expectedRevision: 1, lineId: workspace.lines[0].id, line: replacement }))
      .rejects.toMatchObject({ code: "CONFLICT", context: { reason: "unsupported_source_selling_rebuild" } });
    expect(() => orderEditWorkspaceChangeSet({ ...workspace, lines: [{ ...workspace.lines[0], input: replacement }] })).toThrow(/cannot be rebuilt/);
    expect(previews).toBe(0);
  });
  it("keeps removed source history and creates final ordering references only for live lines", () => {
    const removed = workspace.lines[0];
    const added = { id: randomUUID(), workspaceId: workspace.id, position: 0, revision: 1, input: { productId: randomUUID(), quantity: 1 } };
    const diff = orderEditWorkspaceChangeSet({ ...workspace, lines: [added], removedLines: [removed] });
    expect(diff.lineChanges).toEqual([{ kind: "add", line: { ...added.input, clientLineKey: added.id } }, { kind: "remove", lineId: source.lineId }]);
    expect(diff.finalLineOrder).toEqual([{ clientLineKey: added.id }]);
    expect(diff.repricesLines).toBe(true);
  });
  it("blocks combined customer change plus new/changed commercial lines before an owner call", () => {
    const next = { ...workspace, header: { ...workspace.header, customerContact: { ...workspace.header.customerContact!, customerId: brandedId<"CustomerId">(randomUUID()) } },
      lines: [...workspace.lines, { id: randomUUID(), workspaceId: workspace.id, position: 1, revision: 1,
        input: { productId: randomUUID(), quantity: 3, selling: { kind: "calculated" as const } } }] };
    expect(() => orderEditWorkspaceChangeSet(next)).toThrow(/Customer changes combined/);
  });
  it("requires fresh view/edit, Staff scope and exact creator, not create authority", async () => {
    expect(authorizeSalesWorkspace(context, workspace).userId).toBe(user);
    for (const capabilities of [["order.view"], ["order.edit"], ["order.create"], []]) {
      const actor: OperationContext = { ...context, principal: { ...context.principal as Extract<OperationContext["principal"], { kind: "staff" }>, authority: { membershipId: "verified", capabilities: capabilities as never } } };
      expect(() => authorizeSalesWorkspace(actor, workspace)).toThrow(/authority/);
    }
    expect(() => authorizeSalesWorkspace({ ...context, organizationId: randomUUID() }, workspace)).toThrow();
    expect(() => authorizeSalesWorkspace(context, { ...workspace, creatorUserId: randomUUID() })).toThrow(/not found/);
    await expect(new SalesWorkspaceApplicationService(store).create(context, { requestId: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not accept writable source snapshots inside header JSON", () => {
    expect(() => validateSalesWorkspaceHeader({ ...workspace.header, sourceHeader: workspace.sourceHeader }, org)).toThrow(/Invalid workspace header/);
  });
  it.each(["draft", "promoting", "promoted"] as const)("rejects quote_edit %s at the scoped access boundary before full read or cached replay", async (state) => {
    const actor: OperationContext = { ...context, principal: { kind: "staff", organizationId: org, userId: user,
      authority: { membershipId: "verified", capabilities: ["quote.create"] } } };
    const unsupported: SalesWorkspace = { ...workspace, kind: "quote_edit", state };
    const get = jest.fn(async () => unsupported), getRequest = jest.fn(async () => ({ operation: "save_draft", result: unsupported }));
    const tx = { getKind: jest.fn(async (organizationId: string, creator: string, id: string) =>
      organizationId === org && creator === user && id === workspace.id ? "quote_edit" : null), get, getRequest } as unknown as SalesWorkspaceTransaction;
    const scopedStore: SalesWorkspaceStore = { run: (action) => action(tx), withWorkspace: async () => { throw new Error("Unexpected broad access"); } };
    const service = new SalesWorkspaceApplicationService(scopedStore);
    const rejection = { code: "CONFLICT", context: { reason: "workspace_kind_unsupported" } };
    await expect(getAuthorizedSalesWorkspace(tx, actor, workspace.id)).rejects.toMatchObject(rejection);
    await expect(service.get(actor, workspace.id)).rejects.toMatchObject(rejection);
    await expect(service.saveDraft(actor, workspace.id, { requestId: randomUUID(), expectedRevision: unsupported.revision, header: unsupported.header })).rejects.toMatchObject(rejection);
    expect(get).not.toHaveBeenCalled(); expect(getRequest).not.toHaveBeenCalled();
    await expect(service.get({ ...actor, principal: { ...actor.principal as Extract<OperationContext["principal"], { kind: "staff" }>, userId: randomUUID() } }, workspace.id))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(() => authorizeSalesWorkspace(actor, { ...unsupported, creatorUserId: randomUUID() })).toThrow(/not found/);
    expect(() => authorizeSalesWorkspace(actor, { ...unsupported, organizationId: randomUUID() })).toThrow(/not found/);
    // Legacy transaction ports without getKind must still reject before disclosure.
    await expect(getAuthorizedSalesWorkspace({ get } as unknown as SalesWorkspaceTransaction, actor, workspace.id)).rejects.toMatchObject(rejection);
  });
  it("rejects stale TEMP revisions before source pricing or mutation", async () => {
    await expect(lines.update(context, workspace.id, { requestId: randomUUID(), expectedRevision: 2, lineId: workspace.lines[0].id,
      line: workspace.lines[0].input, operationalNote: "Should not apply" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(previews).toBe(0);
    expect(workspace.revision).toBe(1);
  });
});
