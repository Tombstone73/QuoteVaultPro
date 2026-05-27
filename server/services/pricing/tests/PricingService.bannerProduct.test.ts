import { describe, expect, test } from "@jest/globals";

import { createPbv2BannerProductTreeJson } from "../../../../shared/pbv2/starterTree";
import { resolveRuntimeVisibility } from "../../../../shared/optionTreeV2Runtime";
import {
  evaluatePricingPreviewFromTree,
  type Pbv2OptionRuleValidationError,
} from "../PricingService";

function bannerTree() {
  return createPbv2BannerProductTreeJson();
}

function validBaseSelections() {
  return {
    banner_weight: { value: "13oz" },
    print_side: { value: "single_sided" },
    hems: { value: "none" },
    pole_pockets: { value: "no" },
    grommets: { value: "no" },
  };
}

function preview(selections: Record<string, any>, tree = bannerTree()) {
  return evaluatePricingPreviewFromTree({
    treeJson: tree,
    widthIn: 36,
    heightIn: 42,
    quantity: 1,
    pbv2ExplicitSelections: selections,
    debug: true,
  });
}

function expectOptionRuleError(fn: () => unknown): Pbv2OptionRuleValidationError {
  try {
    fn();
  } catch (error: any) {
    expect(error.code).toBe("PBV2_OPTION_RULE_VALIDATION_FAILED");
    return error as Pbv2OptionRuleValidationError;
  }
  throw new Error("Expected PBV2 option rule validation error");
}

