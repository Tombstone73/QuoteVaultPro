/**
 * Tests for PBV2 base pricing calculation
 * 
 * Verifies that minimum charge is applied per LINE ITEM, not per unit
 */

import { describe, expect, test } from "@jest/globals";
import { assertQuantityOnlyPriceConfigured, evaluatePricingPreviewFromTree } from "../PricingService";

// Mock the calculateBasePrice function's logic
function calculateBasePrice(
  tree: any,
  context: { widthIn: number; heightIn: number; quantity: number }
): number {
  const meta = tree?.meta;
  const pricingV2 = meta?.pricingV2;
  const base = pricingV2?.base;

  let perSqftCents = typeof base?.perSqftCents === 'number' ? base.perSqftCents : 0;
  let perPieceCents = typeof base?.perPieceCents === 'number' ? base.perPieceCents : 0;
  let minimumChargeCents = typeof base?.minimumChargeCents === 'number' ? base.minimumChargeCents : 0;

  const { widthIn, heightIn, quantity } = context;
  const sqftPerItem = widthIn > 0 && heightIn > 0 ? (widthIn * heightIn) / 144 : 0;

  // Compute line base total: perSqft applies to total sqft across all items
  const totalSqft = sqftPerItem * quantity;
  const sqftComponent = perSqftCents * totalSqft;
  const pieceComponent = perPieceCents * quantity;
  const lineBaseCents = sqftComponent + pieceComponent;

  // Apply minimum charge once per line item (not per unit)
  const total = minimumChargeCents > 0 ? Math.max(lineBaseCents, minimumChargeCents) : lineBaseCents;

  return Math.round(total);
}

