import { createHash } from "node:crypto";
import type { TransactionalClient } from "../persistence/types.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../src/errors/applicationError.js";
import { canonicalJson, brandedId, currencyCode, type JsonValue, type OrganizationId, type PricingConfigurationId, type ProductId, type ProductTypeId } from "../../src/modules/shared/commercialValues.js";
import type { HistoricalPricingConfigurationReference, ProductPricingCompatibilityPort, ProductTypeRoutePolicy, ResolveActivePricingInput, ResolvedPricingInput, SellableProductConfiguration } from "../../src/modules/products/contracts.js";
import { resolveActivePbv2PricingInput, type ActivePbv2CompatibilityRecord } from "../../src/modules/products/pbv2CompatibilityResolution.js";
import { PostgresProductVersionRoutingReader } from "../products/postgresProductRouting.js";

type ProductRow = {
  product_id: string; product_name: string; product_type_id: string | null; measurement_mode: "dimensions_required" | "quantity_only";
  pricing_profile_key: string | null; product_formula_id: string | null; product_formula: string | null; tree_id: string; tree_schema_version: number; tree_published_at: Date | null; tree_json: unknown;
  pricing_profile_config: unknown | null;
  formula_id: string | null; formula_code: string | null; formula_profile_key: string | null; formula_expression: string | null; formula_config: unknown; formula_updated_at: Date | null;
};
const hash = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const iso = (value: Date | null): string | null => value ? value.toISOString() : null;

/** Normal commercial reads bind Product pointer, organization, Product association, and ACTIVE tree state in one SELECT. */
export class PostgresProductsCompatibilityReader implements ProductPricingCompatibilityPort {
  constructor(private readonly client: TransactionalClient) {}

  async getSellableProduct(organizationId: OrganizationId, productId: ProductId): Promise<SellableProductConfiguration | null> {
    const row = await this.activeRow(organizationId, productId);
    return row ? this.sellable(organizationId, row) : null;
  }

  async resolveProductType(organizationId: OrganizationId, productTypeId: ProductTypeId): Promise<Readonly<{ id: ProductTypeId; routePolicy: ProductTypeRoutePolicy }> | null> {
    const result = await this.client.query<{ id: string; routing_mode: "route_required" | "no_route" | "unconfigured"; default_route_template_id: string | null }>("SELECT id,routing_mode,default_route_template_id FROM product_types WHERE organization_id = $1 AND id = $2", [organizationId, productTypeId]);
    const row = result.rows[0];
    if (!row) return null;
    const routePolicy: ProductTypeRoutePolicy = row.routing_mode === "route_required" && row.default_route_template_id
      ? { kind: "route_required", defaultRouteTemplateId: brandedId<"RouteTemplateId">(row.default_route_template_id) }
      : row.routing_mode === "no_route" ? { kind: "no_route" } : { kind: "unconfigured" };
    return { id: brandedId<"ProductTypeId">(row.id), routePolicy };
  }

  async getActivePricingConfiguration(organizationId: OrganizationId, productId: ProductId): Promise<Readonly<{ id: PricingConfigurationId; version: string; contentHash: string }> | null> {
    const row = await this.activeRow(organizationId, productId);
    return row ? this.configuration(row) : null;
  }

  async validateSellableProduct(organizationId: OrganizationId, productId: ProductId): Promise<boolean> {
    return Boolean(await this.activeRow(organizationId, productId));
  }

  async resolveCurrentRoutingProduct(organizationId: OrganizationId, productId: ProductId): Promise<Readonly<{ productTypeId: ProductTypeId }> | null> {
    // Deliberately does not join PBV2: route policy is current operational
    // policy and must not make Quote conversion depend on current pricing.
    const result = await this.client.query<{ product_type_id: string | null }>(
      "SELECT product_type_id FROM products WHERE organization_id=$1 AND id=$2 AND is_active=TRUE",
      [organizationId, productId],
    );
    const row = result.rows[0];
    return row?.product_type_id ? { productTypeId: brandedId<"ProductTypeId">(row.product_type_id) } : null;
  }

