import { createHash } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId, type PrincipalKind } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";

export const recipeUnits = ["each", "square_foot", "linear_foot", "sheet", "roll"] as const;
export type RecipeUnit = (typeof recipeUnits)[number];
export const recipeQuantityKinds = ["per_line", "per_piece"] as const;
export type RecipeQuantityKind = (typeof recipeQuantityKinds)[number];
export type RecipeComponent = Readonly<{
  componentId: string;
  materialId: string;
  materialName: string;
  materialSku: string | null;
  quantity: string;
  unit: RecipeUnit;
  quantityKind: RecipeQuantityKind;
}>;
export type ProductRecipe = Readonly<{
  recipeId: string;
  productId: string;
  productVersionId: string;
  /** The containing Product Version revision used for stale-write protection. */
  draftUpdatedAt: string;
  lifecycle: "draft" | "active" | "historical";
  components: readonly RecipeComponent[];
}>;
export type RecipeComponentInput = Readonly<{
  componentId?: string;
  materialId: string;
  quantity: string;
  unit: RecipeUnit;
  quantityKind?: RecipeQuantityKind;
}>;
export type UpdateDraftRecipeInput = Readonly<{
  productId: string;
  draftVersionId: string;
  expectedDraftUpdatedAt: string;
  businessRequestId: string;
  components: readonly RecipeComponentInput[];
}>;

type RecipeActor = Readonly<{
  principalKind: PrincipalKind;
  principalSubject: string;
  staffActorUserId?: string;
}>;

export interface ProductRecipeTransaction {
  reserve(input: Readonly<{
    organizationId: string;
    operation: string;
    businessRequestId: string;
    payloadFingerprint: string;
  }> & RecipeActor): Promise<Readonly<{
    kind: "new" | "replay";
    request: Readonly<{ id: string; resultJson: unknown | null }>;
  }>>;
  replaceDraftRecipe(input: Readonly<{
    organizationId: string;
    productId: string;
    draftVersionId: string;
    expectedDraftUpdatedAt: string;
    components: readonly RecipeComponentInput[];
    staffActorUserId?: string;
  }>): Promise<ProductRecipe>;
  attribute(input: Readonly<{
    organizationId: string;
    requestId: string;
    operation: string;
    resourceId: string;
  }> & RecipeActor): Promise<void>;
  audit(input: Readonly<{
    organizationId: string;
    requestId: string;
    operation: string;
    resourceId: string;
  }> & RecipeActor): Promise<void>;
  succeed(organizationId: string, requestId: string, recipeId: string, result: ProductRecipe): Promise<void>;
}

export interface ProductRecipeTransactionRunner {
  transaction<T>(action: (transaction: ProductRecipeTransaction) => Promise<T>): Promise<T>;
}

const operation = "product.draft.recipe.update.v1";

const fingerprint = (input: UpdateDraftRecipeInput): string =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");

const validQuantity = (value: string): boolean =>
  /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value) && Number(value) > 0;

const validateComponents = (components: readonly RecipeComponentInput[]): readonly RecipeComponentInput[] => {
  if (!Array.isArray(components) || components.length > 100) {
    throw new V2ApplicationError("VALIDATION_ERROR", "Recipe components are invalid.");
  }

  const materialIds = new Set<string>();
  return components.map((component) => {
    const materialId = component?.materialId?.trim();
    if (!materialId || materialIds.has(materialId)) {
      throw new V2ApplicationError("VALIDATION_ERROR", "Recipe materials must be unique.");
    }
    materialIds.add(materialId);
    if (!recipeUnits.includes(component.unit) || !validQuantity(component.quantity)
      || (component.quantityKind !== undefined && !recipeQuantityKinds.includes(component.quantityKind))) {
      throw new V2ApplicationError("VALIDATION_ERROR", "Recipe quantities are invalid.");
    }
    return { ...component, materialId, quantity: component.quantity };
  });
};

const actorFor = (context: OperationContext): RecipeActor => ({
  principalKind: context.principal.kind,
  principalSubject: principalSubject(context.principal),
  staffActorUserId: staffActorId(context.principal),
});

export class ProductRecipeApplicationService {
  constructor(private readonly runner: ProductRecipeTransactionRunner) {}

  async updateDraftRecipe(
    context: OperationContext,
    input: UpdateDraftRecipeInput,
  ): Promise<ApplicationResult<ProductRecipe>> {
    try {
      requireOperationPrincipalScope(context);
      if (context.businessRequest?.id !== input.businessRequestId) {
        throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      }
      if (!new AuthorityPolicy().decide(context.principal, {
        capability: "product.edit",
        resource: { organizationId: context.organizationId },
      }).allowed) {
        throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to edit this Product Draft.");
      }

      const components = validateComponents(input.components);
      const actor = actorFor(context);
      const value = await this.runner.transaction(async (transaction) => {
        const request = await transaction.reserve({
          organizationId: context.organizationId,
          operation,
          businessRequestId: input.businessRequestId,
          payloadFingerprint: fingerprint({ ...input, components }),
          ...actor,
        });
        if (request.kind === "replay") return request.request.resultJson as ProductRecipe;

        const saved = await transaction.replaceDraftRecipe({
          organizationId: context.organizationId,
          productId: input.productId,
          draftVersionId: input.draftVersionId,
          expectedDraftUpdatedAt: input.expectedDraftUpdatedAt,
          components,
          staffActorUserId: actor.staffActorUserId,
        });
        await transaction.attribute({
          organizationId: context.organizationId,
          requestId: request.request.id,
          operation,
          resourceId: saved.productVersionId,
          ...actor,
        });
        await transaction.audit({
          organizationId: context.organizationId,
          requestId: request.request.id,
          operation,
          resourceId: saved.productVersionId,
          ...actor,
        });
        await transaction.succeed(context.organizationId, request.request.id, saved.productVersionId, saved);
        return saved;
      });
      return success(value);
    } catch (error) {
      return failure(error instanceof V2ApplicationError
        ? error
        : new V2ApplicationError("CONFLICT", "Recipe could not be saved."));
    }
  }
}
