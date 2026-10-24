import { describe, expect, test } from "@jest/globals";
import type { OptionTreeV2 } from "@shared/optionTreeV2";
import { COROPLAST_FLUTE_KEY, COROPLAST_PRINT_MODE_KEY, isUnprintedCoroplast, isUnprintedCoroplastOrderSnapshot, withBlankCoroplastPricing } from "@shared/blankCoroplast";
import { evaluatePricingPreviewFromTree } from "../PricingService";
import { COROPLAST_4X8_FORMULA, COROPLAST_4X8_FORMULA_CONFIG, makeCoroplastGoldenTree } from "./fixtures/pbv2GoldenPricing.fixtures";
import { createPbv2BannerProductTreeJson } from "@shared/pbv2/starterTree";
import { validateCanonicalProductPublishTarget } from "../../products/canonicalProductPublishOperations";
import { decodeSelections, projectStorefrontOptions } from "../../portalStorefront.service";
import { validateCanonicalPbv2OptionConfigurationTree } from "../../products/canonicalPbv2OptionConfigurationOperations";
import { resolveInitialProductionRoute } from "../../productionRoutingResolver";

function tree() {
  return withBlankCoroplastPricing(makeCoroplastGoldenTree({ allowRotationDefault: true }) as OptionTreeV2, {
    unit: "per_square_foot", rateCents: 200, minimumChargeCents: 2500,
    quantityTiers: [{ minQuantity: 1, rateCents: 200 }, { minQuantity: 10, rateCents: 150 }],
  });
}

function preview(mode: "printed" | "unprinted", quantity: number, widthIn = 12, heightIn = 12) {
  return evaluatePricingPreviewFromTree({ treeJson: tree(), quantity, widthIn, heightIn,
    pbv2ExplicitSelections: { rate: "standard", [COROPLAST_PRINT_MODE_KEY]: mode, [COROPLAST_FLUTE_KEY]: "vertical" },
    formulaSourceMode: "library", pricingFormulaLibrary: { id: "golden", expression: COROPLAST_4X8_FORMULA, config: COROPLAST_4X8_FORMULA_CONFIG },
  });
}

