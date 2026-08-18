import { Router, type Request, type Response } from "express";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { Principal } from "../../authorization/principals.js";
import { brandedId } from "../../modules/shared/commercialValues.js";

export type ProductLifecycle = "active" | "inactive" | "draft" | "active_with_draft";
export type ProductCatalogItem = Readonly<{
  productId: string; displayName: string; category?: string; lifecycle: ProductLifecycle;
  measurementMode: "dimensions_required" | "quantity_only"; pricingSummary: string;
  productType?: Readonly<{ displayName: string; routePolicy: "route_required" | "no_route" | "unconfigured" }>;
  primaryMaterialName?: string; activeVersion?: Readonly<{ label: string; publishedAt?: string }>;
  hasDraft: boolean;
}>;
export type ProductWorkspaceDetail = Readonly<ProductCatalogItem & {
  description?: string; workflowIntent: "standard_production" | "fulfillment_only" | "service_fee";
  requiresProductionJob: boolean; requiresProofApproval: boolean;
  configurableOptionCount: number;
}>;
export type ProductCatalogPage = Readonly<{ items: readonly ProductCatalogItem[]; page: number; pageSize: number; total: number; hasMore: boolean }>;
export interface ProductWorkspaceReadPort {
  list(organizationId: string, input?: Readonly<{ query?: string; page?: number; pageSize?: number }>): Promise<ProductCatalogPage>;
  get(organizationId: string, productId: string): Promise<ProductWorkspaceDetail | null>;
}
export type ProductHttpDependencies = Readonly<{ workspace: ProductWorkspaceReadPort; principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }> }>;
const deny = (response: Response, status: 403 | 404, code: "FORBIDDEN" | "NOT_FOUND", message: string) => response.status(status).json({ ok: false, error: { code, message } });
const validProductId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(value);
const positive = (value: unknown, fallback: number, max: number) => typeof value === "string" && /^\d+$/u.test(value) ? Math.min(Math.max(Number(value), 1), max) : fallback;
export const createProductRouter = (dependencies: ProductHttpDependencies) => {
  const router = Router({ mergeParams: true });
  const principalFor = async (request: Request) => { const organizationId = (request.params as Record<string, string>).organizationId!; const principal = await dependencies.principals.principal(request, organizationId); return { organizationId, allowed: new AuthorityPolicy().decide(principal, { capability: "product.view", resource: { organizationId } }).allowed }; };
  router.get("/", async (request, response) => { try { const { organizationId, allowed } = await principalFor(request); if (!allowed) return deny(response, 403, "FORBIDDEN", "Product access is unavailable."); const q = typeof request.query.q === "string" ? request.query.q : ""; return response.status(200).json({ ok: true, data: await dependencies.workspace.list(organizationId, { query: q, page: positive(request.query.page, 1, 100000), pageSize: positive(request.query.pageSize, 50, 100) }) }); } catch { return deny(response, 403, "FORBIDDEN", "Authenticated access is required."); } });
  router.get("/:productId", async (request, response) => { try { const { organizationId, allowed } = await principalFor(request); if (!allowed) return deny(response, 403, "FORBIDDEN", "Product access is unavailable."); if (!validProductId(request.params.productId)) return deny(response, 404, "NOT_FOUND", "Product is unavailable in this organization."); const product = await dependencies.workspace.get(organizationId, brandedId<"ProductId">(request.params.productId)); return product ? response.status(200).json({ ok: true, data: product }) : deny(response, 404, "NOT_FOUND", "Product is unavailable in this organization."); } catch { return deny(response, 403, "FORBIDDEN", "Authenticated access is required."); } });
  return router;
};
