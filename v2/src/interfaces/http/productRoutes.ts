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
import type {
  ProductDraftRouting,
  ProductRoutingApplicationService,
} from "../../modules/products/productRouting.js";
import type { ProductRoutingCompatibilityApplicationService, ProductRoutingCompatibilityReadPort } from "../../modules/products/productRoutingCompatibility.js";

export type ProductLifecycle =
  "active" | "inactive" | "draft" | "active_with_draft";
/** Human-readable, immutable ProductVersion definition used by the Active Product view. */
export type ProductActiveDefinition = Readonly<{
  productVersionId: string;
  options: readonly Readonly<{
    label: string;
    inputType: string;
    required: boolean;
    defaultLabel?: string;
    choices: readonly Readonly<{
      label: string;
      value: string | number | boolean;
    }>[];
  }>[];
  pricing: Readonly<{
    mode: "unconfigured" | "simple" | "formula" | "matrix" | "matrix_formula";
    perPieceCents?: number;
    perSquareFootCents?: number;
    minimumChargeCents?: number;
    tierBasis?: "quantity" | "square_foot" | "computed_sheet_usage";
    tiers: readonly Readonly<{
      minimum: number;
      maximum: number | null;
      perPieceCents?: number;
      perSquareFootCents?: number;
      minimumChargeCents?: number;
    }>[];
    formula?: Readonly<{
      name?: string;
      expression: string;
      variables: Readonly<Record<string, number>>;
    }>;
    matrix?: Readonly<{
      pricingUnit: "per_piece" | "per_square_foot";
      dimensions: readonly string[];
      rows: readonly Readonly<{
        selections: readonly string[];
        baseRateCents: number;
        tierCount: number;
        computedSheetTiers: boolean;
      }>[];
    }>;
  }>;
  recipe: readonly Readonly<{
    componentId: string;
    materialName: string;
    materialSku?: string;
    quantity: string;
    unit: string;
    basis: string;
    condition?: string;
    replacesCompatibility: boolean;
  }>[];
  productionUnits: readonly Readonly<{
    key: string;
    side?: string;
    condition?: string;
  }>[];
  routing?: Readonly<{
    mode: "route_required" | "no_route" | "unconfigured";
    templateName?: string;
    revision?: string;
    fingerprint?: string;
    steps: readonly string[];
  }>;
}>;
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
    /** Optimistic-concurrency revision required by the canonical publish command. */
    productUpdatedAt: string;
    description?: string;
    workflowIntent: "standard_production" | "fulfillment_only" | "service_fee";
    requiresProductionJob: boolean;
    requiresProofApproval: boolean;
    configurableOptionCount: number;
    activeDefinition?: ProductActiveDefinition;
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
export interface ProductDraftRoutingReadPort {
  read(
    organizationId: string,
    productId: string,
  ): Promise<ProductDraftRouting | null>;
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
  draftRouting: ProductDraftRoutingReadPort;
  materials: ProductMaterialSearchPort;
  recipes: ProductRecipeApplicationService;
  routing: ProductRoutingApplicationService;
  lifecycle: ProductVersionLifecycleApplicationService;
  publication: ProductPublicationApplicationService;
  routingCompatibility: ProductRoutingCompatibilityReadPort;
  routingCompatibilityCommands: ProductRoutingCompatibilityApplicationService;
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
  const commandStatus = (code: string) => code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" || code === "WRONG_TENANT" ? 404 : code === "VALIDATION_ERROR" ? 400 : 409;
  router.get("/routing-readiness", async (request,response) => {
    try { const {organizationId,allowed}=await principalFor(request); if(!allowed) return deny(response,403,"FORBIDDEN","Product access is unavailable."); return response.status(200).json({ok:true,data:await dependencies.routingCompatibility.audit(organizationId)}); }
    catch { return deny(response,403,"FORBIDDEN","Authenticated access is required."); }
  });
  router.get("/:productId/routing-compatibility", async (request,response) => {
    try { const {organizationId,allowed}=await principalFor(request); if(!allowed) return deny(response,403,"FORBIDDEN","Product access is unavailable."); if(!validProductId(request.params.productId)) return deny(response,404,"NOT_FOUND","Product is unavailable in this organization."); const value=await dependencies.routingCompatibility.read(organizationId,request.params.productId); return value?response.status(200).json({ok:true,data:value}):deny(response,404,"NOT_FOUND","Product is unavailable in this organization."); }
    catch { return deny(response,403,"FORBIDDEN","Authenticated access is required."); }
  });
  router.patch("/:productId/routing-compatibility", async (request,response) => {
    try { const organizationId=(request.params as Record<string,string>).organizationId; const principal=await dependencies.principals.principal(request,organizationId); const body=request.body as Record<string,unknown>; const businessRequestId=typeof body.businessRequestId==="string"?body.businessRequestId:""; const expectedProductUpdatedAt=typeof body.expectedProductUpdatedAt==="string"?body.expectedProductUpdatedAt:""; const productTypeId=body.productTypeId===null?null:typeof body.productTypeId==="string"?body.productTypeId:null; if(!validProductId(request.params.productId)||!businessRequestId||!expectedProductUpdatedAt) return response.status(400).json({ok:false,error:{code:"VALIDATION_ERROR",message:"A Product, current revision, and business request are required."}}); const result=await dependencies.routingCompatibilityCommands.assign({principal,organizationId,operationId:businessRequestId,businessRequest:{id:businessRequestId,payloadFingerprint:businessRequestId}},{productId:request.params.productId,productTypeId,expectedProductUpdatedAt,businessRequestId}); return result.ok?response.status(200).json({ok:true,data:result.value}):response.status(commandStatus(result.error.code)).json({ok:false,error:{code:result.error.code,message:result.error.publicMessage}}); }
    catch { return response.status(409).json({ok:false,error:{code:"CONFLICT",message:"Product routing compatibility could not be saved."}}); }
  });
  router.patch("/product-types/:productTypeId/default-route", async (request,response) => {
    try { const organizationId=(request.params as Record<string,string>).organizationId; const principal=await dependencies.principals.principal(request,organizationId); const body=request.body as Record<string,unknown>; const businessRequestId=typeof body.businessRequestId==="string"?body.businessRequestId:""; const expectedProductTypeUpdatedAt=typeof body.expectedProductTypeUpdatedAt==="string"?body.expectedProductTypeUpdatedAt:""; const routeTemplateId=typeof body.routeTemplateId==="string"?body.routeTemplateId:""; if(!validProductId(request.params.productTypeId)||!validProductId(routeTemplateId)||!businessRequestId||!expectedProductTypeUpdatedAt) return response.status(400).json({ok:false,error:{code:"VALIDATION_ERROR",message:"A Product Type, active Route Template, current revision, and business request are required."}}); const result=await dependencies.routingCompatibilityCommands.setDefaultRoute({principal,organizationId,operationId:businessRequestId,businessRequest:{id:businessRequestId,payloadFingerprint:businessRequestId}},{productTypeId:request.params.productTypeId,routeTemplateId,expectedProductTypeUpdatedAt,businessRequestId}); return result.ok?response.status(200).json({ok:true,data:result.value}):response.status(commandStatus(result.error.code)).json({ok:false,error:{code:result.error.code,message:result.error.publicMessage}}); }
    catch { return response.status(409).json({ok:false,error:{code:"CONFLICT",message:"Product Type routing could not be saved."}}); }
  });
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
      return response.status(200).json({
        ok: true,
        data: await dependencies.workspace.list(organizationId, {
          query: q,
          page: positive(request.query.page, 1, 100000),
          pageSize: positive(request.query.pageSize, 50, 100),
        }),
      });
    } catch (error) {
      if (error instanceof V2ApplicationError)
        return response
          .status(
            error.code === "FORBIDDEN"
              ? 403
              : error.code === "NOT_FOUND" || error.code === "WRONG_TENANT"
                ? 404
                : error.code === "VALIDATION_ERROR"
                  ? 400
                  : 409,
          )
          .json({
            ok: false,
            error: { code: error.code, message: error.publicMessage },
          });
      return deny(
        response,
        403,
        "FORBIDDEN",
        "Authenticated access is required.",
      );
    }
  });
  router.post("/", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>)
        .organizationId;
      const principal = await dependencies.principals.principal(
        request,
        organizationId,
      );
      const body = request.body as Record<string, unknown>;
      const businessRequestId =
        typeof body.businessRequestId === "string"
          ? body.businessRequestId.trim()
          : "";
      const displayName =
        typeof body.displayName === "string" ? body.displayName : "";
      if (!businessRequestId || !displayName.trim())
        return response.status(400).json({
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "A Product name and business request are required.",
          },
        });
      const result = await dependencies.lifecycle.createProductWithInitialDraft(
        {
          principal,
          organizationId,
          operationId: businessRequestId,
          businessRequest: {
            id: businessRequestId,
            payloadFingerprint: businessRequestId,
          },
        },
        { displayName, businessRequestId },
      );
      return result.ok
        ? response.status(201).json({ ok: true, data: result.value })
        : response
            .status(
              result.error.code === "FORBIDDEN"
                ? 403
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
      const value =
        error instanceof V2ApplicationError
          ? error
          : new V2ApplicationError(
              "INTERNAL_ERROR",
              "Product creation is unavailable.",
            );
      return response
        .status(
          value.code === "FORBIDDEN"
            ? 403
            : value.code === "VALIDATION_ERROR"
              ? 400
              : 409,
        )
        .json({
          ok: false,
          error: { code: value.code, message: value.publicMessage },
        });
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
        return response.status(400).json({
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
        return response
          .status(
            error.code === "FORBIDDEN"
              ? 403
              : error.code === "NOT_FOUND" || error.code === "WRONG_TENANT"
                ? 404
                : error.code === "VALIDATION_ERROR"
                  ? 400
                  : 409,
          )
          .json({
            ok: false,
            error: { code: error.code, message: error.publicMessage },
          });
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
      const organizationId = (request.params as Record<string, string>)
        .organizationId;
      const principal = await dependencies.principals.principal(
        request,
        organizationId,
      );
      const body = request.body as Record<string, unknown>;
      if (
        typeof body.businessRequestId !== "string" ||
        typeof body.draftVersionId !== "string" ||
        typeof body.expectedProductUpdatedAt !== "string" ||
        typeof body.expectedDraftUpdatedAt !== "string"
      )
        return response.status(400).json({
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "A Draft and its current revisions are required.",
          },
        });
      const result = await dependencies.publication.publish(
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
          draftVersionId: body.draftVersionId,
          expectedProductUpdatedAt: body.expectedProductUpdatedAt,
          expectedDraftUpdatedAt: body.expectedDraftUpdatedAt,
          businessRequestId: body.businessRequestId,
          confirmWarnings: body.confirmWarnings === true,
          activateProduct: body.activateProduct === true,
        },
      );
      return result.ok
        ? response.status(200).json({ ok: true, data: result.value })
        : response
            .status(
              result.error.code === "FORBIDDEN"
                ? 403
                : result.error.code === "NOT_FOUND" ||
                    result.error.code === "WRONG_TENANT"
                  ? 404
                  : result.error.code === "VALIDATION_ERROR"
                    ? 400
                    : result.error.code === "RETRYABLE_FAILURE"
                      ? 503
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
      const value =
        error instanceof V2ApplicationError
          ? error
          : new V2ApplicationError(
              "INTERNAL_ERROR",
              "Product publication is unavailable.",
            );
      return response
        .status(
          value.code === "FORBIDDEN"
            ? 403
            : value.code === "NOT_FOUND"
              ? 404
              : value.code === "VALIDATION_ERROR"
                ? 400
                : 409,
        )
        .json({
          ok: false,
          error: { code: value.code, message: value.publicMessage },
        });
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
        return response.status(400).json({
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
      return response.status(400).json({
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
      return response.status(200).json({
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
        return response.status(400).json({
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
        options = body.options as readonly ProductDraftOption[],
        optionRules = body.optionRules;
      if (
        !businessRequestId ||
        !draftVersionId ||
        !expectedDraftUpdatedAt ||
        !Array.isArray(options)
      )
        return response.status(400).json({
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "A Draft, its current revision, and options are required.",
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
          ...(optionRules === undefined ? {} : { optionRules: optionRules as any }),
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
            ...(body.flatFeeCents === undefined
              ? {}
              : { flatFeeCents: body.flatFeeCents }),
            tierBasis: body.tierBasis,
            tiers: body.tiers,
            ...(body.tierSets === undefined ? {} : { tierSets: body.tierSets }),
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
      return response.status(400).json({
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
          return response.status(400).json({
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Preview inputs are invalid.",
            },
          });
        return response.status(200).json({
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
  router.post(
    "/:productId/draft/pricing/formula/adopt-legacy",
    async (request, response) => {
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
        const body = request.body as Record<string, unknown>;
        if (
          typeof body.businessRequestId !== "string" ||
          typeof body.draftVersionId !== "string" ||
          typeof body.expectedDraftUpdatedAt !== "string"
        )
          return response.status(400).json({
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Legacy Formula adoption settings are invalid.",
            },
          });
        const result = await dependencies.lifecycle.adoptLegacyProductFormula(
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
        return response.status(400).json({
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Legacy Formula adoption settings are invalid.",
          },
        });
      }
    },
  );
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
          (!Object.hasOwn(body, "impact") &&
            !Object.hasOwn(body, "impacts") &&
            !Object.hasOwn(body, "override")) ||
          (Object.hasOwn(body, "impact") &&
            body.impact !== null &&
            (!body.impact || typeof body.impact !== "object")) ||
          (Object.hasOwn(body, "impacts") && !Array.isArray(body.impacts)) ||
          (Object.hasOwn(body, "override") &&
            body.override !== null &&
            (!body.override || typeof body.override !== "object"))
        )
          return response.status(400).json({
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
            ...(Object.hasOwn(body, "impact") ? { impact: body.impact } : {}),
            ...(Object.hasOwn(body, "impacts")
              ? { impacts: body.impacts }
              : {}),
            ...(Object.hasOwn(body, "override")
              ? { override: body.override }
              : {}),
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
        return response.status(400).json({
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
          variables = body.variables,
          rotationControl = body.rotationControl,
          rotationControlRecord =
            rotationControl &&
            typeof rotationControl === "object" &&
            !Array.isArray(rotationControl)
              ? (rotationControl as Record<string, unknown>)
              : undefined,
          rotationChoiceValues = rotationControlRecord?.allowWhenChoiceValues;
        if (
          typeof body.businessRequestId !== "string" ||
          typeof body.draftVersionId !== "string" ||
          typeof body.expectedDraftUpdatedAt !== "string" ||
          (body.source !== "embedded" && body.source !== "library" && body.source !== "formula_revision") ||
          typeof body.allowRotation !== "boolean" ||
          (body.source === "library" &&
            (typeof body.formulaId !== "string" || !body.formulaId.trim())) ||
          (body.source === "embedded" && body.formulaId !== undefined) ||
          (body.source === "formula_revision" && (typeof body.formulaRevisionId !== "string" || !body.formulaRevisionId.trim() || !body.inputValues || typeof body.inputValues !== "object" || Array.isArray(body.inputValues))) ||
          (body.source !== "formula_revision" && (typeof body.expression !== "string" || !variables || typeof variables !== "object" || Array.isArray(variables))) ||
          (rotationControl !== undefined &&
            (!rotationControlRecord ||
              typeof rotationControlRecord.optionId !== "string" ||
              !rotationControlRecord.optionId ||
              !Array.isArray(rotationChoiceValues) ||
              rotationChoiceValues.length === 0 ||
              rotationChoiceValues.some(
                (value: unknown) => typeof value !== "string" || !value,
              )))
        )
          return response.status(400).json({
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
            source: body.source,
            ...(body.source === "library"
              ? { formulaId: (body.formulaId as string).trim() }
              : {}),
            ...(body.source === "formula_revision"
              ? { formulaRevisionId: (body.formulaRevisionId as string).trim(), inputValues: body.inputValues as Record<string, number | boolean> }
              : { expression: body.expression as string, variables: variables as Record<string, number> }),
            allowRotation: body.allowRotation,
            ...(rotationControlRecord === undefined
              ? {}
              : {
                  rotationControl: {
                    optionId: rotationControlRecord.optionId as string,
                    allowWhenChoiceValues: rotationChoiceValues as string[],
                  },
                }),
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
        return response.status(400).json({
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
          typeof body?.active !== "boolean" ||
          typeof body?.matrixId !== "string" ||
          (body?.pricingUnit !== "per_piece" &&
            body?.pricingUnit !== "per_square_foot") ||
          !Array.isArray(body?.dimensions) ||
          !Array.isArray(body?.rows)
        )
          return response.status(400).json({
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
            active: body.active,
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
        return response.status(400).json({
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Matrix settings are invalid.",
          },
        });
      }
    },
  );
  router.get("/:productId/draft/routing", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed)
        return deny(
          response,
          403,
          "FORBIDDEN",
          "Product access is unavailable.",
        );
      const routing = await dependencies.draftRouting.read(
        organizationId,
        request.params.productId,
      );
      return routing
        ? response.status(200).json({ ok: true, data: routing })
        : deny(
            response,
            404,
            "NOT_FOUND",
            "Product Draft Routing is unavailable.",
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
  router.patch("/:productId/draft/routing", async (request, response) => {
    try {
      const organizationId = (request.params as Record<string, string>)
        .organizationId;
      const principal = await dependencies.principals.principal(
        request,
        organizationId,
      );
      const body = request.body as Record<string, unknown>;
      if (
        typeof body?.businessRequestId !== "string" ||
        typeof body?.draftVersionId !== "string" ||
        typeof body?.expectedDraftUpdatedAt !== "string" ||
        !body?.routing ||
        typeof body.routing !== "object"
      )
        throw new V2ApplicationError(
          "VALIDATION_ERROR",
          "Draft Routing settings are invalid.",
        );
      const result = await dependencies.routing.updateDraftRouting(
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
          routing: body.routing as any,
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
    } catch (error) {
      const cause =
        error instanceof V2ApplicationError
          ? error
          : new V2ApplicationError(
              "VALIDATION_ERROR",
              "Draft Routing settings are invalid.",
            );
      return response
        .status(
          cause.code === "FORBIDDEN"
            ? 403
            : cause.code === "NOT_FOUND"
              ? 404
              : cause.code === "VALIDATION_ERROR"
                ? 400
                : 409,
        )
        .json({
          ok: false,
          error: { code: cause.code, message: cause.publicMessage },
        });
    }
  });
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
