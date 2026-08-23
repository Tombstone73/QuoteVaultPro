import { describe, expect, test } from "@jest/globals";
import type { OperationContext } from "../../src/application/operation";
import { V2ApplicationError } from "../../src/errors/applicationError";
import {
  FormulaDomainApplicationService,
  validateFormulaDefinition,
  validateFormulaRevisionInputValues,
} from "../../src/modules/pricing/formulaDomain";
const context = (id: string): OperationContext => ({
  organizationId: "tenant-a",
  operationId: id,
  businessRequest: { id, payloadFingerprint: id },
  principal: {
    kind: "staff",
    organizationId: "tenant-a",
    userId: "staff-a",
    authority: {
      membershipId: "membership-a",
      capabilities: ["pricing.configure"],
    },
  },
});
const definition = validateFormulaDefinition({
  expression: "ceil(sqft) * p",
  declaredInputs: [
    {
      key: "p",
      label: "Rate",
      type: "number" as const,
      required: true,
      minimum: 0,
      maximum: 10,
      authorable: true,
    },
    {
      key: "copies",
      label: "Copies",
      type: "integer" as const,
      required: false,
      defaultValue: 1,
      minimum: 1,
      authorable: true,
    },
  ],
});
type Binding = {
  organizationId: string;
  productId: string;
  productVersionId: string;
  lifecycle: "ACTIVE" | "DEPRECATED";
  formulaId: string;
  formulaRevisionId: string;
  inputValues: Readonly<Record<string, number | boolean>>;
  createdAt: string;
  createdByUserId?: string;
};
/** A pure transaction double: it models the repository's locked lifecycle, * revision/input validation and immutable first-binding rule without a DB. */ class FreezeRunner {
  readonly bindings = new Map<string, Binding>();
  readonly requests = new Map<string, Binding>();
  readonly audits: unknown[] = [];
  readonly treeJson = JSON.stringify({
    meta: { pricingFormula: "legacy expression" },
    nodes: { option: { id: "option" } },
  });
  lifecycle: "ACTIVE" | "DEPRECATED" | "DRAFT" = "ACTIVE";
  async transaction<T>(work: (tx: any) => Promise<T>): Promise<T> {
    return work({
      reserve: async (input: any) =>
        this.requests.has(input.businessRequestId)
          ? {
              kind: "replay",
              request: {
                id: input.businessRequestId,
                resultJson: this.requests.get(input.businessRequestId),
              },
            }
          : {
              kind: "new",
              request: { id: input.businessRequestId, resultJson: null },
            },
      freezeHistoricalBinding: async (input: any): Promise<Binding> => {
        if (this.lifecycle === "DRAFT")
          throw new V2ApplicationError(
            "CONFLICT",
            "Historical Formula freeze is only available for immutable ProductVersions.",
          );
        if (input.organizationId !== "tenant-a")
          throw new V2ApplicationError(
            "NOT_FOUND",
            "ProductVersion was not found.",
          );
        if (
          input.formulaRevisionId === "missing" ||
          input.formulaRevisionId === "foreign"
        ) {
          throw new V2ApplicationError(
            "VALIDATION_ERROR",
            "The selected Formula revision is unavailable.",
          );
        }
        const inputValues = validateFormulaRevisionInputValues(
          definition.declaredInputs,
          input.inputValues ?? {},
        );
        const existing = this.bindings.get(input.productVersionId);
        if (existing) {
          if (
            existing.formulaRevisionId !== input.formulaRevisionId ||
            JSON.stringify(existing.inputValues) !== JSON.stringify(inputValues)
          ) {
            throw new V2ApplicationError(
              "CONFLICT",
              "The immutable ProductVersion Formula binding already differs.",
            );
          }
          return existing;
        }
        const saved: Binding = {
          organizationId: input.organizationId,
          productId: "product-a",
          productVersionId: input.productVersionId,
          lifecycle: this.lifecycle,
          formulaId: "formula-a",
          formulaRevisionId: input.formulaRevisionId,
          inputValues,
          createdAt: "2026-08-23T00:00:00.000Z",
          ...(input.staffActorUserId
            ? { createdByUserId: input.staffActorUserId }
            : {}),
        };
        this.bindings.set(input.productVersionId, saved);
        return saved;
      },
      attribute: async () => undefined,
      audit: async (input: unknown) => {
        this.audits.push(input);
      },
      succeedHistoricalFreeze: async (
        _organizationId: string,
        requestId: string,
        _resourceId: string,
        result: Binding,
      ) => {
        this.requests.set(requestId, result);
      },
    });
  }
}
const freeze = (
  service: FormulaDomainApplicationService,
  requestId: string,
  values: Record<string, number | boolean>,
  overrides: Record<string, unknown> = {},
) =>
  service.freezeHistoricalProductVersion(context(requestId), {
    businessRequestId: requestId,
    productVersionId: "version-a",
    formulaRevisionId: "revision-a",
    inputValues: values,
    ...overrides,
  });
