import type { CurrencyCode, DecimalText, JsonValue, OrganizationId, PricingConfigurationId, ProductId, ProductTypeId } from "../shared/commercialValues.js";
import type { DimensionInput, NestingEstimateEvidence, PricingRules, ResolvedProductConfiguration } from "../pricing/contracts.js";
import type { ApplicationResult } from "../../errors/applicationError.js";

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

/** Explicit input for the normal active-configuration pricing path; callers cannot select a tree id. */
export type ResolveActivePricingInput = Readonly<{
  organizationId: OrganizationId;
  productId: ProductId;
  quantity: number;
  selections?: Readonly<Record<string, JsonValue>>;
  dimensions?: DimensionInput;
}>;

export type ResolvedPricingInput = Readonly<{
  sellableProduct: SellableProductConfiguration;
  resolvedConfiguration: ResolvedProductConfiguration;
  rules: PricingRules;
  nestingEstimate?: NestingEstimateEvidence;
  warnings: readonly Readonly<{ code: string; message: string }>[];
}>;

/** A historical tree cannot be obtained by an arbitrary caller-supplied PBV2 id. */
export type HistoricalPricingConfigurationReference = Readonly<{
  organizationId: OrganizationId;
  salesCheckpointId: string;
  pricingConfigurationId: PricingConfigurationId;
}>;

export interface ProductPricingCompatibilityPort extends ProductsReadPort {
  resolveActivePricingInput(input: ResolveActivePricingInput): Promise<ApplicationResult<ResolvedPricingInput>>;
  resolveHistoricalPricingConfiguration(reference: HistoricalPricingConfigurationReference): Promise<null>;
}

export type PricingPhysicalFacts = Readonly<{
  sheetWidthIn?: DecimalText;
  sheetHeightIn?: DecimalText;
  materialKind?: "sheet" | "roll";
}>;
