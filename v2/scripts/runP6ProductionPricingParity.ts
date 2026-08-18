import assert from "node:assert/strict";
import { Pool } from "pg";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { resolveActivePbv2PricingInput } from "../src/modules/products/pbv2CompatibilityResolution.js";
import { V2PricingParityAdapter } from "../src/modules/pricing/v2PricingAdapter.js";
import { brandedId, currencyCode, decimalText } from "../src/modules/shared/commercialValues.js";

const cloneHost = "ep-soft-frost-aef6c2jb-pooler.c-2.us-east-2.aws.neon.tech";
const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
type Row = { organization_id: string; product_id: string; name: string; measurement_mode: "dimensions_required" | "quantity_only"; pricing_profile_key: string | null; active_id: string; schema_version: number; updated_at: Date; tree_json: unknown; formula_id: string | null; formula_code: string | null; formula_profile_key: string | null; formula_expression: string | null; formula_config: unknown; formula_updated_at: Date | null };
const selectionsFor = (_tree: unknown, overrides: Record<string, unknown> = {}) => ({ ...overrides });
async function price(row: Row, extraSelections: Record<string, unknown> = {}) {
  const sellable = { organizationId: brandedId<"OrganizationId">(row.organization_id), productId: brandedId<"ProductId">(row.product_id), displayName: row.name, lifecycle: "active" as const, pricingConfiguration: { id: brandedId<"PricingConfigurationId">(row.active_id), version: row.updated_at.toISOString(), contentHash: "sha256:active" }, requiresDimensions: row.measurement_mode !== "quantity_only", pricingCurrency: currencyCode("USD") };
  const formula = row.formula_id && row.formula_profile_key && row.formula_expression && row.formula_updated_at ? { id: row.formula_id, code: row.formula_code ?? row.formula_id, profileKey: row.formula_profile_key, expression: row.formula_expression, config: record(row.formula_config), updatedAt: row.formula_updated_at.toISOString() } : null;
  const dimensions = row.measurement_mode === "quantity_only" ? undefined : { width: decimalText("24"), height: decimalText("24"), unit: "in" as const };
  const resolved = resolveActivePbv2PricingInput(sellable, { id: row.active_id, schemaVersion: row.schema_version, publishedAt: row.updated_at.toISOString(), treeJson: row.tree_json, productMeasurementMode: row.measurement_mode, productPricingProfileKey: row.pricing_profile_key, formula }, { organizationId: sellable.organizationId, productId: sellable.productId, quantity: 2, ...(dimensions ? { dimensions } : {}), selections: selectionsFor(row.tree_json, extraSelections) as any });
  assert(resolved.ok, `${row.name} (${row.product_id}) did not resolve: ${resolved.ok ? "" : `${resolved.error.code} ${resolved.error.publicMessage}`}`);
  const result = await new V2PricingParityAdapter().calculate({ organizationId: sellable.organizationId, sellableProduct: { ...sellable, pricingConfiguration: { ...sellable.pricingConfiguration, contentHash: resolved.value.resolvedConfiguration.pricingConfigurationContentHash } }, resolvedConfiguration: resolved.value.resolvedConfiguration, rules: resolved.value.rules, pricingContext: { channel: "staff", effectiveAt: new Date().toISOString() } });
  assert(Number.isSafeInteger(result.calculatedLineAmount.cents) && result.calculatedLineAmount.cents >= 0, `${row.name} returned an invalid price.`); return result.calculatedLineAmount.cents;
}
async function main() {
  const url = requireV2M0CloneDatabaseUrl(), target = new URL(url); assert.equal(target.hostname, cloneHost, "Production parity rehearsal refuses a database other than the authorized MAIN-derived DEV clone."); assert.equal(target.pathname.replace(/^\//u, ""), "neondb", "Production parity rehearsal refuses a database other than neondb.");
  const pool = new Pool({ connectionString: url, max: 4 });
  try {
    const rows = (await pool.query<Row>("SELECT p.organization_id,p.id product_id,p.name,p.measurement_mode,p.pricing_profile_key,a.id active_id,a.schema_version,a.updated_at,a.tree_json,f.id formula_id,f.code formula_code,f.pricing_profile_key formula_profile_key,f.expression formula_expression,f.config formula_config,f.updated_at formula_updated_at FROM products p JOIN pbv2_tree_versions a ON a.organization_id=p.organization_id AND a.id=p.pbv2_active_tree_version_id AND a.status='ACTIVE' LEFT JOIN pricing_formulas f ON f.organization_id=p.organization_id AND f.id=p.pricing_formula_id AND f.is_active=TRUE WHERE p.is_active=TRUE ORDER BY p.id")).rows;
    const formulaHelpers = rows.filter(row => /\bsheet_consumption_sqft\s*\(/u.test(row.formula_expression ?? "")); assert.equal(formulaHelpers.length, 12, "The MAIN-derived clone no longer has the 12 Formula Library sheet-consumption representatives.");
    const formulaResults = await Promise.all(formulaHelpers.map(async row => ({ product: row.name, cents: await price(row) })));
    const banners = rows.filter(row => Object.values(record(record(row.tree_json).nodes)).map(record).some(node => Array.isArray(node.choices) && node.choices.map(record).some(choice => ["set_base_rate", "add_base_rate"].includes(String(record(choice.pricingOverride).mode))))); assert.equal(banners.length, 2, "The MAIN-derived clone no longer has the two Banner base-rate override representatives.");
    const bannerResults = [] as unknown[]; for (const banner of banners) { const set = await price(banner, { banner_weight: "18oz" }), added = await price(banner, { banner_weight: "18oz", print_side: "double_sided" }); assert(added > set, `${banner.name} did not apply add_base_rate after set_base_rate.`); bannerResults.push({ product: banner.name, setBaseRate: set, setAndAdd: added }); }
    console.log(JSON.stringify({ formulaLibrarySheetConsumptionProducts: formulaResults, bannerBaseRateOverrides: bannerResults }, null, 2)); console.log("[p6] MAIN PBV2 Formula Library and base-rate override compatibility rehearsal passed.");
  } finally { await pool.end(); }
}
void main().catch(error => { console.error(`[p6] ${error instanceof Error ? error.stack ?? error.message : String(error)}`); process.exitCode = 1; });
