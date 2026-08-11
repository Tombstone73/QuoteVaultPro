import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "./validator";

/**
 * Smallest PBV2 tree JSON that passes validateTreeForPublish with DEFAULT_VALIDATE_OPTS.
 * Derived from shared/pbv2/tests/validator/validatePublish.test.ts.
 */
export function createPbv2StarterTreeJson(): Record<string, unknown> {
  const tree: Record<string, unknown> = {
    status: "DRAFT",
    rootNodeIds: ["root"],
    nodes: [
      {
        id: "root",
        type: "INPUT",
        status: "ENABLED",
        key: "root",
        input: { selectionKey: "root", valueType: "BOOLEAN" },
      },
    ],
    edges: [],
    meta: { baseWeightOz: 1 },
  };

  // Guardrail: ensure this template stays publish-valid as validator evolves.
  const res = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
  if (res.errors.length > 0 || res.warnings.length > 0) {
    const summary = {
      errors: res.errors.map((f) => ({ code: f.code, path: f.path })),
      warnings: res.warnings.map((f) => ({ code: f.code, path: f.path })),
    };
    throw new Error(`PBV2 starter tree is no longer publish-valid: ${JSON.stringify(summary)}`);
  }

  return tree;
}

/**
 * Publish-valid PBV2 template proving a banner finishing → grommets → placement + spacing path.
 * Kept intentionally minimal; callers can extend.
 */
export function createPbv2BannerGrommetsTreeJson(): Record<string, unknown> {
  const tree: Record<string, unknown> = {
    status: "DRAFT",
    rootNodeIds: ["finishing"],
    nodes: [
      {
        id: "finishing",
        type: "INPUT",
        status: "ENABLED",
        key: "finishing",
        input: {
          selectionKey: "finishing",
          valueType: "ENUM",
          constraints: {
            enum: {
              options: [{ value: "NONE" }, { value: "GROMMETS" }],
            },
          },
        },
      },
      {
        id: "grommetsPlacement",
        type: "INPUT",
        status: "ENABLED",
        key: "grommetsPlacement",
        input: {
          selectionKey: "grommetsPlacement",
          valueType: "ENUM",
          constraints: {
            enum: {
              options: [{ value: "CORNERS" }, { value: "TOP_BOTTOM" }, { value: "ALL_AROUND" }],
            },
          },
        },
      },
      {
        id: "grommetsSpacingIn",
        type: "INPUT",
        status: "ENABLED",
        key: "grommetsSpacingIn",
        input: {
          selectionKey: "grommetsSpacingIn",
          valueType: "NUMBER",
          constraints: {
            number: { min: 0, max: 240, step: 0.5 },
          },
        },
      },
    ],
    edges: [
      {
        id: "e_finishing_to_grommetsPlacement",
        status: "ENABLED",
        fromNodeId: "finishing",
        toNodeId: "grommetsPlacement",
        priority: 0,
        condition: {
          op: "EQ",
          left: { op: "ref", ref: { kind: "selectionRef", selectionKey: "finishing" } },
          right: { op: "literal", value: "GROMMETS" },
        },
      },
      {
        id: "e_grommetsPlacement_to_grommetsSpacingIn",
        status: "ENABLED",
        fromNodeId: "grommetsPlacement",
        toNodeId: "grommetsSpacingIn",
        priority: 0,
        // ConditionRule is required by validator; use always-true.
        condition: { op: "EXISTS", value: { op: "literal", value: true } },
      },
    ],
    meta: { baseWeightOz: 1 },
  };

  const res = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
  if (res.errors.length > 0 || res.warnings.length > 0) {
    const summary = {
      errors: res.errors.map((f) => ({ code: f.code, path: f.path })),
      warnings: res.warnings.map((f) => ({ code: f.code, path: f.path })),
    };
    throw new Error(`PBV2 banner grommets template is no longer publish-valid: ${JSON.stringify(summary)}`);
  }

  return tree;
}

/**
 * Publish-valid PBV2 tree proving option-attached COMPUTE + PRICE behavior for banner grommets.
 *
 * Numeric proof target (with widthIn=24, heightIn=48):
 * - spacing=24 => total=6, overage=0, addOnCents=0
 * - spacing=12 => total=10, overage=4, addOnCents=100 (unitPrice=25 cents)
 * - grommetsEnabled=false => addOnCents=0
 */
