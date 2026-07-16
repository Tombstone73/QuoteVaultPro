import { afterAll, beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import { sql } from "drizzle-orm";

import { db } from "../../../db";
import { evaluatePricingPreviewFromTree, priceLineItem } from "../PricingService";

const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
const organizationId = `org_pbv2_snapshot_${suffix}`;
const productId = `prod_pbv2_snapshot_${suffix}`;
const treeVersionId = `tree_pbv2_snapshot_${suffix}`;
const pricingFormulaId = `formula_pbv2_snapshot_${suffix}`;
const quantityOnlyFormulaId = `formula_qty_only_snapshot_${suffix}`;
const COROPLAST_4X8_FORMULA = "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price";
const COROPLAST_4X8_FORMULA_CONFIG = {
  variables: {
    sheet_width: 48,
    sheet_length: 96,
    usable_drop_min: 0,
    billable_length_increment: 1,
    minimum_billable_sqft: 32,
  },
};

function makeAcmTree(matrixBasePriceForDouble = 575, base: Record<string, number> = { perSqftCents: 100 }) {
  return {
    schemaVersion: 2,
    rootNodeIds: ["thickness", "sides"],
    pricingMatrix: {
      dimensions: ["thickness", "sides"],
      rows: [
        { id: "3mm_single", when: { thickness: "choice_3mm", sides: "choice_single" }, variables: { base_price: 500 } },
        { id: "3mm_double", when: { thickness: "choice_3mm", sides: "choice_double" }, variables: { base_price: matrixBasePriceForDouble } },
      ],
    },
    nodes: {
      thickness: {
        id: "thickness",
        kind: "question",
        label: "Thickness",
        input: { type: "select", selectionKey: "thickness" },
        choices: [
          { value: "choice_3mm", label: "3mm" },
          { value: "choice_6mm", label: "6mm" },
        ],
      },
      sides: {
        id: "sides",
        kind: "question",
        label: "Sides",
        input: { type: "select", selectionKey: "sides" },
        choices: [
          { value: "choice_single", label: "Single sided" },
          { value: "choice_double", label: "Double sided" },
        ],
      },
    },
    meta: {
      pricingV2: {
        base,
      },
      pricingFormula: "sheet_consumption_sqft(w, h, q, sheet_width, sheet_length, usable_drop_min, billable_length_increment, minimum_billable_sqft) * base_price",
      formulaVariables: {
        sheet_width: 48,
        sheet_length: 96,
        usable_drop_min: 0,
        billable_length_increment: 1,
        minimum_billable_sqft: 0,
      },
    },
  };
}

function makeCoroplastTree() {
  return {
    schemaVersion: 2,
    rootNodeIds: ["rate"],
    pricingMatrix: {
      dimensions: ["rate"],
      rows: [
        {
          id: "standard",
          when: { rate: "standard" },
          variables: { base_price: 1.375 },
        },
      ],
    },
    nodes: {
      rate: {
        id: "rate",
        kind: "question",
        label: "Rate",
        input: { type: "select", selectionKey: "rate" },
        choices: [
          { value: "standard", label: "Standard" },
        ],
      },
    },
    meta: {
      pricingV2: {
        base: {
          perSqftCents: 100,
        },
      },
    },
  };
}

function makeMagnetBillableTree() {
  const tree = makeCoroplastTree() as any;
  tree.pricingMatrix.rows[0].variables = { base_price: 5 };
  tree.meta.pricingV2.base.perSqftCents = 500;
  return tree;
}

function makeQuantityOnlyTree() {
  return {
    schemaVersion: 2,
    rootNodeIds: ["root"],
    nodes: {
      root: { id: "root", kind: "group", label: "Fulfillment item" },
    },
    edges: [],
    meta: {
      pricingProfileKey: "qty_only",
      // Deliberately stale geometry formula: the profile must ignore it.
      pricingFormula: "ceil((((w + 0.25) * (h + 0.25)) / 144) * q)",
      pricingV2: {
        base: { perSqftCents: 999, perPieceCents: 100, minimumChargeCents: 5000 },
      },
    },
  };
}

beforeAll(async () => {
  await db.execute(sql`
    insert into organizations (id, name, slug)
    values (${organizationId}, ${`PBV2 Snapshot ${suffix}`}, ${`pbv2-snapshot-${suffix}`})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into products (id, organization_id, name, description, pricing_profile_key)
    values (${productId}, ${organizationId}, ${"PBV2 Snapshot ACM"}, ${"snapshot test"}, ${"default"})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into pbv2_tree_versions (id, organization_id, product_id, status, schema_version, tree_json, published_at)
    values (${treeVersionId}, ${organizationId}, ${productId}, ${"ACTIVE"}, ${2}, ${JSON.stringify(makeAcmTree())}::jsonb, now())
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
    set tree_json = ${JSON.stringify(makeAcmTree())}::jsonb
    where id = ${treeVersionId}
  `);
  await db.execute(sql`
    update products
    set price_breaks = '{"enabled":false,"type":"quantity","tiers":[]}'::jsonb,
        pricing_formula_id = null,
        pricing_formula = null,
        pricing_engine = ${"pricingProfile"},
        pricing_profile_key = ${"default"},
        pricing_profile_config = null
    where id = ${productId}
  `);
});

describe("PricingService PBV2 pricing snapshot persistence payload", () => {
  test("quantity-only order pricing matches preview and ignores a stale geometry formula", async () => {
    const staleFormula = "ceil((((w + 0.25) * (h + 0.25)) / 144) * q)";
    await db.execute(sql`
      insert into pricing_formulas (
        id, organization_id, name, code, description, pricing_profile_key, expression, is_active
      ) values (
        ${quantityOnlyFormulaId}, ${organizationId}, ${"Stale geometry formula"}, ${"stale_geometry"},
        ${"Regression fixture"}, ${"default"}, ${staleFormula}, true
      )
      on conflict (id) do update
      set expression = excluded.expression,
          pricing_profile_key = excluded.pricing_profile_key
    `);
    await db.execute(sql`
      update products
      set pricing_formula_id = ${quantityOnlyFormulaId},
          pricing_engine = ${"formulaLibrary"},
          pricing_profile_key = ${"qty_only"}
      where id = ${productId}
    `);
    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(makeQuantityOnlyTree())}::jsonb
      where id = ${treeVersionId}
    `);

    const preview = evaluatePricingPreviewFromTree({
      treeJson: makeQuantityOnlyTree(),
      widthIn: 24,
      heightIn: 36,
      quantity: 6,
      pricingProfileKey: "qty_only",
      formulaSourceMode: "library",
      pricingFormulaLibrary: { id: quantityOnlyFormulaId, expression: staleFormula },
    });
    const orderPrice = await priceLineItem({
      organizationId,
      productId,
      widthIn: 24,
      heightIn: 36,
      quantity: 6,
      pbv2ExplicitSelections: {},
    });

    expect(preview.unitPrice).toBe(1);
    expect(preview.totalPrice).toBe(6);
    expect(orderPrice.lineTotalCents).toBe(600);
    expect(orderPrice.lineTotalCents / 100).toBe(preview.totalPrice);
    expect(orderPrice.pbv2SnapshotJson.pbv2PricingSnapshot?.formula).toBe("q * unitPrice");
    expect(orderPrice.pbv2SnapshotJson.pbv2PricingSnapshot?.resolvedFormulaExpression).toBe("q * unitPrice");
  });

  test("saved line item pricing honors formula library billable output meaning", async () => {
    const magnetFormula = "sheet_consumption_sqft(w,h,q,24,96,12,12,2)";
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
        ${"Magnet Billable Sqft"},
        ${"magnet_billable_sqft"},
        ${"Bills magnets by billable consumed sqft"},
        ${"default"},
        ${magnetFormula},
        ${JSON.stringify({ formulaOutputMeaning: "billable" })}::jsonb,
        true
      )
      on conflict (id) do update
      set name = excluded.name,
          code = excluded.code,
          description = excluded.description,
          expression = excluded.expression,
          pricing_profile_key = excluded.pricing_profile_key,
          config = excluded.config
    `);

    await db.execute(sql`
      update products
      set pricing_formula_id = ${pricingFormulaId},
          pricing_formula = null,
          pricing_engine = ${"formulaLibrary"},
          pricing_profile_key = ${"default"},
          pricing_profile_config = null
      where id = ${productId}
    `);

    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(makeMagnetBillableTree())}::jsonb
      where id = ${treeVersionId}
    `);

    const result = await priceLineItem({
      organizationId,
      productId,
      quantity: 2,
      widthIn: 18,
      heightIn: 14,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
    });

    expect(result.lineTotalCents).toBe(3000);
    expect(result.breakdown.baseCents).toBe(3000);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.formula).toBe(magnetFormula);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.formulaOutputMeaning).toBe("billable");
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.normalizedFormulaOutputMeaning).toBe("billable");
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.formulaOutputMeaningRaw).toBe("billable");
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.formulaOutputMeaningSource).toBe("formula_library.config.formulaOutputMeaning");
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.formulaEvaluatedTotal).toBe(30);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.evaluatedFormulaTotalRaw).toBe(30);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.rawBasePrice).toBe(5);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.finalTotal).toBe(30);
  });

  test("resolves product pricingFormulaId before stale legacy pricingFormula text", async () => {
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
        ${"Coroplast 4x8 Sheet Consumption"},
        ${"coroplast_4x8_sheet_consumption"},
        ${"Bills Coroplast by consumed 4x8 sheet area"},
        ${"default"},
        ${COROPLAST_4X8_FORMULA},
        ${JSON.stringify(COROPLAST_4X8_FORMULA_CONFIG)}::jsonb,
        true
      )
      on conflict (id) do update
      set name = excluded.name,
          code = excluded.code,
          description = excluded.description,
          expression = excluded.expression,
          pricing_profile_key = excluded.pricing_profile_key,
          config = excluded.config
    `);

    await db.execute(sql`
      update products
      set pricing_formula_id = ${pricingFormulaId},
          pricing_formula = ${"ceil(total_sqft) * base_price"},
          pricing_engine = ${"formulaLibrary"},
          pricing_profile_key = ${"default"}
      where id = ${productId}
    `);

    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(makeCoroplastTree())}::jsonb
      where id = ${treeVersionId}
    `);

    const result = await priceLineItem({
      organizationId,
      productId,
      quantity: 10,
      widthIn: 24,
      heightIn: 18,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
    });

    expect(result.lineTotalCents).toBe(4400);
    expect(result.breakdown.baseCents).toBe(4400);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.formula).toBe(COROPLAST_4X8_FORMULA);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.formulaSourceMode).toBe("library");
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.resolvedFormulaSource).toBe("library");
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.resolvedFormulaId).toBe(pricingFormulaId);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.resolvedFormulaName).toBe("Coroplast 4x8 Sheet Consumption");
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.resolvedFormulaExpression).toBe(COROPLAST_4X8_FORMULA);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.manualFormulaPresent).toBe(true);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.manualFormulaIgnored).toBe(true);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.calculatedPrice).toBe(44);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.formulaEvaluatedTotal).toBe(44);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.rawBasePrice).toBe(1.375);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.evaluatedFormulaTotalRaw).toBe(44);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.evaluatedFormulaTotalRounded).toBe(44);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.roundingAppliedAt).toBe("final_currency_total");
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.finalTotalSource).toBe("formula");
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.finalTotal).toBe(44);
    expect(result.pbv2SnapshotJson.pricingSystem).toBe("pbv2");
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.pricingSystem).toBe("pbv2");
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.formulaVariables.sheet_width).toBe(48);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.formulaVariableSources?.sheet_width).toBe("formula_library.config.variables");
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.formulaVariables.minimum_billable_sqft).toBe(32);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.formulaVariables.computed_sheets).toBe(1);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.formulaVariables.billed_sheet_sqft).toBe(32);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.sheetYield?.billedSheetSqft).toBe(32);
  });

  test("captures raw selections, effective selections, matrix variables, formula scope, and price", async () => {
    const result = await priceLineItem({
      organizationId,
      productId,
      quantity: 1,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {
        thickness: { value: "choice_3mm" },
        sides: { value: "choice_double" },
      },
    });

    const snapshot = result.pbv2SnapshotJson.pbv2PricingSnapshot;
    const preview = evaluatePricingPreviewFromTree({
      treeJson: makeAcmTree(),
      widthIn: 24,
      heightIn: 36,
      quantity: 1,
      pbv2ExplicitSelections: {
        thickness: { value: "choice_3mm" },
        sides: { value: "choice_double" },
      },
      formulaVariables: (makeAcmTree() as any).meta.formulaVariables,
      debug: true,
    });

    expect(result.lineTotalCents).toBe(3450);
    expect(result.lineTotalCents / 100).toBeCloseTo(preview.totalPrice, 2);
    expect(snapshot).toEqual(expect.objectContaining({
      rawSelections: { thickness: "choice_3mm", sides: "choice_double" },
      effectiveSelections: { thickness: "choice_3mm", sides: "choice_double" },
      resolvedMatrixRowId: "3mm_double",
      resolvedMatrixVariables: { base_price: 5.75 },
      basePriceSource: "pricing_matrix.base_price",
      rateUsedSource: "pricing_matrix.base_price",
      minimumApplied: false,
      calculatedPrice: result.lineTotalCents / 100,
      formula: expect.stringContaining("sheet_consumption_sqft"),
    }));
    expect(snapshot?.formulaVariables.base_price).toBe(5.75);
    expect(snapshot?.formulaScopeUsed?.base_price).toBe(5.75);
    expect(snapshot?.formulaVariables.sheet_width).toBe(48);
    expect(typeof snapshot?.capturedAt).toBe("string");
  });

  test("matrix base_price prices order entry when base rate is blank", async () => {
    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(makeAcmTree(575, {}))}::jsonb
      where id = ${treeVersionId}
    `);

    const result = await priceLineItem({
      organizationId,
      productId,
      quantity: 1,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {
        thickness: { value: "choice_3mm" },
        sides: { value: "choice_double" },
      },
    });

    expect(result.lineTotalCents).toBe(3450);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.resolvedMatrixVariables).toEqual({ base_price: 5.75 });
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.basePriceSource).toBe("pricing_matrix.base_price");
  });

  test("minimum charge applies only after matrix formula result", async () => {
    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(makeAcmTree(575, { minimumChargeCents: 4000 }))}::jsonb
      where id = ${treeVersionId}
    `);

    const belowMinimum = await priceLineItem({
      organizationId,
      productId,
      quantity: 1,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {
        thickness: { value: "choice_3mm" },
        sides: { value: "choice_double" },
      },
    });
    const aboveMinimum = await priceLineItem({
      organizationId,
      productId,
      quantity: 2,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {
        thickness: { value: "choice_3mm" },
        sides: { value: "choice_double" },
      },
    });

    expect(belowMinimum.lineTotalCents).toBe(4000);
    expect(belowMinimum.pbv2SnapshotJson.pbv2PricingSnapshot?.minimumApplied).toBe(true);
    expect(aboveMinimum.lineTotalCents).toBe(6900);
    expect(aboveMinimum.pbv2SnapshotJson.pbv2PricingSnapshot?.minimumApplied).toBe(false);
  });

  test("returned snapshot remains stable after product tree pricing matrix changes", async () => {
    const result = await priceLineItem({
      organizationId,
      productId,
      quantity: 1,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {
        thickness: { value: "choice_3mm" },
        sides: { value: "choice_double" },
      },
    });

    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(makeAcmTree(999))}::jsonb
      where id = ${treeVersionId}
    `);

    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.resolvedMatrixVariables).toEqual({ base_price: 5.75 });
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.resolvedMatrixRowId).toBe("3mm_double");
  });

  test("captures quantity tier metadata in the persisted PBV2 snapshot", async () => {
    const tree = makeAcmTree(575, { perSqftCents: 100 }) as any;
    delete tree.pricingMatrix;
    tree.meta.pricingV2.qtyTiers = [
      { id: "tier_5", label: "Five plus", minQty: 5, perSqftCents: 80 },
    ];

    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(tree)}::jsonb
      where id = ${treeVersionId}
    `);

    const result = await priceLineItem({
      organizationId,
      productId,
      quantity: 5,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {},
    });

    const snapshot = result.pbv2SnapshotJson.pbv2PricingSnapshot;
    expect(snapshot?.tierResolution).toEqual(expect.objectContaining({
      quantity: 5,
      enabled: true,
      source: "pbv2_product",
      matchedTierId: "tier_5",
      matchedTierLabel: "Five plus",
      originalBaseRate: 1,
      tierBaseRate: 0.8,
      effectiveBaseRateBeforeMatrix: 0.8,
      matrixBasePriceOverride: false,
      tierBasis: "line_item_quantity",
      tierBasisValue: 5,
      tierBasisResolvedFrom: "default",
      lineItemQuantity: 5,
      computedSheetUsageAvailable: false,
      computedSheetUsageMode: "unavailable",
      fallbackToLineItemQuantity: false,
      finalBaseRateUsed: 0.8,
    }));
    expect(snapshot?.formulaScopeUsed?.base_price).toBe(0.8);
    expect(snapshot?.formulaScopeUsed?.tier_base_price).toBe(0.8);
    expect(typeof snapshot?.tierResolution?.capturedAt).toBe("string");
  });

  test("captures matrix row quantity tier metadata in the persisted PBV2 snapshot", async () => {
    const tree = makeAcmTree(575, { perSqftCents: 100 }) as any;
    tree.pricingMatrix.rows[1] = {
      ...tree.pricingMatrix.rows[1],
      qtyTiers: [
        { id: "row_tier_5", label: "Row five plus", minQty: 5, perSqftCents: 450 },
      ],
    };
    tree.meta.pricingV2.qtyTiers = [
      { id: "product_tier_5", label: "Product five plus", minQty: 5, perSqftCents: 80 },
    ];

    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(tree)}::jsonb
      where id = ${treeVersionId}
    `);

    const result = await priceLineItem({
      organizationId,
      productId,
      quantity: 5,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {
        thickness: { value: "choice_3mm" },
        sides: { value: "choice_double" },
      },
    });

    const snapshot = result.pbv2SnapshotJson.pbv2PricingSnapshot;
    expect(result.lineTotalCents).toBe(17100);
    expect(snapshot?.tierResolution).toEqual(expect.objectContaining({
      quantity: 5,
      enabled: true,
      source: "matrix_row",
      matrixRowId: "3mm_double",
      matchedTierId: "row_tier_5",
      matchedTierLabel: "Row five plus",
      tierBaseRate: 4.5,
      matrixStaticBaseRate: 5.75,
      matrixStaticBaseRateUsedAsFallback: false,
      productTierFallbackUsed: false,
      tierBasis: "line_item_quantity",
      tierBasisValue: 5,
      tierBasisResolvedFrom: "default",
      lineItemQuantity: 5,
      computedSheetUsageAvailable: false,
      computedSheetUsageMode: "unavailable",
      fallbackToLineItemQuantity: false,
      finalBaseRateUsed: 4.5,
    }));
    expect(snapshot?.basePriceSource).toBe("pricing_matrix.row_qty_tier");
    expect(snapshot?.resolvedMatrixVariables).toEqual({ base_price: 5.75 });
    expect(snapshot?.formulaScopeUsed?.base_price).toBe(4.5);
    expect(snapshot?.formulaScopeUsed?.tier_base_price).toBe(4.5);
  });

  test("captures computed sheet usage tier basis metadata in the persisted PBV2 snapshot", async () => {
    const tree = makeAcmTree(575, { perSqftCents: 100 }) as any;
    delete tree.pricingMatrix;
    tree.meta.pricingV2.tierBasis = "computed_sheet_usage";
    tree.meta.pricingV2.qtyTiers = [
      { id: "sheet_usage_2", label: "Two sheets plus", minQty: 2, perSqftCents: 80 },
    ];

    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(tree)}::jsonb
      where id = ${treeVersionId}
    `);

    const result = await priceLineItem({
      organizationId,
      productId,
      quantity: 21,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {},
    });

    const snapshot = result.pbv2SnapshotJson.pbv2PricingSnapshot;
    expect(snapshot?.tierResolution).toEqual(expect.objectContaining({
      quantity: 21,
      enabled: true,
      source: "pbv2_product",
      matchedTierId: "sheet_usage_2",
      matchedTierLabel: "Two sheets plus",
      tierBaseRate: 0.8,
      tierBasis: "computed_sheet_usage",
      tierBasisResolvedFrom: "product",
      lineItemQuantity: 21,
      computedSheetUsageAvailable: true,
      computedSheetUsageMode: "layout_yield",
      sheetUsageMethod: "layout_yield",
      allowRotation: false,
      allowRotationSource: "default.allow_rotation=false",
      piecesPerSheet: 4,
      fullSheets: 5,
      partialSheetPieceCount: 1,
      partialSheetFinishedSqft: 6,
      partialSheetBillableSqft: 6,
      partialSheetPolicy: "measured_partial_sheet",
      totalSheetCount: 6,
      fallbackToLineItemQuantity: false,
      finalBaseRateUsed: 0.8,
    }));
    expect(snapshot?.tierResolution?.tierBasisValue).toBe(6);
    expect(snapshot?.sheetYield).toEqual(expect.objectContaining({
      allowRotation: false,
      orientationUsed: "normal",
      piecesPerSheet: 4,
      totalSheetCount: 6,
      billedSheetSqft: 166,
    }));
    expect(snapshot?.formulaScopeUsed?.allow_rotation).toBe(false);
    expect(snapshot?.formulaScopeUsed?.base_price).toBe(0.8);
    expect(snapshot?.formulaScopeUsed?.tier_base_price).toBe(0.8);
  });

  test("captures selected allow_rotation in the persisted PBV2 snapshot", async () => {
    const tree = makeAcmTree(575, { perSqftCents: 100 }) as any;
    delete tree.pricingMatrix;
    tree.rootNodeIds = ["allow_rotation"];
    tree.nodes = {
      allow_rotation: {
        id: "allow_rotation",
        kind: "question",
        label: "Allow Rotation",
        input: { type: "select", selectionKey: "allow_rotation" },
        choices: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
    };
    tree.meta.pricingV2.tierBasis = "computed_sheet_usage";
    tree.meta.pricingV2.qtyTiers = [
      { id: "sheet_usage_1", label: "One sheet plus", minQty: 1, perSqftCents: 132 },
    ];

    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(tree)}::jsonb
      where id = ${treeVersionId}
    `);

    const result = await priceLineItem({
      organizationId,
      productId,
      quantity: 5,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {
        allow_rotation: { value: "yes" },
      },
    });

    const snapshot = result.pbv2SnapshotJson.pbv2PricingSnapshot;
    expect(snapshot?.formulaScopeUsed?.allow_rotation).toBe(true);
    expect(snapshot?.formulaVariableSources?.allow_rotation).toBe("pbv2.choice:allow_rotation");
    expect(snapshot?.sheetYield).toEqual(expect.objectContaining({
      allowRotation: true,
      allowRotationSource: "pbv2.choice:allow_rotation",
      orientationUsed: "mixed",
      piecesPerSheet: 5,
      totalSheetCount: 1,
      billedSheetSqft: 32,
    }));
    expect(snapshot?.tierResolution).toEqual(expect.objectContaining({
      allowRotation: true,
      allowRotationSource: "pbv2.choice:allow_rotation",
      normalPiecesPerSheet: 4,
      rotatedPiecesPerSheet: 4,
      mixedPiecesPerSheet: 5,
      orientationUsed: "mixed",
      piecesPerSheet: 5,
      tierSelectionQuantity: 1,
      computedSheetUsage: 1,
    }));
  });

  test("ignores legacy priceBreaks while capturing PBV2 matrix override metadata", async () => {
    const tree = makeAcmTree(575, { perSqftCents: 100 }) as any;
    tree.meta.pricingV2.qtyTiers = [
      { id: "tier_5", label: "Five plus", minQty: 5, perSqftCents: 80 },
    ];

    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(tree)}::jsonb
      where id = ${treeVersionId}
    `);
    await db.execute(sql`
      update products
      set price_breaks = '{"enabled":true,"type":"quantity","tiers":[{"minValue":1,"discountType":"percentage","discountValue":10}]}'::jsonb
      where id = ${productId}
    `);

    const result = await priceLineItem({
      organizationId,
      productId,
      quantity: 5,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {
        thickness: { value: "choice_3mm" },
        sides: { value: "choice_double" },
      },
    });

    const tierResolution = result.pbv2SnapshotJson.pbv2PricingSnapshot?.tierResolution;
    expect(tierResolution).toEqual(expect.objectContaining({
      matchedTierId: "tier_5",
      tierBaseRate: 0.8,
      effectiveBaseRateBeforeMatrix: 0.8,
      matrixBasePriceOverride: true,
      finalBaseRateUsed: 5.75,
    }));
    expect(tierResolution?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PBV2_TIER_MATRIX_BASE_PRICE_OVERRIDE" }),
      ])
    );
    expect(tierResolution?.warnings ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: expect.stringContaining("LEGACY") }),
      ])
    );
    expect((tierResolution as any)?.source).not.toBe("legacy_price_breaks");
  });
});
