import { describe, expect, test } from "@jest/globals";
import {
  ProductVersionLifecycleApplicationService,
  type ProductDraftGeneral,
  type ProductDraftGeneralRead,
  type ProductDraftOptionsRead,
  type ProductVersionTransactionRunner,
} from "../../src/modules/products/productVersionLifecycle";
import type { OperationContext } from "../../src/application/operation";
import { V2ApplicationError } from "../../src/errors/applicationError";

const general: ProductDraftGeneral = {
  displayName: "Existing Product Draft",
  category: "Signs",
  description: "The saved Basics revision.",
  storefrontVisible: true,
  measurementMode: "quantity_only",
  workflowIntent: "standard_production",
  requiresProofApproval: false,
  requiresProductionJob: true,
};
const options = [{
  optionId: "finish",
  selectionKey: "finish",
  label: "Finish",
  inputType: "select" as const,
  required: true,
  defaultValue: "matte",
  choices: [{ choiceValue: "matte", label: "Matte" }],
  canRemove: true,
}];
const context = (id: string): OperationContext => ({
  organizationId: "org-a",
  operationId: id,
  businessRequest: { id, payloadFingerprint: id },
  principal: {
    kind: "staff",
    organizationId: "org-a",
    userId: "staff-a",
    authority: { membershipId: "member-a", capabilities: ["product.edit"] },
  },
});

/** In-memory draft persistence fixture. It intentionally models an existing
 * Draft with unrelated Pricing metadata, so a later failed section save can
 * prove that a successful Basics write remains durable across reload/retry. */
class ExistingDraftRunner implements ProductVersionTransactionRunner {
  updatedAt = "2026-08-24T12:00:00.000Z";
  failNextOptions = false;
  readonly requests = new Map<string, unknown>();
  readonly draftTree: any = {
    schemaVersion: 2,
    meta: { pricingV2: { base: { perPieceCents: 500 } } },
    options: [],
    optionRules: [],
  };

  reload() {
    return structuredClone(this.draftTree);
  }

  async transaction<T>(action: any): Promise<T> {
    return action({
      reserve: async (input: any) => this.requests.has(input.businessRequestId)
        ? { kind: "replay", request: { id: input.businessRequestId, resultJson: this.requests.get(input.businessRequestId) } }
        : { kind: "new", request: { id: input.businessRequestId, resultJson: null } },
      updateDraftGeneral: async (input: any): Promise<ProductDraftGeneralRead> => {
        if (input.expectedDraftUpdatedAt !== this.updatedAt) throw new V2ApplicationError("STALE_STATE", "stale");
        this.draftTree.meta = { ...this.draftTree.meta, general: input.general };
        this.updatedAt = "2026-08-24T12:01:00.000Z";
        return { productId: "product-a", draftVersionId: "draft-a", draftUpdatedAt: this.updatedAt, lifecycle: "draft", general: input.general };
      },
      updateDraftOptions: async (input: any): Promise<ProductDraftOptionsRead> => {
        if (input.expectedDraftUpdatedAt !== this.updatedAt) throw new V2ApplicationError("STALE_STATE", "stale");
        if (this.failNextOptions) {
          this.failNextOptions = false;
          throw new V2ApplicationError("VALIDATION_ERROR", "Options intentionally rejected for retry coverage.");
        }
        this.draftTree.options = structuredClone(input.options);
        this.draftTree.optionRules = structuredClone(input.optionRules ?? this.draftTree.optionRules);
        this.updatedAt = "2026-08-24T12:02:00.000Z";
        return { productId: "product-a", draftVersionId: "draft-a", draftUpdatedAt: this.updatedAt, lifecycle: "draft", options: input.options, optionRules: input.optionRules ?? [] };
      },
      succeed: async (_organizationId: string, requestId: string, _resourceId: string, value: unknown) => { this.requests.set(requestId, value); },
      attribute: async () => undefined,
      audit: async () => undefined,
      auditDraftGeneral: async () => undefined,
      auditDraftOptions: async () => undefined,
    });
  }
}

describe("existing Draft cross-section save recovery", () => {
  test("keeps a saved Basics section through a later Options failure, reload, and retry", async () => {
    const runner = new ExistingDraftRunner();
    const service = new ProductVersionLifecycleApplicationService(runner);

    const savedGeneral = await service.updateDraftGeneral(context("general-save"), {
      productId: "product-a", draftVersionId: "draft-a", expectedDraftUpdatedAt: runner.updatedAt,
      businessRequestId: "general-save", general,
    });
    expect(savedGeneral).toMatchObject({ ok: true, value: { draftUpdatedAt: "2026-08-24T12:01:00.000Z" } });

    runner.failNextOptions = true;
    const failedOptions = await service.updateDraftOptions(context("options-failed"), {
      productId: "product-a", draftVersionId: "draft-a", expectedDraftUpdatedAt: runner.updatedAt,
      businessRequestId: "options-failed", options,
    });
    expect(failedOptions).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

    const afterFailureReload = runner.reload();
    expect(afterFailureReload.meta.general).toMatchObject(general);
    expect(afterFailureReload.meta.pricingV2).toEqual({ base: { perPieceCents: 500 } });
    expect(afterFailureReload.options).toEqual([]);

    const retriedOptions = await service.updateDraftOptions(context("options-retry"), {
      productId: "product-a", draftVersionId: "draft-a", expectedDraftUpdatedAt: runner.updatedAt,
      businessRequestId: "options-retry", options,
    });
    expect(retriedOptions).toMatchObject({ ok: true, value: { draftUpdatedAt: "2026-08-24T12:02:00.000Z", options } });

    const afterRetryReload = runner.reload();
    expect(afterRetryReload.meta.general).toMatchObject(general);
    expect(afterRetryReload.meta.pricingV2).toEqual({ base: { perPieceCents: 500 } });
    expect(afterRetryReload.options).toEqual(options);
  });
});
