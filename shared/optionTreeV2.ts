import { z } from "zod";

// ------------------------------------------------------------
// Option Tree v2 (schemaVersion=2)
// Additive model that coexists with legacy products.optionsJson
// ------------------------------------------------------------

export type ConditionExpr =
  | { op: "equals"; ref: string; value?: any }
  | { op: "notEquals"; ref: string; value?: any }
  | { op: "truthy"; ref: string }
  | { op: "contains"; ref: string; value?: any }
  | { op: "and"; args: ConditionExpr[] }
  | { op: "or"; args: ConditionExpr[] }
  | { op: "not"; arg: ConditionExpr };

export type PricingImpact =
  | { mode: "addFlat"; amountCents: number; applyWhen?: ConditionExpr; label?: string }
  | { mode: "addPerQty"; amountCents: number; applyWhen?: ConditionExpr; label?: string }
  | { mode: "addPerSqft"; amountCents: number; applyWhen?: ConditionExpr; label?: string }
  | { mode: "percentOfBase"; percent: number; applyWhen?: ConditionExpr; label?: string }
  | { mode: "multiplier"; factor: number; applyWhen?: ConditionExpr; label?: string };

export type WeightImpact =
  | { mode: "addFlat"; oz: number; applyWhen?: ConditionExpr; label?: string }
  | { mode: "addPerQty"; oz: number; applyWhen?: ConditionExpr; label?: string }
  | { mode: "addPerSqft"; oz: number; applyWhen?: ConditionExpr; label?: string };

export type PricingV2Tier = {
  minQty?: number;
  minSqft?: number;
  perSqftCents?: number;
  perPieceCents?: number;
  minimumChargeCents?: number;
};

export type PricingV2Base = {
  perSqftCents?: number;
  perPieceCents?: number;
  minimumChargeCents?: number;
};

export type PricingV2 = {
  unitSystem?: "imperial" | "metric";
  base?: PricingV2Base;
  qtyTiers?: PricingV2Tier[];
  sqftTiers?: PricingV2Tier[];
};

export type Effect =
  | { type: "setFlag"; flagCode: string; tone?: string; message?: string }
  | { type: "requireArtwork"; required: boolean }
  | { type: "setMaterial"; materialId: string }
  | { type: "setSides"; sides: "SS" | "DS" }
  | { type: "setProductionNote"; text: string }
  | { type: "materialUsage"; materialId: string; quantityMode: "per_sqft" | "per_qty" | "fixed"; quantity: number };

export type BranchEdge = {
  toNodeId: string;
  when?: ConditionExpr;
  effectTag?: string;
};

export type OptionNodeV2 = {
  id: string;
  kind: "question" | "group" | "computed";
  label: string;
  description?: string;
  ui?: {
    groupKey?: string;
    sortOrder?: number;
    layoutHint?: "inline" | "stack" | "grid" | "compact";
    helpText?: string;
    badge?: string;
  };
  input?: {
    type: "boolean" | "select" | "multiselect" | "number" | "text" | "textarea" | "file" | "dimension";
    required?: boolean;
    defaultValue?: any;
    constraints?: {
      number?: { min?: number; max?: number; step?: number; integerOnly?: boolean };
      text?: { minLen?: number; maxLen?: number; pattern?: string };
      select?: { allowEmpty?: boolean; emptyLabel?: string };
    };
  };
  choices?: Array<{ value: string; label: string; description?: string; sortOrder?: number; weightOz?: number }>;
  visibility?: { condition?: ConditionExpr };
  edges?: { children?: BranchEdge[] };
  pricingImpact?: PricingImpact[];
  weightImpact?: WeightImpact[];
  effects?: Effect[];
};

export type ShippingPolicy = "pickup_only" | "shippable_estimate" | "shippable_custom_quote";
export type WeightUnit = "lb" | "oz" | "g" | "kg";
export type WeightBasis = "per_item" | "per_sqft" | "per_order";

export type ShippingConfig = {
  shippingPolicy?: ShippingPolicy;
  baseWeight?: number | null;
  weightUnit?: WeightUnit;
  weightBasis?: WeightBasis;
};

export type ProductImage = {
  url: string;
  fileName: string;
  mediaAssetId?: string;
  orderIndex: number;
};

export type OptionTreeV2 = {
  schemaVersion: 2;
  rootNodeIds: string[];
  nodes: Record<string, OptionNodeV2>;
  meta?: {
    title?: string;
    updatedAt?: string;
    updatedByUserId?: string;
    notes?: string;
    baseWeightOz?: number;
    pricingV2?: PricingV2;
    shippingConfig?: ShippingConfig;
    productImages?: ProductImage[];
  };
};

