import assert from "node:assert/strict";
import { ProductVersionLifecycleApplicationService, type ProductDraftFormulaPricing, type ProductVersionTransactionRunner } from "../../src/modules/products/productVersionLifecycle.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { evaluateResolvedFormula } from "../../src/modules/pricing/v2PricingAdapter.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";

const formula = "ceil((((w+.25)*(h+.25))*q)/144)*p";
const principal = (capabilities: readonly ("product.view" | "product.edit")[]): StaffPrincipal => ({ kind: "staff", organizationId: "org", userId: "staff", authority: { membershipId: "membership", capabilities } });
const context = (id: string, capabilities: readonly ("product.view" | "product.edit")[] = ["product.view", "product.edit"]) => ({ principal: principal(capabilities), organizationId: "org", operationId: id, businessRequest: { id, payloadFingerprint: id } });

class AdoptionRunner implements ProductVersionTransactionRunner {
  updated = "2026-08-22T12:00:00.000Z";
  readonly requests = new Map<string, ProductDraftFormulaPricing>();
  async transaction<T>(action: (transaction: any) => Promise<T>): Promise<T> {
    return action({
      reserve: async (input: any) => this.requests.has(input.businessRequestId)
        ? { kind: "replay", request: { id: input.businessRequestId, resultJson: this.requests.get(input.businessRequestId) } }
        : { kind: "new", request: { id: input.businessRequestId, resultJson: null } },
      adoptLegacyProductFormula: async (input: any): Promise<ProductDraftFormulaPricing> => {
        if (input.expectedDraftUpdatedAt !== this.updated) throw new V2ApplicationError("STALE_STATE", "Draft changed");
        this.updated = "2026-08-22T12:01:00.000Z";
        return { productId: "product", draftVersionId: "draft", draftUpdatedAt: this.updated, lifecycle: "draft", source: "embedded_editable", editable: true, expressionEditable: true, variablesEditable: true, rotationEditable: false, inputs: [], expression: formula, variables: {}, allowRotation: false, supportedRuntimeVariables: ["q", "w", "h", "p"], warnings: [] };
      },
      succeed: async (_organizationId: string, requestId: string, _resourceId: string, value: ProductDraftFormulaPricing) => { this.requests.set(requestId, value); },
      attribute: async () => undefined,
      auditDraftFormulaPricing: async () => undefined,
    });
  }
}

const runner = new AdoptionRunner();
const service = new ProductVersionLifecycleApplicationService(runner);
const input = { productId: "product", draftVersionId: "draft", expectedDraftUpdatedAt: "2026-08-22T12:00:00.000Z", businessRequestId: "legacy-adopt-1" };
const adopted = await service.adoptLegacyProductFormula(context(input.businessRequestId), input);
assert.equal(adopted.ok, true);
if (!adopted.ok) throw new Error(adopted.error.publicMessage);
assert.equal(adopted.value.source, "embedded_editable");
assert.equal(adopted.value.expression, formula);
assert.deepEqual(await service.adoptLegacyProductFormula(context(input.businessRequestId), input), adopted);
const stale = await service.adoptLegacyProductFormula(context("legacy-stale"), { ...input, businessRequestId: "legacy-stale" });
assert.equal(stale.ok, false);
if (!stale.ok) assert.equal(stale.error.code, "STALE_STATE");
const denied = await service.adoptLegacyProductFormula(context("legacy-denied", ["product.view"]), { ...input, businessRequestId: "legacy-denied", expectedDraftUpdatedAt: runner.updated });
assert.equal(denied.ok, false);
if (!denied.ok) assert.equal(denied.error.code, "FORBIDDEN");
assert.equal(evaluateResolvedFormula(formula, { w: 12, h: 12, q: 1, p: 3 }), 6);

console.log("Legacy Formula Draft authoring pure tests passed.");
