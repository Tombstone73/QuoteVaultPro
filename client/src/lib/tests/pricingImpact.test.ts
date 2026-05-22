import { describe, expect, test } from "@jest/globals";
import {
  parseMoneyInputDraft,
  normalizePricingImpactForMode,
  normalizeLegacyPricingImpact,
  normalizeFormulaInputDraft,
  normalizeTreePricingImpacts,
  getPricingImpactWarnings,
  hasPricingImpactWarnings,
  canonicalAmountField,
} from "../pbv2/pricing/pricingImpact";

describe("parseMoneyInputDraft", () => {
  test("converts dollar input to stored cents", () => {
    expect(parseMoneyInputDraft("1.25")).toEqual({ status: "valid", cents: 125 });
    expect(parseMoneyInputDraft("0")).toEqual({ status: "valid", cents: 0 });
    expect(parseMoneyInputDraft("0.25")).toEqual({ status: "valid", cents: 25 });
    expect(parseMoneyInputDraft("12.99")).toEqual({ status: "valid", cents: 1299 });
  });

  test("treats a partial decimal like '1.' as a valid in-progress value", () => {
    expect(parseMoneyInputDraft("1.")).toEqual({ status: "valid", cents: 100 });
    expect(parseMoneyInputDraft(".5")).toEqual({ status: "valid", cents: 50 });
  });

  test("clearing the input reports 'empty' and never writes NaN/0", () => {
    expect(parseMoneyInputDraft("")).toEqual({ status: "empty" });
    expect(parseMoneyInputDraft("   ")).toEqual({ status: "empty" });
  });

  test("unparseable input is 'partial' so no garbage is committed", () => {
    expect(parseMoneyInputDraft("-")).toEqual({ status: "partial" });
    expect(parseMoneyInputDraft("abc")).toEqual({ status: "partial" });
    expect(parseMoneyInputDraft("1.2.3")).toEqual({ status: "partial" });
  });

  test("supports negative amounts (discounts)", () => {
    expect(parseMoneyInputDraft("-2.50")).toEqual({ status: "valid", cents: -250 });
  });
});

describe("normalizePricingImpactForMode", () => {
  test("changing type to Per Unit initializes both amount and unit", () => {
    const next = normalizePricingImpactForMode({ mode: "addCents", cents: 125 }, "addPerUnit");
    expect(next.mode).toBe("addPerUnit");
    expect(next.centsPerUnit).toBe(125); // amount preserved (compatible)
    expect(next.unit).toBe("perPiece"); // required unit initialized
    expect(next.cents).toBeUndefined(); // stale field removed
  });

  test("keeps an existing unit when switching back into Per Unit", () => {
    const next = normalizePricingImpactForMode(
      { mode: "addCents", cents: 50, unit: "perSqft" },
      "addPerUnit",
    );
    expect(next.unit).toBe("perSqft");
    expect(next.centsPerUnit).toBe(50);
  });

  test("Per Unit -> Add Amount carries the amount into cents", () => {
    const next = normalizePricingImpactForMode(
      { mode: "addPerUnit", centsPerUnit: 300, unit: "perQty" },
      "addCents",
    );
    expect(next.mode).toBe("addCents");
    expect(next.cents).toBe(300);
    expect(next.centsPerUnit).toBeUndefined();
    expect(next.unit).toBeUndefined();
  });

  test("switching to Add Percent initializes percent + basis and drops cents", () => {
    const next = normalizePricingImpactForMode({ mode: "addCents", cents: 125 }, "addPercent");
    expect(next.mode).toBe("addPercent");
    expect(next.percent).toBe(0);
    expect(next.basis).toBe("base");
    expect(next.cents).toBeUndefined();
  });

  test("does not mutate the original impact", () => {
    const original = { mode: "addCents", cents: 125 };
    normalizePricingImpactForMode(original, "addPerUnit");
    expect(original).toEqual({ mode: "addCents", cents: 125 });
  });

  test("initializes the amount to 0 when there is nothing compatible to carry", () => {
    const next = normalizePricingImpactForMode({ mode: "addPercent", percent: 10 }, "addPerUnit");
    expect(next.centsPerUnit).toBe(0);
    expect(next.unit).toBe("perPiece");
  });

  test("switching to Formula initializes an editable blank formula and drops amount fields", () => {
    const next = normalizePricingImpactForMode({ mode: "addFlat", amountCents: 250 }, "addFormula");
    expect(next).toEqual({ mode: "addFormula", formula: "" });
  });
});

