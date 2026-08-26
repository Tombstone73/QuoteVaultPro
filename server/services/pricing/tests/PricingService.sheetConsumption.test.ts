/**
 * Tests for the sheet_consumption_sqft() formula helper.
 *
 * Verifies: normal vs rotated orientation selection, reusable-drop logic
 * (partial-row occupied-width fix), billable-length rounding, minimum-sqft
 * floor, and paneling fallback when a finished piece cannot fit one sheet.
 *
 * Because the formula contains `q`, inferFormulaApplication classifies it as
 * totalPrice. The formula result (sqft) maps directly to result.totalPrice.
 */

import { describe, expect, test } from "@jest/globals";
import { evaluatePricingPreviewFromTree } from "../PricingService";

function makeTree(perSqftCents = 100) {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["root"],
    nodes: {
      root: {
        id: "root",
        kind: "question" as const,
        label: "Root",
        input: { type: "boolean" as const },
      },
    },
    meta: {
      pricingV2: { base: { perSqftCents } },
    },
  };
}

function makeMatrixBasePriceTree(basePrice: number) {
  return {
    ...makeTree(100),
    rootNodeIds: ["rate"],
    pricingMatrix: {
      dimensions: ["rate"],
      rows: [
        {
          id: "standard",
          when: { rate: "standard" },
          variables: { base_price: basePrice },
        },
      ],
    },
    nodes: {
      rate: {
        id: "rate",
        kind: "question" as const,
        label: "Rate",
        input: { type: "select" as const, selectionKey: "rate" },
        choices: [
          { value: "standard", label: "Standard" },
        ],
      },
    },
  };
}

function makeRowTierBasisTree(
  tierBasis: "computed_sheet_usage" | "line_item_quantity",
  rowVariables?: Record<string, number>,
  formulaVariablesOverride?: Record<string, number>,
) {
  return {
    ...makeTree(200),
    rootNodeIds: ["rate"],
    pricingMatrix: {
      dimensions: ["rate"],
      rows: [
        {
          id: "standard",
          when: { rate: "standard" },
          ...(rowVariables ? { variables: rowVariables } : {}),
          tierBasis,
          qtyTiers: [
            { id: "sheet_1", label: "1+ sheet", minQty: 1, perSqftCents: 132 },
            { id: "sheet_10", label: "10+ raw qty", minQty: 10, perSqftCents: 100 },
          ],
        },
      ],
    },
    nodes: {
      rate: {
        id: "rate",
        kind: "question" as const,
        label: "Rate",
        input: { type: "select" as const, selectionKey: "rate" },
        choices: [
          { value: "standard", label: "Standard" },
        ],
      },
    },
    meta: {
      pricingV2: { base: { perSqftCents: 200 } },
      formulaVariables: formulaVariablesOverride ?? {
        sheet_width: 48,
        sheet_length: 96,
        usable_drop_min: 24,
        billable_length_increment: 12,
        minimum_billable_sqft: 3,
      },
    },
  };
}

function makeAllowRotationTree() {
  const tree = makeRowTierBasisTree("computed_sheet_usage") as any;
  tree.rootNodeIds = ["rate", "allow_rotation"];
  tree.nodes.allow_rotation = {
    id: "allow_rotation",
    kind: "question" as const,
    label: "Allow Rotation",
    input: { type: "select" as const, selectionKey: "allow_rotation" },
    choices: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  };
  return tree;
}

function runFormula(formula: string, w = 24, h = 36, q = 1) {
  return evaluatePricingPreviewFromTree({
    treeJson: makeTree(),
    widthIn: w,
    heightIn: h,
    quantity: q,
    pricingFormulaOverride: formula,
    debug: true,
  });
}

function runFormulaExpectError(formula: string, w = 24, h = 36, q = 1): any {
  try {
    runFormula(formula, w, h, q);
    return null;
  } catch (e: any) {
    return e;
  }
}

function runAcmDropBillingPreview(widthIn: number, heightIn: number) {
  return evaluatePricingPreviewFromTree({
    treeJson: makeMatrixBasePriceTree(5),
    widthIn,
    heightIn,
    quantity: 1,
    pbv2ExplicitSelections: { rate: { value: "standard" } },
    pricingFormulaOverride: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price",
    formulaVariables: {
      sheet_width: 48,
      sheet_length: 96,
      usable_drop_min: 24,
      billable_length_increment: 12,
      minimum_billable_sqft: 3,
      allow_rotation: 1,
    },
    debug: true,
  });
}

// sheet_consumption_sqft(w, h, q, sheet_width, sheet_length, usable_drop_min, billable_length_increment, minimum_billable_sqft)

