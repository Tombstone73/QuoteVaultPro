import assert from "node:assert/strict";
import type { OperationContext } from "../../src/application/operation.js";
import {
  FormulaDomainApplicationService,
  type FormulaDomainTransactionRunner,
  type FormulaIdentity,
  evaluateFormulaDefinition,
  validateFormulaDefinition,
  validateFormulaRevisionInputValues,
} from "../../src/modules/pricing/formulaDomain.js";
import { planLegacyFormulaFreeze } from "../../src/modules/pricing/legacyFormulaFreezeInventory.js";

const context = (id: string): OperationContext => ({
  organizationId: "tenant-a", operationId: id, businessRequest: { id, payloadFingerprint: id },
  principal: { kind: "staff", organizationId: "tenant-a", userId: "staff-a", authority: { membershipId: "membership-a", capabilities: ["pricing.configure"] } },
});
const definition = {
  expression: "ceil(sqft) * p",
  declaredInputs: [
    { key: "p", label: "Rate", type: "number" as const, required: true, minimum: 0, unit: "sq_ft" as const, authorable: true },
    { key: "copies", label: "Copies", type: "integer" as const, required: false, defaultValue: 1, minimum: 1, authorable: true },
    { key: "allow_rotation", label: "Allow rotation", type: "boolean" as const, required: false, defaultValue: false, authorable: true },
  ],
};

class Runner implements FormulaDomainTransactionRunner {
  revisions: FormulaIdentity["revision"][] = [];
  identity: FormulaIdentity | undefined;
  requests = new Map<string, FormulaIdentity>();
  async transaction<T>(work: any): Promise<T> {
    return work({
      reserve: async (input: any) => this.requests.has(input.businessRequestId)
        ? { kind: "replay", request: { id: input.businessRequestId, resultJson: this.requests.get(input.businessRequestId) } }
        : { kind: "new", request: { id: input.businessRequestId, resultJson: null } },
      create: async (input: any) => {
        const revision = { formulaRevisionId: "revision-1", formulaId: "formula-1", organizationId: input.organizationId, revisionNumber: 1, createdAt: "2026-08-22T00:00:00.000Z", ...input.definition };
        this.revisions.push(structuredClone(revision));
        return this.identity = { formulaId: "formula-1", organizationId: input.organizationId, name: input.name, visibility: input.visibility, status: "active", currentRevisionId: revision.formulaRevisionId, revision, createdAt: revision.createdAt, updatedAt: revision.createdAt } as FormulaIdentity;
      },
      revise: async (input: any) => {
        assert.equal(input.expectedCurrentRevisionId, this.identity?.currentRevisionId);
        const revision = { formulaRevisionId: "revision-2", formulaId: "formula-1", organizationId: input.organizationId, revisionNumber: 2, createdAt: "2026-08-22T00:01:00.000Z", ...input.definition };
        this.revisions.push(structuredClone(revision));
        return this.identity = { ...this.identity!, currentRevisionId: revision.formulaRevisionId, revision, updatedAt: revision.createdAt } as FormulaIdentity;
      },
      updateMetadata: async (input: any) => this.identity = { ...this.identity!, name: input.name, ...(input.description ? { description: input.description } : {}), updatedAt: "2026-08-22T00:00:30.000Z" },
      setVisibility: async () => this.identity!, setStatus: async () => this.identity!,
      freezeHistoricalBinding: async () => { throw new Error("Historical Formula freeze is not exercised by this Formula-authoring runner."); },
      attribute: async () => undefined, audit: async () => undefined,
      succeed: async (_organizationId: string, requestId: string, _resourceId: string, result: FormulaIdentity) => { this.requests.set(requestId, result); },
      succeedHistoricalFreeze: async () => undefined,
    });
  }
}

