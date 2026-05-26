import { afterAll, beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import { sql } from "drizzle-orm";

import { db } from "../../../db";
import { evaluatePricingPreviewFromTree, priceLineItem } from "../PricingService";
import {
  COROPLAST_4X8_FORMULA,
  COROPLAST_4X8_FORMULA_CONFIG,
  evaluateCoroplastGoldenPreview,
  makeCoroplastGoldenTree,
} from "./fixtures/pbv2GoldenPricing.fixtures";

const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
const organizationId = `org_pbv2_golden_${suffix}`;
const productId = `prod_pbv2_golden_${suffix}`;
const treeVersionId = `tree_pbv2_golden_${suffix}`;
const pricingFormulaId = `formula_pbv2_golden_${suffix}`;

const PRODUCT_PRICING_PROFILE_CONFIG = {
  formulaVariables: {
    allow_rotation: true,
  },
};

beforeAll(async () => {
  await db.execute(sql`
    insert into organizations (id, name, slug)
    values (${organizationId}, ${`PBV2 Golden ${suffix}`}, ${`pbv2-golden-${suffix}`})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into products (id, organization_id, name, description, pricing_profile_key)
    values (${productId}, ${organizationId}, ${"PBV2 Golden Coroplast"}, ${"golden pricing regression"}, ${"default"})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into pricing_formulas (
      id,
      organization_id,
      name,
      code,
      description,
      pricing_profile_key,
      expression,
      config,
      is_active
    )
    values (
      ${pricingFormulaId},
      ${organizationId},
      ${"4x8 Sheets with rounding"},
      ${"4X8_WITH_WASTE_CALCULATION"},
      ${"Golden Coroplast 4x8 sheet-yield formula"},
      ${"default"},
      ${COROPLAST_4X8_FORMULA},
      ${JSON.stringify(COROPLAST_4X8_FORMULA_CONFIG)}::jsonb,
      true
    )
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into pbv2_tree_versions (id, organization_id, product_id, status, schema_version, tree_json, published_at)
    values (${treeVersionId}, ${organizationId}, ${productId}, ${"ACTIVE"}, ${2}, ${JSON.stringify(makeCoroplastGoldenTree({ allowRotationDefault: true }))}::jsonb, now())
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    update products
    set pbv2_active_tree_version_id = ${treeVersionId}
    where id = ${productId}
  `);
});

afterAll(async () => {
  await db.execute(sql`delete from pricing_formulas where organization_id = ${organizationId}`);
  await db.execute(sql`delete from pbv2_tree_versions where organization_id = ${organizationId}`);
  await db.execute(sql`delete from products where id = ${productId}`);
  await db.execute(sql`delete from organizations where id = ${organizationId}`);
});

beforeEach(async () => {
  await db.execute(sql`
    update pbv2_tree_versions
    set tree_json = ${JSON.stringify(makeCoroplastGoldenTree({ allowRotationDefault: true }))}::jsonb
    where id = ${treeVersionId}
  `);

  await db.execute(sql`
    update products
    set pricing_formula_id = ${pricingFormulaId},
        pricing_formula = ${"ceil(total_sqft) * base_price"},
        pricing_engine = ${"formulaLibrary"},
        pricing_profile_key = ${"default"},
        pricing_profile_config = ${JSON.stringify(PRODUCT_PRICING_PROFILE_CONFIG)}::jsonb,
        price_breaks = '{"enabled":false,"type":"quantity","tiers":[]}'::jsonb
    where id = ${productId}
  `);
});

describe("PBV2 golden pricing regression fixtures", () => {
  test.each([
    { quantity: 8, totalSheetCount: 1, fullSheets: 0, partialPieces: 8, billedSheetSqft: 32, tierMinQty: 1, tierRate: 1.375, finalTotal: 44 },
    { quantity: 10, totalSheetCount: 1, fullSheets: 1, partialPieces: 0, billedSheetSqft: 32, tierMinQty: 1, tierRate: 1.375, finalTotal: 44 },
    { quantity: 91, totalSheetCount: 10, fullSheets: 9, partialPieces: 1, billedSheetSqft: 320, tierMinQty: 10, tierRate: 1.03, finalTotal: 329.6 },
    { quantity: 100, totalSheetCount: 10, fullSheets: 10, partialPieces: 0, billedSheetSqft: 320, tierMinQty: 10, tierRate: 1.03, finalTotal: 329.6 },
    { quantity: 101, totalSheetCount: 11, fullSheets: 10, partialPieces: 1, billedSheetSqft: 352, tierMinQty: 10, tierRate: 1.03, finalTotal: 362.56 },
  ])("Coroplast 24x18 q$quantity follows the 4x8 sheet-yield golden path", ({
    quantity,
    totalSheetCount,
    fullSheets,
    partialPieces,
    billedSheetSqft,
    tierMinQty,
    tierRate,
    finalTotal,
  }) => {
    const result = evaluateCoroplastGoldenPreview({
      widthIn: 24,
      heightIn: 18,
      quantity,
      allowRotationDefault: true,
    });

    expect(result.debug?.pricingSystem).toBe("pbv2");
    expect(result.debug?.resolvedFormulaSource).toBe("library");
    expect(result.debug?.resolvedFormulaExpression).toBe(COROPLAST_4X8_FORMULA);
    expect(result.debug?.variables.allow_rotation).toBe(true);
    expect(result.debug?.variables.sheet_width).toBe(48);
    expect(result.debug?.variables.sheet_length).toBe(96);
    expect(result.debug?.variables.minimum_billable_sqft).toBe(32);
    expect(result.debug?.tierResolution?.piecesPerSheet).toBe(10);
    expect(result.debug?.tierResolution?.totalSheetCount).toBe(totalSheetCount);
    expect(result.debug?.tierResolution?.tierSelectionQuantity).toBe(totalSheetCount);
    expect(result.debug?.tierResolution?.selectedTierMinQty).toBe(tierMinQty);
    expect(result.debug?.tierResolution?.selectedTierRate).toBe(tierRate);
    expect(result.debug?.tierResolution?.fallbackToLineItemQuantity).toBe(false);
    expect(result.debug?.sheetYield).toEqual(expect.objectContaining({
      piecesPerSheet: 10,
      fullSheets,
      partialSheetPieceCount: partialPieces,
      totalSheetCount,
      billedSheetSqft,
    }));
    expect(result.debug?.variables.computed_sheets).toBe(totalSheetCount);
    expect(result.debug?.variables.billed_sheet_sqft).toBe(billedSheetSqft);
    expect(result.debug?.rawBasePrice).toBe(tierRate);
    expect(result.debug?.evaluatedFormulaTotalRaw).toBeCloseTo(finalTotal, 6);
    expect(result.debug?.evaluatedFormulaTotalRounded).toBe(finalTotal);
    expect(result.debug?.finalTotalSource).toBe("formula");
    expect(result.debug?.finalTotal).toBe(finalTotal);
    expect(result.totalPrice).toBe(finalTotal);
  });

  test.each([
    { allowRotationSelection: "no" as const, piecesPerSheet: 4, totalSheetCount: 2, orientationUsed: "normal", finalTotal: 88 },
    { allowRotationSelection: "yes" as const, piecesPerSheet: 5, totalSheetCount: 1, orientationUsed: "mixed", finalTotal: 44 },
  ])("Coroplast 24x36 q5 honors allow_rotation=$allowRotationSelection", ({
    allowRotationSelection,
    piecesPerSheet,
    totalSheetCount,
    orientationUsed,
    finalTotal,
  }) => {
    const result = evaluateCoroplastGoldenPreview({
      widthIn: 24,
      heightIn: 36,
      quantity: 5,
      allowRotationDefault: false,
      allowRotationSelection,
    });

    expect(result.debug?.variables.allow_rotation).toBe(allowRotationSelection === "yes");
    expect(result.debug?.variableSources?.allow_rotation).toBe("pbv2.choice:allow_rotation");
    expect(result.debug?.tierResolution).toEqual(expect.objectContaining({
      normalPiecesPerSheet: 4,
      rotatedPiecesPerSheet: 4,
      mixedPiecesPerSheet: 5,
      piecesPerSheet,
      orientationUsed,
      totalSheetCount,
      tierSelectionQuantity: totalSheetCount,
    }));
    expect(result.debug?.sheetYield).toEqual(expect.objectContaining({
      piecesPerSheet,
      orientationUsed,
      totalSheetCount,
    }));
    expect(result.totalPrice).toBe(finalTotal);
  });

  test("PBV2 tree JSON save/reload preserves high-precision tier rate 1.375", async () => {
    const tree = makeCoroplastGoldenTree({ allowRotationDefault: true });
    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(tree)}::jsonb
      where id = ${treeVersionId}
    `);

    const stored = await db.execute(sql`
      select tree_json
      from pbv2_tree_versions
      where id = ${treeVersionId}
      limit 1
    `);
    const storedTree = (stored.rows[0] as { tree_json?: any } | undefined)?.tree_json;

    expect(storedTree?.pricingMatrix?.rows?.[0]?.qtyTiers?.[0]?.perSqftCents).toBe(137.5);

    const result = evaluatePricingPreviewFromTree({
      treeJson: storedTree,
      widthIn: 24,
      heightIn: 18,
      quantity: 10,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      formulaSourceMode: "library",
      pricingFormulaLibrary: {
        id: pricingFormulaId,
        name: "4x8 Sheets with rounding",
        expression: COROPLAST_4X8_FORMULA,
        config: COROPLAST_4X8_FORMULA_CONFIG,
      },
      debug: true,
    });
    expect(result.debug?.rawBasePrice).toBe(1.375);
    expect(result.debug?.evaluatedFormulaTotalRaw).toBe(44);
    expect(result.totalPrice).toBe(44);
  });

  test("quote/order runtime snapshot preserves the golden sheet-yield pricing inputs", async () => {
    const result = await priceLineItem({
      organizationId,
      productId,
      widthIn: 24,
      heightIn: 18,
      quantity: 91,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
    });
    const snapshot = result.pbv2SnapshotJson.pbv2PricingSnapshot;

    expect(result.lineTotalCents).toBe(32960);
    expect(result.breakdown.baseCents).toBe(32960);
    expect(result.pbv2SnapshotJson.pricingSystem).toBe("pbv2");
    expect(snapshot).toEqual(expect.objectContaining({
      pricingSystem: "pbv2",
      formulaSourceMode: "library",
      resolvedFormulaSource: "library",
      resolvedFormulaId: pricingFormulaId,
      resolvedFormulaExpression: COROPLAST_4X8_FORMULA,
      manualFormulaPresent: true,
      manualFormulaIgnored: true,
      rawBasePrice: 1.03,
      evaluatedFormulaTotalRaw: 329.6,
      evaluatedFormulaTotalRounded: 329.6,
      finalTotalSource: "formula",
      finalTotal: 329.6,
      calculatedPrice: 329.6,
    }));
    expect(snapshot?.formulaVariables).toEqual(expect.objectContaining({
      sheet_width: 48,
      sheet_length: 96,
      minimum_billable_sqft: 32,
      allow_rotation: true,
      base_price: 1.03,
      p: 1.03,
      computed_sheets: 10,
      total_sheet_count: 10,
      billed_sheet_sqft: 320,
    }));
    expect(snapshot?.tierResolution).toEqual(expect.objectContaining({
      source: "matrix_row",
      tierBasis: "computed_sheet_usage",
      fallbackToLineItemQuantity: false,
      selectedTierMinQty: 10,
      selectedTierRate: 1.03,
      tierSelectionQuantity: 10,
      piecesPerSheet: 10,
      totalSheetCount: 10,
      fullSheets: 9,
      partialSheetPieceCount: 1,
      partialSheetBillableSqft: 32,
    }));
    expect(snapshot?.sheetYield).toEqual(expect.objectContaining({
      allowRotation: true,
      piecesPerSheet: 10,
      fullSheets: 9,
      partialSheetPieceCount: 1,
      totalSheetCount: 10,
      billedSheetSqft: 320,
    }));
  });
});
