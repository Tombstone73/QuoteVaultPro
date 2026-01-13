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