describe("PBV2 Banner product configuration", () => {
  test("13oz hides Double Sided", () => {
    const result = resolveRuntimeVisibility(bannerTree() as any, {
      selected: {
        banner_weight: { value: "13oz" },
      },
    });

    expect(result.visibleChoiceIds).toContain("print_side:single_sided");
    expect(result.visibleChoiceIds).not.toContain("print_side:double_sided");
  });

  test("18oz allows Double Sided", () => {
    const result = resolveRuntimeVisibility(bannerTree() as any, {
      selected: {
        banner_weight: { value: "18oz" },
      },
    });

    expect(result.visibleChoiceIds).toContain("print_side:double_sided");
  });

  test("switching from 18oz Double Sided to 13oz clears or blocks Double Sided before pricing", () => {
    const tree = bannerTree();
    const runtime = resolveRuntimeVisibility(tree as any, {
      selected: {
        ...validBaseSelections(),
        banner_weight: { value: "13oz" },
        print_side: { value: "double_sided" },
      },
    });

    expect(runtime.effectiveSelections.print_side).toBeUndefined();

    const error = expectOptionRuleError(() =>
      preview({
        ...validBaseSelections(),
        banner_weight: { value: "13oz" },
        print_side: { value: "double_sided" },
      }, tree)
    );

    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          optionGroup: "print_side",
          code: "PBV2_OPTION_SELECTION_NOT_VISIBLE",
        }),
      ])
    );
  });

  test("Pole Pockets = No hides and rejects stale depth, location, and custom depth", () => {
    const tree = bannerTree();
    const selections = {
      ...validBaseSelections(),
      pole_pocket_location: { value: "top_bottom" },
      pole_pocket_depth: { value: "custom" },
      custom_pole_pocket_depth: { value: "5 inch" },
    };
    const runtime = resolveRuntimeVisibility(tree as any, { selected: selections });

    expect(runtime.visibleNodeIds).not.toContain("pole_pocket_location");
    expect(runtime.visibleNodeIds).not.toContain("pole_pocket_depth");
    expect(runtime.visibleNodeIds).not.toContain("custom_pole_pocket_depth");
    expect(runtime.effectiveSelections.pole_pocket_location).toBeUndefined();
    expect(runtime.effectiveSelections.pole_pocket_depth).toBeUndefined();
    expect(runtime.effectiveSelections.custom_pole_pocket_depth).toBeUndefined();

    const error = expectOptionRuleError(() => preview(selections, tree));
    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ optionGroup: "pole_pocket_depth" }),
        expect.objectContaining({ optionGroup: "custom_pole_pocket_depth" }),
      ])
    );
  });

  test("Pole Pockets = Yes requires location and depth", () => {
    const error = expectOptionRuleError(() =>
      preview({
        ...validBaseSelections(),
        pole_pockets: { value: "yes" },
      })
    );

    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          optionGroup: "pole_pocket_location",
          code: "OPTION_RULE_REQUIRED_MISSING",
        }),
        expect.objectContaining({
          optionGroup: "pole_pocket_depth",
          code: "OPTION_RULE_REQUIRED_MISSING",
        }),
      ])
    );
  });

  test("Depth = Custom requires custom depth text", () => {
    const error = expectOptionRuleError(() =>
      preview({
        ...validBaseSelections(),
        pole_pockets: { value: "yes" },
        pole_pocket_location: { value: "top" },
        pole_pocket_depth: { value: "custom" },
        custom_pole_pocket_depth: { value: "" },
      })
    );

    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          optionGroup: "custom_pole_pocket_depth",
          code: "OPTION_RULE_REQUIRED_MISSING",
        }),
      ])
    );
  });

  test("Grommets = No hides and rejects stale placement and custom count", () => {
    const tree = bannerTree();
    const selections = {
      ...validBaseSelections(),
      grommet_placement: { value: "custom" },
      custom_grommet_count: { value: 8 },
    };
    const runtime = resolveRuntimeVisibility(tree as any, { selected: selections });

    expect(runtime.visibleNodeIds).not.toContain("grommet_placement");
    expect(runtime.visibleNodeIds).not.toContain("custom_grommet_count");
    expect(runtime.effectiveSelections.grommet_placement).toBeUndefined();
    expect(runtime.effectiveSelections.custom_grommet_count).toBeUndefined();

    const error = expectOptionRuleError(() => preview(selections, tree));
    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ optionGroup: "grommet_placement" }),
        expect.objectContaining({ optionGroup: "custom_grommet_count" }),
      ])
    );
  });

  test("Grommets = Yes requires placement", () => {
    const error = expectOptionRuleError(() =>
      preview({
        ...validBaseSelections(),
        grommets: { value: "yes" },
      })
    );

    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          optionGroup: "grommet_placement",
          code: "OPTION_RULE_REQUIRED_MISSING",
        }),
      ])
    );
  });

  test("Placement = Custom requires custom grommet count", () => {
    const error = expectOptionRuleError(() =>
      preview({
        ...validBaseSelections(),
        grommets: { value: "yes" },
        grommet_placement: { value: "custom" },
        custom_grommet_count: { value: "" },
      })
    );

    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          optionGroup: "custom_grommet_count",
          code: "OPTION_RULE_REQUIRED_MISSING",
        }),
      ])
    );
  });

  test("published-style pricing uses banner rates and pole pocket linear footage", () => {
    const base13 = preview(validBaseSelections());
    expect(base13.totalPrice).toBeCloseTo(13.13, 2);

    const ds18 = preview({
      ...validBaseSelections(),
      banner_weight: { value: "18oz" },
      print_side: { value: "double_sided" },
    });
    expect(ds18.totalPrice).toBe(42);

    const withPolePockets = preview({
      ...validBaseSelections(),
      pole_pockets: { value: "yes" },
      pole_pocket_location: { value: "top_bottom" },
      pole_pocket_depth: { value: "3in" },
    });
    expect(withPolePockets.breakdown.optionsPrice).toBe(6);
    expect(withPolePockets.totalPrice).toBeCloseTo(19.13, 2);
  });

  test("invalid hidden stale values cannot produce a priced quote/order snapshot", () => {
    const error = expectOptionRuleError(() =>
      preview({
        ...validBaseSelections(),
        banner_weight: { value: "13oz" },
        print_side: { value: "double_sided" },
        pole_pockets: { value: "no" },
        pole_pocket_depth: { value: "4in" },
        grommets: { value: "no" },
        grommet_placement: { value: "corners_only" },
      })
    );

    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ optionGroup: "print_side" }),
        expect.objectContaining({ optionGroup: "pole_pocket_depth" }),
        expect.objectContaining({ optionGroup: "grommet_placement" }),
      ])
    );
  });
});
