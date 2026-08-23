import assert from "node:assert/strict";
import type { OperationContext } from "../../src/application/operation.js";
import {
  FormulaDomainApplicationService,
  type FormulaDomainTransactionRunner,
  type FormulaIdentity,
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
      setVisibility: async () => this.identity!, setStatus: async () => this.identity!, attribute: async () => undefined, audit: async () => undefined,
      succeed: async (_organizationId: string, requestId: string, _resourceId: string, result: FormulaIdentity) => { this.requests.set(requestId, result); },
    });
  }
}

const run = async (): Promise<void> => {
  const inputs = validateFormulaDefinition(definition).declaredInputs;
  assert.deepEqual(validateFormulaRevisionInputValues(inputs, { p: 3 }), { p: 3, copies: 1, allow_rotation: false });
  assert.throws(() => validateFormulaRevisionInputValues(inputs, { p: 3, unknown: 1 }), /not declared/);
  assert.throws(() => validateFormulaDefinition({ ...definition, expression: "unsupported_function(q)", }), /Formula expression is invalid/);

  const runner = new Runner();
  const service = new FormulaDomainApplicationService(runner);
  const created = await service.create(context("formula-create"), { businessRequestId: "formula-create", name: "Area", visibility: "product_scoped", definition });
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
  process.stdout.write("Formula-domain pure tests passed.\n");
};
void run();