export function createPbv2BannerGrommetsPricingTreeJson(): Record<string, unknown> {
  const tree: Record<string, unknown> = {
    status: "DRAFT",
    rootNodeIds: ["grommetsEnabled"],
    nodes: [
      {
        id: "grommetsEnabled",
        type: "INPUT",
        status: "ENABLED",
        key: "finishing.grommets.enabled",
        input: { selectionKey: "grommetsEnabled", valueType: "BOOLEAN", defaultValue: true },
      },
      {
        id: "grommetSpacingIn",
        type: "INPUT",
        status: "ENABLED",
        key: "finishing.grommets.spacingIn",
        input: {
          selectionKey: "grommetSpacingIn",
          valueType: "NUMBER",
          defaultValue: 24,
          constraints: { number: { min: 6, max: 48, step: 0.5 } },
        },
      },
      {
        id: "compute_standardCount",
        type: "COMPUTE",
        status: "ENABLED",
        key: "finishing.grommets.standardCount",
        compute: {
          outputs: { standardCount: { type: "NUMBER" } },
          expression: {
            op: "if",
            cond: {
              op: "eq",
              left: { op: "ref", ref: { kind: "effectiveRef", selectionKey: "grommetsEnabled" } },
              right: { op: "literal", value: true },
            },
            then: {
              // standardCount = 4 + 2*max(0, ceil(heightIn/24) - 1)
              op: "add",
              left: { op: "literal", value: 4 },
              right: {
                op: "mul",
                left: { op: "literal", value: 2 },
                right: {
                  op: "max",
                  left: { op: "literal", value: 0 },
                  right: {
                    op: "sub",
                    left: {
                      op: "ceil",
                      x: {
                        op: "div",
                        left: { op: "ref", ref: { kind: "envRef", envKey: "heightIn" } },
                        right: {
                          op: "clamp",
                          x: { op: "literal", value: 24 },
                          lo: { op: "literal", value: 1 },
                          hi: { op: "literal", value: 1000000 },
                        },
                      },
                    },
                    right: { op: "literal", value: 1 },
                  },
                },
              },
            },
            else: { op: "literal", value: 0 },
          },
        },
      },
      {
        id: "compute_totalCount",
        type: "COMPUTE",
        status: "ENABLED",
        key: "finishing.grommets.totalCount",
        compute: {
          outputs: { totalCount: { type: "NUMBER" } },
          expression: {
            op: "if",
            cond: {
              op: "eq",
              left: { op: "ref", ref: { kind: "effectiveRef", selectionKey: "grommetsEnabled" } },
              right: { op: "literal", value: true },
            },
            then: {
              // totalCount = 4 + 2*max(0, ceil(heightIn/max(1, grommetSpacingIn)) - 1)
              op: "add",
              left: { op: "literal", value: 4 },
              right: {
                op: "mul",
                left: { op: "literal", value: 2 },
                right: {
                  op: "max",
                  left: { op: "literal", value: 0 },
                  right: {
                    op: "sub",
                    left: {
                      op: "ceil",
                      x: {
                        op: "div",
                        left: { op: "ref", ref: { kind: "envRef", envKey: "heightIn" } },
                        right: {
                          op: "clamp",
                          x: { op: "ref", ref: { kind: "effectiveRef", selectionKey: "grommetSpacingIn" } },
                          lo: { op: "literal", value: 1 },
                          hi: { op: "literal", value: 1000000 },
                        },
                      },
                    },
                    right: { op: "literal", value: 1 },
                  },
                },
              },
            },
            else: { op: "literal", value: 0 },
          },
        },
      },
      {
        id: "compute_overageCount",
        type: "COMPUTE",
        status: "ENABLED",
        key: "finishing.grommets.overageCount",
        compute: {
          outputs: { overageCount: { type: "NUMBER" } },
          expression: {
            // max(0, totalCount - standardCount)
            op: "max",
            left: { op: "literal", value: 0 },
            right: {
              op: "sub",
              left: { op: "ref", ref: { kind: "nodeOutputRef", nodeId: "compute_totalCount", outputKey: "totalCount" } },
              right: { op: "ref", ref: { kind: "nodeOutputRef", nodeId: "compute_standardCount", outputKey: "standardCount" } },
            },
          },
        },
      },
      {
        id: "price_grommets_overage",
        type: "PRICE",
        status: "ENABLED",
        key: "pricing.finishing.grommets.overage",
        price: {
          components: [
            {
              kind: "PER_UNIT",
              quantityRef: {
                op: "ref",
                ref: { kind: "nodeOutputRef", nodeId: "compute_overageCount", outputKey: "overageCount" },
              },
              unitPriceRef: { op: "literal", value: 25 },
              appliesWhen: {
                op: "EQ",
                left: { op: "ref", ref: { kind: "effectiveRef", selectionKey: "grommetsEnabled" } },
                right: { op: "literal", value: true },
              },
            },
          ],
          materialEffects: [
            {
              skuRef: "GROMMET_STD",
              uom: "ea",
              qtyRef: { op: "ref", ref: { kind: "nodeOutputRef", nodeId: "compute_totalCount", outputKey: "totalCount" } },
            },
          ],
        },
      },
    ],
    edges: [
      {
        id: "e_enabled_to_spacing",
        status: "ENABLED",
        fromNodeId: "grommetsEnabled",
        toNodeId: "grommetSpacingIn",
        priority: 0,
        condition: {
          op: "EQ",
          left: { op: "ref", ref: { kind: "effectiveRef", selectionKey: "grommetsEnabled" } },
          right: { op: "literal", value: true },
        },
      },
      {
        id: "e_spacing_to_standard",
        status: "ENABLED",
        fromNodeId: "grommetSpacingIn",
        toNodeId: "compute_standardCount",
        priority: 0,
        condition: { op: "EXISTS", value: { op: "literal", value: true } },
      },
      {
        id: "e_standard_to_total",
        status: "ENABLED",
        fromNodeId: "compute_standardCount",
        toNodeId: "compute_totalCount",
        priority: 0,
        condition: { op: "EXISTS", value: { op: "literal", value: true } },
      },
      {
        id: "e_total_to_overage",
        status: "ENABLED",
        fromNodeId: "compute_totalCount",
        toNodeId: "compute_overageCount",
        priority: 0,
        condition: { op: "EXISTS", value: { op: "literal", value: true } },
      },
      {
        id: "e_overage_to_price",
        status: "ENABLED",
        fromNodeId: "compute_overageCount",
        toNodeId: "price_grommets_overage",
        priority: 0,
        condition: { op: "EXISTS", value: { op: "literal", value: true } },
      },
    ],
    meta: { baseWeightOz: 1 },
  };

  const res = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
  if (res.errors.length > 0 || res.warnings.length > 0) {
    const summary = {
      errors: res.errors.map((f) => ({ code: f.code, path: f.path })),
      warnings: res.warnings.map((f) => ({ code: f.code, path: f.path })),
    };
    throw new Error(`PBV2 banner grommets pricing template is no longer publish-valid: ${JSON.stringify(summary)}`);
  }

  return tree;
}

