import { describe, expect, test } from "@jest/globals";
import {
  parseDimensionsFromDescription,
  computeTotalSqFt,
  extractFinishingBullets,
} from "../server/routes/flatStockNesting.shared";

// ---------------------------------------------------------------------------
// parseDimensionsFromDescription
// ---------------------------------------------------------------------------

describe("parseDimensionsFromDescription", () => {
  test("parses plain NxM format", () => {
    expect(parseDimensionsFromDescription("24x36")).toEqual({ widthIn: 24, heightIn: 36 });
  });

  test("parses with spaces around x", () => {
    expect(parseDimensionsFromDescription("24 x 36")).toEqual({ widthIn: 24, heightIn: 36 });
  });

  test("parses with inch suffix", () => {
    expect(parseDimensionsFromDescription("24in x 36in")).toEqual({ widthIn: 24, heightIn: 36 });
  });

  test("parses with quote-style inch marker", () => {
    expect(parseDimensionsFromDescription('24"x36"')).toEqual({ widthIn: 24, heightIn: 36 });
  });

  test("parses decimal dimensions", () => {
    expect(parseDimensionsFromDescription("11.5x17")).toEqual({ widthIn: 11.5, heightIn: 17 });
  });

  test("parses unicode × separator", () => {
    expect(parseDimensionsFromDescription("48×96")).toEqual({ widthIn: 48, heightIn: 96 });
  });

  test("returns null for both when no dimensions found", () => {
    expect(parseDimensionsFromDescription("no dimensions here")).toEqual({
      widthIn: null,
      heightIn: null,
    });
  });

  test("returns null for both on empty string", () => {
    expect(parseDimensionsFromDescription("")).toEqual({ widthIn: null, heightIn: null });
  });

  test("returns null for both on null/undefined", () => {
    expect(parseDimensionsFromDescription(null)).toEqual({ widthIn: null, heightIn: null });
    expect(parseDimensionsFromDescription(undefined)).toEqual({ widthIn: null, heightIn: null });
  });
});

// ---------------------------------------------------------------------------
// computeTotalSqFt
// ---------------------------------------------------------------------------

describe("computeTotalSqFt", () => {
  test("computes correctly from explicit width/height/quantity", () => {
    // (24 × 36 / 144) × 2 = 6 × 2 = 12
    expect(computeTotalSqFt({ width: 24, height: 36, quantity: 2 })).toBeCloseTo(12);
  });

  test("handles quantity = 1", () => {
    // 24 × 36 / 144 = 6
    expect(computeTotalSqFt({ width: 24, height: 36, quantity: 1 })).toBeCloseTo(6);
  });

  test("falls back to description when width/height are missing", () => {
    expect(
      computeTotalSqFt({ width: null, height: null, quantity: 1, description: "24x36 banner" }),
    ).toBeCloseTo(6);
  });

  test("falls back to description when width/height are zero", () => {
    expect(
      computeTotalSqFt({ width: 0, height: 0, quantity: 1, description: "12x12" }),
    ).toBeCloseTo(1);
  });

  test("prefers explicit width/height over description", () => {
    // explicit 48×48 → 16 sqft, not 24x36 from description
    expect(
      computeTotalSqFt({ width: 48, height: 48, quantity: 1, description: "24x36" }),
    ).toBeCloseTo(16);
  });

  test("returns null when dimensions cannot be resolved", () => {
    expect(computeTotalSqFt({ width: null, height: null, quantity: 1 })).toBeNull();
  });

  test("returns null when quantity is zero", () => {
    expect(computeTotalSqFt({ width: 24, height: 36, quantity: 0 })).toBeNull();
  });

  test("returns null when quantity is negative", () => {
    expect(computeTotalSqFt({ width: 24, height: 36, quantity: -1 })).toBeNull();
  });

  test("returns null when quantity is non-finite", () => {
    expect(computeTotalSqFt({ width: 24, height: 36, quantity: NaN })).toBeNull();
    expect(computeTotalSqFt({ width: 24, height: 36, quantity: Infinity })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractFinishingBullets
// ---------------------------------------------------------------------------

describe("extractFinishingBullets", () => {
  test("extracts from selectedOptions", () => {
    const lineItem = {
      selectedOptions: [
        { optionName: "Laminate", value: "Gloss" },
        { optionName: "Size", value: "Large" },
      ],
    };
    const bullets = extractFinishingBullets(lineItem);
    expect(bullets).toContain("Laminate: Gloss");
    expect(bullets).not.toContain("Size: Large");
  });

  test("extracts from optionSelectionsJson", () => {
    const lineItem = {
      optionSelectionsJson: {
        Finish: "Matte",
        Color: "Red",
        Grommets: true,
      },
    };
    const bullets = extractFinishingBullets(lineItem);
    expect(bullets).toContain("Finish: Matte");
    expect(bullets).toContain("Grommets");
    expect(bullets).not.toContain("Color: Red");
  });

  test("extracts from specsJson", () => {
    const lineItem = {
      specsJson: { Hemming: "All sides", Weight: "Heavy" },
    };
    const bullets = extractFinishingBullets(lineItem);
    expect(bullets).toContain("Hemming: All sides");
    expect(bullets).not.toContain("Weight: Heavy");
  });

  test("deduplicates across sources", () => {
    const lineItem = {
      selectedOptions: [{ optionName: "Finish", value: "Gloss" }],
      optionSelectionsJson: { Finish: "Gloss" },
    };
    const bullets = extractFinishingBullets(lineItem);
    expect(bullets.filter((b) => b === "Finish: Gloss").length).toBe(1);
  });

  test("boolean false value is excluded", () => {
    const lineItem = {
      optionSelectionsJson: { Grommets: false },
    };
    const bullets = extractFinishingBullets(lineItem);
    expect(bullets).toEqual([]);
  });

  test("returns empty array for empty line item", () => {
    expect(extractFinishingBullets({})).toEqual([]);
    expect(extractFinishingBullets(null)).toEqual([]);
  });
});
