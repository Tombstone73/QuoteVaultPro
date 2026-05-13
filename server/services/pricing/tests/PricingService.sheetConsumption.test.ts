/**
 * Tests for the sheet_consumption_sqft() formula helper.
 *
 * Verifies: normal vs rotated orientation selection, reusable-drop logic
 * (partial-row occupied-width fix), billable-length rounding, minimum-sqft
 * floor, and error throwing when a piece physically cannot fit the sheet.
 *
 * Because the formula contains `q`, inferFormulaApplication classifies it as
 * totalPrice. The formula result (sqft) maps directly to result.totalPrice.
 */

import { describe, expect, test } from "@jest/globals";
import { evaluatePricingPreviewFromTree } from "../PricingService";

function makeTree() {
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
      pricingV2: { base: { perSqftCents: 100 } },
    },
  };
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

// sheet_consumption_sqft(w, h, q, sheet_width, sheet_length, usable_drop_min, billable_length_increment, minimum_billable_sqft)

describe("sheet_consumption_sqft", () => {
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
    expect(result.totalPrice).toBeCloseTo(10, 1);
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
      "sheet_consumption_sqft(w, h, q, 48, 96, 24, 12, 3)",
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
      "sheet_consumption_sqft(w, h, q, 48, 96, 24, 12, 3)",
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

  // ── physical fit constraint → error, not silent underpricing ──────────────

  test("oversized piece fitting neither orientation throws PBV2_FORMULA_ERROR", () => {
    // 50×50 piece on a 48×48 sheet: pieceW=50>48 in both orientations
    const err = runFormulaExpectError(
      "sheet_consumption_sqft(w, h, q, 48, 48, 0, 1, 5)",
      50, 50, 1,
    );
    expect(err).not.toBeNull();
    expect(err.code).toBe("PBV2_FORMULA_ERROR");
    expect(err.message.toLowerCase()).toContain("sheet_consumption_sqft");
  });

  test("piece taller than sheet_length in both orientations throws PBV2_FORMULA_ERROR", () => {
    // piece 24×100, sheet_width=48, sheet_length=96
    // normal (24w×100h): h=100>96 → Infinity
    // rotated (100w×24h): w=100>48 → Infinity
    const err = runFormulaExpectError(
      "sheet_consumption_sqft(w, h, q, 48, 96, 0, 1, 3)",
      24, 100, 1,
    );
    expect(err).not.toBeNull();
    expect(err.code).toBe("PBV2_FORMULA_ERROR");
    expect(err.message.toLowerCase()).toContain("sheet_consumption_sqft");
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
    expect(result.totalPrice).toBeCloseTo(66, 1);
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
});

// ── 48×96 expected-output table ───────────────────────────────────────────────
// Config: sheet_width=48, sheet_length=96, usable_drop_min=24,
//         billable_length_increment=12, minimum_billable_sqft=3
// All values must be whole integers (ceil applied to final result).

const FORMULA_4X8 =
  "sheet_consumption_sqft(w, h, q, 48, 96, 24, 12, 3)";

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

  test("12×18 q21 → 36  (one full sheet + 12\" increment)", () => {
    // normal (12w×18h): piecesAcross=4, rowsNeeded=6, consumedLength=108
    //   billableLength=108, sqft=48*108/144=36
    // ceil(36)=36
    expect(runFormula(FORMULA_4X8, 12, 18, 21).totalPrice).toBe(36);
  });

  test("60×23 q1 → 10  (reusable drop, fractional area ceiled)", () => {
    // rotated (23w×60h): partial row, occupiedWidth=23, drop=25≥24
    //   sqft=23*60/144≈9.583 → ceil=10
    expect(runFormula(FORMULA_4X8, 60, 23, 1).totalPrice).toBe(10);
  });

  test("60×25 q1 → 20  (drop too narrow, full width)", () => {
    // rotated (25w×60h): piecesAcross=1, fullRow, drop=23<24 → effectiveW=48
    //   sqft=48*60/144=20 → ceil=20
    expect(runFormula(FORMULA_4X8, 60, 25, 1).totalPrice).toBe(20);
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