/**
 * Publish-valid PBV2 Banner product configuration.
 *
 * This is the real banner option tree used for catalog seeding/imports:
 * - Weight and print side drive the base sqft rate.
 * - 13oz hides Double Sided so stale 13oz + double-sided selections are rejected.
 * - Pole pocket and grommet child options use generic visibility/rule validation.
 */
export function createPbv2BannerProductTreeJson(): Record<string, unknown> {
  const trueCondition = { op: "EXISTS", value: { op: "literal", value: true } };
  const visibleWhen = (selectionKey: string, value: string) => ({
    rules: [{ type: "equals", selectionKey, value }],
  });
  const visibleWhenAll = (rules: Array<Record<string, unknown>>) => ({ rules });
  const structuralEdge = (fromNodeId: string, toNodeId: string, index: number) => ({
    id: `edge_${fromNodeId}_${toNodeId}`,
    status: "DISABLED",
    fromNodeId,
    toNodeId,
    priority: index,
    condition: trueCondition,
  });

  const tree: Record<string, unknown> = {
    status: "DRAFT",
    schemaVersion: 2,
    rootNodeIds: [
      "banner_weight",
      "print_side",
      "hems",
      "pole_pockets",
      "pole_pocket_location",
      "pole_pocket_depth",
      "custom_pole_pocket_depth",
      "grommets",
      "grommet_placement",
      "custom_grommet_count",
      "custom_grommet_placement",
    ],
    nodes: {
      group_banner_media: {
        id: "group_banner_media",
        type: "GROUP",
        kind: "group",
        label: "Banner Media",
        displayOrder: 0,
        ui: { sortOrder: 0 },
        status: "ENABLED",
      },
      banner_weight: {
        id: "banner_weight",
        type: "INPUT",
        kind: "question",
        key: "banner.weight",
        label: "Banner Weight",
        displayOrder: 0,
        ui: { sortOrder: 0 },
        status: "ENABLED",
        input: {
          type: "select",
          valueType: "ENUM",
          selectionKey: "banner_weight",
          required: true,
        },
        choices: [
          {
            value: "13oz",
            label: "13oz",
            pricingOverride: {
              mode: "set_base_rate",
              amount: 125,
              unit: "perSqft",
              appliesTo: "area",
              label: "13oz banner",
            },
          },
          {
            value: "18oz",
            label: "18oz",
            pricingOverride: {
              mode: "set_base_rate",
              amount: 250,
              unit: "perSqft",
              appliesTo: "area",
              label: "18oz banner",
            },
          },
        ],
      },
      print_side: {
        id: "print_side",
        type: "INPUT",
        kind: "question",
        key: "banner.print_side",
        label: "Print Side",
        displayOrder: 1,
        ui: { sortOrder: 1 },
        status: "ENABLED",
        input: {
          type: "select",
          valueType: "ENUM",
          selectionKey: "print_side",
          required: true,
        },
        choices: [
          {
            value: "single_sided",
            label: "Single Sided",
          },
          {
            value: "double_sided",
            label: "Double Sided",
            visibilityRules: [
              {
                type: "not",
                rule: { type: "equals", selectionKey: "banner_weight", value: "13oz" },
              },
            ],
            pricingOverride: {
              mode: "add_base_rate",
              amount: 150,
              unit: "perSqft",
              appliesTo: "area",
              label: "18oz double sided",
            },
          },
        ],
      },
      group_banner_finishing: {
        id: "group_banner_finishing",
        type: "GROUP",
        kind: "group",
        label: "Banner Finishing",
        displayOrder: 1,
        ui: { sortOrder: 1 },
        status: "ENABLED",
      },
      hems: {
        id: "hems",
        type: "INPUT",
        kind: "question",
        key: "banner.hems",
        label: "Hems",
        displayOrder: 0,
        ui: { sortOrder: 0 },
        status: "ENABLED",
        input: {
          type: "select",
          valueType: "ENUM",
          selectionKey: "hems",
          required: true,
        },
        choices: [
          { value: "none", label: "None" },
          { value: "welded", label: "Welded" },
        ],
      },
      pole_pockets: {
        id: "pole_pockets",
        type: "INPUT",
        kind: "question",
        key: "banner.pole_pockets.enabled",
        label: "Pole Pockets",
        displayOrder: 1,
        ui: { sortOrder: 1 },
        status: "ENABLED",
        input: {
          type: "select",
          valueType: "ENUM",
          selectionKey: "pole_pockets",
          required: true,
        },
        choices: [
          { value: "no", label: "No" },
          { value: "yes", label: "Yes" },
        ],
      },
      pole_pocket_location: {
        id: "pole_pocket_location",
        type: "INPUT",
        kind: "question",
        key: "banner.pole_pockets.location",
        label: "Pole Pocket Location",
        displayOrder: 2,
        ui: { sortOrder: 2 },
        status: "ENABLED",
        visibility: visibleWhen("pole_pockets", "yes"),
        input: {
          type: "select",
          valueType: "ENUM",
          selectionKey: "pole_pocket_location",
          required: false,
        },
        choices: [
          {
            value: "top",
            label: "Top",
            pricingImpact: [{ mode: "addFormula", formula: "(ordered_width / 12) * q" }],
          },
          {
            value: "top_bottom",
            label: "Top/Bottom",
            pricingImpact: [{ mode: "addFormula", formula: "((ordered_width * 2) / 12) * q" }],
          },
          {
            value: "sides",
            label: "Sides",
            pricingImpact: [{ mode: "addFormula", formula: "((ordered_height * 2) / 12) * q" }],
          },
        ],
      },
      pole_pocket_depth: {
        id: "pole_pocket_depth",
        type: "INPUT",
        kind: "question",
        key: "banner.pole_pockets.depth",
        label: "Pole Pocket Depth",
        displayOrder: 3,
        ui: { sortOrder: 3 },
        status: "ENABLED",
        visibility: visibleWhen("pole_pockets", "yes"),
        input: {
          type: "select",
          valueType: "ENUM",
          selectionKey: "pole_pocket_depth",
          required: false,
        },
        choices: [
          { value: "2in", label: "2 inch" },
          { value: "3in", label: "3 inch" },
          { value: "4in", label: "4 inch" },
          { value: "custom", label: "Custom" },
        ],
      },
      custom_pole_pocket_depth: {
        id: "custom_pole_pocket_depth",
        type: "INPUT",
        kind: "question",
        key: "banner.pole_pockets.custom_depth",
        label: "Custom Pole Pocket Depth",
        displayOrder: 4,
        ui: { sortOrder: 4 },
        status: "ENABLED",
        visibility: visibleWhenAll([
          { type: "equals", selectionKey: "pole_pockets", value: "yes" },
          { type: "equals", selectionKey: "pole_pocket_depth", value: "custom" },
        ]),
        input: {
          type: "text",
          valueType: "TEXT",
          selectionKey: "custom_pole_pocket_depth",
          required: false,
          constraints: { text: { minLen: 1, maxLen: 80 } },
        },
      },
      group_banner_grommets: {
        id: "group_banner_grommets",
        type: "GROUP",
        kind: "group",
        label: "Grommets",
        displayOrder: 2,
        ui: { sortOrder: 2 },
        status: "ENABLED",
      },
      grommets: {
        id: "grommets",
        type: "INPUT",
        kind: "question",
        key: "banner.grommets.enabled",
        label: "Grommets",
        displayOrder: 0,
        ui: { sortOrder: 0 },
        status: "ENABLED",
        input: {
          type: "select",
          valueType: "ENUM",
          selectionKey: "grommets",
          required: true,
        },
        choices: [
          { value: "no", label: "No" },
          { value: "yes", label: "Yes" },
        ],
      },
      grommet_placement: {
        id: "grommet_placement",
        type: "INPUT",
        kind: "question",
        key: "banner.grommets.placement",
        label: "Grommet Placement",
        displayOrder: 1,
        ui: { sortOrder: 1 },
        status: "ENABLED",
        visibility: visibleWhen("grommets", "yes"),
        input: {
          type: "select",
          valueType: "ENUM",
          selectionKey: "grommet_placement",
          required: false,
        },
        choices: [
          { value: "corners_only", label: "Corners Only" },
          { value: "every_2_feet", label: "Every 2 Feet" },
          { value: "every_3_feet", label: "Every 3 Feet" },
          { value: "every_4_feet", label: "Every 4 Feet" },
          { value: "custom", label: "Custom" },
        ],
      },
      custom_grommet_count: {
        id: "custom_grommet_count",
        type: "INPUT",
        kind: "question",
        key: "banner.grommets.custom_count",
        label: "Custom Grommet Count",
        displayOrder: 2,
        ui: { sortOrder: 2 },
        status: "ENABLED",
        visibility: visibleWhenAll([
          { type: "equals", selectionKey: "grommets", value: "yes" },
          { type: "equals", selectionKey: "grommet_placement", value: "custom" },
        ]),
        input: {
          type: "number",
          valueType: "NUMBER",
          selectionKey: "custom_grommet_count",
          required: false,
          constraints: { number: { min: 1, step: 1, integerOnly: true } },
        },
      },
      custom_grommet_placement: {
        id: "custom_grommet_placement",
        type: "INPUT",
        kind: "question",
        key: "banner.grommets.custom_placement",
        label: "Custom Grommet Placement",
        description: "Describe the requested grommet placement.",
        displayOrder: 3,
        ui: { sortOrder: 3 },
        status: "ENABLED",
        visibility: visibleWhenAll([
          { type: "equals", selectionKey: "grommets", value: "yes" },
          { type: "equals", selectionKey: "grommet_placement", value: "custom" },
        ]),
        input: {
          type: "textarea",
          valueType: "TEXT",
          selectionKey: "custom_grommet_placement",
          required: false,
          constraints: { text: { maxLen: 500 } },
        },
      },
    },
    edges: [
      structuralEdge("group_banner_media", "banner_weight", 0),
      structuralEdge("group_banner_media", "print_side", 1),
      structuralEdge("group_banner_finishing", "hems", 0),
      structuralEdge("group_banner_finishing", "pole_pockets", 1),
      structuralEdge("group_banner_finishing", "pole_pocket_location", 2),
      structuralEdge("group_banner_finishing", "pole_pocket_depth", 3),
      structuralEdge("group_banner_finishing", "custom_pole_pocket_depth", 4),
      structuralEdge("group_banner_grommets", "grommets", 0),
      structuralEdge("group_banner_grommets", "grommet_placement", 1),
      structuralEdge("group_banner_grommets", "custom_grommet_count", 2),
      structuralEdge("group_banner_grommets", "custom_grommet_placement", 3),
    ],
    optionRules: [
      {
        id: "rule_13oz_defaults_single_sided",
        label: "13oz is single sided only",
        when: { all: [{ optionGroup: "banner_weight", operator: "equals", value: "13oz" }] },
        then: [
          { action: "clear", targetOptionGroup: "print_side" },
          { action: "set_default", targetOptionGroup: "print_side", value: "single_sided" },
        ],
      },
      {
        id: "rule_pole_pockets_children",
        label: "Pole pocket child options",
        when: { all: [{ optionGroup: "pole_pockets", operator: "equals", value: "yes" }] },
        then: [
          { action: "show", targetOptionGroup: "pole_pocket_location" },
          { action: "require", targetOptionGroup: "pole_pocket_location" },
          { action: "show", targetOptionGroup: "pole_pocket_depth" },
          { action: "require", targetOptionGroup: "pole_pocket_depth" },
        ],
        else: [
          { action: "hide", targetOptionGroup: "pole_pocket_location" },
          { action: "optional", targetOptionGroup: "pole_pocket_location" },
          { action: "clear", targetOptionGroup: "pole_pocket_location" },
          { action: "hide", targetOptionGroup: "pole_pocket_depth" },
          { action: "optional", targetOptionGroup: "pole_pocket_depth" },
          { action: "clear", targetOptionGroup: "pole_pocket_depth" },
          { action: "hide", targetOptionGroup: "custom_pole_pocket_depth" },
          { action: "optional", targetOptionGroup: "custom_pole_pocket_depth" },
          { action: "clear", targetOptionGroup: "custom_pole_pocket_depth" },
        ],
      },
      {
        id: "rule_custom_pole_pocket_depth",
        label: "Custom pole pocket depth text",
        when: { all: [{ optionGroup: "pole_pocket_depth", operator: "equals", value: "custom" }] },
        then: [
          { action: "show", targetOptionGroup: "custom_pole_pocket_depth" },
          { action: "require", targetOptionGroup: "custom_pole_pocket_depth" },
        ],
        else: [
          { action: "hide", targetOptionGroup: "custom_pole_pocket_depth" },
          { action: "optional", targetOptionGroup: "custom_pole_pocket_depth" },
          { action: "clear", targetOptionGroup: "custom_pole_pocket_depth" },
        ],
      },
      {
        id: "rule_grommet_children",
        label: "Grommet child options",
        when: { all: [{ optionGroup: "grommets", operator: "equals", value: "yes" }] },
        then: [
          { action: "show", targetOptionGroup: "grommet_placement" },
          { action: "require", targetOptionGroup: "grommet_placement" },
        ],
        else: [
          { action: "hide", targetOptionGroup: "grommet_placement" },
          { action: "optional", targetOptionGroup: "grommet_placement" },
          { action: "clear", targetOptionGroup: "grommet_placement" },
          { action: "hide", targetOptionGroup: "custom_grommet_count" },
          { action: "optional", targetOptionGroup: "custom_grommet_count" },
          { action: "clear", targetOptionGroup: "custom_grommet_count" },
          { action: "hide", targetOptionGroup: "custom_grommet_placement" },
          { action: "optional", targetOptionGroup: "custom_grommet_placement" },
          { action: "clear", targetOptionGroup: "custom_grommet_placement" },
        ],
      },
      {
        id: "rule_custom_grommet_count",
        label: "Custom grommet count",
        when: { all: [{ optionGroup: "grommet_placement", operator: "equals", value: "custom" }] },
        then: [
          { action: "show", targetOptionGroup: "custom_grommet_count" },
          { action: "require", targetOptionGroup: "custom_grommet_count" },
        ],
        else: [
          { action: "hide", targetOptionGroup: "custom_grommet_count" },
          { action: "optional", targetOptionGroup: "custom_grommet_count" },
          { action: "clear", targetOptionGroup: "custom_grommet_count" },
          { action: "hide", targetOptionGroup: "custom_grommet_placement" },
          { action: "optional", targetOptionGroup: "custom_grommet_placement" },
          { action: "clear", targetOptionGroup: "custom_grommet_placement" },
        ],
      },
    ],
    meta: {
      title: "Banner",
      baseWeightOz: 1,
      pricingProfileKey: "default",
      requiresDimensions: true,
      pricingV2: {
        unitSystem: "imperial",
        base: { perSqftCents: 125 },
      },
    },
  };

  const res = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
  if (res.errors.length > 0 || res.warnings.length > 0) {
    const summary = {
      errors: res.errors.map((f) => ({ code: f.code, path: f.path })),
      warnings: res.warnings.map((f) => ({ code: f.code, path: f.path })),
    };
    throw new Error(`PBV2 banner product template is no longer publish-valid: ${JSON.stringify(summary)}`);
  }

  return tree;
}

