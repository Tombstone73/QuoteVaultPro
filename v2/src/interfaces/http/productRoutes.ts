import { Router, type Request, type Response } from "express";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { Principal } from "../../authorization/principals.js";
import { brandedId } from "../../modules/shared/commercialValues.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type {
  ProductDraftFormulaPricing,
  ProductDraftGeneral,
  ProductDraftGeneralRead,
  ProductDraftOption,
  ProductDraftOptionPricing,
  ProductDraftOptionsRead,
  ProductDraftPricing,
  ProductDraftPricingMatrix,
  ProductVersionLifecycle,
} from "../../modules/products/productVersionLifecycle.js";
import type { ProductVersionLifecycleApplicationService } from "../../modules/products/productVersionLifecycle.js";
import type {
  ProductRecipe,
  ProductRecipeApplicationService,
  RecipeComponentInput,
} from "../../modules/products/productRecipes.js";
import type { ProductPublicationApplicationService } from "../../modules/products/productPublication.js";

export type ProductLifecycle =
  "active" | "inactive" | "draft" | "active_with_draft";
export type ProductCatalogItem = Readonly<{
  productId: string;
  displayName: string;
  category?: string;
  lifecycle: ProductLifecycle;
  measurementMode: "dimensions_required" | "quantity_only";
  pricingSummary: string;
  productType?: Readonly<{
    displayName: string;
    routePolicy: "route_required" | "no_route" | "unconfigured";
  }>;
  primaryMaterialName?: string;
  activeVersion?: Readonly<{ label: string; publishedAt?: string }>;
  hasDraft: boolean;
}>;
export type ProductWorkspaceDetail = Readonly<
  ProductCatalogItem & {
    description?: string;
    workflowIntent: "standard_production" | "fulfillment_only" | "service_fee";
    requiresProductionJob: boolean;
    requiresProofApproval: boolean;
    configurableOptionCount: number;
    versions: ProductVersionLifecycle;
  }
>;
export type ProductCatalogPage = Readonly<{
  items: readonly ProductCatalogItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}>;
