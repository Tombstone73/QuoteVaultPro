import { describe, expect, test } from "@jest/globals";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter";
import { explainPricingResult } from "../../src/modules/pricing/operatorPricingExplanation";
import { resolveActivePbv2PricingInput } from "../../src/modules/products/pbv2CompatibilityResolution";
import { brandedId, currencyCode, decimalText, type OrganizationId } from "../../src/modules/shared/commercialValues";
import type { ResolvedPricingInput, SellableProductConfiguration } from "../../src/modules/products/contracts";

const organizationId = brandedId<"OrganizationId">("rotation-option-org") as OrganizationId;
const productId = brandedId<"ProductId">("rotation-option-product");
const product: SellableProductConfiguration = {
  organizationId,
  productId,
  displayName: "Generic flat product",
  lifecycle: "active",
  pricingConfiguration: { id: brandedId<"PricingConfigurationId">("rotation-option-version"), version: "2026-08-22T00:00:00.000Z", contentHash: "sha256:rotation-option" },
  requiresDimensions: true,
  pricingCurrency: currencyCode("USD"),
};

const formula = {
  id: "sheet-formula",
  code: "SHEET",
  profileKey: "sheet",
  expression: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price",
  config: { variables: { sheet_width: 48, sheet_length: 96, usable_drop_min: 0, billable_length_increment: 1, minimum_billable_sqft: 32 } },
  updatedAt: "2026-08-22T00:00:00.000Z",
};

const treeFor = (input: Readonly<{ allowRotation: boolean; rotationControl?: { optionId: string; allowWhenChoiceValues: string[] } }>) => ({
  schemaVersion: 2 as const,
  rootNodeIds: ["flute-direction", "thickness"],
  nodes: {
    "flute-direction": {
      id: "flute-direction",
      kind: "question" as const,
      label: "Flute direction matters?",
      input: { type: "select" as const, selectionKey: "flute_direction", required: true, defaultValue: "yes" },
      choices: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
    },
    thickness: {
      id: "thickness",
      kind: "question" as const,
      label: "Thickness",
      input: { type: "select" as const, selectionKey: "thickness", required: true, defaultValue: "4mm" },
      choices: [{ value: "4mm", label: "4mm" }],
    },
  },
  meta: {
    pricingV2: {
      allowRotation: input.allowRotation,
      ...(input.rotationControl ? { rotationControl: input.rotationControl } : {}),
      tierBasis: "computed_sheet_usage" as const,
      base: { perSqftCents: 137.5 },
    },
    pricingMatrix: {
      id: "thickness-rate",
      dimensions: ["thickness"],
      rows: [{
        id: "4mm-sheet-rate",
        when: { thickness: "4mm" },
        variables: { base_price: 0 },
        tierBasis: "computed_sheet_usage" as const,
        qtyTiers: [{ id: "computed-sheet-tier", minQty: 1, perSqftCents: 137.5 }],
      }],
    },
  },
});

const resolve = (input: Readonly<{
  width: number;
  height: number;
  fluteDirection: "yes" | "no";
  allowRotation?: boolean;
  /** null deliberately models an older ProductVersion with no option control. */
  rotationControl?: { optionId: string; allowWhenChoiceValues: string[] } | null;
}>) => resolveActivePbv2PricingInput(product, {
  id: "rotation-option-version",
  schemaVersion: 2,
  publishedAt: "2026-08-22T00:00:00.000Z",
  treeJson: treeFor({
    allowRotation: input.allowRotation ?? true,
    ...(input.rotationControl === undefined ? { rotationControl: { optionId: "flute-direction", allowWhenChoiceValues: ["no"] } } : input.rotationControl === null ? {} : { rotationControl: input.rotationControl }),
  }),
  productMeasurementMode: "dimensions_required",
  productPricingProfileKey: "sheet",
  formula,
}, {
  organizationId,
  productId,
  quantity: 5,
  dimensions: { width: decimalText(String(input.width)), height: decimalText(String(input.height)), unit: "in" },
  selections: { flute_direction: input.fluteDirection, thickness: "4mm" },
});

