import { describe, expect, test } from "@jest/globals";
import { PostgresCustomersCompatibilityReader } from "../../infrastructure/compatibility/postgresCustomersRead";
import { PostgresProductsCompatibilityReader } from "../../infrastructure/compatibility/postgresProductsRead";
import { resolveActivePbv2PricingInput } from "../../src/modules/products/pbv2CompatibilityResolution";
import { brandedId, currencyCode, type OrganizationId } from "../../src/modules/shared/commercialValues";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter";
import { sheetConsumptionSqft } from "../../../shared/pbv2/formulaHelpers";

const org = brandedId<"OrganizationId">("org-a");
const productId = brandedId<"ProductId">("product-a");
const product = {
  organizationId: org, productId, displayName: "Coroplast", lifecycle: "active" as const,
  pricingConfiguration: { id: brandedId<"PricingConfigurationId">("tree-a"), version: "2026-08-15T00:00:00.000Z", contentHash: "sha256:tree" },
  requiresDimensions: true, pricingCurrency: currencyCode("USD"),
};
const tree = {
  schemaVersion: 2 as const, rootNodeIds: ["sides", "hidden"],
  nodes: {
    sides: { id: "sides", kind: "question" as const, label: "Sides", input: { type: "select" as const, selectionKey: "sides", required: true, defaultValue: "single" }, choices: [{ value: "single", label: "Single" }, { value: "double", label: "Double" }] },
    hidden: { id: "hidden", kind: "question" as const, label: "Hidden", input: { type: "select" as const, selectionKey: "hidden" }, visibility: { rules: [{ type: "equals" as const, selectionKey: "sides", value: "double" }] }, choices: [{ value: "x", label: "X" }] },
  },
  meta: { fixedDimensions: { widthIn: 24, heightIn: 18, unit: "in" as const }, pricingV2: { base: { perSqftCents: 100 }, qtyTiers: [{ id: "q10", minQty: 10, perSqftCents: 90 }] } },
};

const queryClient = (rows: unknown[][]) => {
  const calls: { text: string; values?: readonly unknown[] }[] = [];
  return {
    calls,
    client: { query: async <T>(text: string, values?: readonly unknown[]) => { calls.push({ text, values }); return { rows: (rows.shift() ?? []) as T[] } },
  } as any,
  };
};