describe("historical FormulaRevision freeze", () => {
  test.each(["ACTIVE", "DEPRECATED"] as const)(
    "creates the first append-only binding for an unbound %s ProductVersion",
    async (lifecycle) => {
      const runner = new FreezeRunner();
      runner.lifecycle = lifecycle;
      const result = await freeze(
        new FormulaDomainApplicationService(runner as any),
        `first-${lifecycle}`,
        { p: 3 },
      );
      expect(result).toMatchObject({
        ok: true,
        value: {
          productVersionId: "version-a",
          lifecycle,
          formulaRevisionId: "revision-a",
          inputValues: { p: 3, copies: 1 },
        },
      });
      expect(runner.bindings.size).toBe(1);
      expect(runner.audits).toHaveLength(1);
    },
  );
  test("rejects Drafts and does not create a binding or alter ProductVersion state", async () => {
    const runner = new FreezeRunner();
    runner.lifecycle = "DRAFT";
    const beforeTree = runner.treeJson;
    const result = await freeze(
      new FormulaDomainApplicationService(runner as any),
      "draft",
      { p: 3 },
      { expectedLifecycle: "DRAFT" },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(runner.bindings.size).toBe(0);
    expect(runner.treeJson).toBe(beforeTree);
    expect(runner.lifecycle).toBe("DRAFT");
  });
  test("rejects missing, foreign, missing-required, unknown, wrong-type, and out-of-range revision/input cases before a binding is written", async () => {
    const runner = new FreezeRunner();
    const service = new FormulaDomainApplicationService(runner as any);
    for (const [requestId, values, overrides] of [
      ["missing-revision", { p: 3 }, { formulaRevisionId: "missing" }],
      ["foreign-revision", { p: 3 }, { formulaRevisionId: "foreign" }],
      ["missing-required", {}, {}],
      ["unknown-input", { p: 3, unknown: 1 }, {}],
      ["wrong-type", { p: true }, {}],
      ["out-of-range", { p: 11 }, {}],
    ] as const) {
      const result = await freeze(
        service,
        requestId,
        values as Record<string, number | boolean>,
        overrides,
      );
      expect(result.ok).toBe(false);
      expect(runner.bindings.size).toBe(0);
    }
  });
  test("accepts exact request replay and exact independently replayed binding, but rejects Formula or value retargeting", async () => {
    const runner = new FreezeRunner();
    const service = new FormulaDomainApplicationService(runner as any);
    const first = await freeze(service, "first", { p: 3 });
    const sameRequest = await freeze(service, "first", { p: 3 });
    const sameBinding = await freeze(service, "second", { p: 3 });
    const differentRevision = await freeze(
      service,
      "different-revision",
      { p: 3 },
      { formulaRevisionId: "revision-b" },
    );
    const differentValues = await freeze(service, "different-values", { p: 4 });
    expect(first).toEqual(sameRequest);
    expect(sameBinding).toMatchObject({
      ok: true,
      value: {
        formulaRevisionId: "revision-a",
        inputValues: { p: 3, copies: 1 },
      },
    });
    expect(differentRevision).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(differentValues).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(runner.bindings.size).toBe(1);
  });
  test("concurrent same-target first freezes converge on one append-only binding", async () => {
    const runner = new FreezeRunner();
    const service = new FormulaDomainApplicationService(runner as any);
    const [left, right] = await Promise.all([
      freeze(service, "concurrent-left", { p: 3 }),
      freeze(service, "concurrent-right", { p: 3 }),
    ]);
    expect(left).toMatchObject({ ok: true, value: { formulaRevisionId: "revision-a", inputValues: { p: 3, copies: 1 } } });
    expect(right).toMatchObject({ ok: true, value: { formulaRevisionId: "revision-a", inputValues: { p: 3, copies: 1 } } });
    expect(runner.bindings.size).toBe(1);
  });
  test("records only the binding/audit facts; ProductVersion tree and lifecycle remain unchanged", async () => {
    const runner = new FreezeRunner();
    const beforeTree = runner.treeJson;
    const beforeLifecycle = runner.lifecycle;
    const result = await freeze(
      new FormulaDomainApplicationService(runner as any),
      "immutable",
      { p: 3 },
    );
    expect(result).toMatchObject({
      ok: true,
      value: { createdByUserId: "staff-a" },
    });
    expect(runner.treeJson).toBe(beforeTree);
    expect(runner.lifecycle).toBe(beforeLifecycle);
    expect(runner.audits[0]).toMatchObject({
      resourceId: "version-a",
      event: "historical_formula_revision_frozen",
      principalSubject: "staff-a",
      staffActorUserId: "staff-a",
    });
  });
});