describe("normalizeLegacyPricingImpact", () => {
  test("legacy addFlatCents converts to canonical addFlat", () => {
    expect(normalizeLegacyPricingImpact({ mode: "addFlatCents", cents: 250 }, "addFlat")).toEqual({
      mode: "addFlat",
      amountCents: 250,
    });
  });

  test("legacy addPerQtyCents converts to canonical addPerQty", () => {
    expect(normalizeLegacyPricingImpact({ mode: "addPerQtyCents", amountCents: 75 }, "addFlat")).toEqual({
      mode: "addPerQty",
      amountCents: 75,
    });
  });

  test("legacy addPerSqftCents converts to canonical addPerSqft", () => {
    expect(normalizeLegacyPricingImpact({ mode: "addPerSqftCents", cents: 25 }, "addFlat")).toEqual({
      mode: "addPerSqft",
      amountCents: 25,
    });
  });

  test("addPerUnit initializes missing amount and unit without NaN/undefined", () => {
    expect(normalizeLegacyPricingImpact({ mode: "addPerUnit" }, "addCents")).toEqual({
      mode: "addPerUnit",
      centsPerUnit: 0,
      unit: "perPiece",
    });
  });

  test("addFormula preserves non-empty formulas and initializes blank formulas", () => {
    expect(normalizeLegacyPricingImpact({ mode: "addFormula", formula: "custom_qty * 0.25 * q" }, "addFlat")).toEqual({
      mode: "addFormula",
      formula: "custom_qty * 0.25 * q",
    });
    expect(normalizeLegacyPricingImpact({ mode: "addFormula", formula: "" }, "addFlat")).toEqual({
      mode: "addFormula",
      formula: "0",
    });
  });

  test("addFormula can preserve a blank draft while the editor input is active", () => {
    expect(
      normalizeLegacyPricingImpact(
        { mode: "addFormula", formula: "" },
        "addFlat",
        { settleBlankFormula: false },
      ),
    ).toEqual({
      mode: "addFormula",
      formula: "",
    });
  });

  test("switching a rule to Formula creates an editable blank formula draft", () => {
    expect(normalizePricingImpactForMode({ mode: "addFlat", amountCents: 0 }, "addFormula")).toEqual({
      mode: "addFormula",
      formula: "",
    });
  });

  test("tree normalization can preserve blank formula drafts in the editor", () => {
    const { tree, changed } = normalizeTreePricingImpacts(
      {
        nodes: {
          custom: { id: "custom", pricingImpact: [{ mode: "addFormula", formula: "" }] },
        },
      },
      { settleBlankFormula: false },
    );

    expect(changed).toBe(false);
    expect(tree.nodes.custom.pricingImpact).toEqual([{ mode: "addFormula", formula: "" }]);
  });

  test("tree normalization repairs node and choice pricing impacts", () => {
    const { tree, changed } = normalizeTreePricingImpacts({
      nodes: {
        custom: { id: "custom", pricingImpact: [{ mode: "addFlatCents", cents: 100 }] },
        grommets: {
          id: "grommets",
          choices: [{ value: "corners", pricingImpact: [{ mode: "addPerUnit" }] }],
        },
      },
    });
    expect(changed).toBe(true);
    expect(tree.nodes.custom.pricingImpact[0]).toEqual({ mode: "addFlat", amountCents: 100 });
    expect(tree.nodes.grommets.choices[0].pricingImpact[0]).toEqual({
      mode: "addPerUnit",
      centsPerUnit: 0,
      unit: "perPiece",
    });
  });
});

describe("normalizeFormulaInputDraft", () => {
  test("strips the stale no-op zero when typing a formula identifier", () => {
    expect(normalizeFormulaInputDraft("0", "0custom_grommet_quantity * 0.25 * q")).toBe(
      "custom_grommet_quantity * 0.25 * q",
    );
  });

  test("keeps numeric formulas that intentionally start with zero", () => {
    expect(normalizeFormulaInputDraft("0", "0.25 * q")).toBe("0.25 * q");
    expect(normalizeFormulaInputDraft("0", "01 * q")).toBe("01 * q");
  });
});

describe("getPricingImpactWarnings", () => {
  test("a complete Add Amount impact has no warnings", () => {
    expect(getPricingImpactWarnings({ mode: "addCents", cents: 125 })).toEqual({});
  });

  test("a complete Per Unit impact (amount + unit) has no warnings", () => {
    const warnings = getPricingImpactWarnings({
      mode: "addPerUnit",
      centsPerUnit: 125,
      unit: "perQty",
    });
    expect(hasPricingImpactWarnings(warnings)).toBe(false);
  });

  test("flags a missing amount", () => {
    expect(getPricingImpactWarnings({ mode: "addCents", cents: null }).amount).toBe(
      "Enter an amount.",
    );
    expect(getPricingImpactWarnings({ mode: "addCents" }).amount).toBe("Enter an amount.");
  });

  test("Per Unit flags missing amount and missing unit independently", () => {
    const warnings = getPricingImpactWarnings({ mode: "addPerUnit", centsPerUnit: null });
    expect(warnings.amount).toBe("Enter an amount.");
    expect(warnings.unit).toBe("Choose a unit.");
  });

  test("flags an unrecognized pricing type", () => {
    expect(getPricingImpactWarnings({ mode: "bogus" }).type).toBe("Choose a valid pricing type.");
    expect(getPricingImpactWarnings({}).type).toBe("Choose a valid pricing type.");
  });

  test("0 is a valid amount, not an incomplete one", () => {
    expect(getPricingImpactWarnings({ mode: "addCents", cents: 0 })).toEqual({});
  });
});

describe("canonicalAmountField", () => {
  test("maps each mode to its stored cents field", () => {
    expect(canonicalAmountField("addCents")).toBe("cents");
    expect(canonicalAmountField("addFlat")).toBe("amountCents");
    expect(canonicalAmountField("addPerUnit")).toBe("centsPerUnit");
    expect(canonicalAmountField("addPercent")).toBeNull();
  });
});
