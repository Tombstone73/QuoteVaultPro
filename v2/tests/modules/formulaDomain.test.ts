import { describe, expect, test } from "@jest/globals";
import type { OperationContext } from "../../src/application/operation";
import { FormulaDomainApplicationService, type FormulaDomainTransactionRunner, type FormulaIdentity, evaluateFormulaDefinition, validateFormulaDefinition, validateFormulaRevisionInputValues } from "../../src/modules/pricing/formulaDomain";

const context = (id: string): OperationContext => ({
  organizationId: "tenant-a",
  operationId: id,
  businessRequest: { id, payloadFingerprint: id },
  principal: { kind: "staff", organizationId: "tenant-a", userId: "staff-a", authority: { membershipId: "membership-a", capabilities: ["pricing.configure"] } },
});

class FormulaRunner implements FormulaDomainTransactionRunner {
  readonly revisions: FormulaIdentity["revision"][] = [];
  private readonly requests = new Map<string, FormulaIdentity>();
  private identity: FormulaIdentity | undefined;

  async transaction<T>(work: any): Promise<T> {
    return work({
      reserve: async (input: any) => this.requests.has(input.businessRequestId)
        ? { kind: "replay", request: { id: input.businessRequestId, resultJson: this.requests.get(input.businessRequestId) } }
        : { kind: "new", request: { id: input.businessRequestId, resultJson: null } },
      create: async (input: any) => {
        const revision = { formulaRevisionId: "revision-1", formulaId: "formula-1", organizationId: input.organizationId, revisionNumber: 1, createdAt: "2026-08-22T00:00:00.000Z", createdByUserId: input.staffActorUserId, ...input.definition };
        this.revisions.push(structuredClone(revision));
        return this.identity = { formulaId: "formula-1", organizationId: input.organizationId, name: input.name, ...(input.description ? { description: input.description } : {}), visibility: input.visibility, status: "active", currentRevisionId: revision.formulaRevisionId, revision, createdAt: revision.createdAt, updatedAt: revision.createdAt };
      },
      revise: async (input: any) => {
        if (!this.identity || input.expectedCurrentRevisionId !== this.identity.currentRevisionId) throw new Error("stale revision");
        const revision = { formulaRevisionId: "revision-2", formulaId: this.identity.formulaId, organizationId: input.organizationId, revisionNumber: 2, createdAt: "2026-08-22T00:01:00.000Z", createdByUserId: input.staffActorUserId, ...input.definition };
        this.revisions.push(structuredClone(revision));
        return this.identity = { ...this.identity, currentRevisionId: revision.formulaRevisionId, revision, updatedAt: revision.createdAt };
      },
      setVisibility: async (input: any) => {
        if (!this.identity || input.expectedCurrentRevisionId !== this.identity.currentRevisionId) throw new Error("stale revision");
        return this.identity = { ...this.identity, visibility: input.visibility, updatedAt: "2026-08-22T00:02:00.000Z" };
      },
      setStatus: async (input: any) => {
        if (!this.identity || input.expectedCurrentRevisionId !== this.identity.currentRevisionId) throw new Error("stale revision");
        return this.identity = { ...this.identity, status: input.status, updatedAt: "2026-08-22T00:02:00.000Z" };
      },
      freezeHistoricalBinding: async () => { throw new Error("Historical Formula freeze is not exercised by this Formula-authoring runner."); },
      attribute: async () => undefined,
      audit: async () => undefined,
      succeed: async (_organizationId: string, requestId: string, _resourceId: string, result: FormulaIdentity) => { this.requests.set(requestId, result); },
      succeedHistoricalFreeze: async () => undefined,
    });
  }
}

const definition = {
  expression: "ceil(sqft) * p",
  declaredInputs: [
    { key: "p", label: "Rate", type: "number" as const, required: true, minimum: 0, unit: "sq_ft", authorable: true },
    { key: "copies", label: "Copies", type: "integer" as const, required: false, defaultValue: 1, minimum: 1, authorable: true },
    { key: "allow_rotation", label: "Allow rotation", type: "boolean" as const, required: false, defaultValue: false, authorable: true },
  ],
};