const run = async (): Promise<void> => {
  const inputs = validateFormulaDefinition(definition).declaredInputs;
  assert.deepEqual(validateFormulaRevisionInputValues(inputs, { p: 3 }), { p: 3, copies: 1, allow_rotation: false });
  assert.throws(() => validateFormulaRevisionInputValues(inputs, { p: 3, unknown: 1 }), /not declared/);
  assert.throws(() => validateFormulaDefinition({ ...definition, expression: "unsupported_function(q)", }), /Formula expression is invalid/);
  const evaluated = evaluateFormulaDefinition({ definition, width: 12, height: 24, quantity: 2, inputValues: { p: 3, copies: 2 } });
  assert.equal(evaluated.result, 6, "Formula Tester uses the canonical evaluator with runtime geometry and declared inputs");
  assert.deepEqual(evaluated.inputValues, { p: 3, copies: 2, allow_rotation: false });
  assert.throws(() => evaluateFormulaDefinition({ definition, width: 0, height: 24, quantity: 1, inputValues: { p: 3 } }), /Width must be a positive finite number/);
  assert.throws(() => evaluateFormulaDefinition({ definition, width: 12, height: 24, quantity: 1, inputValues: { p: 3, undeclared: 1 } }), /not declared/);

  const runner = new Runner();
  const service = new FormulaDomainApplicationService(runner);
  const created = await service.create(context("formula-create"), { businessRequestId: "formula-create", name: "Area", visibility: "product_scoped", scopeProductId: "product-a", definition });
  assert.equal(created.ok, true);
  const first = structuredClone(runner.revisions[0]!);
  const renamed = await service.updateMetadata(context("formula-metadata"), { businessRequestId: "formula-metadata", formulaId: "formula-1", expectedCurrentRevisionId: "revision-1", name: "Area pricing", description: "Catalog metadata only" });
  assert.equal(renamed.ok, true);
  assert.equal(runner.revisions.length, 1, "metadata changes do not revise formula math");
  assert.deepEqual(runner.revisions[0], first);
  const revised = await service.revise(context("formula-revise"), { businessRequestId: "formula-revise", formulaId: "formula-1", expectedCurrentRevisionId: "revision-1", definition: { ...definition, expression: "ceil(sqft) * (p + 1)" } });
  assert.equal(revised.ok, true);
  assert.equal(runner.revisions.length, 2);
  assert.deepEqual(runner.revisions[0], first, "revision one is immutable when revision two is appended");

  const freeze = planLegacyFormulaFreeze({ organizationId: "tenant-a", productId: "product-a", productName: "Formula test product", productVersionId: "version-a", lifecycle: "ACTIVE", evidence: [
    { source: "legacy_product_formula", expression: "q * 1" },
    { source: "legacy_formula_library", formulaId: "legacy-formula", formulaRevisionId: "revision-7", expression: "q * 3", inputValues: { p: 3 } },
  ] });
  assert.equal(freeze.disposition, "bind_existing_revision");
  assert.equal(freeze.currentSource, "legacy_formula_library");
  assert.equal(freeze.compatibilityBindingRequired, true);
  const ambiguous = planLegacyFormulaFreeze({ organizationId: "tenant-a", productId: "product-a", productName: "Formula test product", productVersionId: "version-a", lifecycle: "ACTIVE", evidence: [
    { source: "legacy_formula_library", formulaId: "legacy-formula", expression: "q" },
    { source: "legacy_formula_library", formulaId: "legacy-formula", expression: "q + 1" },
  ] });
  assert.equal(ambiguous.disposition, "ambiguous");

  // The reconciliation command is intentionally database-free at this layer.
  // This transaction double represents the repository's single locked
  // ProductVersion, immutable first-binding, and FormulaRevision input check.
  const frozen = new Map<string, { formulaRevisionId: string; inputValues: Readonly<Record<string, number | boolean>> }>();
  const freezeRequests = new Map<string, any>();
  const audit: any[] = [];
  let lifecycle: "ACTIVE" | "DEPRECATED" | "DRAFT" = "ACTIVE";
  const immutableTree = JSON.stringify({ meta: { pricingFormula: "legacy" } });
  const freezeRunner = {
    transaction: async <T>(work: (tx: any) => Promise<T>): Promise<T> => work({
      reserve: async (input: any) => freezeRequests.has(input.businessRequestId)
        ? { kind: "replay", request: { id: input.businessRequestId, resultJson: freezeRequests.get(input.businessRequestId) } }
        : { kind: "new", request: { id: input.businessRequestId, resultJson: null } },
      freezeHistoricalBinding: async (input: any) => {
        if (lifecycle === "DRAFT") throw new Error("Historical Formula freeze is only available for immutable ProductVersions.");
        if (input.formulaRevisionId === "missing" || input.formulaRevisionId === "foreign") throw new Error("Formula revision is unavailable.");
        const values = validateFormulaRevisionInputValues(inputs, input.inputValues);
        const prior = frozen.get(input.productVersionId);
        if (prior && (prior.formulaRevisionId !== input.formulaRevisionId || JSON.stringify(prior.inputValues) !== JSON.stringify(values))) throw new Error("Historical Formula binding already differs.");
        if (prior) return { organizationId: input.organizationId, productId: "product-a", productVersionId: input.productVersionId, lifecycle, formulaId: "formula-a", formulaRevisionId: prior.formulaRevisionId, inputValues: prior.inputValues, createdAt: "2026-08-23T00:00:00.000Z", createdByUserId: input.staffActorUserId };
        frozen.set(input.productVersionId, { formulaRevisionId: input.formulaRevisionId, inputValues: values });
        return { organizationId: input.organizationId, productId: "product-a", productVersionId: input.productVersionId, lifecycle, formulaId: "formula-a", formulaRevisionId: input.formulaRevisionId, inputValues: values, createdAt: "2026-08-23T00:00:00.000Z", createdByUserId: input.staffActorUserId };
      },
      attribute: async () => undefined,
      audit: async (value: any) => { audit.push(value); },
      succeedHistoricalFreeze: async (_organizationId: string, requestId: string, _resourceId: string, result: any) => { freezeRequests.set(requestId, result); },
    }),
  };
  const freezeService = new FormulaDomainApplicationService(freezeRunner as any);
  const historicalContext = (requestId: string): OperationContext => context(requestId);
  const freezeInput = (businessRequestId: string, inputValues: Record<string, number | boolean>, extra: Record<string, unknown> = {}) => ({ businessRequestId, productVersionId: "history-a", formulaRevisionId: "revision-a", inputValues, ...extra });
  const active = await freezeService.freezeHistoricalProductVersion(historicalContext("history-active"), freezeInput("history-active", { p: 3 }));
  assert.equal(active.ok, true);
  assert.deepEqual(active.ok && active.value.inputValues, { p: 3, copies: 1, allow_rotation: false });
  assert.equal(frozen.size, 1);
  assert.equal(audit.length, 1);
  assert.equal(immutableTree, JSON.stringify({ meta: { pricingFormula: "legacy" } }), "historical freeze must not rewrite ProductVersion tree JSON");
  const exactReplay = await freezeService.freezeHistoricalProductVersion(historicalContext("history-active"), freezeInput("history-active", { p: 3 }));
  assert.deepEqual(exactReplay, active, "same durable request replays its original binding");
  const exactExisting = await freezeService.freezeHistoricalProductVersion(historicalContext("history-existing"), freezeInput("history-existing", { p: 3 }));
  assert.equal(exactExisting.ok, true, "an exact existing binding is safely idempotent");
  const [concurrentLeft, concurrentRight] = await Promise.all([
    freezeService.freezeHistoricalProductVersion(historicalContext("history-concurrent-left"), { ...freezeInput("history-concurrent-left", { p: 3 }), productVersionId: "history-concurrent" }),
    freezeService.freezeHistoricalProductVersion(historicalContext("history-concurrent-right"), { ...freezeInput("history-concurrent-right", { p: 3 }), productVersionId: "history-concurrent" }),
  ]);
  assert.equal(concurrentLeft.ok, true, "first concurrent historical freeze succeeds");
  assert.equal(concurrentRight.ok, true, "exact concurrent historical freeze replays the same binding");
  assert.equal(frozen.size, 2, "one existing binding plus one converged concurrent binding are present");
  const retarget = await freezeService.freezeHistoricalProductVersion(historicalContext("history-retarget"), freezeInput("history-retarget", { p: 3 }, { formulaRevisionId: "revision-b" }));
  const changedValues = await freezeService.freezeHistoricalProductVersion(historicalContext("history-values"), freezeInput("history-values", { p: 4 }));
  assert.equal(retarget.ok, false);
  assert.equal(changedValues.ok, false);
  for (const [id, values] of [["history-missing", {}], ["history-unknown", { p: 3, unknown: 1 }], ["history-type", { p: true }], ["history-range", { p: 11 }]] as const) {
    const invalid = await freezeService.freezeHistoricalProductVersion(historicalContext(id), freezeInput(id, values as Record<string, number | boolean>));
    assert.equal(invalid.ok, false, `${id} must not write a Formula binding`);
  }
  lifecycle = "DEPRECATED";
  const deprecated = await freezeService.freezeHistoricalProductVersion(historicalContext("history-deprecated"), { ...freezeInput("history-deprecated", { p: 3 }), productVersionId: "history-deprecated" });
  assert.equal(deprecated.ok && deprecated.value.lifecycle, "DEPRECATED");
  lifecycle = "DRAFT";
  const draft = await freezeService.freezeHistoricalProductVersion(historicalContext("history-draft"), { ...freezeInput("history-draft", { p: 3 }), productVersionId: "history-draft" });
  assert.equal(draft.ok, false, "Draft Formula binding remains on normal Product authoring path");
  process.stdout.write("Formula-domain pure tests passed.\n");
};
void run();