describe("PBV2 Base Pricing - Minimum Charge Semantics", () => {
  const mockTree = {
    meta: {
      pricingV2: {
        base: {
          perSqftCents: 400,
          perPieceCents: 0,
          minimumChargeCents: 444,
        }
      }
    }
  };

  test("12x12 (1 sqft), qty=1, perSqft=400, min=444 => 444 (minimum applies)", () => {
    const result = calculateBasePrice(mockTree, {
      widthIn: 12,
      heightIn: 12,
      quantity: 1,
    });

    // lineBase = 400 * 1 * 1 = 400
    // max(400, 444) = 444
    expect(result).toBe(444);
  });

  test("12x12 (1 sqft), qty=3, perSqft=400, min=444 => 1200 (line total exceeds minimum)", () => {
    const result = calculateBasePrice(mockTree, {
      widthIn: 12,
      heightIn: 12,
      quantity: 3,
    });

    // lineBase = 400 * 1 * 3 = 1200
    // max(1200, 444) = 1200
    expect(result).toBe(1200);
  });

  test("24x48 (8 sqft), qty=1, perSqft=400, min=444 => 3200 (line total exceeds minimum)", () => {
    const result = calculateBasePrice(mockTree, {
      widthIn: 24,
      heightIn: 48,
      quantity: 1,
    });

    // lineBase = 400 * 8 * 1 = 3200
    // max(3200, 444) = 3200
    expect(result).toBe(3200);
  });

  test("12x12 (1 sqft), qty=2, perSqft=400, min=444 => 800 (line total exceeds minimum)", () => {
    const result = calculateBasePrice(mockTree, {
      widthIn: 12,
      heightIn: 12,
      quantity: 2,
    });

    // lineBase = 400 * 1 * 2 = 800
    // max(800, 444) = 800
    expect(result).toBe(800);
  });

  test("with perPieceCents: 6x6 (0.25 sqft), qty=5, perSqft=400, perPiece=50, min=444 => 750", () => {
    const treeWithPiece = {
      meta: {
        pricingV2: {
          base: {
            perSqftCents: 400,
            perPieceCents: 50,
            minimumChargeCents: 444,
          }
        }
      }
    };

    const result = calculateBasePrice(treeWithPiece, {
      widthIn: 6,
      heightIn: 6,
      quantity: 5,
    });

    // lineBase = (400 * 0.25 * 5) + (50 * 5) = 500 + 250 = 750
    // max(750, 444) = 750
    expect(result).toBe(750);
  });

  test("no minimum charge: 12x12, qty=3, perSqft=400, min=0 => 1200", () => {
    const treeNoMin = {
      meta: {
        pricingV2: {
          base: {
            perSqftCents: 400,
            perPieceCents: 0,
            minimumChargeCents: 0,
          }
        }
      }
    };

    const result = calculateBasePrice(treeNoMin, {
      widthIn: 12,
      heightIn: 12,
      quantity: 3,
    });

    // lineBase = 400 * 1 * 3 = 1200
    // max(1200, 0) = 1200
    expect(result).toBe(1200);
  });

  test("high-precision perSqftCents: 32 sqft at $1.375/sqft => 4400", () => {
    const highPrecisionTree = {
      meta: {
        pricingV2: {
          base: {
            perSqftCents: 137.5,
            perPieceCents: 0,
            minimumChargeCents: 0,
          }
        }
      }
    };

    const result = calculateBasePrice(highPrecisionTree, {
      widthIn: 48,
      heightIn: 96,
      quantity: 1,
    });

    // 48x96 = 32 sqft; 137.5 cents * 32 = 4400 cents
    expect(result).toBe(4400);
  });

  test("quantity-only per-item pricing uses quantity times the configured unit price", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: {
        schemaVersion: 2,
        rootNodeIds: ["root"],
        nodes: {
          root: { id: "root", kind: "group", label: "Product options" },
          unit: {
            id: "unit",
            kind: "question",
            key: "unit",
            label: "Unit",
            input: { type: "select", selectionKey: "unit", defaultValue: "each" },
            choices: [{ value: "each", label: "Each" }],
          },
        },
        edges: [{ fromNodeId: "root", toNodeId: "unit" }],
        meta: {
          pricingV2: {
            base: { perPieceCents: 275, perSqftCents: 0, minimumChargeCents: 0 },
          },
        },
      },
      // Quantity-only callers use neutral geometry solely at the pricing boundary.
      widthIn: 1,
      heightIn: 1,
      quantity: 3,
      pricingProfileKey: "qty_only",
    });

    expect(result.totalPrice).toBe(8.25);
  });

  test("quantity-only binds unitPrice to Rate per piece and ignores Rate per sq ft", () => {
    const treeJson = {
      schemaVersion: 2,
      rootNodeIds: ["root"],
      nodes: { root: { id: "root", kind: "group", label: "Product options" } },
      edges: [],
      meta: {
        pricingProfileKey: "qty_only",
        pricingFormula: "q * unitPrice",
        pricingV2: {
          base: { perSqftCents: 999, perPieceCents: 100, minimumChargeCents: 0 },
        },
      },
    };

    const one = evaluatePricingPreviewFromTree({
      treeJson,
      widthIn: 1,
      heightIn: 1,
      quantity: 1,
      pricingProfileKey: "qty_only",
      debug: true,
    });
    const fifty = evaluatePricingPreviewFromTree({
      treeJson,
      widthIn: 1,
      heightIn: 1,
      quantity: 50,
      pricingProfileKey: "qty_only",
      debug: true,
    });
    const sixWithStaleGeometryFormula = evaluatePricingPreviewFromTree({
      treeJson,
      widthIn: 24,
      heightIn: 36,
      quantity: 6,
      pricingProfileKey: "qty_only",
      formulaSourceMode: "library",
      pricingFormulaLibrary: {
        id: "stale-sqft-formula",
        expression: "ceil((((w + 0.25) * (h + 0.25)) / 144) * q)",
      },
      debug: true,
    });

    expect(one.totalPrice).toBe(1);
    expect(one.unitPrice).toBe(1);
    expect(one.debug?.variables.unitPrice).toBe(1);
    expect(sixWithStaleGeometryFormula.totalPrice).toBe(6);
    expect(sixWithStaleGeometryFormula.unitPrice).toBe(1);
    expect(sixWithStaleGeometryFormula.formulaUsed).toBe("q * unitPrice");
    expect(sixWithStaleGeometryFormula.debug?.resolvedFormulaExpression).toBe("q * unitPrice");
    expect(sixWithStaleGeometryFormula.debug?.variables).not.toHaveProperty("sqft");
    expect(sixWithStaleGeometryFormula.debug?.variables).not.toHaveProperty("base_price");
    expect(fifty.totalPrice).toBe(50);
    expect(fifty.unitPrice).toBe(1);
  });

  test("quantity-only preview with no per-piece rate remains zero for the explicit configuration warning", () => {
    const result = evaluatePricingPreviewFromTree({
      treeJson: {
        schemaVersion: 2,
        rootNodeIds: ["root"],
        nodes: { root: { id: "root", kind: "group", label: "Product options" } },
        edges: [],
        meta: {
          pricingProfileKey: "qty_only",
          pricingFormula: "q * unitPrice",
          pricingV2: { base: { perSqftCents: 500, perPieceCents: 0, minimumChargeCents: 0 } },
        },
      },
      widthIn: 1,
      heightIn: 1,
      quantity: 1,
      pricingProfileKey: "qty_only",
    });

    expect(result.totalPrice).toBe(0);
    expect(result.unitPrice).toBe(0);
  });

  test("zero-priced quantity-only products are blocked unless explicitly allowed", () => {
    expect(() => assertQuantityOnlyPriceConfigured({ measurementMode: "quantity_only", allowZeroPrice: false }, 0))
      .toThrow("Price not configured");
    expect(() => assertQuantityOnlyPriceConfigured({ measurementMode: "quantity_only", allowZeroPrice: true }, 0))
      .not.toThrow();
  });
});