describe("Formula domain immutable revisions", () => {
  test("creates revision 1 and appends revision 2 without changing a ProductVersion-bound revision 1", async () => {
    const runner = new FormulaRunner();
    const service = new FormulaDomainApplicationService(runner);
    const created = await service.create(context("formula-create"), { businessRequestId: "formula-create", name: "Area", visibility: "product_scoped", scopeProductId: "product-a", definition });
    expect(created).toMatchObject({ ok: true, value: { currentRevisionId: "revision-1", revision: { expression: "ceil(sqft) * p", revisionNumber: 1 } } });
    const boundRevision = structuredClone(runner.revisions[0]!);
    const revised = await service.revise(context("formula-revise"), { businessRequestId: "formula-revise", formulaId: "formula-1", expectedCurrentRevisionId: "revision-1", definition: { ...definition, expression: "ceil(sqft) * (p + 1)" } });
    expect(revised).toMatchObject({ ok: true, value: { currentRevisionId: "revision-2", revision: { revisionNumber: 2, expression: "ceil(sqft) * (p + 1)" } } });
    expect(runner.revisions).toHaveLength(2);
    expect(runner.revisions[0]).toEqual(boundRevision);
    expect(runner.revisions[0]!.expression).toBe("ceil(sqft) * p");
  });

  test("a visibility or status transition does not rewrite the immutable current revision", async () => {
    const runner = new FormulaRunner();
    const service = new FormulaDomainApplicationService(runner);
    const created = await service.create(context("create-visibility"), { businessRequestId: "create-visibility", name: "Area", visibility: "product_scoped", scopeProductId: "product-a", definition });
    if (!created.ok) throw new Error(created.error.publicMessage);
    const before = structuredClone(created.value.revision);
    const listed = await service.setVisibility(context("visibility"), { businessRequestId: "visibility", formulaId: created.value.formulaId, expectedCurrentRevisionId: created.value.currentRevisionId, visibility: "library" });
    const inactive = await service.setStatus(context("inactive"), { businessRequestId: "inactive", formulaId: created.value.formulaId, expectedCurrentRevisionId: created.value.currentRevisionId, status: "inactive" });
    expect(listed).toMatchObject({ ok: true, value: { visibility: "library", revision: before } });
    expect(inactive).toMatchObject({ ok: true, value: { status: "inactive", revision: before } });
    expect(runner.revisions).toEqual([before]);
  });
});

describe("Formula declared input contract", () => {
  test("shares the base-price alias contract across revision validation and tester evaluation", () => {
    const basePriceDefinition = {
      expression: "basePrice + setupFee",
      declaredInputs: [{ key: "setupFee", label: "Setup fee", type: "number" as const, required: true, authorable: true }],
    };
    expect(validateFormulaDefinition(basePriceDefinition)).toMatchObject({ expression: "basePrice + setupFee" });
    expect(evaluateFormulaDefinition({ definition: basePriceDefinition, width: 12, height: 12, quantity: 1, basePrice: 3, inputValues: { setupFee: 2 } })).toMatchObject({ result: 5, variables: { base_price: 3, basePrice: 3, p: 3 } });
    expect(() => validateFormulaDefinition({ ...basePriceDefinition, expression: "definitelyNotARealVariable + setupFee" })).toThrow("Unknown pricing formula variable");
  });

  test("accepts typed number, integer, and boolean declarations and applies typed defaults", () => {
    const valid = validateFormulaDefinition(definition);
    expect(validateFormulaRevisionInputValues(valid.declaredInputs, { p: 3 })).toEqual({ p: 3, copies: 1, allow_rotation: false });
  });

  test("rejects duplicate keys, boolean numeric bounds, and invalid typed defaults", () => {
    expect(() => validateFormulaDefinition({ ...definition, declaredInputs: [...definition.declaredInputs, { ...definition.declaredInputs[0]!, label: "Duplicate" }] })).toThrow("unique identifiers");
    expect(() => validateFormulaDefinition({ ...definition, declaredInputs: [{ key: "rotate", label: "Rotate", type: "boolean", required: false, minimum: 0, authorable: true }] })).toThrow("cannot have numeric bounds");
    expect(() => validateFormulaDefinition({ ...definition, declaredInputs: [{ key: "copies", label: "Copies", type: "integer", required: false, defaultValue: 1.5, authorable: true }] })).toThrow("default value is invalid");
  });

  test("rejects undeclared, missing required, type-invalid, and out-of-range ProductVersion values", () => {
    const inputs = validateFormulaDefinition(definition).declaredInputs;
    expect(() => validateFormulaRevisionInputValues(inputs, { p: 3, unknown: 1 })).toThrow("not declared");
    expect(() => validateFormulaRevisionInputValues(inputs, { copies: 2 })).toThrow("Rate");
    expect(() => validateFormulaRevisionInputValues(inputs, { p: 3, copies: 1.5 })).toThrow("invalid value");
    expect(() => validateFormulaRevisionInputValues(inputs, { p: -1 })).toThrow("outside its allowed range");
  });
});