/**
 * Publish-valid PBV2 template proving ChildItemEffect proposals for sign-shop assemblies.
 *
 * Proof target: an optional aluminum extrusion frame proposal derived from perimeter.
 * - When extrusionEnabled=true, emits a child item proposal (qty in feet, rounded up)
 * - No pricing is invented in this template; amount is omitted.
 */
export function createPbv2SignExtrusionTreeJson(): Record<string, unknown> {
  const tree: Record<string, unknown> = {
    status: "DRAFT",
    rootNodeIds: ["extrusionEnabled"],
    nodes: [
      {
        id: "extrusionEnabled",
        type: "INPUT",
        status: "ENABLED",
        key: "finishing.extrusion.enabled",
        input: { selectionKey: "extrusionEnabled", valueType: "BOOLEAN", defaultValue: false },
      },
      {
        id: "price_extrusion",
        type: "PRICE",
        status: "ENABLED",
        key: "finishing.extrusion.childItems",
        price: {
          components: [],
          childItemEffects: [
            {
              kind: "inlineSku",
              title: "Aluminum extrusion frame",
              skuRef: "AL_EXTRUSION_STD",
              invoiceVisibility: "rollup",
              // qty = ceil(perimeterIn / 12)  (feet)
              qtyRef: {
                op: "ceil",
                x: {
                  op: "div",
                  left: { op: "ref", ref: { kind: "envRef", envKey: "perimeterIn" } },
                  right: {
                    op: "clamp",
                    x: { op: "literal", value: 12 },
                    lo: { op: "literal", value: 1 },
                    hi: { op: "literal", value: 1000000 },
                  },
                },
              },
              appliesWhen: {
                op: "EQ",
                left: { op: "ref", ref: { kind: "effectiveRef", selectionKey: "extrusionEnabled" } },
                right: { op: "literal", value: true },
              },
            },
          ],
        },
      },
    ],
    edges: [
      {
        id: "e_extrusionEnabled_to_price_extrusion",
        status: "ENABLED",
        fromNodeId: "extrusionEnabled",
        toNodeId: "price_extrusion",
        priority: 0,
        condition: {
          op: "EQ",
          left: { op: "ref", ref: { kind: "selectionRef", selectionKey: "extrusionEnabled" } },
          right: { op: "literal", value: true },
        },
      },
    ],
    meta: { baseWeightOz: 1 },
  };

  const res = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
  if (res.errors.length > 0 || res.warnings.length > 0) {
    const summary = {
      errors: res.errors.map((f) => ({ code: f.code, path: f.path })),
      warnings: res.warnings.map((f) => ({ code: f.code, path: f.path })),
    };
    throw new Error(`PBV2 sign extrusion template is no longer publish-valid: ${JSON.stringify(summary)}`);
  }

  return tree;
}

export function stringifyPbv2TreeJson(tree: unknown): string {
  try {
    return JSON.stringify(tree ?? {}, null, 2);
  } catch {
    return "{}";
  }
}
