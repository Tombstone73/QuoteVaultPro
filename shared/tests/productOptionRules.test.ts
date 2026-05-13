import { describe, expect, test } from "@jest/globals";
import { evaluateProductOptionRules, type ProductOptionRule } from "../productOptionRules";

const bannerRules: ProductOptionRule[] = [
  {
    id: "rule_pole_pockets",
    when: {
      all: [
        {
          optionGroup: "finishing",
          operator: "equals",
          value: "pole_pockets",
        },
      ],
    },
    then: [
      { action: "hide", targetOptionGroup: "welded_hems" },
      { action: "clear", targetOptionGroup: "welded_hems" },
      { action: "show", targetOptionGroup: "pole_pocket_size" },
      { action: "require", targetOptionGroup: "pole_pocket_size" },
    ],
    else: [
      { action: "show", targetOptionGroup: "welded_hems" },
      { action: "hide", targetOptionGroup: "pole_pocket_size" },
      { action: "optional", targetOptionGroup: "pole_pocket_size" },
      { action: "clear", targetOptionGroup: "pole_pocket_size" },
    ],
  },
  {
    id: "rule_welded_hems",
    when: {
      all: [
        {
          optionGroup: "finishing",
          operator: "equals",
          value: "welded_hems",
        },
      ],
    },
    then: [
      { action: "hide", targetOptionGroup: "pole_pocket_size" },
      { action: "clear", targetOptionGroup: "pole_pocket_size" },
    ],
  },
];

describe("product option rule evaluation", () => {
  test("pole pockets hides and clears welded hems, then requires pocket size", () => {
    const result = evaluateProductOptionRules({
      optionGroups: ["finishing", "welded_hems", "pole_pocket_size"],
      rules: bannerRules,
      selections: {
        finishing: { value: "pole_pockets" },
        welded_hems: { value: true },
      },
    });

    expect(result.effectiveSelections.finishing).toBe("pole_pockets");
    expect(result.effectiveSelections.welded_hems).toBeUndefined();
    expect(result.hiddenOptionGroups).toContain("welded_hems");
    expect(result.visibleOptionGroups).toContain("pole_pocket_size");
    expect(result.requiredOptionGroups).toContain("pole_pocket_size");
    expect(result.clearedOptionGroups).toContain("welded_hems");
    expect(result.isValidForPricing).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        optionGroup: "pole_pocket_size",
        code: "OPTION_RULE_REQUIRED_MISSING",
      }),
    ]);
  });

  test("welded hems hides and clears pole pocket size", () => {
    const result = evaluateProductOptionRules({
      optionGroups: ["finishing", "welded_hems", "pole_pocket_size"],
      rules: bannerRules,
      selections: {
        finishing: { value: "welded_hems" },
        pole_pocket_size: { value: "3in" },
      },
    });

    expect(result.effectiveSelections.finishing).toBe("welded_hems");
    expect(result.effectiveSelections.pole_pocket_size).toBeUndefined();
    expect(result.hiddenOptionGroups).toContain("pole_pocket_size");
    expect(result.requiredOptionGroups).not.toContain("pole_pocket_size");
    expect(result.clearedOptionGroups).toContain("pole_pocket_size");
    expect(result.isValidForPricing).toBe(true);
  });

  test("set_default runs after clearing and before required validation", () => {
    const result = evaluateProductOptionRules({
      optionGroups: ["finishing", "pole_pocket_size"],
      rules: [
        {
          id: "rule_default_pocket_size",
          when: {
            all: [{ optionGroup: "finishing", operator: "equals", value: "pole_pockets" }],
          },
          then: [
            { action: "show", targetOptionGroup: "pole_pocket_size" },
            { action: "set_default", targetOptionGroup: "pole_pocket_size", value: "3in" },
            { action: "require", targetOptionGroup: "pole_pocket_size" },
          ],
        },
      ],
      selections: {
        finishing: { value: "pole_pockets" },
      },
    });

    expect(result.effectiveSelections.pole_pocket_size).toBe("3in");
    expect(result.defaultedOptionGroups).toContain("pole_pocket_size");
    expect(result.errors).toHaveLength(0);
    expect(result.isValidForPricing).toBe(true);
  });

  test("disable runs before clearing, so disabled selections are removed before pricing", () => {
    const result = evaluateProductOptionRules({
      optionGroups: ["material", "sides"],
      rules: [
        {
          id: "rule_material_disables_double_sided",
          when: {
            all: [{ optionGroup: "material", operator: "in", value: ["mesh_banner", "economy_vinyl"] }],
          },
          then: [
            { action: "disable", targetOptionGroup: "sides" },
            { action: "clear", targetOptionGroup: "sides" },
          ],
        },
      ],
      selections: {
        material: { value: "mesh_banner" },
        sides: { value: "double_sided" },
      },
    });

    expect(result.disabledOptionGroups).toContain("sides");
    expect(result.effectiveSelections.sides).toBeUndefined();
    expect(result.clearedOptionGroups).toContain("sides");
    expect(result.isValidForPricing).toBe(true);
  });

  test("condition grouping supports any, not_exists, and not_in", () => {
    const result = evaluateProductOptionRules({
      optionGroups: ["finishing", "grommet_spacing"],
      rules: [
        {
          id: "rule_require_grommets",
          when: {
            any: [
              { optionGroup: "finishing", operator: "not_in", value: ["pole_pockets", "welded_hems"] },
              { optionGroup: "edge", operator: "not_exists" },
            ],
          },
          then: [{ action: "require", targetOptionGroup: "grommet_spacing" }],
        },
      ],
      selections: {
        finishing: { value: "raw_edge" },
      },
    });

    expect(result.requiredOptionGroups).toContain("grommet_spacing");
    expect(result.isValidForPricing).toBe(false);
  });
});