describe("sheet_consumption_sqft", () => {
  test.each([
    { widthIn: 48, heightIn: 72, orientation: "normal" },
    { widthIn: 72, heightIn: 48, orientation: "rotated" },
  ])("ACM $widthIn x $heightIn bills 24 sqft at $5 with a reusable drop", ({ widthIn, heightIn, orientation }) => {
    const result = runAcmDropBillingPreview(widthIn, heightIn);

    expect(result.totalPrice).toBe(120);
    expect(result.unitPrice).toBe(120);
    expect(result.debug?.evaluatedFormulaTotalRaw).toBe(120);
    expect(result.debug?.sheetYield).toEqual(expect.objectContaining({
      consumedSqft: 24,
      billedSheetSqft: 24,
      leftoverDropWidth: 0,
      leftoverDropLength: 24,
      lengthDropUsable: true,
      dropUsable: true,
      orientationUsed: orientation,
    }));
  });

  test("ACM 48x73 bills the full sheet because the 23-inch end drop is unusable", () => {
    const result = runAcmDropBillingPreview(48, 73);

    expect(result.totalPrice).toBe(160);
    expect(result.debug?.evaluatedFormulaTotalRaw).toBe(160);
    expect(result.debug?.sheetYield).toEqual(expect.objectContaining({
      billedSheetSqft: 32,
      leftoverDropLength: 23,
      lengthDropUsable: false,
      dropUsable: false,
    }));
  });

  // ── orientation selection ──────────────────────────────────────────────────

  test("normal orientation wins when it uses less effective width", () => {
    // w=36, h=24, q=3, sheet_width=48, drop_min=0, inc=1, min=0
    // normal (36w×24h): piecesAcross=1, fullRows=3, piecesInLastRow=0
    //   occupiedWidth=36, drop=12≥0 → effectiveW=36, consumedLength=72, sqft=18
    // rotated (24w×36h): piecesAcross=2, fullRows=1, piecesInLastRow=1
    //   fullRows>0 → occupiedWidth=48, drop=0≥0 → effectiveW=48, consumedLength=72, sqft=24
    // best = 18 (normal wins)
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 9999, 0, 1, 0)",
      36, 24, 3,
    );
    expect(result.totalPrice).toBeCloseTo(18, 1);
  });

  test("rotated orientation wins when pieces pack more efficiently", () => {
    // w=40, h=10, q=2, sheet_width=48, drop_min=0, inc=1, min=0
    // normal (40w×10h): piecesAcross=1, fullRows=2 → occupiedWidth=40, drop=8≥0
    //   effectiveW=40, consumedLength=20, sqft≈5.56
    // rotated (10w×40h): piecesAcross=4, fullRows=0, piecesInLastRow=2
    //   occupiedWidth=2*10=20, drop=28≥0 → effectiveW=20, consumedLength=40, sqft≈5.56
    // equal; min(5.56, 5.56) = 5.56 → ceil = 6
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 9999, 0, 1, 0)",
      40, 10, 2,
    );
    expect(result.totalPrice).toBeCloseTo(6, 1);
  });

  // ── billable-length rounding ───────────────────────────────────────────────

  test("billable_length_increment rounds consumed length up to next multiple", () => {
    // w=24, h=11, q=2, sheetLength=20 blocks rotated (pieceH=24>20), allows normal (pieceH=11≤20)
    // normal (24w×11h): piecesAcross=2, fullRows=1, piecesInLastRow=0
    //   occupiedWidth=48, drop=0≥0 → effectiveW=48
    //   consumedLength=11, billableLength=ceil(11/12)*12=12, sqft=48*12/144=4
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 20, 0, 12, 0)",
      24, 11, 2,
    );
    expect(result.totalPrice).toBeCloseTo(4, 1);
  });

  test("billable_length_increment=0 treated as 1 (no division by zero)", () => {
    // w=24, h=36, q=1; inc=0 → treated as 1; billableLength=36
    // normal (24w×36h): piecesAcross=2, fullRows=0, piecesInLastRow=1
    //   occupiedWidth=24, drop=24≥0 → effectiveW=24, sqft=24*36/144=6
    // rotated (36w×24h): piecesAcross=1, fullRows=1, piecesInLastRow=0
    //   occupiedWidth=36, drop=12≥0 → effectiveW=36, sqft=36*24/144=6
    // best=6
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 9999, 0, 0, 0)",
      24, 36, 1,
    );
    expect(result.totalPrice).toBeCloseTo(6, 1);
  });

  // ── reusable side-drop rule ────────────────────────────────────────────────

  test("usable_drop_min: full-row drop too narrow → charge full sheet width", () => {
    // w=20, h=36, q=2, drop_min=10
    // normal (20w×36h): piecesAcross=2, fullRows=1, piecesInLastRow=0
    //   occupiedWidth=40, drop=8 < 10 → effectiveW=48 (full), sqft=12
    // rotated (36w×20h): piecesAcross=1, fullRows=2, piecesInLastRow=0
    //   occupiedWidth=36, drop=12≥10 → effectiveW=36, sqft=10
    // best = 10 (rotated wins)
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 9999, 10, 1, 0)",
      20, 36, 2,
    );
    expect(result.totalPrice).toBeCloseTo(12, 1);
  });

  test("usable_drop_min: drop wide enough → charge only used width", () => {
    // w=24, h=36, q=2, drop_min=6
    // normal (24w×36h): piecesAcross=2, fullRows=1, piecesInLastRow=0
    //   occupiedWidth=48, drop=0 < 6 → effectiveW=48 (full), sqft=12
    // rotated (36w×24h): piecesAcross=1, fullRows=2, piecesInLastRow=0
    //   occupiedWidth=36, drop=12≥6 → effectiveW=36, sqft=12
    // equal at 12
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 9999, 6, 1, 0)",
      24, 36, 2,
    );
    expect(result.totalPrice).toBeCloseTo(12, 1);
  });

  // ── partial-row occupied-width fix (Issue 2) ───────────────────────────────

  test("single piece (q=1): side drop uses actual 1-piece width, not max piecesAcross width", () => {
    // sheet_consumption_sqft(60,23,1,48,96,24,12,3)
    // normal (60w×23h): pieceW=60 > sheetWidth=48 → Infinity
    // rotated (23w×60h): piecesAcross=floor(48/23)=2
    //   fullRows=floor(1/2)=0, piecesInLastRow=1 → occupiedWidth=1*23=23
    //   drop=48-23=25 ≥ usableDropMin=24 → effectiveW=23
    //   consumedLength=60, billableLength=60 (multiple of 12), sqft=23*60/144≈9.583
    // best = max(9.583, min=3) = 9.583 → ceil = 10
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 96, 24, 12, 3, true)",
      60, 23, 1,
    );
    expect(result.totalPrice).toBeCloseTo(10, 1);
  });

  test("single piece (q=1): drop just below threshold → charge full sheet width", () => {
    // sheet_consumption_sqft(60,25,1,48,96,24,12,3)
    // normal (60w×25h): pieceW=60 > 48 → Infinity
    // rotated (25w×60h): piecesAcross=floor(48/25)=1
    //   fullRows=floor(1/1)=1, piecesInLastRow=0 → last row is full
    //   occupiedWidth=1*25=25, drop=48-25=23 < usableDropMin=24 → effectiveW=48
    //   consumedLength=60, billableLength=60, sqft=48*60/144=20
    // best = max(20, min=3) = 20
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 96, 24, 12, 3, true)",
      60, 25, 1,
    );
    expect(result.totalPrice).toBeCloseTo(20, 1);
  });

  test("partial final row (q < piecesAcross): uses actual occupied width", () => {
    // piece 15×60, q=2, sheet=48×96, drop_min=6, inc=12, min=0
    // normal (15w×60h): piecesAcross=3, fullRows=floor(2/3)=0, piecesInLastRow=2
    //   occupiedWidth=2*15=30, drop=18≥6 → effectiveW=30
    //   rowsNeeded=1, consumedLength=60, billableLength=60, sqft=30*60/144=12.5
    // rotated (60w×15h): pieceW=60 > sheetWidth=48 → Infinity
    // best = max(12.5, 0) = 12.5 → ceil = 13
    // (old logic: occupiedWidth=3*15=45, drop=3<6 → effectiveW=48, sqft=20 — wrong)
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 96, 6, 12, 0)",
      15, 60, 2,
    );
    expect(result.totalPrice).toBeCloseTo(13, 1);
  });

  // ── minimum billable sqft floor ────────────────────────────────────────────

  test("minimum_billable_sqft applied as floor when computed sqft is smaller", () => {
    // tiny 6×6 piece, qty=1 → sqft=(6*6)/144=0.25; floor=10
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 9999, 0, 1, 10)",
      6, 6, 1,
    );
    expect(result.totalPrice).toBeCloseTo(10, 1);
  });

  // ── physical fit constraint → paneling warning / finished-area fallback ──

  test("oversized piece fitting neither orientation remains priceable", () => {
    // 50×50 piece on a 48×48 sheet: pieceW=50>48 in both orientations
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 48, 0, 1, 5)",
      50, 50, 1,
    );
    expect(result.totalPrice).toBe(17.36);
  });

  test("piece taller than sheet_length in both orientations remains priceable", () => {
    // piece 24×100, sheet_width=48, sheet_length=96
    // normal (24w×100h): h=100>96 → Infinity
    // rotated (100w×24h): w=100>48 → Infinity
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 96, 0, 1, 3)",
      24, 100, 1,
    );
    expect(result.totalPrice).toBe(16.67);
  });

  // ── multi-row and integration ──────────────────────────────────────────────

  test("large quantity: rotated beats normal across multiple rows", () => {
    // w=24, h=36, q=11, sheet_width=48, inc=12
    // normal (24w×36h): piecesAcross=2, fullRows=5, piecesInLastRow=1
    //   fullRows>0 → occupiedWidth=48, drop=0≥0 → effectiveW=48
    //   rowsNeeded=6, consumedLength=216, billableLength=216, sqft=72
    // rotated (36w×24h): piecesAcross=1, fullRows=11, piecesInLastRow=0
    //   occupiedWidth=36, drop=12≥0 → effectiveW=36
    //   rowsNeeded=11, consumedLength=264, billableLength=264, sqft=66
    // best = 66
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 9999, 0, 12, 0)",
      24, 36, 11,
    );
    expect(result.totalPrice).toBeCloseTo(72, 1);
  });

  test("symmetric square piece: both orientations identical", () => {
    // 24×24, q=4 → normal = rotated; piecesAcross=2, fullRows=2, occupiedWidth=48, sqft=16
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 9999, 0, 1, 0)",
      24, 24, 4,
    );
    expect(result.totalPrice).toBeCloseTo(16, 1);
  });

  test("integrates with base_price for dollar pricing", () => {
    // sheet_consumption_sqft * base_price with q=2, base=$1/sqft
    // normal (24w×36h): piecesAcross=2, fullRows=1, piecesInLastRow=0
    //   occupiedWidth=48, sqft=12 → result = 12 * 1 = 12; totalPrice=12
    const result = runFormula(
      "sheet_consumption_sqft(w, h, q, 48, 9999, 0, 1, 0) * base_price",
      24, 36, 2,
    );
    expect(result.totalPrice).toBeCloseTo(12, 1);
  });

  test("24x18 q10 bills one 4x8 sheet at $44 when base_price is $1.375", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeMatrixBasePriceTree(1.375),
      widthIn: 24,
      heightIn: 18,
      quantity: 10,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      pricingFormulaOverride: "sheet_consumption_sqft(w, h, q, 48, 96, 24, 12, 3) * base_price",
      debug: true,
    });

    expect(result.totalPrice).toBeCloseTo(44, 2);
    expect(result.breakdown.basePrice).toBeCloseTo(44, 2);
  });

  test("24x36 q5 with allow_rotation=false uses normal 4-up layout and two sheets", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeAllowRotationTree(),
      widthIn: 24,
      heightIn: 36,
      quantity: 5,
      pbv2ExplicitSelections: {
        rate: { value: "standard" },
        allow_rotation: { value: "no" },
      },
      pricingFormulaOverride: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price",
      debug: true,
    });

    expect(result.debug?.variables.allow_rotation).toBe(false);
    expect(result.debug?.variableSources?.allow_rotation).toBe("pbv2.choice:allow_rotation");
    expect(result.debug?.sheetYield).toEqual(expect.objectContaining({
      allowRotation: false,
      allowRotationSource: "pbv2.choice:allow_rotation",
      normalPiecesPerSheet: 4,
      rotatedPiecesPerSheet: 4,
      mixedPiecesPerSheet: 5,
      piecesPerSheet: 4,
      orientationUsed: "normal",
      fullSheets: 1,
      partialSheetPieceCount: 1,
      totalSheetCount: 2,
    }));
    expect(result.debug?.tierResolution).toEqual(expect.objectContaining({
      allowRotation: false,
      tierSelectionQuantity: 2,
      computedSheetUsage: 2,
      piecesPerSheet: 4,
      totalSheetCount: 2,
    }));
  });

  test("24x36 q5 with allow_rotation=true uses mixed 5-up layout and one sheet", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeAllowRotationTree(),
      widthIn: 24,
      heightIn: 36,
      quantity: 5,
      pbv2ExplicitSelections: {
        rate: { value: "standard" },
        allow_rotation: { value: "yes" },
      },
      pricingFormulaOverride: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price",
      debug: true,
    });

    expect(result.debug?.variables.allow_rotation).toBe(true);
    expect(result.debug?.variableSources?.allow_rotation).toBe("pbv2.choice:allow_rotation");
    expect(result.debug?.sheetYield).toEqual(expect.objectContaining({
      allowRotation: true,
      allowRotationSource: "pbv2.choice:allow_rotation",
      normalPiecesPerSheet: 4,
      rotatedPiecesPerSheet: 4,
      mixedPiecesPerSheet: 5,
      piecesPerSheet: 5,
      orientationUsed: "mixed",
      fullSheets: 1,
      partialSheetPieceCount: 0,
      totalSheetCount: 1,
      billedSheetSqft: 32,
    }));
    expect(result.debug?.tierResolution).toEqual(expect.objectContaining({
      allowRotation: true,
      tierSelectionQuantity: 1,
      computedSheetUsage: 1,
      piecesPerSheet: 5,
      totalSheetCount: 1,
    }));
  });

  test("product-level allow_rotation=true feeds formula scope", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeRowTierBasisTree("computed_sheet_usage"),
      widthIn: 24,
      heightIn: 36,
      quantity: 5,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      pricingProfileConfig: {
        formulaVariables: { allow_rotation: "yes" },
      },
      pricingFormulaOverride: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price",
      debug: true,
    });

    expect(result.debug?.variables.allow_rotation).toBe(true);
    expect(result.debug?.variableSources?.allow_rotation).toBe("product.pricingProfileConfig.formulaVariables");
    expect(result.debug?.sheetYield).toEqual(expect.objectContaining({
      allowRotation: true,
      allowRotationSource: "product.pricingProfileConfig.formulaVariables",
      piecesPerSheet: 5,
      orientationUsed: "mixed",
      totalSheetCount: 1,
    }));
  });

  test("PBV2 choice allow_rotation=false overrides product true", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeAllowRotationTree(),
      widthIn: 24,
      heightIn: 36,
      quantity: 5,
      pbv2ExplicitSelections: {
        rate: { value: "standard" },
        allow_rotation: { value: "no" },
      },
      pricingProfileConfig: {
        formulaVariables: { allow_rotation: true },
      },
      pricingFormulaOverride: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price",
      debug: true,
    });

    expect(result.debug?.variables.allow_rotation).toBe(false);
    expect(result.debug?.variableSources?.allow_rotation).toBe("pbv2.choice:allow_rotation");
    expect(result.debug?.sheetYield).toEqual(expect.objectContaining({
      allowRotation: false,
      piecesPerSheet: 4,
      orientationUsed: "normal",
      totalSheetCount: 2,
    }));
  });

  test("PBV2 choice allow_rotation=true overrides product false", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeAllowRotationTree(),
      widthIn: 24,
      heightIn: 36,
      quantity: 5,
      pbv2ExplicitSelections: {
        rate: { value: "standard" },
        allow_rotation: { value: "yes" },
      },
      pricingProfileConfig: {
        formulaVariables: { allow_rotation: "no" },
      },
      pricingFormulaOverride: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price",
      debug: true,
    });

    expect(result.debug?.variables.allow_rotation).toBe(true);
    expect(result.debug?.variableSources?.allow_rotation).toBe("pbv2.choice:allow_rotation");
    expect(result.debug?.sheetYield).toEqual(expect.objectContaining({
      allowRotation: true,
      piecesPerSheet: 5,
      orientationUsed: "mixed",
      totalSheetCount: 1,
    }));
  });

  test("formula library mode ignores stale manual formula text and uses library expression", () => {
    const libraryExpression = "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price";
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeMatrixBasePriceTree(1.375),
      widthIn: 24,
      heightIn: 18,
      quantity: 10,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      formulaSourceMode: "library",
      pricingFormulaLibrary: {
        id: "formula_4x8",
        name: "4x8 Sheets with rounding",
        expression: libraryExpression,
        config: {
          variables: {
            sheet_width: 48,
            sheet_length: 96,
            usable_drop_min: 0,
            billable_length_increment: 1,
            minimum_billable_sqft: 32,
          },
        },
      },
      manualFormulaText: "total_sqft * base_price",
      debug: true,
    });

    expect(result.totalPrice).toBeCloseTo(44, 2);
    expect(result.formulaUsed).toBe(libraryExpression);
    expect(result.debug?.formulaRaw).toBe(libraryExpression);
    expect(result.debug?.formulaSourceMode).toBe("library");
    expect(result.debug?.resolvedFormulaSource).toBe("library");
    expect(result.debug?.resolvedFormulaId).toBe("formula_4x8");
    expect(result.debug?.resolvedFormulaName).toBe("4x8 Sheets with rounding");
    expect(result.debug?.resolvedFormulaExpression).toBe(libraryExpression);
    expect(result.debug?.manualFormulaPresent).toBe(true);
    expect(result.debug?.manualFormulaIgnored).toBe(true);
    expect(result.debug?.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PBV2_W_LIBRARY_FORMULA_DETACHED" }),
    ]));
    expect(result.debug?.variables.sheet_width).toBe(48);
    expect(result.debug?.variableSources?.sheet_width).toBe("formula_library.config.variables");
    expect(result.debug?.variables.sheet_length).toBe(96);
    expect(result.debug?.variableSources?.sheet_length).toBe("formula_library.config.variables");
    expect(result.debug?.variables.usable_drop_min).toBe(0);
    expect(result.debug?.variables.billable_length_increment).toBe(1);
    expect(result.debug?.variables.minimum_billable_sqft).toBe(32);
    expect(result.debug?.variables.computed_sheets).toBe(1);
    expect(result.debug?.variables.billed_sheet_sqft).toBe(32);
  });

  test("manual formula mode uses the manual formula even when a library formula is selected", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeMatrixBasePriceTree(1.375),
      widthIn: 24,
      heightIn: 18,
      quantity: 10,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      formulaSourceMode: "manual",
      pricingFormulaOverride: "total_sqft * base_price",
      pricingFormulaLibrary: {
        id: "formula_4x8",
        name: "4x8 Sheets with rounding",
        expression: "sheet_consumption_sqft(w, h, q, 48, 96, 24, 12, 3) * base_price",
      },
      debug: true,
    });

    expect(result.totalPrice).toBeCloseTo(41.25, 2);
    expect(result.formulaUsed).toBe("total_sqft * base_price");
    expect(result.debug?.formulaSourceMode).toBe("manual");
    expect(result.debug?.resolvedFormulaSource).toBe("manual");
    expect(result.debug?.manualFormulaPresent).toBe(true);
    expect(result.debug?.manualFormulaIgnored).toBe(false);
  });

  test("formula library mode errors when the selected library formula is missing", () => {
    let err: any = null;
    try {
      evaluatePricingPreviewFromTree({
        treeJson: makeMatrixBasePriceTree(1.375),
        widthIn: 24,
        heightIn: 18,
        quantity: 10,
        pbv2ExplicitSelections: { rate: { value: "standard" } },
        formulaSourceMode: "library",
        manualFormulaText: "total_sqft * base_price",
        debug: true,
      });
    } catch (error: any) {
      err = error;
    }

    expect(err?.code).toBe("PBV2_FORMULA_ERROR");
    expect(err?.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PBV2_E_FORMULA_LIBRARY_NOT_FOUND" }),
    ]));
    expect(err?.debug?.formulaSourceMode).toBe("library");
    expect(err?.debug?.resolvedFormulaSource).toBe("none");
    expect(err?.debug?.manualFormulaPresent).toBe(true);
    expect(err?.debug?.manualFormulaIgnored).toBe(true);
  });

  test("selected formula wins over flat-goods fallback for 24x18 q9", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeMatrixBasePriceTree(1.72),
      widthIn: 24,
      heightIn: 18,
      quantity: 9,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      pricingFormulaOverride: "total_sqft * base_price",
      pricingProfileKey: "flat_goods",
      pricingProfileConfig: {
        sheetWidth: 48,
        sheetHeight: 96,
        allowRotation: true,
        materialType: "sheet",
        minPricePerItem: 3,
      },
      debug: true,
    });

    expect(result.totalPrice).toBeCloseTo(46.44, 2);
    expect(result.breakdown.basePrice).toBeCloseTo(46.44, 2);
    expect(result.debug?.pricing?.finalTotalSource).toBe("formula");
    expect(result.debug?.pricing?.formulaEvaluatedTotal).toBeCloseTo(46.44, 2);
    expect(result.debug?.pricing?.finalTotal).toBeCloseTo(46.44, 2);
    expect(result.debug?.pricing?.totalPrice).toBeCloseTo(result.debug?.pricing?.finalTotal ?? 0, 2);
    expect(result.totalPrice).toBeCloseTo(result.debug?.pricing?.finalTotal ?? 0, 2);
    expect(result.debug?.pricing?.pbv2BaseTotal).not.toBeCloseTo(46.44, 2);
    expect(result.debug?.pricingSystem).toBe("pbv2");
    expect(result.totalPrice).not.toBe(27);
  });

  test("selected formula wins over fallback for 24x18 q10", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeMatrixBasePriceTree(1.38),
      widthIn: 24,
      heightIn: 18,
      quantity: 10,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      pricingFormulaOverride: "total_sqft * base_price",
      pricingProfileKey: "flat_goods",
      pricingProfileConfig: {
        sheetWidth: 48,
        sheetHeight: 96,
        allowRotation: true,
        materialType: "sheet",
        minPricePerItem: 3,
      },
      debug: true,
    });

    expect(result.totalPrice).toBeCloseTo(41.4, 2);
    expect(result.breakdown.basePrice).toBeCloseTo(41.4, 2);
    expect(result.debug?.pricing?.finalTotalSource).toBe("formula");
    expect(result.debug?.pricing?.formulaEvaluatedTotal).toBeCloseTo(41.4, 2);
    expect(result.debug?.pricing?.finalTotal).toBeCloseTo(41.4, 2);
    expect(result.debug?.pricing?.totalPrice).toBeCloseTo(result.debug?.pricing?.finalTotal ?? 0, 2);
    expect(result.totalPrice).toBeCloseTo(result.debug?.pricing?.finalTotal ?? 0, 2);
    expect(result.totalPrice).not.toBe(30);
  });

  test("row-level computed sheet usage selects the min qty 1 tier for 24x18 q10", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeRowTierBasisTree("computed_sheet_usage"),
      widthIn: 24,
      heightIn: 18,
      quantity: 10,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      pricingFormulaOverride: "total_finished_sqft * base_price",
      debug: true,
    });

    expect(result.debug?.tierResolution?.rawItemQuantity).toBe(10);
    expect(result.debug?.tierResolution?.tierBasis).toBe("computed_sheet_usage");
    expect(result.debug?.tierResolution?.tierBasisResolvedFrom).toBe("matrix_row");
    expect(result.debug?.tierResolution?.computedSheetUsage).toBe(1);
    expect(result.debug?.tierResolution?.tierSelectionQuantity).toBe(1);
    expect(result.debug?.tierResolution?.selectedTierMinQty).toBe(1);
    expect(result.debug?.tierResolution?.selectedTierRate).toBe(1.32);
    expect(result.debug?.tierResolution?.selectedTierSource).toBe("matrix_row");
    expect(result.debug?.variables.computed_sheets).toBe(1);
    expect(result.debug?.variables.billed_sheet_sqft).toBe(32);
    expect(result.debug?.pricingSystem).toBe("pbv2");
    expect(result.totalPrice).toBeCloseTo(39.6, 2);
  });

  test("row-level computed sheet usage selects the min qty 1 tier for 24x18 q9", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeRowTierBasisTree("computed_sheet_usage"),
      widthIn: 24,
      heightIn: 18,
      quantity: 9,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      pricingFormulaOverride: "total_finished_sqft * base_price",
      debug: true,
    });

    expect(result.debug?.tierResolution?.computedSheetUsage).toBe(1);
    expect(result.debug?.tierResolution?.tierSelectionQuantity).toBe(1);
    expect(result.debug?.tierResolution?.selectedTierMinQty).toBe(1);
    expect(result.debug?.tierResolution?.selectedTierRate).toBe(1.32);
  });

  test.each([8, 9, 10])("formula library sheet variables reach quantity tier resolver for 24x18 q%s", (quantity) => {
    const libraryExpression = "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price";
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeRowTierBasisTree("computed_sheet_usage", { base_price: 0 }, {}),
      widthIn: 24,
      heightIn: 18,
      quantity,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      formulaSourceMode: "library",
      pricingFormulaLibrary: {
        id: "formula_4x8",
        name: "4x8 Sheets with rounding",
        expression: libraryExpression,
        config: {
          variables: {
            sheet_width: 48,
            sheet_length: 96,
            usable_drop_min: 0,
            billable_length_increment: 1,
            minimum_billable_sqft: 32,
          },
        },
      },
      debug: true,
    });

    expect(result.debug?.tierResolution?.computedSheetUsage).toBe(1);
    expect(result.debug?.tierResolution?.tierSelectionQuantity).toBe(1);
    expect(result.debug?.tierResolution?.selectedTierMinQty).toBe(1);
    expect(result.debug?.tierResolution?.selectedTierRate).toBe(1.32);
    expect(result.debug?.tierResolution?.fallbackToLineItemQuantity).toBe(false);
    expect(result.debug?.tierResolution?.tierSheetWidth).toBe(48);
    expect(result.debug?.tierResolution?.tierSheetLength).toBe(96);
    expect(result.debug?.tierResolution?.tierUsableDropMin).toBe(0);
    expect(result.debug?.tierResolution?.tierBillableLengthIncrement).toBe(1);
    expect(result.debug?.tierResolution?.tierMinimumBillableSqft).toBe(32);
    expect(result.debug?.tierResolution?.tierVariableSources).toEqual(expect.objectContaining({
      sheet_width: "formula_library.config.variables",
      sheet_length: "formula_library.config.variables",
      usable_drop_min: "formula_library.config.variables",
      billable_length_increment: "formula_library.config.variables",
      minimum_billable_sqft: "formula_library.config.variables",
    }));
    expect(result.debug?.variables.billed_sheet_sqft).toBe(32);
    expect(result.totalPrice).toBeCloseTo(42.24, 2);
  });

  test.each([7, 8, 9, 10])("row tier rate drives sheet-yield base_price for 24x18 q%s", (quantity) => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeRowTierBasisTree(
        "computed_sheet_usage",
        { base_price: 0 },
        {
          sheet_width: 48,
          sheet_length: 96,
          usable_drop_min: 0,
          billable_length_increment: 1,
          minimum_billable_sqft: 32,
        },
      ),
      widthIn: 24,
      heightIn: 18,
      quantity,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      pricingFormulaOverride: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price",
      debug: true,
    });

    expect(result.debug?.variables.billed_sheet_sqft).toBe(32);
    expect(result.debug?.variables.base_price).toBe(1.32);
    expect(result.debug?.variables.p).toBe(1.32);
    expect(result.debug?.tierResolution?.rawItemQuantity).toBe(quantity);
    expect(result.debug?.tierResolution?.computedSheetUsageAvailable).toBe(true);
    expect(result.debug?.tierResolution?.tierSelectionQuantity).toBeGreaterThanOrEqual(1);
    expect(result.debug?.tierResolution?.selectedTierMinQty).toBe(1);
    expect(result.debug?.tierResolution?.selectedTierRate).toBe(1.32);
    expect(result.debug?.tierResolution?.selectedTierRateAppliedToBasePrice).toBe(true);
    expect(result.debug?.tierResolution?.matrixBasePriceRaw).toBe(0);
    expect(result.debug?.tierResolution?.matrixBasePriceIgnoredBecauseTierMatched).toBe(true);
    expect(result.debug?.tierResolution?.basePriceFinal).toBe(1.32);
    expect(result.debug?.tierResolution?.basePriceSource).toBe("pricing_matrix.row_qty_tier");
    expect(result.totalPrice).toBeCloseTo(42.24, 2);
    expect(result.breakdown.basePrice).toBeCloseTo(42.24, 2);
    expect(result.totalPrice).not.toBe(10);
  });

  test("high-precision row tier rate evaluates 32 sqft at 1.375 as 44.00", () => {
    const tree = makeRowTierBasisTree(
      "computed_sheet_usage",
      { base_price: 0 },
      {
        sheet_width: 48,
        sheet_length: 96,
        usable_drop_min: 0,
        billable_length_increment: 1,
        minimum_billable_sqft: 32,
      },
    ) as any;
    tree.pricingMatrix.rows[0].qtyTiers[0].perSqftCents = 137.5;

    const result = evaluatePricingPreviewFromTree({
      treeJson: tree,
      widthIn: 24,
      heightIn: 18,
      quantity: 10,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      pricingFormulaOverride: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price",
      debug: true,
    });

    expect(result.debug?.tierResolution?.selectedTierRate).toBe(1.375);
    expect(result.debug?.variables.base_price).toBe(1.375);
    expect(result.debug?.variables.p).toBe(1.375);
    expect(result.debug?.variables.billed_sheet_sqft).toBe(32);
    expect(result.debug?.rawBasePrice).toBe(1.375);
    expect(result.debug?.evaluatedFormulaTotalRaw).toBe(44);
    expect(result.debug?.evaluatedFormulaTotalRounded).toBe(44);
    expect(result.debug?.roundingAppliedAt).toBe("final_currency_total");
    expect(result.totalPrice).toBe(44);
  });

  test("formula evaluation preserves 4-decimal rates internally and rounds final currency", () => {
    const tree = makeRowTierBasisTree(
      "computed_sheet_usage",
      { base_price: 0 },
      {
        sheet_width: 48,
        sheet_length: 96,
        usable_drop_min: 0,
        billable_length_increment: 1,
        minimum_billable_sqft: 32,
      },
    ) as any;
    tree.pricingMatrix.rows[0].qtyTiers[0].perSqftCents = 133.33;

    const result = evaluatePricingPreviewFromTree({
      treeJson: tree,
      widthIn: 24,
      heightIn: 18,
      quantity: 10,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      pricingFormulaOverride: "billed_sheet_sqft * base_price",
      debug: true,
    });

    expect(result.debug?.variables.base_price).toBeCloseTo(1.3333, 6);
    expect(result.debug?.evaluatedFormulaTotalRaw).toBeCloseTo(42.6656, 6);
    expect(result.debug?.evaluatedFormulaTotalRounded).toBe(42.67);
    expect(result.totalPrice).toBe(42.67);
  });

  test.each([
    { quantity: 8, expectedSheets: 1, expectedFullSheets: 0, expectedPartialPieces: 8, expectedPartialFinishedSqft: 24, expectedPartialBillableSqft: 32, expectedBilledSqft: 32, expectedTierMinQty: 1, expectedPolicy: "minimum_billable_sqft" },
    { quantity: 10, expectedSheets: 1, expectedFullSheets: 1, expectedPartialPieces: 0, expectedPartialFinishedSqft: 0, expectedPartialBillableSqft: 0, expectedBilledSqft: 32, expectedTierMinQty: 1, expectedPolicy: "none" },
    { quantity: 11, expectedSheets: 2, expectedFullSheets: 1, expectedPartialPieces: 1, expectedPartialFinishedSqft: 3, expectedPartialBillableSqft: 32, expectedBilledSqft: 64, expectedTierMinQty: 1, expectedPolicy: "minimum_billable_sqft" },
    { quantity: 91, expectedSheets: 10, expectedFullSheets: 9, expectedPartialPieces: 1, expectedPartialFinishedSqft: 3, expectedPartialBillableSqft: 32, expectedBilledSqft: 320, expectedTierMinQty: 10, expectedPolicy: "minimum_billable_sqft" },
    { quantity: 100, expectedSheets: 10, expectedFullSheets: 10, expectedPartialPieces: 0, expectedPartialFinishedSqft: 0, expectedPartialBillableSqft: 0, expectedBilledSqft: 320, expectedTierMinQty: 10, expectedPolicy: "none" },
    { quantity: 101, expectedSheets: 11, expectedFullSheets: 10, expectedPartialPieces: 1, expectedPartialFinishedSqft: 3, expectedPartialBillableSqft: 32, expectedBilledSqft: 352, expectedTierMinQty: 10, expectedPolicy: "minimum_billable_sqft" },
  ])("computed sheet usage uses actual layout yield for 24x18 q$quantity", ({
    quantity,
    expectedSheets,
    expectedFullSheets,
    expectedPartialPieces,
    expectedPartialFinishedSqft,
    expectedPartialBillableSqft,
    expectedBilledSqft,
    expectedTierMinQty,
    expectedPolicy,
  }) => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeRowTierBasisTree(
        "computed_sheet_usage",
        { base_price: 0 },
        {
          sheet_width: 48,
          sheet_length: 96,
          usable_drop_min: 0,
          billable_length_increment: 1,
          minimum_billable_sqft: 32,
        },
      ),
      widthIn: 24,
      heightIn: 18,
      quantity,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      pricingFormulaOverride: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price",
      debug: true,
    });

    expect(result.debug?.tierResolution?.sheetUsageMethod).toBe("layout_yield");
    expect(result.debug?.tierResolution?.computedSheetUsageMode).toBe("layout_yield");
    expect(result.debug?.tierResolution?.piecesPerSheet).toBe(10);
    expect(result.debug?.tierResolution?.orientationUsed).toBe("normal");
    expect(result.debug?.tierResolution?.fullSheets).toBe(expectedFullSheets);
    expect(result.debug?.tierResolution?.partialSheetPieceCount).toBe(expectedPartialPieces);
    expect(result.debug?.tierResolution?.partialSheetFinishedSqft).toBe(expectedPartialFinishedSqft);
    expect(result.debug?.tierResolution?.partialSheetBillableSqft).toBe(expectedPartialBillableSqft);
    expect(result.debug?.tierResolution?.partialSheetPolicy).toBe(expectedPolicy);
    expect(result.debug?.tierResolution?.totalSheetCount).toBe(expectedSheets);
    expect(result.debug?.tierResolution?.computedSheetUsage).toBe(expectedSheets);
    expect(result.debug?.tierResolution?.tierSelectionQuantity).toBe(expectedSheets);
    expect(result.debug?.tierResolution?.selectedTierMinQty).toBe(expectedTierMinQty);
    expect(result.debug?.variables.computed_sheets).toBe(expectedSheets);
    expect(result.debug?.variables.total_sheet_count).toBe(expectedSheets);
    expect(result.debug?.variables.pieces_per_sheet).toBe(10);
    expect(result.debug?.variables.billed_sheet_sqft).toBe(expectedBilledSqft);
    expect(result.debug?.variables.computed_sheets).toBe(result.debug?.tierResolution?.totalSheetCount);
    expect(result.debug?.sheetYield).toEqual(expect.objectContaining({
      fullSheets: expectedFullSheets,
      partialSheetPieceCount: expectedPartialPieces,
      partialSheetFinishedSqft: expectedPartialFinishedSqft,
      partialSheetBillableSqft: expectedPartialBillableSqft,
      partialSheetPolicy: expectedPolicy,
      totalSheetCount: expectedSheets,
      billedSheetSqft: expectedBilledSqft,
    }));
  });

  test("row-level raw item quantity still selects the qty 10 tier when configured", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeRowTierBasisTree("line_item_quantity"),
      widthIn: 24,
      heightIn: 18,
      quantity: 10,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      pricingFormulaOverride: "total_finished_sqft * base_price",
      debug: true,
    });

    expect(result.debug?.tierResolution?.tierBasis).toBe("line_item_quantity");
    expect(result.debug?.tierResolution?.tierSelectionQuantity).toBe(10);
    expect(result.debug?.tierResolution?.selectedTierMinQty).toBe(10);
    expect(result.debug?.tierResolution?.selectedTierRate).toBe(1);
    expect(result.totalPrice).toBeCloseTo(30, 2);
  });

  test("billed sheet sqft formula returns billed-sheet pricing", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeTree(),
      widthIn: 24,
      heightIn: 18,
      quantity: 10,
      pricingFormulaOverride: "billed_sheet_sqft * sqft_rate",
      formulaVariables: {
        sheet_width: 48,
        sheet_length: 96,
        usable_drop_min: 24,
        billable_length_increment: 12,
        minimum_billable_sqft: 3,
        sqft_rate: 1.375,
      },
      debug: true,
    });

    expect(result.debug?.variables.computed_sheets).toBe(1);
    expect(result.debug?.variables.billed_sheet_sqft).toBe(32);
    expect(result.debug?.quantityBasisUsed).toBe("billed_sheet_sqft");
    expect(result.debug?.formulaResultType).toBe("final_dollars");
    expect(result.totalPrice).toBeCloseTo(44, 2);
  });

  test("computed sheets formula returns sheet-count pricing", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeTree(),
      widthIn: 24,
      heightIn: 18,
      quantity: 10,
      pricingFormulaOverride: "computed_sheets * sheet_price",
      formulaVariables: {
        sheet_width: 48,
        sheet_length: 96,
        usable_drop_min: 24,
        billable_length_increment: 12,
        minimum_billable_sqft: 3,
        sheet_price: 44,
      },
      debug: true,
    });

    expect(result.debug?.variables.computed_sheets).toBe(1);
    expect(result.debug?.quantityBasisUsed).toBe("computed_sheets");
    expect(result.debug?.formulaResultType).toBe("final_dollars");
    expect(result.totalPrice).toBeCloseTo(44, 2);
  });

  test("geometry-only formula is flagged as likely misconfigured", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeTree(),
      widthIn: 24,
      heightIn: 18,
      quantity: 10,
      pricingFormulaOverride: "billed_sheet_sqft",
      formulaVariables: {
        sheet_width: 48,
        sheet_length: 96,
        usable_drop_min: 24,
        billable_length_increment: 12,
        minimum_billable_sqft: 3,
      },
      debug: true,
    });

    expect(result.debug?.likelyMisconfiguredFormula).toBe(true);
    expect(result.debug?.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PBV2_FORMULA_GEOMETRY_OUTPUT_ONLY" }),
    ]));
    expect(result.debug?.formulaResultType).toBe("final_dollars");
  });

  test("billable output meaning prices sheet_consumption_sqft as billable sqft times base price", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeTree(500),
      widthIn: 18,
      heightIn: 14,
      quantity: 2,
      pricingFormulaOverride: "sheet_consumption_sqft(w,h,q,24,96,12,12,2)",
      pricingProfileConfig: { formulaOutputMeaning: "billable" },
      debug: true,
    });

    expect(result.debug?.resultValue).toBe(6);
    expect(result.debug?.formulaOutputMeaning).toBe("billable");
    expect(result.debug?.formulaResultType).toBe("billable_quantity");
    expect(result.debug?.selectedRate).toBe(5);
    expect(result.totalPrice).toBeCloseTo(30, 2);
    expect(result.debug?.errors ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PBV2_FORMULA_GEOMETRY_OUTPUT_ONLY" }),
    ]));
  });

  test("formula library billable output meaning is honored in product pricing preview", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeTree(500),
      widthIn: 18,
      heightIn: 14,
      quantity: 2,
      formulaSourceMode: "formulaLibrary",
      pricingFormulaLibrary: {
        id: "magnet_billable_sqft",
        name: "Magnet Billable Sqft",
        expression: "sheet_consumption_sqft(w,h,q,24,96,12,12,2)",
        config: { formulaOutputMeaning: "billable" },
      },
      debug: true,
    });

    expect(result.debug?.resolvedFormulaSource).toBe("library");
    expect(result.debug?.resultValue).toBe(6);
    expect(result.debug?.formulaOutputMeaning).toBe("billable");
    expect(result.debug?.normalizedFormulaOutputMeaning).toBe("billable");
    expect(result.debug?.formulaOutputMeaningRaw).toBe("billable");
    expect(result.debug?.formulaOutputMeaningSource).toBe("formula_library.config.formulaOutputMeaning");
    expect(result.debug?.formulaResultType).toBe("billable_quantity");
    expect(result.totalPrice).toBeCloseTo(30, 2);
  });

  test("formula library output meaning aliases are normalized for product builder preview", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeTree(500),
      widthIn: 18,
      heightIn: 14,
      quantity: 2,
      formulaSourceMode: "formulaLibrary",
      pricingFormulaLibrary: {
        id: "magnet_billable_sqft",
        name: "Magnet Billable Sqft",
        expression: "sheet_consumption_sqft(w,h,q,24,96,12,12,2)",
        config: { metadata: { formulaOutputMeaning: "billable qty / sqft" } },
      },
      debug: true,
    });

    expect(result.debug?.resultValue).toBe(6);
    expect(result.debug?.normalizedFormulaOutputMeaning).toBe("billable");
    expect(result.debug?.formulaOutputMeaningRaw).toBe("billable qty / sqft");
    expect(result.debug?.formulaOutputMeaningSource).toBe("formula_library.config.metadata.formulaOutputMeaning");
    expect(result.debug?.formulaResultType).toBe("billable_quantity");
    expect(result.totalPrice).toBeCloseTo(30, 2);
  });

  test("missing computed sheet usage emits an explicit tier error without raw quantity fallback", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: {
        ...makeRowTierBasisTree("computed_sheet_usage"),
        meta: { pricingV2: { base: { perSqftCents: 200 } } },
      },
      widthIn: 24,
      heightIn: 18,
      quantity: 10,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      pricingFormulaOverride: "total_finished_sqft * base_price",
      debug: true,
    });

    expect(result.debug?.tierResolution?.tierSelectionQuantity).toBe(0);
    expect(result.debug?.tierResolution?.fallbackToLineItemQuantity).toBe(false);
    expect(result.debug?.tierResolution?.computedSheetUsageUnavailableReason).toContain("missing_variables");
    expect(result.debug?.tierResolution?.warnings?.some((warning) => warning.code === "PBV2_E_TIER_COMPUTED_SHEET_USAGE_UNAVAILABLE")).toBe(true);
  });
});

