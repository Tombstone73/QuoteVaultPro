import { describe, expect, test } from "@jest/globals";
import { ProductVersionLifecycleApplicationService, type ProductDraftOptionPricing, type ProductVersionTransactionRunner } from "../../src/modules/products/productVersionLifecycle";
import type { OperationContext } from "../../src/application/operation";
import { V2ApplicationError } from "../../src/errors/applicationError";

const value: ProductDraftOptionPricing = { productId: "product", draftVersionId: "draft", draftUpdatedAt: "2026-08-18T12:00:00.000Z", lifecycle: "draft", options: [{ optionId: "finish", selectionKey: "finish", label: "Finish", nodeImpact: null, nodeImpacts: [], choices: [{ choiceValue: "matte", label: "Matte", impact: { type: "fixed", value: 250 }, impacts: [{ type: "fixed", value: 250 }], override: null, editable: true }, { choiceValue: "conditional", label: "Conditional", impact: null, impacts: [], override: null, editable: false, readOnlyReason: "This pricing rule is read only." }] }] };
const context = (id: string, capabilities: readonly any[] = ["product.edit"]): OperationContext => ({ organizationId: "org-a", operationId: id, businessRequest: { id, payloadFingerprint: id }, principal: { kind: "staff", organizationId: "org-a", userId: "staff", authority: { membershipId: "membership", capabilities } } });

class Runner implements ProductVersionTransactionRunner {
  private updated = value.draftUpdatedAt;
  private readonly requests = new Map<string, ProductDraftOptionPricing>();
  async transaction<T>(action: any): Promise<T> {
    return action({
      reserve: async (input: any) => this.requests.has(input.businessRequestId) ? { kind: "replay", request: { id: input.businessRequestId, resultJson: this.requests.get(input.businessRequestId) } } : { kind: "new", request: { id: input.businessRequestId, resultJson: null } },
      updateDraftOptionPricing: async (input: any) => {
        if (input.expectedDraftUpdatedAt !== this.updated) throw new V2ApplicationError("STALE_STATE", "stale");
        if (input.optionPricing.optionId !== "finish" || input.optionPricing.choiceValue === "conditional") throw new V2ApplicationError("CONFLICT", "This pricing rule is read only.");
        this.updated = "2026-08-18T12:01:00.000Z";
        return { ...value, draftUpdatedAt: this.updated, options: [{ ...value.options[0]!, choices: value.options[0]!.choices.map(choice => choice.choiceValue === input.optionPricing.choiceValue ? { ...choice, impact: input.optionPricing.impact } : choice) }] };
      },
      attribute: async () => undefined,
      auditDraftOptionPricing: async () => undefined,
      succeed: async (_organizationId: string, requestId: string, _resourceId: string, result: ProductDraftOptionPricing) => { this.requests.set(requestId, result); },
    });
  }
}

describe("P6C Draft Option Pricing command", () => {
  test("saves a typed choice impact, replays exactly, and rejects stale or unauthorized writes", async () => {
    const service = new ProductVersionLifecycleApplicationService(new Runner());
    const input = { productId: "product", draftVersionId: "draft", expectedDraftUpdatedAt: value.draftUpdatedAt, businessRequestId: "save", optionId: "finish", choiceValue: "matte", impact: { type: "per_square_foot" as const, value: 50 } };
    const saved = await service.updateDraftOptionPricing(context("save"), input);
    expect(saved).toMatchObject({ ok: true, value: { draftUpdatedAt: "2026-08-18T12:01:00.000Z" } });
    expect(saved.ok && saved.value.options[0]!.choices[0]!.impact).toEqual({ type: "per_square_foot", value: 50 });
    await expect(service.updateDraftOptionPricing(context("save"), input)).resolves.toEqual(saved);
    await expect(service.updateDraftOptionPricing(context("stale"), { ...input, businessRequestId: "stale" })).resolves.toMatchObject({ ok: false, error: { code: "STALE_STATE" } });
    await expect(service.updateDraftOptionPricing(context("denied", ["product.view"]), { ...input, businessRequestId: "denied", expectedDraftUpdatedAt: "2026-08-18T12:01:00.000Z" })).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  test("rejects invalid values before persistence", async () => {
    const service = new ProductVersionLifecycleApplicationService(new Runner());
    await expect(service.updateDraftOptionPricing(context("invalid"), { productId: "product", draftVersionId: "draft", expectedDraftUpdatedAt: value.draftUpdatedAt, businessRequestId: "invalid", optionId: "finish", choiceValue: "matte", impact: { type: "fixed", value: Number.NaN } })).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  test("accepts an ordered advanced impact list and only established choice override targets", async () => {
    const service = new ProductVersionLifecycleApplicationService(new Runner());
    const input = { productId: "product", draftVersionId: "draft", expectedDraftUpdatedAt: value.draftUpdatedAt, businessRequestId: "advanced", optionId: "finish", choiceValue: "matte", impacts: [{ type: "per_linear_foot" as const, value: 25 }, { type: "per_inch" as const, value: 2 }, { type: "formula" as const, formula: "max(q, 3) * 1.25" }, { type: "percent_of_options_subtotal" as const, value: 10 }, { type: "percent_of_line_subtotal" as const, value: 5 }], override: { mode: "set" as const, target: "per_square_foot" as const, value: 125 } };
    await expect(service.updateDraftOptionPricing(context("advanced"), input)).resolves.toMatchObject({ ok: true });
    await expect(service.updateDraftOptionPricing(context("invalid-target"), { ...input, businessRequestId: "invalid-target", expectedDraftUpdatedAt: "2026-08-18T12:01:00.000Z", override: { mode: "set", target: "invented_target" as any, value: 1 } })).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });
});