export type LineItemOptionSelectionsV2 = {
  schemaVersion: 2;
  selected: Record<string, { value?: any; note?: string }>;
  resolved?: {
    visibleNodeIds?: string[];
    pathTags?: string[];
  };
};

// ------------------------------------------------------------
// Zod Schemas (used for validation at boundaries)
// ------------------------------------------------------------

export const conditionExprSchema: z.ZodType<ConditionExpr> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("equals"), ref: z.string(), value: z.any() }),
    z.object({ op: z.literal("notEquals"), ref: z.string(), value: z.any() }),
    z.object({ op: z.literal("truthy"), ref: z.string() }),
    z.object({ op: z.literal("contains"), ref: z.string(), value: z.any() }),
    z.object({ op: z.literal("and"), args: z.array(conditionExprSchema) }),
    z.object({ op: z.literal("or"), args: z.array(conditionExprSchema) }),
    z.object({ op: z.literal("not"), arg: conditionExprSchema }),
  ])
);

export const pricingImpactSchema: z.ZodType<PricingImpact> = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("addFlat"), amountCents: z.number().int(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("addPerQty"), amountCents: z.number().int(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("addPerSqft"), amountCents: z.number().int(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("percentOfBase"), percent: z.number(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("multiplier"), factor: z.number(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
]);

export const weightImpactSchema: z.ZodType<WeightImpact> = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("addFlat"), oz: z.number(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("addPerQty"), oz: z.number(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("addPerSqft"), oz: z.number(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
]);

export const pricingV2TierSchema: z.ZodType<PricingV2Tier> = z.object({
  minQty: z.number().int().min(1).optional(),
  minSqft: z.number().positive().optional(),
  perSqftCents: z.number().int().min(0).optional(),
  perPieceCents: z.number().int().min(0).optional(),
  minimumChargeCents: z.number().int().min(0).optional(),
});

export const pricingV2BaseSchema: z.ZodType<PricingV2Base> = z.object({
  perSqftCents: z.number().int().min(0).optional(),
  perPieceCents: z.number().int().min(0).optional(),
  minimumChargeCents: z.number().int().min(0).optional(),
});

export const pricingV2Schema: z.ZodType<PricingV2> = z.object({
  unitSystem: z.enum(["imperial", "metric"]).optional(),
  base: pricingV2BaseSchema.optional(),
  qtyTiers: z.array(pricingV2TierSchema).optional(),
  sqftTiers: z.array(pricingV2TierSchema).optional(),
});

export const effectSchema: z.ZodType<Effect> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setFlag"), flagCode: z.string(), tone: z.string().optional(), message: z.string().optional() }),
  z.object({ type: z.literal("requireArtwork"), required: z.boolean() }),
  z.object({ type: z.literal("setMaterial"), materialId: z.string() }),
  z.object({ type: z.literal("setSides"), sides: z.enum(["SS", "DS"]) }),
  z.object({ type: z.literal("setProductionNote"), text: z.string() }),
  z.object({ type: z.literal("materialUsage"), materialId: z.string(), quantityMode: z.enum(["per_sqft", "per_qty", "fixed"]), quantity: z.number() }),
]);

export const branchEdgeSchema: z.ZodType<BranchEdge> = z.object({
  toNodeId: z.string(),
  when: conditionExprSchema.optional(),
  effectTag: z.string().optional(),
});

export const optionNodeV2Schema: z.ZodType<OptionNodeV2> = z.object({
  id: z.string(),
  kind: z.enum(["question", "group", "computed"]),
  label: z.string(),
  description: z.string().optional(),
  ui: z
    .object({
      groupKey: z.string().optional(),
      sortOrder: z.number().optional(),
      layoutHint: z.enum(["inline", "stack", "grid", "compact"]).optional(),
      helpText: z.string().optional(),
      badge: z.string().optional(),
    })
    .optional(),
  input: z
    .object({
      type: z.enum(["boolean", "select", "multiselect", "number", "text", "textarea", "file", "dimension"]),
      required: z.boolean().optional(),
      defaultValue: z.any().optional(),
      constraints: z
        .object({
          number: z
            .object({ min: z.number().optional(), max: z.number().optional(), step: z.number().optional(), integerOnly: z.boolean().optional() })
            .optional(),
          text: z
            .object({ minLen: z.number().int().optional(), maxLen: z.number().int().optional(), pattern: z.string().optional() })
            .optional(),
          select: z.object({ allowEmpty: z.boolean().optional(), emptyLabel: z.string().optional() }).optional(),
        })
        .optional(),
    })
    .optional(),
  choices: z
    .array(
      z.object({
        value: z.string(),
        label: z.string(),
        description: z.string().optional(),
        sortOrder: z.number().optional(),
        weightOz: z.number().optional(),
      })
    )
    .optional(),
  visibility: z.object({ condition: conditionExprSchema.optional() }).optional(),
  edges: z.object({ children: z.array(branchEdgeSchema).optional() }).optional(),
  pricingImpact: z.array(pricingImpactSchema).optional(),
  weightImpact: z.array(weightImpactSchema).optional(),
  effects: z.array(effectSchema).optional(),
});

export const shippingPolicyEnum = z.enum(["pickup_only", "shippable_estimate", "shippable_custom_quote"]);
export const weightUnitEnum = z.enum(["lb", "oz", "g", "kg"]);
export const weightBasisEnum = z.enum(["per_item", "per_sqft", "per_order"]);

export const shippingConfigSchema: z.ZodType<ShippingConfig> = z.object({
  shippingPolicy: shippingPolicyEnum.optional(),
  baseWeight: z.number().min(0).nullable().optional(),
  weightUnit: weightUnitEnum.optional(),
  weightBasis: weightBasisEnum.optional(),
});

export const productImageSchema: z.ZodType<ProductImage> = z.object({
  url: z.string(),
  fileName: z.string(),
  mediaAssetId: z.string().optional(),
  orderIndex: z.number().int().min(0),
});

export const optionTreeV2Schema: z.ZodType<OptionTreeV2> = z.object({
  schemaVersion: z.literal(2),
  rootNodeIds: z.array(z.string()),
  nodes: z.record(optionNodeV2Schema),
  meta: z
    .object({
      title: z.string().optional(),
      updatedAt: z.string().optional(),
      updatedByUserId: z.string().optional(),
      notes: z.string().optional(),
      baseWeightOz: z.number().optional(),
      pricingV2: pricingV2Schema.optional(),
      shippingConfig: shippingConfigSchema.optional(),
      productImages: z.array(productImageSchema).optional(),
    })
    .optional(),
});

export const lineItemOptionSelectionsV2Schema: z.ZodType<LineItemOptionSelectionsV2> = z.object({
  schemaVersion: z.literal(2),
  selected: z.record(z.object({ value: z.any(), note: z.string().optional() })),
  resolved: z
    .object({
      visibleNodeIds: z.array(z.string()).optional(),
      pathTags: z.array(z.string()).optional(),
    })
    .optional(),
});

// ------------------------------------------------------------
// Minimal graph validator (MVP)
// ------------------------------------------------------------

export function validateOptionTreeV2(tree: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!tree || typeof tree !== "object") {
    return { ok: false, errors: ["Tree must be an object"] };
  }

  const anyTree: any = tree as any;

  if (anyTree.schemaVersion !== 2) {
    errors.push("schemaVersion must be 2");
  }

  if (!Array.isArray(anyTree.rootNodeIds) || anyTree.rootNodeIds.length === 0) {
    errors.push("rootNodeIds must be a non-empty array");
  }

  if (!anyTree.nodes || typeof anyTree.nodes !== "object") {
    errors.push("nodes must be an object map");
  }

  const nodes: Record<string, any> = anyTree.nodes && typeof anyTree.nodes === "object" ? anyTree.nodes : {};

  // roots exist in nodes
  if (Array.isArray(anyTree.rootNodeIds)) {
    for (let i = 0; i < anyTree.rootNodeIds.length; i++) {
      const rootId = anyTree.rootNodeIds[i];
      if (typeof rootId !== "string" || !rootId.trim()) {
        errors.push("rootNodeIds must contain non-empty strings");
        continue;
      }
      if (!nodes[rootId]) {
        errors.push(`rootNodeId '${rootId}' does not exist in nodes`);
      }
    }
  }

  // nodes[key].id === key
  for (const key of Object.keys(nodes)) {
    const node = nodes[key];
    if (!node || typeof node !== "object") continue;
    if (node.id !== key) {
      errors.push(`Node id mismatch: nodes['${key}'].id must equal '${key}'`);
    }
  }

  // no missing nodes referenced by edges.children[].toNodeId
  for (const fromId of Object.keys(nodes)) {
    const node = nodes[fromId];
    const children = node?.edges?.children;
    if (!children) continue;
    if (!Array.isArray(children)) continue;

    for (let i = 0; i < children.length; i++) {
      const edge = children[i];
      const toNodeId = edge?.toNodeId;
      if (typeof toNodeId !== "string" || !toNodeId.trim()) continue;
      if (!nodes[toNodeId]) {
        errors.push(`Edge reference missing: '${fromId}' -> '${toNodeId}'`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}