describe("unprinted Coroplast canonical pricing", () => {
  test("saved blank selection retains Flatbed cutting intake without printed prepress", async () => {
    const snapshot = { treeJson: tree(), selections: { [COROPLAST_PRINT_MODE_KEY]: "unprinted" } };
    expect(isUnprintedCoroplastOrderSnapshot(snapshot)).toBe(true);
    expect(isUnprintedCoroplastOrderSnapshot({ ...snapshot, selections: { [COROPLAST_PRINT_MODE_KEY]: "printed" } })).toBe(false);
    expect(await resolveInitialProductionRoute({ organizationId: "not-needed-for-blank-route", productTypeId: "printed-flatbed-type",
      lineItemRequiresPrepressSnapshot: true, lineItemIsUnprintedCoroplast: isUnprintedCoroplastOrderSnapshot(snapshot) }))
      .toEqual({ stationKey: "flatbed", stepKey: "queued", reason: "unprinted_coroplast_flatbed" });
  });
  test("existing printed mode keeps its sheet-yield formula and blank mode uses its own minimum", () => {
    expect(preview("printed", 1).totalPrice).toBeGreaterThan(25);
    expect(preview("unprinted", 1).totalPrice).toBe(25);
    expect(isUnprintedCoroplast(tree(), { [COROPLAST_PRINT_MODE_KEY]: "unprinted" })).toBe(true);
  });

  test("blank quantity tiers and piece pricing select one rate without print cost", () => {
    expect(preview("unprinted", 10, 24, 18).totalPrice).toBe(45);
    const perPiece = withBlankCoroplastPricing(tree(), { unit: "per_piece", rateCents: 350, minimumChargeCents: 1500 });
    const result = evaluatePricingPreviewFromTree({ treeJson: perPiece, quantity: 10, widthIn: 24, heightIn: 18,
      pbv2ExplicitSelections: { rate: "standard", [COROPLAST_PRINT_MODE_KEY]: "unprinted", [COROPLAST_FLUTE_KEY]: "horizontal" },
      formulaSourceMode: "library", pricingFormulaLibrary: { id: "golden", expression: COROPLAST_4X8_FORMULA, config: COROPLAST_4X8_FORMULA_CONFIG } });
    expect(result.totalPrice).toBe(35);
  });

  test("adding blank mode is deterministic and retains printed defaults", () => {
    const once = tree();
    const twice = withBlankCoroplastPricing(once, once.meta!.blankCoroplastPricing!);
    expect(twice.rootNodeIds).toEqual(once.rootNodeIds);
    expect(twice.nodes["coroplast-print-mode"].input?.defaultValue).toBe("printed");
    expect(twice.nodes["coroplast-flute-direction"].choices?.map((choice) => choice.value)).toEqual(["vertical", "horizontal"]);
  });

  test("blank mode excludes print-only charges while retaining selected cutting", () => {
    const configured = tree();
    configured.rootNodeIds.push("ink", "cutting");
    configured.nodes.ink = { id: "ink", kind: "question", label: "Ink", input: { type: "select", selectionKey: "ink" },
      choices: [{ value: "color", label: "Color", pricingImpact: [{ mode: "addCents", cents: 1000 }] }] };
    configured.nodes.cutting = { id: "cutting", kind: "question", label: "Cutting", input: { type: "select", selectionKey: "cutting" },
      choices: [{ value: "square", label: "Square cut", pricingImpact: [{ mode: "addCents", cents: 500 }] }] };
    const blank = withBlankCoroplastPricing(configured, configured.meta!.blankCoroplastPricing!);
    const result = evaluatePricingPreviewFromTree({ treeJson: blank, widthIn: 12, heightIn: 12, quantity: 1,
      pbv2ExplicitSelections: { rate: "standard", ink: "color", cutting: "square",
        [COROPLAST_PRINT_MODE_KEY]: "unprinted", [COROPLAST_FLUTE_KEY]: "vertical" },
      formulaSourceMode: "library", pricingFormulaLibrary: { id: "golden", expression: COROPLAST_4X8_FORMULA, config: COROPLAST_4X8_FORMULA_CONFIG } });
    expect(result.totalPrice).toBe(30);
  });

  test("blank dimensions retain the configured 48 by 96 sheet fit rule", () => {
    expect(() => preview("unprinted", 1, 120, 120)).toThrow(/do not fit the configured sheet/i);
  });

  test("blank price preview does not depend on a printed formula library", () => {
    const result = evaluatePricingPreviewFromTree({ treeJson: tree(), quantity: 1, widthIn: 12, heightIn: 12,
      pbv2ExplicitSelections: { [COROPLAST_PRINT_MODE_KEY]: "unprinted", [COROPLAST_FLUTE_KEY]: "vertical" },
    });
    expect(result.totalPrice).toBe(25);
    expect(projectStorefrontOptions(tree(), { [COROPLAST_PRINT_MODE_KEY]: "unprinted" }).options.map((option) => option.label))
      .not.toContain("Rate");
  });

  test("Product Editor publish validation accepts the added mode and pricing", () => {
    const treeJson = withBlankCoroplastPricing(createPbv2BannerProductTreeJson() as OptionTreeV2,
      { unit: "per_square_foot", rateCents: 200, minimumChargeCents: 2500 });
    const target = { product: { id: "product_test", organizationId: "org_test", name: "4mm Coroplast",
      isActive: true, primaryMaterialId: null, pbv2ActiveTreeVersionId: "tree_test", updatedAt: new Date(),
      pricingEngine: "pricingProfile" as const, pricingFormulaId: null },
      tree: { id: "tree_test", organizationId: "org_test", productId: "product_test", status: "DRAFT" as const,
        schemaVersion: 2, treeJson, publishedAt: null, updatedAt: new Date() }, materials: [], pricingFormula: null };
    const validation = validateCanonicalProductPublishTarget(target);
    expect(validation.errors).toEqual([]);
    expect(validateCanonicalPbv2OptionConfigurationTree(treeJson, true)).toEqual([]);
  });

  test("customer option projection exposes mode and flute, and drops stale print-only input", () => {
    const configured = tree();
    configured.rootNodeIds.push("ink");
    configured.nodes.ink = { id: "ink", kind: "question", label: "Ink", input: { type: "select", valueType: "ENUM", selectionKey: "ink" },
      choices: [{ value: "color", label: "Color" }] };
    const published = withBlankCoroplastPricing(configured, configured.meta!.blankCoroplastPricing!);
    const printed = projectStorefrontOptions(published, { [COROPLAST_PRINT_MODE_KEY]: "printed" });
    const modeKey = printed.options.find((option) => option.label === "Print Mode")?.key;
    const inkKey = printed.options.find((option) => option.label === "Ink")?.key;
    expect(modeKey).toBeDefined();
    expect(inkKey).toBeDefined();
    expect(printed.options.map((option) => option.label)).not.toContain("Flute Direction");
    const blank = projectStorefrontOptions(published, { [COROPLAST_PRINT_MODE_KEY]: "unprinted", [COROPLAST_FLUTE_KEY]: "vertical", ink: "color" });
    const fluteKey = blank.options.find((option) => option.label === "Flute Direction")?.key;
    expect(fluteKey).toBeDefined();
    expect(blank.options.map((option) => option.label)).not.toContain("Ink");
    expect(decodeSelections(published, { [modeKey!]: "unprinted", [fluteKey!]: "vertical", [inkKey!]: "color" })).not.toHaveProperty("ink");
  });
});
