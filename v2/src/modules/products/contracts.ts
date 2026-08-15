import type { CurrencyCode, OrganizationId, PricingConfigurationId, ProductId, ProductTypeId } from "../shared/commercialValues.js";

export type SellableProductConfiguration = Readonly<{
  organizationId: OrganizationId;
  productId: ProductId;
  productTypeId?: ProductTypeId;
  displayName: string;
  lifecycle: "active";
  pricingConfiguration: Readonly<{ id: PricingConfigurationId; version: string; contentHash: string }>;
  requiresDimensions: boolean;
  pricingCurrency: CurrencyCode;
}>;

export interface ProductsReadPort {
  getSellableProduct(organizationId: OrganizationId, productId: ProductId): Promise<SellableProductConfiguration | null>;
  resolveProductType(organizationId: OrganizationId, productTypeId: ProductTypeId): Promise<Readonly<{ id: ProductTypeId; routingRequired: boolean; defaultRouteTemplateRevisionId?: string }> | null>;
  getActivePricingConfiguration(organizationId: OrganizationId, productId: ProductId): Promise<Readonly<{ id: PricingConfigurationId; version: string; contentHash: string }> | null>;
  validateSellableProduct(organizationId: OrganizationId, productId: ProductId): Promise<boolean>;
}