const calculate = (resolved: ResolvedPricingInput) => new V2PricingParityAdapter().calculate({
  organizationId,
  sellableProduct: { ...resolved.sellableProduct, pricingConfiguration: { ...resolved.sellableProduct.pricingConfiguration, contentHash: resolved.resolvedConfiguration.pricingConfigurationContentHash } },
  resolvedConfiguration: resolved.resolvedConfiguration,
  rules: resolved.rules,
  nestingEstimate: resolved.nestingEstimate,
  pricingContext: { channel: "staff", effectiveAt: "2026-08-22T00:00:00.000Z" },
});

describe("ProductVersion option-controlled rotation", () => {
  test.each([
    [24, 36, "yes", false, 2, 64, 8800],
    [24, 36, "no", true, 1, 32, 4400],
    [36, 24, "yes", false, 2, 64, 8800],
    [36, 24, "no", true, 1, 32, 4400],
  ] as const)("%ix%i qty 5 with flute direction %s resolves rotation=%s", async (width, height, fluteDirection, expectedRotation, expectedSheets, expectedBillableSqft, expectedCents) => {
    const resolved = resolve({ width, height, fluteDirection });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    // The configured node identity resolves through its selectionKey; labels never
    // participate in this commercial decision.
    expect(resolved.resolvedConfiguration.selections).toMatchObject({ flute_direction: fluteDirection, thickness: "4mm" });
    expect(resolved.resolvedConfiguration.derivedFacts).toMatchObject({
      productAllowsRotation: true,
      optionAllowsRotation: expectedRotation,
      effectiveRotation: expectedRotation,
      rotationControlOptionId: "flute-direction",
      rotationControlSelectionKey: "flute_direction",
      rotationControlSelectedChoiceValues: [fluteDirection],
      rotationControlAllowWhenChoiceValues: ["no"],
    });
    expect(resolved.nestingEstimate?.facts).toMatchObject({
      allowRotation: expectedRotation,
      productAllowsRotation: true,
      optionAllowsRotation: expectedRotation,
      effectiveRotation: expectedRotation,
      totalSheetCount: expectedSheets,
      billedSheetSqft: expectedBillableSqft,
    });

    const priced = await calculate(resolved);
    expect(priced.matrix).toMatchObject({ matrixId: "thickness-rate", rowId: "4mm-sheet-rate" });
    expect(priced.tier).toMatchObject({ source: "computed_sheet", selectedTierId: "computed-sheet-tier", basisValue: decimalText(String(expectedSheets)) });
    expect(priced.calculatedLineAmount.cents).toBe(expectedCents);
    expect(explainPricingResult(priced).computedSheetUsage).toMatchObject({
      productAllowsRotation: true,
      optionAllowsRotation: expectedRotation,
      effectiveRotation: expectedRotation,
      rotationControl: {
        optionId: "flute-direction",
        selectionKey: "flute_direction",
        selectedChoiceValues: [fluteDirection],
        allowWhenChoiceValues: ["no"],
      },
    });
  });

  test("ProductVersion allowRotation=false remains a hard ceiling even when the selected choice would otherwise allow it", () => {
    const resolved = resolve({ width: 24, height: 36, fluteDirection: "no", allowRotation: false });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.nestingEstimate?.facts).toMatchObject({ allowRotation: false, totalSheetCount: 2, billedSheetSqft: 64 });
  });

  test("existing ProductVersions without a rotation-control option retain their ProductVersion rotation policy", () => {
    const on = resolve({ width: 24, height: 36, fluteDirection: "yes", allowRotation: true, rotationControl: null });
    const off = resolve({ width: 24, height: 36, fluteDirection: "no", allowRotation: false, rotationControl: null });
    expect(on.ok).toBe(true);
    expect(off.ok).toBe(true);
    if (!on.ok || !off.ok) return;
    expect(on.nestingEstimate?.facts).toMatchObject({ allowRotation: true, totalSheetCount: 1 });
    expect(off.nestingEstimate?.facts).toMatchObject({ allowRotation: false, totalSheetCount: 2 });
  });

  test("a stale rotation-control identity fails closed rather than falling back to labels or a product heuristic", () => {
    const resolved = resolve({
      width: 24,
      height: 36,
      fluteDirection: "no",
      rotationControl: { optionId: "deleted-option", allowWhenChoiceValues: ["no"] },
    });
    expect(resolved).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });
});
