import { Router, type Request, type Response } from "express";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { PortalPrincipal, Principal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { CustomerCommercialApplicationService, CustomerCommercialPricingAdapter, CustomerCommercialStore } from "../../modules/products/customerCommercial.js";
import { brandedId, type CustomerId, type ProductId } from "../../modules/shared/commercialValues.js";
import type { ProductPricingCompatibilityPort } from "../../modules/products/contracts.js";

export type CustomerCommercialHttpDependencies = Readonly<{
  service: CustomerCommercialApplicationService;
  store: CustomerCommercialStore;
  pricing: CustomerCommercialPricingAdapter;
  products: ProductPricingCompatibilityPort;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
}>;
export type PortalCustomerCommercialHttpDependencies = Omit<CustomerCommercialHttpDependencies, "principals"> & Readonly<{
  portalPrincipal: Readonly<{ principal(request: Request): Promise<Principal> }>;
}>;

const error = (response: Response, value: unknown, fallback: string) => {
  const e = value instanceof V2ApplicationError ? value : new V2ApplicationError("INTERNAL_ERROR", fallback);
  const status = e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" || e.code === "WRONG_TENANT" ? 404 : e.code === "VALIDATION_ERROR" ? 400 : e.code === "CONFLICT" || e.code === "STALE_STATE" ? 409 : 500;
  return response.status(status).json({ ok: false, error: { code: e.code, message: e.publicMessage } });
};
const body = (request: Request): Record<string, unknown> => request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const quantity = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
const portalPrincipal = async (dependencies: PortalCustomerCommercialHttpDependencies, request: Request): Promise<PortalPrincipal> => {
  const principal = await dependencies.portalPrincipal.principal(request);
  if (principal.kind !== "portal") throw new V2ApplicationError("FORBIDDEN", "Portal access is required.");
  return principal;
};

export const createCustomerCommercialRouter = (dependencies: CustomerCommercialHttpDependencies) => {
  const router = Router({ mergeParams: true });
  const staff = async (request: Request) => {
    const organizationId = request.params.organizationId;
    const principal = await dependencies.principals.principal(request, organizationId);
    if (principal.kind !== "staff" && principal.kind !== "delegated_ai") throw new V2ApplicationError("FORBIDDEN", "Staff commercial administration is required.");
    return { principal, organizationId };
  };
  router.get("/customers/:customerId/products", async (request, response) => {
    try { const { principal, organizationId } = await staff(request); const customerId = brandedId<"CustomerId">(request.params.customerId); return response.json({ ok: true, data: await dependencies.service.catalogForCustomer({ principal, organizationId, operationId: `customer-commercial:list:${customerId}` }, customerId) }); }
    catch (value) { return error(response, value, "Customer catalog is unavailable."); }
  });
  router.get("/customers/:customerId/pricing-agreements", async (request, response) => {
    try { const { principal, organizationId } = await staff(request); const customerId = brandedId<"CustomerId">(request.params.customerId); return response.json({ ok: true, data: await dependencies.service.activePricingAgreementsForCustomer({ principal, organizationId, operationId: `customer-commercial:pricing-list:${customerId}` }, customerId) }); }
    catch (value) { return error(response, value, "Customer pricing policy is unavailable."); }
  });
  router.put("/customers/:customerId/products/:productId/entitlement", async (request, response) => {
    try { const { principal, organizationId } = await staff(request); const enabled = body(request).enabled; if (typeof enabled !== "boolean") throw new V2ApplicationError("VALIDATION_ERROR", "An explicit entitlement enabled state is required."); const customerId = brandedId<"CustomerId">(request.params.customerId); const productId = brandedId<"ProductId">(request.params.productId); const value = await dependencies.service.setEntitlement({ principal, organizationId, operationId: `customer-commercial:entitlement:${customerId}:${productId}` }, { customerId, productId, enabled }); return response.json({ ok: true, data: value }); }
    catch (value) { return error(response, value, "Customer Product entitlement could not be saved."); }
  });
  router.put("/customers/:customerId/products/:productId/pricing-agreement", async (request, response) => {
    try {
      const { principal, organizationId } = await staff(request); const input = body(request); const mode = input.mode === "fixed_unit" || input.mode === "percent_adjustment" ? input.mode : undefined; const value = typeof input.value === "number" ? input.value : undefined; const currency = text(input.currency); if (!mode || value === undefined || !Number.isSafeInteger(value) || !currency) throw new V2ApplicationError("VALIDATION_ERROR", "Mode, whole-cent or basis-point value, and currency are required.");
      const customerId = brandedId<"CustomerId">(request.params.customerId); const productId = brandedId<"ProductId">(request.params.productId);
      const agreement = await dependencies.service.setPricingAgreement({ principal, organizationId, operationId: `customer-commercial:pricing:${customerId}:${productId}` }, { customerId, productId, ...(text(input.productVersionId) ? { productVersionId: text(input.productVersionId) } : {}), currency: currency as never, mode, value });
      return response.json({ ok: true, data: agreement });
    } catch (value) { return error(response, value, "Customer pricing agreement could not be saved."); }
  });
  return router;
};

/** Customer identity is obtained only from the signed portal session. */
export const createPortalCustomerCommercialRouter = (dependencies: PortalCustomerCommercialHttpDependencies) => {
  const router = Router();
  router.get("/", async (request, response) => {
    try {
      const principal = await portalPrincipal(dependencies, request);
      if (!new AuthorityPolicy().decide(principal, { capability: "product.view", resource: { organizationId: principal.organizationId, customerId: principal.customerId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "Product catalog access is unavailable.");
      const entitlements = await dependencies.store.listEntitlements(principal.organizationId as never, principal.customerId as never);
      const items = (await Promise.all(entitlements.filter((item) => item.enabled).map(async (item) => {
        const product = await dependencies.products.getSellableProduct(principal.organizationId as never, item.productId);
        return product ? { productId: product.productId, displayName: product.displayName, requiresDimensions: product.requiresDimensions, currency: product.pricingCurrency } : null;
      }))).filter((item): item is NonNullable<typeof item> => item !== null);
      return response.json({ ok: true, data: { items } });
    } catch (value) { return error(response, value, "Product catalog is unavailable."); }
  });
  router.post("/:productId/price-preview", async (request, response) => {
    try {
      const principal = await portalPrincipal(dependencies, request);
      if (!new AuthorityPolicy().decide(principal, { capability: "product.view", resource: { organizationId: principal.organizationId, customerId: principal.customerId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "Product catalog access is unavailable.");
      const productId = brandedId<"ProductId">(request.params.productId); const input = body(request); const count = quantity(input.quantity); if (!count) throw new V2ApplicationError("VALIDATION_ERROR", "A positive whole quantity is required.");
      const resolved = await dependencies.products.resolveActivePricingInput({ organizationId: principal.organizationId as never, productId, quantity: count, ...(input.selections && typeof input.selections === "object" && !Array.isArray(input.selections) ? { selections: input.selections as never } : {}), ...(input.dimensions && typeof input.dimensions === "object" && !Array.isArray(input.dimensions) ? { dimensions: input.dimensions as never } : {}) });
      if (!resolved.ok) throw resolved.error;
      const priced = await dependencies.pricing.calculateForCustomer(principal.customerId as never, { organizationId: principal.organizationId as never, sellableProduct: resolved.value.sellableProduct, resolvedConfiguration: resolved.value.resolvedConfiguration, pricingContext: { channel: "portal", effectiveAt: new Date().toISOString() }, rules: resolved.value.rules, ...(resolved.value.nestingEstimate ? { nestingEstimate: resolved.value.nestingEstimate } : {}) });
      return response.json({ ok: true, data: { productId: priced.normalizedInput.productId, currency: priced.currency, unitAmount: priced.calculatedUnitAmount, lineAmount: priced.calculatedLineAmount, ...(priced.customerPricing ? { customerPricing: { applied: true } } : { customerPricing: { applied: false } }), warnings: priced.warnings } });
    } catch (value) { return error(response, value, "Customer price preview is unavailable."); }
  });
  return router;
};
