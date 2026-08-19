import { describe, expect, test } from "@jest/globals";
import type { OperationContext } from "../../src/application/operation";
import { V2ApplicationError } from "../../src/errors/applicationError";
import {
  ProductRecipeApplicationService,
  type ProductRecipe,
  type ProductRecipeTransaction,
  type ProductRecipeTransactionRunner,
  type UpdateDraftRecipeInput,
} from "../../src/modules/products/productRecipes";

const initialRevision = "2026-08-18T12:00:00.000Z";
const context = (requestId: string, capabilities: readonly string[] = ["product.edit"]): OperationContext => ({
  organizationId: "org-a",
  operationId: requestId,
  businessRequest: { id: requestId, payloadFingerprint: requestId },
  principal: {
    kind: "staff",
    organizationId: "org-a",
    userId: "staff-a",
    authority: { membershipId: "membership-a", capabilities: capabilities as any },
  },
});

class RecipeTransaction implements ProductRecipeTransaction {
  draftRevision = initialRevision;
  readonly activeRecipe: ProductRecipe = {
    recipeId: "recipe-active", productId: "product-a", productVersionId: "active-a", draftUpdatedAt: initialRevision,
    lifecycle: "active", components: [{ componentId: "active-component", materialId: "material-a", materialName: "Substrate", materialSku: "SUB", quantity: "1", unit: "sheet", quantityKind: "per_line" }],
  };
  draftRecipe: ProductRecipe | null = null;
  private readonly requests = new Map<string, ProductRecipe>();

  async reserve(input: Parameters<ProductRecipeTransaction["reserve"]>[0]) {
    const replay = this.requests.get(input.businessRequestId);
    return replay
      ? { kind: "replay" as const, request: { id: input.businessRequestId, resultJson: replay } }
      : { kind: "new" as const, request: { id: input.businessRequestId, resultJson: null } };
  }

  async replaceDraftRecipe(input: Parameters<ProductRecipeTransaction["replaceDraftRecipe"]>[0]): Promise<ProductRecipe> {
    if (input.organizationId !== "org-a" || input.productId !== "product-a" || input.draftVersionId !== "draft-a") {
      throw new V2ApplicationError("NOT_FOUND", "Product Draft was not found.");
    }
    if (input.expectedDraftUpdatedAt !== this.draftRevision) {
      throw new V2ApplicationError("STALE_STATE", "This Draft changed elsewhere. Refresh and try again.");
    }
    if (input.components.some((component) => component.materialId === "foreign-material")) {
      throw new V2ApplicationError("VALIDATION_ERROR", "A recipe material is unavailable.");
    }
    this.draftRevision = "2026-08-18T12:01:00.000Z";
    this.draftRecipe = {
      recipeId: "recipe-draft", productId: "product-a", productVersionId: "draft-a", draftUpdatedAt: this.draftRevision, lifecycle: "draft",
      components: input.components.map((component, position) => ({
        componentId: component.componentId ?? `component-${position}`,
        materialId: component.materialId,
        materialName: component.materialId === "material-b" ? "Vinyl" : "Substrate",
        materialSku: component.materialId === "material-b" ? "VIN" : "SUB",
        quantity: component.quantity, unit: component.unit, quantityKind: component.quantityKind ?? "per_line",
      })),
    };
    return this.draftRecipe;
  }

  async attribute(): Promise<void> {}
  async audit(): Promise<void> {}
  async succeed(_organizationId: string, requestId: string, _recipeId: string, recipe: ProductRecipe): Promise<void> {
    this.requests.set(requestId, recipe);
  }
}

class Runner implements ProductRecipeTransactionRunner {
  readonly transactionState = new RecipeTransaction();
  async transaction<T>(action: (transaction: ProductRecipeTransaction) => Promise<T>): Promise<T> {
    return action(this.transactionState);
  }
}

const input = (requestId: string, revision = initialRevision): UpdateDraftRecipeInput => ({
  productId: "product-a", draftVersionId: "draft-a", expectedDraftUpdatedAt: revision,
  businessRequestId: requestId,
  components: [
    { componentId: "component-a", materialId: "material-a", quantity: "1.250000", unit: "sheet" },
    { componentId: "component-b", materialId: "material-b", quantity: "2", unit: "each" },
  ],
});

describe("P7A Product Draft recipe command", () => {
  test("edits a Draft-only multi-component recipe without changing the Active recipe", async () => {
    const runner = new Runner();
    const service = new ProductRecipeApplicationService(runner);
    const activeBefore = structuredClone(runner.transactionState.activeRecipe);

    const saved = await service.updateDraftRecipe(context("recipe-1"), input("recipe-1"));

    expect(saved).toMatchObject({ ok: true, value: { lifecycle: "draft", components: [
      { componentId: "component-a", materialId: "material-a", quantity: "1.250000", unit: "sheet" },
      { componentId: "component-b", materialId: "material-b", quantity: "2", unit: "each" },
    ] } });
    expect(runner.transactionState.activeRecipe).toEqual(activeBefore);
    expect(runner.transactionState.draftRecipe?.draftUpdatedAt).not.toBe(initialRevision);
  });

  test("replays exactly, rejects stale updates, invalid material references, and cross-tenant reads", async () => {
    const runner = new Runner();
    const service = new ProductRecipeApplicationService(runner);
    const saved = await service.updateDraftRecipe(context("recipe-2"), input("recipe-2"));
    const replay = await service.updateDraftRecipe(context("recipe-2"), input("recipe-2"));
    const stale = await service.updateDraftRecipe(context("recipe-stale"), input("recipe-stale"));
    const foreign = await service.updateDraftRecipe(context("recipe-foreign"), {
      ...input("recipe-foreign", saved.ok ? saved.value.draftUpdatedAt : initialRevision),
      components: [{ materialId: "foreign-material", quantity: "1", unit: "each" }],
    });
    const wrongTenant = await service.updateDraftRecipe({ ...context("recipe-tenant"), organizationId: "org-b" }, input("recipe-tenant"));

    expect(replay).toEqual(saved);
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_STATE" } });
    expect(foreign).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(wrongTenant).toMatchObject({ ok: false, error: { code: "WRONG_TENANT" } });
  });

  test("rejects duplicate components, unsupported units, malformed quantities, and missing product.edit", async () => {
    const service = new ProductRecipeApplicationService(new Runner());
    const duplicate = await service.updateDraftRecipe(context("recipe-duplicate"), {
      ...input("recipe-duplicate"),
      components: [
        { materialId: "material-a", quantity: "1", unit: "each" },
        { materialId: "material-a", quantity: "2", unit: "each" },
      ],
    });
    const badQuantity = await service.updateDraftRecipe(context("recipe-quantity"), {
      ...input("recipe-quantity"), components: [{ materialId: "material-a", quantity: "0", unit: "each" }],
    });
    const badUnit = await service.updateDraftRecipe(context("recipe-unit"), {
      ...input("recipe-unit"), components: [{ materialId: "material-a", quantity: "1", unit: "grommet" as any }],
    });
    const forbidden = await service.updateDraftRecipe(context("recipe-denied", ["product.view"]), input("recipe-denied"));

    expect(duplicate).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(badQuantity).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(badUnit).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(forbidden).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});