export interface ProductWorkspaceReadPort {
  list(
    organizationId: string,
    input?: Readonly<{ query?: string; page?: number; pageSize?: number }>,
  ): Promise<ProductCatalogPage>;
  get(
    organizationId: string,
    productId: string,
  ): Promise<ProductWorkspaceDetail | null>;
}
export interface ProductDraftGeneralReadPort {
  read(
    organizationId: string,
    productId: string,
  ): Promise<ProductDraftGeneralRead | null>;
}
export interface ProductDraftOptionsReadPort {
  read(
    organizationId: string,
    productId: string,
  ): Promise<ProductDraftOptionsRead | null>;
}
export interface ProductDraftPricingReadPort {
  read(
    organizationId: string,
    productId: string,
  ): Promise<ProductDraftPricing | null>;
}
export interface ProductDraftPricingMatrixReadPort {
  read(
    organizationId: string,
    productId: string,
  ): Promise<ProductDraftPricingMatrix | null>;
}
export interface ProductDraftFormulaReadPort {
  read(
    organizationId: string,
    productId: string,
  ): Promise<ProductDraftFormulaPricing | null>;
}
export interface ProductDraftOptionPricingReadPort {
  read(
    organizationId: string,
    productId: string,
  ): Promise<ProductDraftOptionPricing | null>;
}
export interface ProductDraftPricingPreviewPort {
  preview(
    organizationId: string,
    productId: string,
    input: Readonly<{
      quantity: number;
      width?: number;
      height?: number;
      selections?: Record<string, unknown>;
    }>,
  ): Promise<unknown>;
}
export interface ProductRecipeReadPort {
  readDraft(
    organizationId: string,
    productId: string,
  ): Promise<ProductRecipe | null>;
  readActive(
    organizationId: string,
    productId: string,
  ): Promise<ProductRecipe | null>;
}
export interface ProductMaterialSearchPort {
  list(
    organizationId: string,
    query: string,
  ): Promise<
    readonly Readonly<{
      materialId: string;
      name: string;
      sku: string | null;
      unit: "each" | "square_foot" | "linear_foot" | "sheet" | "roll";
    }>[]
  >;
}
export type ProductHttpDependencies = Readonly<{
  workspace: ProductWorkspaceReadPort;
  draftGeneral: ProductDraftGeneralReadPort;
  draftOptions: ProductDraftOptionsReadPort;
  draftPricing: ProductDraftPricingReadPort;
  draftMatrix: ProductDraftPricingMatrixReadPort;
  draftFormula: ProductDraftFormulaReadPort;
  draftOptionPricing: ProductDraftOptionPricingReadPort;
  draftPreview: ProductDraftPricingPreviewPort;
  draftRecipe: ProductRecipeReadPort;
  materials: ProductMaterialSearchPort;
  recipes: ProductRecipeApplicationService;
  lifecycle: ProductVersionLifecycleApplicationService;
  publication: ProductPublicationApplicationService;
  principals: Readonly<{
    principal(request: Request, organizationId: string): Promise<Principal>;
  }>;
}>;
const deny = (
  response: Response,
  status: 403 | 404,
  code: "FORBIDDEN" | "NOT_FOUND",
  message: string,
) => response.status(status).json({ ok: false, error: { code, message } });
const validProductId = (value: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(value);
const positive = (value: unknown, fallback: number, max: number) =>
  typeof value === "string" && /^\d+$/u.test(value)
    ? Math.min(Math.max(Number(value), 1), max)
    : fallback;
export const createProductRouter = (dependencies: ProductHttpDependencies) => {
  const router = Router({ mergeParams: true });
  const principalFor = async (request: Request) => {
    const organizationId = (request.params as Record<string, string>)
      .organizationId!;
    const principal = await dependencies.principals.principal(
      request,
      organizationId,
    );
    return {
      organizationId,
      allowed: new AuthorityPolicy().decide(principal, {
        capability: "product.view",
        resource: { organizationId },
      }).allowed,
    };
  };
  router.get("/", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed)
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product access is unavailable.",
        );
      const q = typeof request.query.q === "string" ? request.query.q : "";
      return response
        .status(200)
        .json({
          ok: true,
          data: await dependencies.workspace.list(organizationId, {
            query: q,
            page: positive(request.query.page, 1, 100000),
            pageSize: positive(request.query.pageSize, 50, 100),
          }),
        });
    } catch (error) {
      if (error instanceof V2ApplicationError)
        return response.status(error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" || error.code === "WRONG_TENANT" ? 404 : error.code === "VALIDATION_ERROR" ? 400 : 409).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  router.post("/:productId/drafts", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>)
        .organizationId;
      const principal = await dependencies.principals.principal(
        request,
        organizationId,
      );
      if (
        !new AuthorityPolicy().decide(principal, {
          capability: "product.edit",
          resource: { organizationId },
        }).allowed
      )
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product Draft access is unavailable.",
        );
      if (!validProductId(request.params.productId))
        return deny(
          response,
          404,
          "NOT_FOUND",
          "Product is unavailable in this organization.",
        );
      const body = request.body as Record<string, unknown>;
      const businessRequestId =
        typeof body?.businessRequestId === "string"
          ? body.businessRequestId.trim()
          : "";
      const expectedActiveVersionUpdatedAt =
        typeof body?.expectedActiveVersionUpdatedAt === "string"
          ? body.expectedActiveVersionUpdatedAt
          : "";
      if (!businessRequestId || !expectedActiveVersionUpdatedAt)
        return response
          .status(400)
          .json({
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "A business request and current Active version state are required.",
            },
          });
      const result = await dependencies.lifecycle.createDraft(
        {
          principal,
          organizationId,
          operationId: businessRequestId,
          businessRequest: {
            id: businessRequestId,
            payloadFingerprint: businessRequestId,
          },
        },
        {
          productId: request.params.productId,
          businessRequestId,
          expectedActiveVersionUpdatedAt,
        },
      );
      return result.ok
        ? response.status(200).json({ ok: true, data: result.value })
        : response
            .status(
              result.error.code === "FORBIDDEN"
                ? 403
                : result.error.code === "NOT_FOUND"
                  ? 404
                  : result.error.code === "VALIDATION_ERROR"
                    ? 400
                    : 409,
            )
            .json({
              ok: false,
              error: {
                code: result.error.code,
                message: result.error.publicMessage,
              },
            });
    } catch (error) {
      if (error instanceof V2ApplicationError)
        return response.status(error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" || error.code === "WRONG_TENANT" ? 404 : error.code === "VALIDATION_ERROR" ? 400 : 409).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  router.post("/:productId/draft/publish", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>).organizationId;
      const principal = await dependencies.principals.principal(request, organizationId);
      const body = request.body as Record<string, unknown>;
      if (typeof body.businessRequestId !== "string" || typeof body.draftVersionId !== "string" || typeof body.expectedProductUpdatedAt !== "string" || typeof body.expectedDraftUpdatedAt !== "string")
        return response.status(400).json({ ok: false, error: { code: "VALIDATION_ERROR", message: "A Draft and its current revisions are required." } });
      const result = await dependencies.publication.publish({ principal, organizationId, operationId: body.businessRequestId, businessRequest: { id: body.businessRequestId, payloadFingerprint: body.businessRequestId } }, {
        productId: request.params.productId,
        draftVersionId: body.draftVersionId,
        expectedProductUpdatedAt: body.expectedProductUpdatedAt,
        expectedDraftUpdatedAt: body.expectedDraftUpdatedAt,
        businessRequestId: body.businessRequestId,
        confirmWarnings: body.confirmWarnings === true,
        activateProduct: body.activateProduct === true,
      });
      return result.ok
        ? response.status(200).json({ ok: true, data: result.value })
        : response.status(result.error.code === "FORBIDDEN" ? 403 : result.error.code === "NOT_FOUND" || result.error.code === "WRONG_TENANT" ? 404 : result.error.code === "VALIDATION_ERROR" ? 400 : result.error.code === "RETRYABLE_FAILURE" ? 503 : 409).json({ ok: false, error: { code: result.error.code, message: result.error.publicMessage } });
    } catch (error) {
      const value = error instanceof V2ApplicationError ? error : new V2ApplicationError("INTERNAL_ERROR", "Product publication is unavailable.");
      return response.status(value.code === "FORBIDDEN" ? 403 : value.code === "NOT_FOUND" ? 404 : value.code === "VALIDATION_ERROR" ? 400 : 409).json({ ok: false, error: { code: value.code, message: value.publicMessage } });
    }
  });
  router.get("/:productId/active/recipe", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed)
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product access is unavailable.",
        );
      const recipe = await dependencies.draftRecipe.readActive(
        organizationId,
        request.params.productId,
      );
      return recipe
        ? response.status(200).json({ ok: true, data: recipe })
        : deny(
            response,
            404,
            "NOT_FOUND",
            "An Active Product recipe is unavailable.",
          );
    } catch {
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  router.get("/:productId/draft/recipe", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed)
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product access is unavailable.",
        );
      const recipe = await dependencies.draftRecipe.readDraft(
        organizationId,
        request.params.productId,
      );
      return recipe
        ? response.status(200).json({ ok: true, data: recipe })
        : deny(
            response,
            404,
            "NOT_FOUND",
            "A Product Draft recipe is unavailable.",
          );
    } catch {
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  router.patch("/:productId/draft/recipe", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>)
          .organizationId,
        principal = await dependencies.principals.principal(
          request,
          organizationId,
        ),
        body = request.body as Record<string, unknown>;
      if (
        !new AuthorityPolicy().decide(principal, {
          capability: "product.edit",
          resource: { organizationId },
        }).allowed
      )
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product Draft editing is unavailable.",
        );
      const businessRequestId =
          typeof body.businessRequestId === "string"
            ? body.businessRequestId
            : "",
        draftVersionId =
          typeof body.draftVersionId === "string" ? body.draftVersionId : "",
        expectedDraftUpdatedAt =
          typeof body.expectedDraftUpdatedAt === "string"
            ? body.expectedDraftUpdatedAt
            : "",
        components = body.components;
      if (
        !businessRequestId ||
        !draftVersionId ||
        !expectedDraftUpdatedAt ||
        !Array.isArray(components)
      )
        return response
          .status(400)
          .json({
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "A Draft, its current revision, and recipe components are required.",
            },
          });
      const result = await dependencies.recipes.updateDraftRecipe(
        {
          principal,
          organizationId,
          operationId: businessRequestId,
          businessRequest: {
            id: businessRequestId,
            payloadFingerprint: businessRequestId,
          },
        },
        {
          productId: request.params.productId,
          draftVersionId,
          expectedDraftUpdatedAt,
          businessRequestId,
          components: components as readonly RecipeComponentInput[],
        },
      );
      return result.ok
        ? response.status(200).json({ ok: true, data: result.value })
        : response
            .status(
              result.error.code === "VALIDATION_ERROR"
                ? 400
                : result.error.code === "FORBIDDEN"
                  ? 403
                  : result.error.code === "NOT_FOUND"
                    ? 404
                    : 409,
            )
            .json({
              ok: false,
              error: {
                code: result.error.code,
                message: result.error.publicMessage,
              },
            });
    } catch {
      return response
        .status(400)
        .json({
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Recipe settings are invalid.",
          },
        });
    }
  });
  router.get("/:productId/materials", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed)
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product access is unavailable.",
        );
      const q = typeof request.query.q === "string" ? request.query.q : "";
      return response
        .status(200)
        .json({
          ok: true,
          data: { items: await dependencies.materials.list(organizationId, q) },
        });
    } catch {
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  router.get("/:productId/draft/general", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed)
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product access is unavailable.",
        );
      if (!validProductId(request.params.productId))
        return deny(
          response,
          404,
          "NOT_FOUND",
          "Product is unavailable in this organization.",
        );
      const draft = await dependencies.draftGeneral.read(
        organizationId,
        request.params.productId,
      );
      return draft
        ? response.status(200).json({ ok: true, data: draft })
        : deny(response, 404, "NOT_FOUND", "A Product Draft is unavailable.");
    } catch {
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  router.patch("/:productId/draft/general", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>)
        .organizationId;
      const principal = await dependencies.principals.principal(
        request,
        organizationId,
      );
      if (
        !new AuthorityPolicy().decide(principal, {
          capability: "product.edit",
          resource: { organizationId },
        }).allowed
      )
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product Draft editing is unavailable.",
        );
      if (!validProductId(request.params.productId))
        return deny(
          response,
          404,
          "NOT_FOUND",
          "Product is unavailable in this organization.",
        );
      const body = request.body as Record<string, unknown>;
      const businessRequestId =
        typeof body?.businessRequestId === "string"
          ? body.businessRequestId.trim()
          : "";
      const draftVersionId =
        typeof body?.draftVersionId === "string"
          ? body.draftVersionId.trim()
          : "";
      const expectedDraftUpdatedAt =
        typeof body?.expectedDraftUpdatedAt === "string"
          ? body.expectedDraftUpdatedAt
          : "";
      const general = body?.general as ProductDraftGeneral;
      if (
        !businessRequestId ||
        !draftVersionId ||
        !expectedDraftUpdatedAt ||
        !general ||
        typeof general !== "object"
      )
        return response
          .status(400)
          .json({
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "A Draft, its current revision, and General settings are required.",
            },
          });
      const result = await dependencies.lifecycle.updateDraftGeneral(
        {
          principal,
          organizationId,
          operationId: businessRequestId,
          businessRequest: {
            id: businessRequestId,
            payloadFingerprint: businessRequestId,
          },
        },
        {
          productId: request.params.productId,
          businessRequestId,
          draftVersionId,
          expectedDraftUpdatedAt,
          general,
        },
      );
      return result.ok
        ? response.status(200).json({ ok: true, data: result.value })
        : response
            .status(
              result.error.code === "FORBIDDEN"
                ? 403
                : result.error.code === "NOT_FOUND"
                  ? 404
                  : result.error.code === "VALIDATION_ERROR"
                    ? 400
                    : 409,
            )
            .json({
              ok: false,
              error: {
                code: result.error.code,
                message: result.error.publicMessage,
              },
            });
    } catch {
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  router.get("/:productId/draft/options", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed)
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product access is unavailable.",
        );
      if (!validProductId(request.params.productId))
        return deny(
          response,
          404,
          "NOT_FOUND",
          "Product is unavailable in this organization.",
        );
      const options = await dependencies.draftOptions.read(
        organizationId,
        request.params.productId,
      );
      return options
        ? response.status(200).json({ ok: true, data: options })
        : deny(response, 404, "NOT_FOUND", "A Product Draft is unavailable.");
    } catch {
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  router.patch("/:productId/draft/options", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>)
        .organizationId;
      const principal = await dependencies.principals.principal(
        request,
        organizationId,
      );
      if (
        !new AuthorityPolicy().decide(principal, {
          capability: "product.edit",
          resource: { organizationId },
        }).allowed
      )
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product Draft editing is unavailable.",
        );
      if (!validProductId(request.params.productId))
        return deny(
          response,
          404,
          "NOT_FOUND",
          "Product is unavailable in this organization.",
        );
      const body = request.body as Record<string, unknown>,
        businessRequestId =
          typeof body.businessRequestId === "string"
            ? body.businessRequestId.trim()
            : "",
        draftVersionId =
          typeof body.draftVersionId === "string"
            ? body.draftVersionId.trim()
            : "",
        expectedDraftUpdatedAt =
          typeof body.expectedDraftUpdatedAt === "string"
            ? body.expectedDraftUpdatedAt
            : "",
        options = body.options as readonly ProductDraftOption[];
      if (
        !businessRequestId ||
        !draftVersionId ||
        !expectedDraftUpdatedAt ||
        !Array.isArray(options)
      )
        return response
          .status(400)
          .json({
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "A Draft, its current revision, and options are required.",
            },
          });
      const result = await dependencies.lifecycle.updateDraftOptions(
        {
          principal,
          organizationId,
          operationId: businessRequestId,
          businessRequest: {
            id: businessRequestId,
            payloadFingerprint: businessRequestId,
          },
        },
        {
          productId: request.params.productId,
          businessRequestId,
          draftVersionId,
          expectedDraftUpdatedAt,
          options,
        },
      );
      return result.ok
        ? response.status(200).json({ ok: true, data: result.value })
        : response
            .status(
              result.error.code === "FORBIDDEN"
                ? 403
                : result.error.code === "NOT_FOUND"
                  ? 404
                  : result.error.code === "VALIDATION_ERROR"
                    ? 400
                    : 409,
            )
            .json({
              ok: false,
              error: {
                code: result.error.code,
                message: result.error.publicMessage,
              },
            });
    } catch {
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  router.get("/:productId/draft/pricing", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed)
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product access is unavailable.",
        );
      const pricing = await dependencies.draftPricing.read(
        organizationId,
        request.params.productId,
      );
      return pricing
        ? response.status(200).json({ ok: true, data: pricing })
        : deny(response, 404, "NOT_FOUND", "A Product Draft is unavailable.");
    } catch {
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  router.patch("/:productId/draft/pricing", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>)
          .organizationId,
        principal = await dependencies.principals.principal(
          request,
          organizationId,
        );
      if (
        !new AuthorityPolicy().decide(principal, {
          capability: "product.edit",
          resource: { organizationId },
        }).allowed
      )
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product Draft editing is unavailable.",
        );
      const body = request.body as any,
        result = await dependencies.lifecycle.updateDraftPricing(
          {
            principal,
            organizationId,
            operationId: body.businessRequestId,
            businessRequest: {
              id: body.businessRequestId,
              payloadFingerprint: body.businessRequestId,
            },
          },
          {
            productId: request.params.productId,
            businessRequestId: body.businessRequestId,
            draftVersionId: body.draftVersionId,
            expectedDraftUpdatedAt: body.expectedDraftUpdatedAt,
            base: body.base,
            tierBasis: body.tierBasis,
            tiers: body.tiers,
          },
        );
      return result.ok
        ? response.status(200).json({ ok: true, data: result.value })
        : response
            .status(
              result.error.code === "VALIDATION_ERROR"
                ? 400
                : result.error.code === "FORBIDDEN"
                  ? 403
                  : result.error.code === "NOT_FOUND"
                    ? 404
                    : 409,
            )
            .json({
              ok: false,
              error: {
                code: result.error.code,
                message: result.error.publicMessage,
              },
            });
    } catch {
      return response
        .status(400)
        .json({
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Draft Pricing settings are invalid.",
          },
        });
    }
  });
  router.post(
    "/:productId/draft/pricing/preview",
    async (request, response) => {
      try {
        const { organizationId, allowed } = await principalFor(request);
        if (!allowed)
          return deny(
            response,
            403,
            "FORBIDDEN",
            "Product access is unavailable.",
          );
        const body = request.body as Record<string, unknown>,
          quantity = body.quantity,
          width = body.width,
          height = body.height;
        if (
          typeof quantity !== "number" ||
          (width !== undefined && typeof width !== "number") ||
          (height !== undefined && typeof height !== "number")
        )
          return response
            .status(400)
            .json({
              ok: false,
              error: {
                code: "VALIDATION_ERROR",
                message: "Preview inputs are invalid.",
              },
            });
        return response
          .status(200)
          .json({
            ok: true,
            data: await dependencies.draftPreview.preview(
              organizationId,
              request.params.productId,
              {
                quantity,
                width: width as number | undefined,
                height: height as number | undefined,
                selections: body.selections as
                  Record<string, unknown> | undefined,
              },
            ),
          });
      } catch (error) {
        const value = error as V2ApplicationError;
        return response
          .status(
            value?.code === "NOT_FOUND"
              ? 404
              : value?.code === "VALIDATION_ERROR"
                ? 400
                : 409,
          )
          .json({
            ok: false,
            error: {
              code: value?.code ?? "CONFLICT",
              message:
                value?.publicMessage ?? "Pricing preview is unavailable.",
            },
          });
      }
    },
  );
  router.get("/:productId/draft/pricing/formula", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed)
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product access is unavailable.",
        );
      const formula = await dependencies.draftFormula.read(
        organizationId,
        request.params.productId,
      );
      return formula
        ? response.status(200).json({ ok: true, data: formula })
        : deny(
            response,
            404,
            "NOT_FOUND",
            "A Product Draft formula is unavailable.",
          );
    } catch {
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  router.get("/:productId/draft/option-pricing", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed)
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product access is unavailable.",
        );
      const value = await dependencies.draftOptionPricing.read(
        organizationId,
        request.params.productId,
      );
      return value
        ? response.status(200).json({ ok: true, data: value })
        : deny(response, 404, "NOT_FOUND", "A Product Draft is unavailable.");
    } catch {
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  router.patch(
    "/:productId/draft/option-pricing",
    async (request, response) => {
      try {
        const organizationId = (request.params as Record<string, string>)
            .organizationId,
          principal = await dependencies.principals.principal(
            request,
            organizationId,
          ),
          body = request.body as any;
        if (
          !new AuthorityPolicy().decide(principal, {
            capability: "product.edit",
            resource: { organizationId },
          }).allowed
        )
          return deny(
            response,
            403,
            "FORBIDDEN",
            "Product Draft editing is unavailable.",
          );
        if (
          typeof body?.businessRequestId !== "string" ||
          typeof body?.draftVersionId !== "string" ||
          typeof body?.expectedDraftUpdatedAt !== "string" ||
          typeof body?.optionId !== "string" ||
          (body.impact !== null &&
            (!body.impact || typeof body.impact !== "object"))
        )
          return response
            .status(400)
            .json({
              ok: false,
              error: {
                code: "VALIDATION_ERROR",
                message: "Option pricing is invalid.",
              },
            });
        const result = await dependencies.lifecycle.updateDraftOptionPricing(
          {
            principal,
            organizationId,
            operationId: body.businessRequestId,
            businessRequest: {
              id: body.businessRequestId,
              payloadFingerprint: body.businessRequestId,
            },
          },
          {
            productId: request.params.productId,
            businessRequestId: body.businessRequestId,
            draftVersionId: body.draftVersionId,
            expectedDraftUpdatedAt: body.expectedDraftUpdatedAt,
            optionId: body.optionId,
            ...(typeof body.choiceValue === "string"
              ? { choiceValue: body.choiceValue }
              : {}),
            impact: body.impact,
          },
        );
        return result.ok
          ? response.status(200).json({ ok: true, data: result.value })
          : response
              .status(
                result.error.code === "VALIDATION_ERROR"
                  ? 400
                  : result.error.code === "FORBIDDEN"
                    ? 403
                    : 409,
              )
              .json({
                ok: false,
                error: {
                  code: result.error.code,
                  message: result.error.publicMessage,
                },
              });
      } catch {
        return response
          .status(400)
          .json({
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Option pricing is invalid.",
            },
          });
      }
    },
  );
  router.patch(
    "/:productId/draft/pricing/formula",
    async (request, response) => {
      try {
        const organizationId = (request.params as Record<string, string>)
            .organizationId,
          principal = await dependencies.principals.principal(
            request,
            organizationId,
          );
        if (
          !new AuthorityPolicy().decide(principal, {
            capability: "product.edit",
            resource: { organizationId },
          }).allowed
        )
          return deny(
            response,
            403,
            "FORBIDDEN",
            "Product Draft editing is unavailable.",
          );
        const body = request.body as Record<string, unknown>,
          variables = body.variables;
        if (
          typeof body.businessRequestId !== "string" ||
          typeof body.draftVersionId !== "string" ||
          typeof body.expectedDraftUpdatedAt !== "string" ||
          typeof body.expression !== "string" ||
          !variables ||
          typeof variables !== "object" ||
          Array.isArray(variables)
        )
          return response
            .status(400)
            .json({
              ok: false,
              error: {
                code: "VALIDATION_ERROR",
                message: "Formula settings are invalid.",
              },
            });
        const result = await dependencies.lifecycle.updateDraftFormulaPricing(
          {
            principal,
            organizationId,
            operationId: body.businessRequestId,
            businessRequest: {
              id: body.businessRequestId,
              payloadFingerprint: body.businessRequestId,
            },
          },
          {
            productId: request.params.productId,
            businessRequestId: body.businessRequestId,
            draftVersionId: body.draftVersionId,
            expectedDraftUpdatedAt: body.expectedDraftUpdatedAt,
            expression: body.expression,
            variables: variables as Record<string, number>,
          },
        );
        return result.ok
          ? response.status(200).json({ ok: true, data: result.value })
          : response
              .status(
                result.error.code === "VALIDATION_ERROR"
                  ? 400
                  : result.error.code === "FORBIDDEN"
                    ? 403
                    : result.error.code === "NOT_FOUND"
                      ? 404
                      : 409,
              )
              .json({
                ok: false,
                error: {
                  code: result.error.code,
                  message: result.error.publicMessage,
                },
              });
      } catch {
        return response
          .status(400)
          .json({
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Formula settings are invalid.",
            },
          });
      }
    },
  );
  router.get("/:productId/draft/pricing/matrix", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed)
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product access is unavailable.",
        );
      const matrix = await dependencies.draftMatrix.read(
        organizationId,
        request.params.productId,
      );
      return matrix
        ? response.status(200).json({ ok: true, data: matrix })
        : deny(
            response,
            404,
            "NOT_FOUND",
            "A Product Draft matrix is unavailable.",
          );
    } catch {
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  router.patch(
    "/:productId/draft/pricing/matrix",
    async (request, response) => {
      try {
        const organizationId = (request.params as Record<string, string>)
            .organizationId,
          principal = await dependencies.principals.principal(
            request,
            organizationId,
          );
        if (
          !new AuthorityPolicy().decide(principal, {
            capability: "product.edit",
            resource: { organizationId },
          }).allowed
        )
          return deny(
            response,
            403,
            "FORBIDDEN",
            "Product Draft editing is unavailable.",
          );
        const body = request.body as any;
        if (
          typeof body?.businessRequestId !== "string" ||
          typeof body?.draftVersionId !== "string" ||
          typeof body?.expectedDraftUpdatedAt !== "string" ||
          typeof body?.matrixId !== "string" ||
          (body?.pricingUnit !== "per_piece" &&
            body?.pricingUnit !== "per_square_foot") ||
          !Array.isArray(body?.dimensions) ||
          !Array.isArray(body?.rows)
        )
          return response
            .status(400)
            .json({
              ok: false,
              error: {
                code: "VALIDATION_ERROR",
                message: "Matrix settings are invalid.",
              },
            });
        const result = await dependencies.lifecycle.updateDraftPricingMatrix(
          {
            principal,
            organizationId,
            operationId: body.businessRequestId,
            businessRequest: {
              id: body.businessRequestId,
              payloadFingerprint: body.businessRequestId,
            },
          },
          {
            productId: request.params.productId,
            businessRequestId: body.businessRequestId,
            draftVersionId: body.draftVersionId,
            expectedDraftUpdatedAt: body.expectedDraftUpdatedAt,
            matrixId: body.matrixId,
            pricingUnit: body.pricingUnit,
            dimensions: body.dimensions,
            rows: body.rows,
          },
        );
        return result.ok
          ? response.status(200).json({ ok: true, data: result.value })
          : response
              .status(
                result.error.code === "VALIDATION_ERROR"
                  ? 400
                  : result.error.code === "FORBIDDEN"
                    ? 403
                    : result.error.code === "NOT_FOUND"
                      ? 404
                      : 409,
              )
              .json({
                ok: false,
                error: {
                  code: result.error.code,
                  message: result.error.publicMessage,
                },
              });
      } catch {
        return response
          .status(400)
          .json({
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Matrix settings are invalid.",
            },
          });
      }
    },
  );
  router.get("/:productId", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed)
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product access is unavailable.",
        );
      if (!validProductId(request.params.productId))
        return deny(
          response,
          404,
          "NOT_FOUND",
          "Product is unavailable in this organization.",
        );
      const product = await dependencies.workspace.get(
        organizationId,
        brandedId<"ProductId">(request.params.productId),
      );
      return product
        ? response.status(200).json({ ok: true, data: product })
        : deny(
            response,
            404,
            "NOT_FOUND",
            "Product is unavailable in this organization.",
          );
    } catch {
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  return router;
};
