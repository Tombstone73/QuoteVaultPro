import type { CurrencyCode, DecimalText, JsonValue, OrganizationId, PricingConfigurationId, ProductId, ProductTypeId, RouteTemplateId } from "../shared/commercialValues.js";
import type { DimensionInput, NestingEstimateEvidence, PricingRules, ResolvedProductConfiguration } from "../pricing/contracts.js";
import type { ApplicationResult } from "../../errors/applicationError.js";
import type { ProductRoutingPolicy } from "./productRouting.js";

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

/** Products owns the selection policy; Routing owns every template and route fact. */
export type ProductTypeRoutePolicy =
  | Readonly<{ kind: "route_required"; defaultRouteTemplateId: RouteTemplateId }>
  | Readonly<{ kind: "no_route" }>
  | Readonly<{ kind: "unconfigured" }>;

/**
 * The single compatibility decision consumed by Sales before a commercial
 * line can cross into an Order.  A Product Version's route selection is the
 * authority; Product Type remains an explicit compatibility fallback inside
 * the Products/Routing boundary only.
 */
export type ProductOrderRoutability =
  | Readonly<{ kind: "routable"; productName: string; productTypeId?: ProductTypeId; routing: ProductRoutingPolicy }>
  | Readonly<{ kind: "unroutable"; productName: string }>;

export interface ProductsReadPort {
  getSellableProduct(organizationId: OrganizationId, productId: ProductId): Promise<SellableProductConfiguration | null>;
  resolveProductType(organizationId: OrganizationId, productTypeId: ProductTypeId): Promise<Readonly<{ id: ProductTypeId; routePolicy: ProductTypeRoutePolicy }> | null>;
  getActivePricingConfiguration(organizationId: OrganizationId, productId: ProductId): Promise<Readonly<{ id: PricingConfigurationId; version: string; contentHash: string }> | null>;
  validateSellableProduct(organizationId: OrganizationId, productId: ProductId): Promise<boolean>;
  /** Routing policy is current operational policy, intentionally independent
   * of the active PBV2 tree used by Pricing. */
  resolveCurrentRoutingProduct(organizationId: OrganizationId, productId: ProductId): Promise<Readonly<{ productTypeId: ProductTypeId }> | null>;
  /** Route selection is bound to the exact PBV2/Product Version priced on a commercial line. */
  resolveVersionRoutingPolicy(organizationId: OrganizationId, productId: ProductId, productVersionId: string): Promise<ProductRoutingPolicy>;
  /** Validates the exact priced Product Version for conversion without inventing a route. */
  resolveOrderRoutability(organizationId: OrganizationId, productId: ProductId, productVersionId: string): Promise<ProductOrderRoutability>;
  /** Current Product policy is read only once, then Sales freezes it on its line. */
  resolveCurrentTaxability(organizationId: OrganizationId, productId: ProductId): Promise<Readonly<{ taxable: boolean }> | null>;
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