  async resolveVersionRoutingPolicy(organizationId: OrganizationId, productId: ProductId, productVersionId: string) {
    return new PostgresProductVersionRoutingReader(this.client).read(organizationId, productId, productVersionId);
  }

  async resolveActivePricingInput(input: ResolveActivePricingInput): Promise<ApplicationResult<ResolvedPricingInput>> {
    const row = await this.activeRow(input.organizationId, input.productId);
    if (!row) return failure(new V2ApplicationError("NOT_FOUND", "Sellable product or active pricing configuration was not found."));
    if (row.product_formula_id && !row.formula_id) return failure(new V2ApplicationError("NOT_FOUND", "The product's active pricing formula was not found."));
    const sellable = this.sellable(input.organizationId, row);
    const source: ActivePbv2CompatibilityRecord = {
      id: row.tree_id, schemaVersion: row.tree_schema_version, publishedAt: iso(row.tree_published_at), treeJson: row.tree_json,
      productMeasurementMode: row.measurement_mode, productPricingProfileKey: row.pricing_profile_key,
      legacyProductPricingConfig: (row.pricing_profile_config ?? null) as JsonValue | null,
      legacyProductPricingFormula: row.product_formula,
      formula: row.formula_id && row.formula_profile_key ? {
        id: row.formula_id, code: row.formula_code, profileKey: row.formula_profile_key, expression: row.formula_expression,
        config: (row.formula_config ?? null) as JsonValue | null, updatedAt: iso(row.formula_updated_at) ?? "unknown",
      } : null,
    };
    return resolveActivePbv2PricingInput(sellable, source, input);
  }

  /** Historical reads intentionally have no generic tree lookup until Sales checkpoints exist. */
  async resolveHistoricalPricingConfiguration(_reference: HistoricalPricingConfigurationReference): Promise<null> {
    return null;
  }

  private configuration(row: ProductRow): Readonly<{ id: PricingConfigurationId; version: string; contentHash: string }> {
    return { id: brandedId<"PricingConfigurationId">(row.tree_id), version: iso(row.tree_published_at) ?? `schema-${row.tree_schema_version}`, contentHash: hash(row.tree_json) };
  }

  private sellable(organizationId: OrganizationId, row: ProductRow): SellableProductConfiguration {
    const configuration = this.configuration(row);
    return {
      organizationId, productId: brandedId<"ProductId">(row.product_id), displayName: row.product_name, lifecycle: "active", pricingConfiguration: configuration,
      ...(row.product_type_id ? { productTypeId: brandedId<"ProductTypeId">(row.product_type_id) } : {}),
      requiresDimensions: row.measurement_mode !== "quantity_only", pricingCurrency: currencyCode("USD"),
    };
  }

  private async activeRow(organizationId: OrganizationId, productId: ProductId): Promise<ProductRow | null> {
    const result = await this.client.query<ProductRow>(`SELECT p.id AS product_id, p.name AS product_name, p.product_type_id, p.measurement_mode, p.pricing_profile_key, p.pricing_profile_config, p.pricing_formula_id AS product_formula_id, p.pricing_formula AS product_formula,
      t.id AS tree_id, t.schema_version AS tree_schema_version, t.published_at AS tree_published_at, t.tree_json,
      f.id AS formula_id, f.code AS formula_code, f.pricing_profile_key AS formula_profile_key, f.expression AS formula_expression, f.config AS formula_config, f.updated_at AS formula_updated_at
      FROM products p
      JOIN pbv2_tree_versions t ON t.id = p.pbv2_active_tree_version_id AND t.organization_id = p.organization_id AND t.product_id = p.id AND t.status = 'ACTIVE'
      LEFT JOIN pricing_formulas f ON f.id = p.pricing_formula_id AND f.organization_id = p.organization_id AND f.is_active = TRUE
      WHERE p.organization_id = $1 AND p.id = $2 AND p.is_active = TRUE`, [organizationId, productId]);
    return result.rows.length === 1 ? result.rows[0] : null;
  }
}