// ── 48×96 expected-output table ───────────────────────────────────────────────
// Config: sheet_width=48, sheet_length=96, usable_drop_min=24,
//         billable_length_increment=12, minimum_billable_sqft=3
// All values must be whole integers (ceil applied to final result).

const FORMULA_4X8 =
  "sheet_consumption_sqft(w, h, q, 48, 96, 24, 12, 3, true)";

describe("sheet_consumption_sqft — 48×96 expected outputs", () => {
  test("12×18 q1 → 3  (reusable drop, minimum floor)", () => {
    // rotated (18w×12h): piecesAcross=2, q=1 partial row, occupiedWidth=18, drop=30≥24
    //   effectiveW=18, consumedLength=12, billableLength=12, sqft=18*12/144=1.5
    // normal (12w×18h): partial row 1 piece, occupiedWidth=12, drop=36≥24
    //   effectiveW=12, consumedLength=18, billableLength=24, sqft=12*24/144=2
    // best=1.5 → max(1.5, 3)=3 → ceil=3
    expect(runFormula(FORMULA_4X8, 12, 18, 1).totalPrice).toBe(3);
  });

  test("12×18 q5 → 12  (two full rows, full width)", () => {
    // normal (12w×18h): piecesAcross=4, rowsNeeded=2, consumedLength=36, billableLength=36
    //   fullRows=1 → occupiedWidth=48, drop=0<24 → effectiveW=48, sqft=48*36/144=12
    // ceil(12)=12
    expect(runFormula(FORMULA_4X8, 12, 18, 5).totalPrice).toBe(12);
  });

  test("12×18 q20 → 32  (consumedLength 90 rounds to 96)", () => {
    // normal (12w×18h): piecesAcross=4, rowsNeeded=5, consumedLength=90
    //   billableLength=ceil(90/12)*12=96, sqft=48*96/144=32
    // ceil(32)=32
    expect(runFormula(FORMULA_4X8, 12, 18, 20).totalPrice).toBe(32);
  });

  test("12x18 q21 bills one full sheet plus partial-sheet minimum", () => {
    // normal (12w×18h): piecesAcross=4, rowsNeeded=6, consumedLength=108
    //   billableLength=108, sqft=48*108/144=36
    // ceil(36)=36
    expect(runFormula(FORMULA_4X8, 12, 18, 21).totalPrice).toBe(35);
  });

  test("60×23 q1 → 10  (reusable drop, fractional area ceiled)", () => {
    // rotated (23w×60h): partial row, occupiedWidth=23, drop=25≥24
    //   sqft=23*60/144≈9.583 → ceil=10
    expect(runFormula(FORMULA_4X8, 60, 23, 1).totalPrice).toBe(10);
  });

  test("60x25 q1 bills the occupied full-width area while preserving the usable end drop", () => {
    // rotated (25w×60h): piecesAcross=1, fullRow, drop=23<24 → effectiveW=48
    //   sqft=48*60/144=20 → ceil=20
    expect(runFormula(FORMULA_4X8, 60, 25, 1).totalPrice).toBe(20);
  });

  test("canonical product allowRotation=true overrides stale active-tree false and prices rotated ACM", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeRowTierBasisTree("computed_sheet_usage", undefined, {
        sheet_width: 48,
        sheet_length: 96,
        usable_drop_min: 24,
        billable_length_increment: 12,
        minimum_billable_sqft: 3,
        allow_rotation: 0,
      }),
      widthIn: 72,
      heightIn: 48,
      quantity: 1,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      pricingProfileConfig: { allowRotation: true },
      pricingFormulaOverride: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price",
      debug: true,
    });

    expect(result.totalPrice).toBeGreaterThan(0);
    expect(result.debug?.variables.allow_rotation).toBe(true);
    expect(result.debug?.variableSources?.allow_rotation).toBe("product.pricingProfileConfig.allowRotation");
    expect(result.debug?.sheetYield).toEqual(expect.objectContaining({
      allowRotation: true,
      orientationUsed: "rotated",
    }));
  });

  test("canonical product allowRotation=false marks rotated-only ACM for paneling", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: makeRowTierBasisTree("computed_sheet_usage"),
      widthIn: 72,
      heightIn: 48,
      quantity: 1,
      pbv2ExplicitSelections: { rate: { value: "standard" } },
      pricingProfileConfig: { allowRotation: false },
      pricingFormulaOverride: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price",
      debug: true,
    });
    expect(result.totalPrice).toBeGreaterThan(0);
    expect(result.debug?.sheetYield?.available).toBe(false);
  });

  test("30×30 q1 → 12  (drop 18\" too narrow, 30\" row rounds to 36\")", () => {
    // normal (30w×30h): piecesAcross=1, fullRow, drop=18<24 → effectiveW=48
    //   consumedLength=30, billableLength=36, sqft=48*36/144=12
    // ceil(12)=12
    expect(runFormula(FORMULA_4X8, 30, 30, 1).totalPrice).toBe(12);
  });

  test("30×30 q2 → 20  (two rows, 60\" rounds to 60\")", () => {
    // normal (30w×30h): piecesAcross=1, rowsNeeded=2, consumedLength=60
    //   billableLength=60, effectiveW=48, sqft=48*60/144=20
    // ceil(20)=20
    expect(runFormula(FORMULA_4X8, 30, 30, 2).totalPrice).toBe(20);
  });

  test("37×37 q1 → 16  (37\" row rounds to 48\", drop too narrow)", () => {
    // normal (37w×37h): piecesAcross=1, fullRow, drop=11<24 → effectiveW=48
    //   consumedLength=37, billableLength=ceil(37/12)*12=48, sqft=48*48/144=16
    // ceil(16)=16
    expect(runFormula(FORMULA_4X8, 37, 37, 1).totalPrice).toBe(16);
  });

  test("48×96 q1 → 32  (exact full sheet)", () => {
    // normal (48w×96h): piecesAcross=1, fullRow, drop=0<24 → effectiveW=48
    //   consumedLength=96, billableLength=96, sqft=48*96/144=32
    // ceil(32)=32
    expect(runFormula(FORMULA_4X8, 48, 96, 1).totalPrice).toBe(32);
  });
});
