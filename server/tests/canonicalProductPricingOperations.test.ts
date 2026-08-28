import { describe, expect, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalProductPricingConfigurationSchema,
  renderCanonicalProductPricingMigrationMarkdown,
  validateCanonicalPercentageImpact,
  validateCanonicalPricingMatrixReplacement,
  validateCanonicalPricingTierReplacement,
} from "../services/products/canonicalProductPricingOperations";
import { validateTreeHasBasePrice } from "@shared/pbv2/validator/validateBasePrice";

const matrixTree = {
  schemaVersion: 2,
  status: "DRAFT",
  nodes: {
    size: {
      id: "size",
      type: "INPUT",
      status: "ENABLED",
      input: { type: "select", selectionKey: "size" },
      choices: [{ value: "small" }, { value: "large" }],
    },
    sides: {
      id: "sides",
      type: "INPUT",
      status: "ENABLED",
      input: { type: "select", selectionKey: "sides" },
      choices: [{ value: "single" }, { value: "double" }],
    },
  },
  edges: [],
};

const completeMatrix = {
  dimensions: ["size", "sides"],
  rows: [
    { when: { size: "small", sides: "single" }, variables: { base_price: 400 } },
    { when: { size: "small", sides: "double" }, variables: { base_price: 500 } },
    { when: { size: "large", sides: "single" }, variables: { base_price: 600 } },
    { when: { size: "large", sides: "double" }, variables: { base_price: 700 } },
  ],
};

describe("CanonicalProductPricingOperations", () => {
  test("accepts exact integer-cent scalar, matrix, and gapless tier configurations", () => {
    expect(canonicalProductPricingConfigurationSchema.parse({ model: "scalar", unit: "per_piece", priceCents: 1299, minimumChargeCents: 2500 })).toEqual({ model: "scalar", unit: "per_piece", priceCents: 1299, minimumChargeCents: 2500 });
    expect(canonicalProductPricingConfigurationSchema.parse({ model: "one_dimensional_matrix", unit: "per_square_foot", optionKey: "finish", cells: [{ option: "matte", priceCents: 450 }, { option: "gloss", priceCents: 500 }] }).cells).toHaveLength(2);
    expect(canonicalProductPricingConfigurationSchema.parse({ model: "quantity_tiers", unit: "per_piece", tiers: [{ minimumQuantity: 1, maximumQuantity: 9, priceCents: 500 }, { minimumQuantity: 10, maximumQuantity: null, priceCents: 450 }] }).tiers).toHaveLength(2);
  });

  test("rejects fractional/negative cents, duplicate matrix cells, and tier gaps", () => {
    expect(() => canonicalProductPricingConfigurationSchema.parse({ model: "scalar", unit: "per_piece", priceCents: 12.5 })).toThrow();
    expect(() => canonicalProductPricingConfigurationSchema.parse({ model: "scalar", unit: "per_piece", priceCents: -1 })).toThrow();
    expect(() => canonicalProductPricingConfigurationSchema.parse({ model: "one_dimensional_matrix", unit: "per_piece", optionKey: "finish", cells: [{ option: "matte", priceCents: 400 }, { option: "matte", priceCents: 500 }] })).toThrow();
    expect(() => canonicalProductPricingConfigurationSchema.parse({ model: "quantity_tiers", unit: "per_piece", tiers: [{ minimumQuantity: 1, maximumQuantity: 9, priceCents: 500 }, { minimumQuantity: 11, maximumQuantity: null, priceCents: 450 }] })).toThrow();
  });

  test("requires complete matrix coverage and preserves the submitted values", () => {
    expect(validateCanonicalPricingMatrixReplacement(matrixTree, completeMatrix)).toEqual(completeMatrix);
    const missing = structuredClone(completeMatrix);
    missing.rows.pop();
    expect(() => validateCanonicalPricingMatrixReplacement(matrixTree, missing)).toThrow(expect.objectContaining({ code: "PBV2_MATRIX_CELLS_MISSING" }));
    const duplicate = structuredClone(completeMatrix);
    duplicate.rows[3]!.when = { size: "large", sides: "single" };
    expect(() => validateCanonicalPricingMatrixReplacement(matrixTree, duplicate)).toThrow(expect.objectContaining({ code: "PBV2_MATRIX_CELL_DUPLICATE" }));
  });

  test("validates established lower-bound tiers and percentage modes without new math", () => {
    const tiers = { tierType: "qtyTiers", tiers: [{ minQty: 1, perSqftCents: 450 }, { minQty: 10, perSqftCents: 400 }] };
    expect(validateCanonicalPricingTierReplacement(tiers)).toEqual(tiers);
    expect(() => validateCanonicalPricingTierReplacement({ ...tiers, tiers: [{ minQty: 2, perSqftCents: 450 }] })).toThrow(expect.objectContaining({ code: "PBV2_TIER_COVERAGE_INVALID" }));
    expect(validateCanonicalPercentageImpact({ mode: "addPercent", percent: 12.5, basis: "base" })).toEqual({ mode: "addPercent", percent: 12.5, basis: "base" });
    expect(() => validateCanonicalPercentageImpact({ mode: "multiplier", factor: 1.2 })).toThrow(expect.objectContaining({ code: "PBV2_PERCENTAGE_IMPACT_INVALID" }));
  });

  test("uses the publish pricing-source rule before an active scalar replacement", () => {
    const activeTree = {
      ...matrixTree,
      meta: { pricingProfileKey: "qty_only", pricingV2: { base: { perSqftCents: 0, perPieceCents: 0, minimumChargeCents: 0 } } },
      pricingMatrix: { dimensions: ["size"], rows: [{ when: { size: "small" }, variables: { base_price: 400 } }, { when: { size: "large" }, variables: { base_price: 500 } }] },
    };
    expect(validateTreeHasBasePrice(activeTree).ok).toBe(true);
    expect(validateTreeHasBasePrice({ ...activeTree, pricingMatrix: undefined }).ok).toBe(false);
  });

  test("keeps Product Editor and AI adapters delegated and the generated report synchronized", async () => {
    const [route, canonicalSource, scalarAdapter, matrixAdapter, tierAdapter, report] = await Promise.all([
      readFile(path.resolve(process.cwd(), "server/routes/products.routes.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "server/services/products/canonicalProductPricingOperations.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "server/services/assistant/productPricingChangeSetDb.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "server/services/assistant/inactivePbv2PricingMatrixEditService.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "server/services/assistant/inactivePbv2QuantityTierEditService.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "docs/architecture/canonical-product-pricing-migration.md"), "utf8"),
    ]);
    expect(route).toContain("canonicalProductPricingOperations.updateProductMetadata");
    expect(route).not.toContain("canonicalProductPricingOperations.propagateEditorDraftBaseToActive");
    expect(canonicalSource).not.toMatch(/\bpricingTier\b|\bwholesaleBaseRate\b|\bretailBaseRate\b/);
    expect(scalarAdapter).toContain("canonicalProductPricingOperations.applyScalarPricing");
    expect(matrixAdapter).toContain("validateCanonicalPricingMatrixReplacement");
    expect(tierAdapter).toContain("validateCanonicalPricingTierReplacement");
    expect(report).toBe(renderCanonicalProductPricingMigrationMarkdown());
  });
});