describe("M1.3 customer/product compatibility reads", () => {
  test("Customer/contact queries structurally bind tenant and active relationship scope", async () => {
    const mock = queryClient([[{ id: "customer-a", display_name: null, company_name: "Acme", email: "a@acme.test", phone: null }], [{ id: "customer-a" }], []]);
    const reader = new PostgresCustomersCompatibilityReader(mock.client);
    expect(await reader.getCustomer(org, brandedId<"CustomerId">("customer-a"))).toEqual({ id: "customer-a", displayName: "Acme" });
    expect(await reader.validateContactReference({ organizationId: org, customerId: brandedId<"CustomerId">("customer-a"), contactId: brandedId<"ContactId">("contact-a") })).toBe(true);
    expect(await reader.validateContactReference({ organizationId: org, customerId: brandedId<"CustomerId">("customer-a"), contactId: brandedId<"ContactId">("contact-b") })).toBe(false);
    expect(mock.calls[0]!.text).toContain("organization_id = $1 AND id = $2");
    expect(mock.calls[1]!.text).toContain("customer_contact_links");
    expect(mock.calls[1]!.text).toContain("ct.organization_id = c.organization_id");
    expect(mock.calls[1]!.values).toEqual(["org-a", "customer-a", "contact-a"]);
  });

  test("presentation mapping exposes recipient facts, never CRM internals", async () => {
    const mock = queryClient([[{ id: "customer-a", display_name: "Acme Display", company_name: "Acme", email: "billing@acme.test", phone: "555", billing_street1: "1 Main", billing_street2: null, billing_city: "Town", billing_state: "OH", billing_postal_code: "44101", billing_country: "US", shipping_street1: null, shipping_street2: null, shipping_city: null, shipping_state: null, shipping_postal_code: null, shipping_country: null }], [{ id: "contact-a", first_name: "Ada", last_name: "Lovelace", email: "ada@acme.test", phone: null }]]);
    const identity = await new PostgresCustomersCompatibilityReader(mock.client).getPresentationIdentity({ organizationId: org, customerId: brandedId<"CustomerId">("customer-a"), contactId: brandedId<"ContactId">("contact-a") });
    expect(identity).toMatchObject({ customerDisplayName: "Acme Display", companyName: "Acme", contactDisplayName: "Ada Lovelace", email: "ada@acme.test", billingAddress: { lines: ["1 Main"], city: "Town" } });
    expect(JSON.stringify(identity)).not.toMatch(/quickbooks|credit|notes/i);
  });

  test("PBV2 resolution applies defaults, rejects hidden/unknown selections, and preserves only resolved facts", () => {
    const normal = resolveActivePbv2PricingInput(product, { id: "tree-a", schemaVersion: 2, publishedAt: "2026-08-15T00:00:00.000Z", treeJson: tree, productMeasurementMode: "dimensions_required", productPricingProfileKey: "default", formula: null }, { organizationId: org, productId, quantity: 10 });
    expect(normal.ok && normal.value.resolvedConfiguration.selections).toEqual({ sides: "single" });
    expect(normal.ok && normal.value.resolvedConfiguration.dimensions).toMatchObject({ width: "24", height: "18" });
    expect(normal.ok && normal.value.rules.tiers?.[0]).toMatchObject({ id: "q10", minQuantity: 10, perSquareFootCents: "90" });
    const injected = resolveActivePbv2PricingInput(product, { id: "tree-a", schemaVersion: 2, publishedAt: null, treeJson: tree, productMeasurementMode: "dimensions_required", productPricingProfileKey: "default", formula: null }, { organizationId: org, productId, quantity: 1, selections: { hidden: "x" } });
    expect(injected).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(JSON.stringify(normal)).not.toContain("treeJson");
  });

  test("PBV2 resolution maps selected choice impacts and tier minimums without leaking tree data", async () => {
    const pricedTree = {
      ...tree,
      nodes: {
        ...tree.nodes,
        sides: { ...tree.nodes.sides, choices: [{ value: "single", label: "Single", priceDeltaCents: 25 }] },
      },
      meta: { ...tree.meta, pricingV2: { base: { perPieceCents: 100 }, qtyTiers: [{ id: "q10", minQty: 10, perPieceCents: 90, minimumChargeCents: 1000 }] } },
    };
    const resolved = resolveActivePbv2PricingInput(product, { id: "tree-a", schemaVersion: 2, publishedAt: "2026-08-15T00:00:00.000Z", treeJson: pricedTree, productMeasurementMode: "dimensions_required", productPricingProfileKey: "qty", formula: null }, { organizationId: org, productId, quantity: 10 });
    expect(resolved.ok && resolved.value.rules.optionImpacts).toMatchObject([{ selectionKey: "sides", whenValue: "single", kind: "fixed", amount: 25 }]);
    expect(resolved.ok && resolved.value.rules.tiers?.[0]).toMatchObject({ minimumChargeCents: 1000 });
    if (!resolved.ok) return;
    const price = await new V2PricingParityAdapter().calculate({ organizationId: org, sellableProduct: { ...resolved.value.sellableProduct, pricingConfiguration: { ...resolved.value.sellableProduct.pricingConfiguration, contentHash: resolved.value.resolvedConfiguration.pricingConfigurationContentHash } }, resolvedConfiguration: resolved.value.resolvedConfiguration, rules: resolved.value.rules, pricingContext: { channel: "staff", effectiveAt: "2026-08-15T00:00:00.000Z" } });
    expect(price.calculatedLineAmount.cents).toBe(1000);
    expect(price.minimumChargeApplied).toBe(true);
    expect(JSON.stringify(resolved.value)).not.toContain("treeJson");
  });

  test("PBV2 option pricing skips absent optional values but preserves defaults, required validation, explicit impacts, and invalid-value rejection", () => {
    const optionalTree = {
      ...tree,
      rootNodeIds: ["optional", "multi", "required", "computed"],
      nodes: {
        optional: { id: "optional", kind: "question" as const, label: "Optional", input: { type: "select" as const, selectionKey: "optional" }, choices: [{ value: "yes", label: "Yes", priceDeltaCents: 25 }], pricingImpact: [{ mode: "addFlat" as const, amountCents: 10 }] },
        multi: { id: "multi", kind: "question" as const, label: "Multi", input: { type: "multiselect" as const, selectionKey: "multi" }, choices: [{ value: "x", label: "X", priceDeltaCents: 15 }] },
        required: { id: "required", kind: "question" as const, label: "Required", input: { type: "select" as const, selectionKey: "required", required: true }, choices: [{ value: "ok", label: "OK" }] },
        computed: { id: "computed", kind: "computed" as const, label: "Base Entry", key: "base" },
      },
    };
    const source = { id: "tree-optional", schemaVersion: 2, publishedAt: null, treeJson: optionalTree, productMeasurementMode: "dimensions_required" as const, productPricingProfileKey: "default", formula: null };
    const missingRequired = resolveActivePbv2PricingInput(product, source, { organizationId: org, productId, quantity: 1 });
    expect(missingRequired).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR", publicMessage: "Required selection 'required' is missing." } });
    const absentOptional = resolveActivePbv2PricingInput(product, source, { organizationId: org, productId, quantity: 1, selections: { required: "ok", multi: [] } });
    expect(absentOptional.ok && absentOptional.value.rules.optionImpacts).toBeUndefined();
    const explicit = resolveActivePbv2PricingInput(product, source, { organizationId: org, productId, quantity: 1, selections: { required: "ok", optional: "yes" } });
    expect(explicit.ok && explicit.value.rules.optionImpacts).toMatchObject([{ selectionKey: "optional", kind: "fixed", amount: 10 }, { selectionKey: "optional", whenValue: "yes", kind: "fixed", amount: 25 }]);
    const invalid = resolveActivePbv2PricingInput(product, source, { organizationId: org, productId, quantity: 1, selections: { required: "ok", optional: { invalid: true } as any } });
    expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  test("compatible Product read resolves to the M1.2 Pricing contract without any commercial write", async () => {
    const resolved = resolveActivePbv2PricingInput(product, { id: "tree-a", schemaVersion: 2, publishedAt: "2026-08-15T00:00:00.000Z", treeJson: tree, productMeasurementMode: "dimensions_required", productPricingProfileKey: "default", formula: null }, { organizationId: org, productId, quantity: 10 });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const price = await new V2PricingParityAdapter().calculate({ organizationId: org, sellableProduct: { ...resolved.value.sellableProduct, pricingConfiguration: { ...resolved.value.sellableProduct.pricingConfiguration, contentHash: resolved.value.resolvedConfiguration.pricingConfigurationContentHash } }, resolvedConfiguration: resolved.value.resolvedConfiguration, rules: resolved.value.rules, pricingContext: { channel: "staff", effectiveAt: "2026-08-15T00:00:00.000Z" } });
    expect(price.calculatedLineAmount.cents).toBe(2700);
    expect(price.normalizedInput.pricingConfigurationId).toBe("tree-a");
  });

  test("quantity-only strips stale dimensions and unsupported formula functions fail closed", () => {
    const quantityOnly = resolveActivePbv2PricingInput({ ...product, requiresDimensions: false }, { id: "tree-a", schemaVersion: 2, publishedAt: null, treeJson: tree, productMeasurementMode: "quantity_only", productPricingProfileKey: "qty_only", formula: null }, { organizationId: org, productId, quantity: 2, dimensions: { width: "24" as any, height: "36" as any, unit: "in" } });
    expect(quantityOnly.ok && quantityOnly.value.resolvedConfiguration.dimensions).toBeUndefined();
    const unsupported = resolveActivePbv2PricingInput(product, { id: "tree-a", schemaVersion: 2, publishedAt: null, treeJson: { ...tree, meta: { ...tree.meta, pricingFormula: "floor(sqft) * p" } }, productMeasurementMode: "dimensions_required", productPricingProfileKey: "default", formula: null }, { organizationId: org, productId, quantity: 1 });
    expect(unsupported).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  test("Formula Library resolution carries source version and immutable content evidence", () => {
    const resolved = resolveActivePbv2PricingInput(product, { id: "tree-a", schemaVersion: 2, publishedAt: null, treeJson: { ...tree, meta: { ...tree.meta, pricingFormula: undefined } }, productMeasurementMode: "dimensions_required", productPricingProfileKey: "default", formula: { id: "formula-a", code: "AREA", profileKey: "formula", expression: "ceil(sqft) * base_price", config: { source: "fixture" }, updatedAt: "2026-08-15T01:02:03.000Z" } }, { organizationId: org, productId, quantity: 1 });
    expect(resolved.ok && resolved.value.rules.formula).toMatchObject({ source: "library", id: "formula-a", version: "2026-08-15T01:02:03.000Z", expression: "ceil(sqft) * base_price" });
    expect(resolved.ok && resolved.value.rules.formula?.contentHash).toMatch(/^sha256:/);
  });

  test("Formula Library sheet_consumption_sqft uses the established helper and configured variables", async () => {
    const source = { id: "tree-a", schemaVersion: 2, publishedAt: "2026-08-15T00:00:00.000Z", treeJson: { ...tree, meta: { ...tree.meta, pricingFormula: undefined } }, productMeasurementMode: "dimensions_required" as const, productPricingProfileKey: "default", formula: { id: "formula-sheet", code: "SHEET", profileKey: "formula", expression: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price", config: { variables: { sheet_width: 48, sheet_length: 96, usable_drop_min: 0, billable_length_increment: 1, minimum_billable_sqft: 0 } }, updatedAt: "2026-08-15T01:02:03.000Z" } };
    const resolved = resolveActivePbv2PricingInput(product, source, { organizationId: org, productId, quantity: 1, dimensions: { width: "24" as any, height: "18" as any, unit: "in" } });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.nestingEstimate?.facts).toMatchObject({ totalSheetCount: 1, billedSheetSqft: 3 });
    const result = await new V2PricingParityAdapter().calculate({ organizationId: org, sellableProduct: { ...resolved.value.sellableProduct, pricingConfiguration: { ...resolved.value.sellableProduct.pricingConfiguration, contentHash: resolved.value.resolvedConfiguration.pricingConfigurationContentHash } }, resolvedConfiguration: resolved.value.resolvedConfiguration, rules: resolved.value.rules, pricingContext: { channel: "staff", effectiveAt: "2026-08-15T00:00:00.000Z" }, nestingEstimate: resolved.value.nestingEstimate });
    expect(result.calculatedLineAmount.cents).toBe(Math.round(sheetConsumptionSqft(24, 18, 1, 48, 96, 0, 1, 0) * 100));
  });

  test("published computed-sheet matrix pricing supplies one canonical sheet estimate to Pricing", async () => {
    const coroplastTree = {
      ...tree,
      rootNodeIds: ["sides", "thickness"],
      nodes: {
        sides: { id: "sides", kind: "question" as const, label: "Print Sides", input: { type: "select" as const, selectionKey: "print_sides", required: true }, choices: [{ value: "double_sided", label: "Double sided" }] },
        thickness: { id: "thickness", kind: "question" as const, label: "Thickness", input: { type: "select" as const, selectionKey: "thickness", required: true }, choices: [{ value: "4mm", label: "4mm" }] },
      },
      meta: {
        pricingV2: { base: { perSqftCents: 137.5, minimumChargeCents: 525 } },
        pricingMatrix: {
          id: "coroplast-matrix", dimensions: ["print_sides", "thickness"], rows: [{ id: "double-4mm", when: { print_sides: "double_sided", thickness: "4mm" }, variables: { base_price: 0 }, tierBasis: "computed_sheet_usage", qtyTiers: [{ id: "sheet-tier", minQty: 1, perSqftCents: 172 }] }],
        },
      },
    };
    const source = { id: "tree-coroplast", schemaVersion: 2, publishedAt: "2026-08-15T00:00:00.000Z", treeJson: coroplastTree, productMeasurementMode: "dimensions_required" as const, productPricingProfileKey: "formula", formula: { id: "formula-sheet", code: "4X8", profileKey: "formula", expression: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price", config: { variables: { sheet_width: 48, sheet_length: 96, usable_drop_min: 24, billable_length_increment: 12, minimum_billable_sqft: 3 } }, updatedAt: "2026-08-15T01:02:03.000Z" } };
    const resolved = resolveActivePbv2PricingInput(product, source, { organizationId: org, productId, quantity: 2, dimensions: { width: "48" as any, height: "96" as any, unit: "in" }, selections: { print_sides: "double_sided", thickness: "4mm" } });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.nestingEstimate?.facts).toMatchObject({ totalSheetCount: 2, billedSheetSqft: 64 });
    const result = await new V2PricingParityAdapter().calculate({ organizationId: org, sellableProduct: { ...resolved.value.sellableProduct, pricingConfiguration: { ...resolved.value.sellableProduct.pricingConfiguration, contentHash: resolved.value.resolvedConfiguration.pricingConfigurationContentHash } }, resolvedConfiguration: resolved.value.resolvedConfiguration, rules: resolved.value.rules, nestingEstimate: resolved.value.nestingEstimate, pricingContext: { channel: "staff", effectiveAt: "2026-08-15T00:00:00.000Z" } });
    expect(result.calculatedLineAmount.cents).toBe(11008);
    expect(result.minimumChargeApplied).toBe(false);
    expect(result.tier).toMatchObject({ source: "computed_sheet", basisValue: "2", selectedTierId: "sheet-tier", selectedRate: "172" });
    expect(result.matrix?.rowId).toBe("double-4mm");
  });

  test("PBV2 per-square-foot set and add base-rate overrides are resolved before formula pricing", async () => {
    const overrideTree = { ...tree, nodes: { rate: { id: "rate", kind: "question" as const, label: "Material", input: { type: "select" as const, selectionKey: "rate", required: true, defaultValue: "standard" }, choices: [{ value: "standard", label: "Standard", pricingOverride: { mode: "set_base_rate" as const, unit: "perSqft" as const, appliesTo: "area" as const, amount: 125 } }] }, print: { id: "print", kind: "question" as const, label: "Print", input: { type: "select" as const, selectionKey: "print", required: true, defaultValue: "double" }, choices: [{ value: "double", label: "Double", pricingOverride: { mode: "add_base_rate" as const, unit: "perSqft" as const, appliesTo: "area" as const, amount: 150 } }] } }, rootNodeIds: ["rate", "print"], meta: { pricingV2: { base: { perSqftCents: 100, minimumChargeCents: 200 } }, pricingFormula: "total_sqft * p" } };
    const resolved = resolveActivePbv2PricingInput(product, { id: "tree-a", schemaVersion: 2, publishedAt: "2026-08-15T00:00:00.000Z", treeJson: overrideTree, productMeasurementMode: "dimensions_required", productPricingProfileKey: "default", formula: null }, { organizationId: org, productId, quantity: 1, dimensions: { width: "12" as any, height: "12" as any, unit: "in" } });
    expect(resolved.ok && resolved.value.rules.baseRateOverrides).toHaveLength(2);
    if (!resolved.ok) return;
    const result = await new V2PricingParityAdapter().calculate({ organizationId: org, sellableProduct: { ...resolved.value.sellableProduct, pricingConfiguration: { ...resolved.value.sellableProduct.pricingConfiguration, contentHash: resolved.value.resolvedConfiguration.pricingConfigurationContentHash } }, resolvedConfiguration: resolved.value.resolvedConfiguration, rules: resolved.value.rules, pricingContext: { channel: "staff", effectiveAt: "2026-08-15T00:00:00.000Z" } });
    expect(result.calculatedLineAmount.cents).toBe(275);
    expect(result.minimumChargeApplied).toBe(false);
  });

  test("unmappable Formula Library and option semantics fail closed", () => {
    const blankFormula = resolveActivePbv2PricingInput(product, { id: "tree-a", schemaVersion: 2, publishedAt: null, treeJson: tree, productMeasurementMode: "dimensions_required", productPricingProfileKey: "default", formula: { id: "formula-a", code: "AREA", profileKey: "formula", expression: " ", config: null, updatedAt: "2026-08-15T01:02:03.000Z" } }, { organizationId: org, productId, quantity: 1 });
    expect(blankFormula).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    const arbitraryFunction = resolveActivePbv2PricingInput(product, { id: "tree-a", schemaVersion: 2, publishedAt: null, treeJson: { ...tree, meta: { ...tree.meta, pricingFormula: "sqrt(sqft)" } }, productMeasurementMode: "dimensions_required", productPricingProfileKey: "default", formula: null }, { organizationId: org, productId, quantity: 1 });
    expect(arbitraryFunction).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    const unsupportedImpact = resolveActivePbv2PricingInput(product, { id: "tree-a", schemaVersion: 2, publishedAt: null, treeJson: { ...tree, nodes: { ...tree.nodes, sides: { ...tree.nodes.sides, choices: [{ value: "single", label: "Single", pricingImpact: [{ mode: "addFormula", formula: "1" }] }] } } }, productMeasurementMode: "dimensions_required", productPricingProfileKey: "default", formula: null }, { organizationId: org, productId, quantity: 1 });
    expect(unsupportedImpact).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  test("normal Product query binds pointer, tenant, Product, ACTIVE tree, and active formula", async () => {
    const row = { product_id: "product-a", product_name: "Coroplast", product_type_id: "type-a", measurement_mode: "dimensions_required", pricing_profile_key: "default", product_formula_id: null, tree_id: "tree-a", tree_schema_version: 2, tree_published_at: new Date("2026-08-15T00:00:00.000Z"), tree_json: tree, formula_id: null, formula_code: null, formula_profile_key: null, formula_expression: null, formula_config: null, formula_updated_at: null };
    const mock = queryClient([[row]]);
    const reader = new PostgresProductsCompatibilityReader(mock.client);
    const result = await reader.resolveActivePricingInput({ organizationId: org, productId, quantity: 1 });
    expect(result.ok).toBe(true);
    expect(mock.calls[0]!.text).toContain("t.id = p.pbv2_active_tree_version_id");
    expect(mock.calls[0]!.text).toContain("t.organization_id = p.organization_id");
    expect(mock.calls[0]!.text).toContain("t.product_id = p.id");
    expect(mock.calls[0]!.text).toContain("t.status = 'ACTIVE'");
    expect(mock.calls[0]!.text).toContain("f.is_active = TRUE");
    expect(mock.calls[0]!.values).toEqual(["org-a", "product-a"]);
  });

  test("missing/inactive/stale configuration is safe not-found before Pricing", async () => {
    const reader = new PostgresProductsCompatibilityReader(queryClient([[]]).client);
    await expect(reader.resolveActivePricingInput({ organizationId: org, productId, quantity: 1 })).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  test("Formula Library pointer with blank active expression fails closed before Pricing", async () => {
    const row = { product_id: "product-a", product_name: "Coroplast", product_type_id: null, measurement_mode: "dimensions_required", pricing_profile_key: "default", product_formula_id: "formula-a", tree_id: "tree-a", tree_schema_version: 2, tree_published_at: null, tree_json: tree, formula_id: "formula-a", formula_code: "AREA", formula_profile_key: "formula", formula_expression: " ", formula_config: null, formula_updated_at: new Date("2026-08-15T00:00:00.000Z") };
    const result = await new PostgresProductsCompatibilityReader(queryClient([[row]]).client).resolveActivePricingInput({ organizationId: org, productId, quantity: 1 });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });
});
