import { Router, type Request, type Response } from "express";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { Principal } from "../../authorization/principals.js";
import { brandedId } from "../../modules/shared/commercialValues.js";

export type ProductCatalogItem = Readonly<{
  productId: string;
  displayName: string;
  measurementMode: "dimensions_required" | "quantity_only";
  requiresDimensions: boolean;
  pricingConfiguration: Readonly<{ id: string; version: string; contentHash: string }>;
}>;
export type ProductWorkspaceDetail = Readonly<
  ProductCatalogItem & {
    productTypeId?: string;
    routePolicy: "route_required" | "no_route" | "unconfigured";
    activeConfiguration: Readonly<{
      schemaVersion: number;
      publishedAt?: string;
      fields: ReadonlyArray<Readonly<{
        selectionKey: string;
        label: string;
        inputType: string;
        required: boolean;
        choices: ReadonlyArray<Readonly<{ value: string | number | boolean; label: string }>>;
      }>>;
    }>;
  }
>;

/** Product-owned, read-only projection for staff catalog/detail adapters. */
export interface ProductWorkspaceReadPort {
  list(organizationId: string, query?: string): Promise<readonly ProductCatalogItem[]>;
  get(organizationId: string, productId: string): Promise<ProductWorkspaceDetail | null>;
}
export type ProductHttpDependencies = Readonly<{
  workspace: ProductWorkspaceReadPort;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
}>;

const deny = (response: Response, status: 403 | 404, code: "FORBIDDEN" | "NOT_FOUND", message: string) =>
  response.status(status).json({ ok: false, error: { code, message } });
const validProductId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(value);

export const createProductRouter = (dependencies: ProductHttpDependencies) => {
  const router = Router({ mergeParams: true });
  const principalFor = async (request: Request) => {
    const organizationId = (request.params as Record<string, string>).organizationId!;
    const principal = await dependencies.principals.principal(request, organizationId);
    const allowed = new AuthorityPolicy().decide(principal, {
      capability: "product.view",
      resource: { organizationId },
    }).allowed;
    return { organizationId, allowed };
  };
  router.get("/", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed) return deny(response, 403, "FORBIDDEN", "Product access is unavailable.");
      const query = typeof request.query.q === "string" ? request.query.q : "";
      return response.status(200).json({ ok: true, data: { items: await dependencies.workspace.list(organizationId, query) } });
    } catch {
      return deny(response, 403, "FORBIDDEN", "Authenticated access is required.");
    }
  });
  router.get("/:productId", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed) return deny(response, 403, "FORBIDDEN", "Product access is unavailable.");
      if (!validProductId(request.params.productId))
        return deny(response, 404, "NOT_FOUND", "Product is unavailable in this organization.");
      const product = await dependencies.workspace.get(organizationId, brandedId<"ProductId">(request.params.productId));
      if (!product) return deny(response, 404, "NOT_FOUND", "Product is unavailable in this organization.");
      return response.status(200).json({ ok: true, data: product });
    } catch {
      return deny(response, 403, "FORBIDDEN", "Authenticated access is required.");
    }
  });
  return router;
};
