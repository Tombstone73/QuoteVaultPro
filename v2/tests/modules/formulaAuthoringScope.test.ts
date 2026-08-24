import { describe, expect, test } from "@jest/globals";
import type { OperationContext } from "../../src/application/operation";
import {
  FormulaDomainApplicationService,
  type FormulaDomainTransactionRunner,
  type FormulaIdentity,
} from "../../src/modules/pricing/formulaDomain";

const definition = {
  expression: "q * rate",
  declaredInputs: [
    { key: "rate", label: "Rate", type: "number" as const, required: true, minimum: 0, authorable: true },
  ],
};
const context = (id: string): OperationContext => ({
  organizationId: "tenant-a",
  operationId: id,
  businessRequest: { id, payloadFingerprint: id },
  principal: {
    kind: "staff",
    organizationId: "tenant-a",
    userId: "staff-a",
    authority: { membershipId: "membership-a", capabilities: ["pricing.configure"] },
  },
});

/** Transaction double that records identity-level changes separately from immutable revisions. */
class FormulaScopeRunner implements FormulaDomainTransactionRunner {
  readonly requests = new Map<string, FormulaIdentity>();
  readonly revisions: FormulaIdentity["revision"][] = [];
  identity: FormulaIdentity | undefined;

  async transaction<T>(work: any): Promise<T> {
    return work({
      reserve: async (input: any) => this.requests.has(input.businessRequestId)
        ? { kind: "replay", request: { id: input.businessRequestId, resultJson: this.requests.get(input.businessRequestId) } }
        : { kind: "new", request: { id: input.businessRequestId, resultJson: null } },
      create: async (input: any) => {
        const revision = {
          formulaRevisionId: "revision-1",
          formulaId: "formula-a",
          organizationId: input.organizationId,
          revisionNumber: 1,
          createdAt: "2026-08-24T00:00:00.000Z",
          ...input.definition,
        };
        this.revisions.push(structuredClone(revision));
        this.identity = {
          formulaId: "formula-a",
          organizationId: input.organizationId,
          name: input.name,
          visibility: input.visibility,
          ...(input.scopeProductId ? { scopeProductId: input.scopeProductId } : {}),
          status: "active",
          currentRevisionId: revision.formulaRevisionId,
          revision,
          createdAt: revision.createdAt,
          updatedAt: revision.createdAt,
        };
        return this.identity;
      },
      revise: async (input: any) => {
        if (!this.identity || input.expectedCurrentRevisionId !== this.identity.currentRevisionId) throw new Error("stale revision");
        const revision = { formulaRevisionId: "revision-2", formulaId: this.identity.formulaId, organizationId: input.organizationId, revisionNumber: 2, createdAt: "2026-08-24T00:01:00.000Z", ...input.definition };
        this.revisions.push(structuredClone(revision));
        this.identity = { ...this.identity, currentRevisionId: revision.formulaRevisionId, revision, updatedAt: revision.createdAt };
        return this.identity;
      },
      updateMetadata: async () => this.identity!,
      setVisibility: async (input: any) => {
        if (!this.identity || input.expectedCurrentRevisionId !== this.identity.currentRevisionId) throw new Error("stale revision");
        this.identity = { ...this.identity, visibility: input.visibility, scopeProductId: undefined, updatedAt: "2026-08-24T00:02:00.000Z" };
        return this.identity;
      },
      setStatus: async () => this.identity!,
      freezeHistoricalBinding: async () => { throw new Error("not used"); },
      attribute: async () => undefined,
      audit: async () => undefined,
      succeed: async (_organizationId: string, requestId: string, _resourceId: string, result: FormulaIdentity) => { this.requests.set(requestId, result); },
      succeedHistoricalFreeze: async () => undefined,
    });
  }
}

describe("Formula authoring Product scope", () => {
  test("requires stable Product scope for unlisted Formulas and refuses ambiguous reusable scope", async () => {
    const service = new FormulaDomainApplicationService(new FormulaScopeRunner());
    await expect(service.create(context("no-scope"), { businessRequestId: "no-scope", name: "Scoped", visibility: "product_scoped", definition })).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    await expect(service.create(context("reusable-scope"), { businessRequestId: "reusable-scope", name: "Reusable", visibility: "library", scopeProductId: "product-a", definition })).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

    const created = await service.create(context("scoped"), { businessRequestId: "scoped", name: "Scoped", visibility: "product_scoped", scopeProductId: "product-a", definition });
    expect(created).toMatchObject({ ok: true, value: { formulaId: "formula-a", visibility: "product_scoped", scopeProductId: "product-a", revision: { formulaRevisionId: "revision-1", revisionNumber: 1 } } });
  });

  test("Add to Library changes the same identity only, retains revision one, and is durably replay-safe", async () => {
    const runner = new FormulaScopeRunner();
    const service = new FormulaDomainApplicationService(runner);
    const created = await service.create(context("create"), { businessRequestId: "create", name: "Scoped", visibility: "product_scoped", scopeProductId: "product-a", definition });
    if (!created.ok) throw new Error(created.error.publicMessage);
    const revisionOne = structuredClone(created.value.revision);

    const listed = await service.setVisibility(context("add-to-library"), { businessRequestId: "add-to-library", formulaId: created.value.formulaId, expectedCurrentRevisionId: created.value.currentRevisionId, visibility: "library" });
    const replay = await service.setVisibility(context("add-to-library"), { businessRequestId: "add-to-library", formulaId: created.value.formulaId, expectedCurrentRevisionId: created.value.currentRevisionId, visibility: "library" });

    expect(listed).toMatchObject({ ok: true, value: { formulaId: "formula-a", visibility: "library", scopeProductId: undefined, revision: revisionOne } });
    expect(replay).toEqual(listed);
    expect(runner.revisions).toEqual([revisionOne]);
    expect(runner.identity).toMatchObject({ formulaId: "formula-a", currentRevisionId: "revision-1", visibility: "library" });
    expect(runner.identity?.scopeProductId).toBeUndefined();
  });

  test("visibility cannot move a reusable Formula back into an unlisted expression authority", async () => {
    const runner = new FormulaScopeRunner();
    const service = new FormulaDomainApplicationService(runner);
    const created = await service.create(context("create"), { businessRequestId: "create", name: "Scoped", visibility: "product_scoped", scopeProductId: "product-a", definition });
    if (!created.ok) throw new Error(created.error.publicMessage);
    await expect(service.setVisibility(context("wrong-direction"), { businessRequestId: "wrong-direction", formulaId: created.value.formulaId, expectedCurrentRevisionId: created.value.currentRevisionId, visibility: "product_scoped" })).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });
});
