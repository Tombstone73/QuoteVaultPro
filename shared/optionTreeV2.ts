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

export type VisibilityRule =
  | { type: "equals"; selectionKey: string; value?: any }
  | { type: "notEquals"; selectionKey: string; value?: any }
  | { type: "in"; selectionKey: string; values: any[] }
  | { type: "truthy"; selectionKey: string }
  | { type: "and"; rules: VisibilityRule[] }
  | { type: "or"; rules: VisibilityRule[] }
  | { type: "not"; rule: VisibilityRule };

export type VisibilityConfig = {
  condition?: ConditionExpr;
  rules?: VisibilityRule[];
};

// New unified pricing impact types (can be negative for discounts)
export type PricingImpact =
  // Legacy modes (kept for backward compatibility)
  | { mode: "addFlat"; amountCents: number; applyWhen?: ConditionExpr; label?: string }
  | { mode: "addPerQty"; amountCents: number; applyWhen?: ConditionExpr; label?: string }
  | { mode: "addPerSqft"; amountCents: number; applyWhen?: ConditionExpr; label?: string }
  | { mode: "percentOfBase"; percent: number; applyWhen?: ConditionExpr; label?: string }
  | { mode: "multiplier"; factor: number; applyWhen?: ConditionExpr; label?: string }
  // New modes (v2.1: choice-level pricing)
  | { mode: "addCents"; cents: number; applyWhen?: ConditionExpr; label?: string }
  | { mode: "addPercent"; percent: number; basis?: "base" | "lineSubtotal" | "optionsSubtotal"; applyWhen?: ConditionExpr; label?: string }
  | { mode: "addPerUnit"; centsPerUnit: number; unit: "perPiece" | "perQty" | "perSqft" | "perLinearFoot" | "perInch"; applyWhen?: ConditionExpr; label?: string }
  | { mode: "addFormula"; formula: string; applyWhen?: ConditionExpr; label?: string };

export type WeightImpact =
  | { mode: "addFlat"; oz: number; applyWhen?: ConditionExpr; label?: string }
  | { mode: "addPerQty"; oz: number; applyWhen?: ConditionExpr; label?: string }
  | { mode: "addPerSqft"; oz: number; applyWhen?: ConditionExpr; label?: string };

export type InventoryConsumptionBasis = "area_sqft" | "perimeter_ft" | "linear_ft" | "each" | "fixed";

export type InventoryConsumption = {
  materialId: string;
  quantityBasis: InventoryConsumptionBasis;
  multiplier: number;
  wastePercent?: number;
  fixedQty?: number;
};

export type ChoicePricingOverrideMode = "none" | "set_base_rate" | "add_base_rate" | "multiply_base_rate";
export type ChoicePricingOverrideUnit = "perSqft" | "perPiece" | "minimumCharge";
export type ChoicePricingOverrideAppliesTo = "base" | "area" | "quantity";

export type ChoicePricingOverride = {
  mode: ChoicePricingOverrideMode;
  amount?: number;
  unit?: ChoicePricingOverrideUnit;
  appliesTo?: ChoicePricingOverrideAppliesTo;
  label?: string;
};

export type AppliedChoicePricingOverride = {
  selectionKey: string;
  optionLabel: string;
  choiceValue: string;
  choiceLabel: string;
  mode: Exclude<ChoicePricingOverrideMode, "none">;
  amount: number;
  unit?: ChoicePricingOverrideUnit;
  appliesTo?: ChoicePricingOverrideAppliesTo;
  label?: string;
};

export type ChoicePricingOverrideMetadata = {
  priceDeltaCents?: number;
  pricingImpact?: PricingImpact[];
  pricingOverride?: ChoicePricingOverride;
};

export type ChoiceMaterialOverride = {
  materialId: string;
};

export type OptionChoiceRuntimeSelection = {
  nodeId: string;
  selectionKey: string;
  optionLabel: string;
  choiceValue: string;
  choiceLabel: string;
  pricing?: ChoicePricingOverrideMetadata;
  material?: ChoiceMaterialOverride;
  inventoryConsumption?: InventoryConsumption[];
  workflowTags?: string[];
  role: "variant" | "modifier";
};

export type OptionRuntimeSelectionWarning = {
  selectionKey: string;
  choiceValue?: string;
  reason: "hidden_node" | "hidden_choice";
};

export type OptionRuntimeSelectionContext = {
  selectedChoices: Record<string, string>;
  resolvedChoices: Record<string, OptionChoiceRuntimeSelection>;
  visibleNodeIds: string[];
  visibleGroupIds: string[];
  visibleChoiceIds: string[];
  workflowTags: string[];
  appliedPricingOverrides: AppliedChoicePricingOverride[];
  hiddenSelectionWarnings: OptionRuntimeSelectionWarning[];
};

export type PricingV2Tier = {
  id?: string;
  label?: string;
  minQty?: number;
  maxQty?: number | null;
  minSqft?: number;
  perSqftCents?: number;
  perPieceCents?: number;
  minimumChargeCents?: number;
};

export type PricingV2Base = {
  perSqftCents?: number | null;
  perPieceCents?: number | null;
  minimumChargeCents?: number | null;
};

export type Pbv2TierBasis = "line_item_quantity" | "computed_sheet_usage";

export type PricingV2 = {
  unitSystem?: "imperial" | "metric";
  tierBasis?: Pbv2TierBasis;
  base?: PricingV2Base;
  qtyTiers?: PricingV2Tier[];
  sqftTiers?: PricingV2Tier[];
  /** The selected option-matrix rate is authoritative. This prevents a
   * per-piece matrix from being interpreted as a square-foot rate. */
  optionMatrixPricingUnit?: "per_piece" | "per_square_foot";
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
  type?: string;
  status?: "ENABLED" | "DISABLED" | "DELETED";
  key?: string;
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
    selectionKey?: string; // Key used for storing/retrieving selections (defaults to node.key or node.id)
    valueType?: string;
    constraints?: {
      number?: { min?: number; max?: number; step?: number; integerOnly?: boolean };
      text?: { minLen?: number; maxLen?: number; pattern?: string };
      select?: { allowEmpty?: boolean; emptyLabel?: string };
    };
  };
  choices?: Array<{ 
    value: string; 
    label: string; 
    description?: string; 
    sortOrder?: number; 
    weightOz?: number;
    priceDeltaCents?: number;
    pricingImpact?: PricingImpact[]; // v2.1: Choice-level pricing impacts
    pricingOverride?: ChoicePricingOverride;
    visibilityRules?: VisibilityRule[];
    materialOverride?: ChoiceMaterialOverride;
    inventoryConsumption?: InventoryConsumption[];
    workflowTags?: string[];
  }>;
  visibility?: VisibilityConfig;
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
  status?: "DRAFT" | "ACTIVE" | "DEPRECATED" | "ARCHIVED";
  rootNodeIds: string[];
  nodes: Record<string, OptionNodeV2>;
  edges?: Array<{
    id?: string;
    status?: "ENABLED" | "DISABLED" | "DELETED";
    fromNodeId: string;
    toNodeId: string;
    priority?: number;
    condition?: any;
  }>;
  meta?: {
    title?: string;
    updatedAt?: string;
    updatedByUserId?: string;
    notes?: string;
    baseWeightOz?: number;
    pricingProfileKey?: string;
    pricingFormula?: string;
    formulaOutputMeaning?: "billable" | "final_price" | "generic";
    outputMeaning?: "billable" | "final_price" | "generic";
    formulaVariables?: Record<string, number | boolean>;
    pricingFormulaVariables?: Record<string, number | boolean>;
    pricingV2?: PricingV2;
    shippingConfig?: ShippingConfig;
    productImages?: ProductImage[];
    requiresDimensions?: boolean; // Default true if missing (product requires W x H)
    fixedDimensions?: {
      widthIn: number;
      heightIn: number;
      unit: "in";
      label?: string;
      source?: string;
      confidence?: number;
    };
    productIntake?: {
      /** Product Intake provenance is optional for legacy/manual PBV2 trees.
       * When supplied, these fields are canonical evidence, not price inputs. */
      architecture?: "product_draft_intent";
      contractVersion?: number;
      intentId?: string;
      revision?: number;
      fingerprint?: string;
      sessionId?: string;
      productName?: string;
      confidence?: number;
      sizeMode?: "fixed_dropdown" | "custom_dimension" | "none";
      fixedDimensions?: {
        widthIn: number;
        heightIn: number;
        unit: "in";
        label?: string;
        source?: string;
        confidence?: number;
      };
      size?: {
        behavior: "fixed_dimensions" | "custom_dimensions" | "none";
        fixedDimensions?: {
          widthIn: number;
          heightIn: number;
          unit: "in";
          label?: string;
          source?: string;
          confidence?: number;
        };
        customerFacingOptionGenerated: boolean;
        sourceOptions: Array<{
          label: string;
          normalizedGroup: string;
          required: boolean;
          confidence: number;
          sampleValues: string[];
          sourcePaths: string[];
        }>;
        warning: string | null;
      };
      quantity?: {
        configured?: boolean;
        behavior: string;
        confidence: number;
        notes: string | null;
        lineItemQuantitySource: boolean;
        customerFacingOptionGenerated: boolean;
        quantityOnly?: boolean;
        sourceOptions: Array<{
          label: string;
          normalizedGroup: string;
          required: boolean;
          confidence: number;
          sampleValues: string[];
          sourcePaths: string[];
        }>;
        mapping?: {
          source: "line_item_quantity" | "fixed_quantity" | "not_applicable";
          variable: "q" | null;
          pricingBehavior: "per_piece" | "quantity_tiers" | "flat_fee" | "per_hour" | "per_square_foot";
          pricingPreviewField: "quantity" | null;
          quoteLineItemField: "quantity" | null;
          orderLineItemField: "quantity" | null;
          matrixAxes: string[];
          fixedQuantity?: number;
        };
        warning: string | null;
      };
      quantityWarnings?: string[];
      pricingReadiness?: {
        base: PricingV2Base;
        sources: string[];
        warnings: string[];
        basePricingConfigured: boolean;
        likelyMatrixPricing: boolean;
        candidateDimensions: string[];
        matrixEvidence: string[];
        matrixType?: string;
        matrixConfidence?: number;
        detectedSizes?: string[];
        detectedQuantityBreaks?: number[];
        detectedMaterials?: string[];
        detectedPricingSignals?: string[];
      };
      matrixReadiness?: {
        required: boolean;
        matrixType: "NONE" | "SIZE_QUANTITY" | "QUANTITY_STOCK" | "SIZE_MATERIAL" | "QUANTITY_TIER" | "MULTI_DIMENSION";
        matrixDimensions: string[];
        matrixConfidence: number;
        reasoning: string[];
        recommendedSetup: string;
        detectedSizes: string[];
        detectedQuantityBreaks: number[];
        detectedMaterials: string[];
        detectedPricingSignals: string[];
        noMatrixRowsGenerated: boolean;
      };
      matrixDraft?: {
        generatedByAI: true;
        reviewRequired: true;
        matrixConfidence: number;
        generationReasoning: string[];
        sourceSignals: string[];
        dimensions: string[];
        tiers: Array<{
          id: string;
          label: string;
          minQty: number;
          maxQty: number | null;
        }>;
        rows: Array<{
          id: string;
          label: string;
          when: Record<string, unknown>;
          prices: Array<{
            tierId: string;
            label: string;
            minQty: number;
            perPieceCents?: number | null;
            perSqftCents?: number | null;
            minimumChargeCents?: number | null;
          }>;
        }>;
        warnings: string[];
      };
      productClassification?: {
        type: "FORMULA_PRODUCT" | "MATRIX_PRODUCT" | "FIXED_SIZE_MATRIX" | "PER_PIECE_PRODUCT" | "FULFILLMENT_PRODUCT";
        confidence: number;
        reasons: string[];
      };
      formulaAssignment?: {
        code: string;
        name: string;
        pricingProfileKey: string;
        expression: string;
        confidence: number;
        source: string;
        pricingFormulaId?: string | null;
      };
      generatedBehaviors?: {
        optionRules: string[];
        pricingImpacts: Array<Record<string, unknown>>;
      };
      pricingWarnings?: string[];
      materialMatch?: {
        materialId: string | null;
        sku: string | null;
        name: string;
        confidence: number;
      } | null;
      materialMatchStatus?: "resolved" | "review_required" | "unresolved";
      materialAssociationRequired?: boolean;
      sourceMaterialText?: string | null;
      materialCandidateMatches?: Array<{
        materialId: string | null;
        sku: string | null;
        name: string;
        confidence: number;
      }>;
      materialWarnings?: string[];
      materialSelection?: "auto" | "unset";
      requiresProofApproval?: boolean;
      requiresProductionJob?: boolean | null;
      productionRoute?: string | null;
      missingDecisions?: Array<{
        id: string;
        question: string;
        severity: "blocker" | "review" | "info";
      }>;
      draftQuality?: {
        label: "Excellent" | "Good" | "Needs Review";
        score: number;
        reasons: string[];
        warnings: string[];
      };
    };
  };
};

export type LineItemOptionSelectionsV2 = {
  schemaVersion: 2;
  selected: Record<string, { value?: any; note?: string; origin?: "DEFAULT" | "AI_INFERRED" | "SOURCE_EVIDENCE" | "USER_SELECTED"; evidence?: string | null }>;
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
  // Legacy modes
  z.object({ mode: z.literal("addFlat"), amountCents: z.number().int(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("addPerQty"), amountCents: z.number().int(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("addPerSqft"), amountCents: z.number().int(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("percentOfBase"), percent: z.number(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("multiplier"), factor: z.number(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  // New modes (v2.1)
  z.object({ mode: z.literal("addCents"), cents: z.number(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("addPercent"), percent: z.number(), basis: z.enum(["base", "lineSubtotal", "optionsSubtotal"]).optional(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("addPerUnit"), centsPerUnit: z.number(), unit: z.enum(["perPiece", "perQty", "perSqft", "perLinearFoot", "perInch"]), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("addFormula"), formula: z.string().min(1), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
]);

export const weightImpactSchema: z.ZodType<WeightImpact> = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("addFlat"), oz: z.number(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("addPerQty"), oz: z.number(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
  z.object({ mode: z.literal("addPerSqft"), oz: z.number(), applyWhen: conditionExprSchema.optional(), label: z.string().optional() }),
]);

export const inventoryConsumptionBasisSchema = z.enum(["area_sqft", "perimeter_ft", "linear_ft", "each", "fixed"]);

export const inventoryConsumptionSchema: z.ZodType<InventoryConsumption> = z
  .object({
    materialId: z.string().min(1),
    quantityBasis: inventoryConsumptionBasisSchema,
    multiplier: z.number().positive(),
    wastePercent: z.number().min(0).max(100).optional(),
    fixedQty: z.number().nonnegative().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.quantityBasis === "fixed" && (value.fixedQty === undefined || value.fixedQty === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fixedQty is required when quantityBasis is fixed",
        path: ["fixedQty"],
      });
    }
  });

export const choiceMaterialOverrideSchema: z.ZodType<ChoiceMaterialOverride> = z.object({
  materialId: z.string().min(1),
});

export const choicePricingOverrideModeSchema = z.enum(["none", "set_base_rate", "add_base_rate", "multiply_base_rate"]);
export const choicePricingOverrideUnitSchema = z.enum(["perSqft", "perPiece", "minimumCharge"]);
export const choicePricingOverrideAppliesToSchema = z.enum(["base", "area", "quantity"]);

export const choicePricingOverrideSchema: z.ZodType<ChoicePricingOverride> = z.object({
  mode: choicePricingOverrideModeSchema,
  amount: z.number().finite().optional(),
  unit: choicePricingOverrideUnitSchema.optional(),
  appliesTo: choicePricingOverrideAppliesToSchema.optional(),
  label: z.string().optional(),
});

export const pricingV2TierSchema: z.ZodType<PricingV2Tier> = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  minQty: z.number().int().min(1).optional(),
  maxQty: z.number().int().min(1).nullable().optional(),
  minSqft: z.number().positive().optional(),
  perSqftCents: z.number().finite().min(0).optional(),
  perPieceCents: z.number().finite().min(0).optional(),
  minimumChargeCents: z.number().finite().min(0).optional(),
});

export const pricingV2BaseSchema: z.ZodType<PricingV2Base> = z.object({
  perSqftCents: z.number().finite().min(0).nullable().optional(),
  perPieceCents: z.number().finite().min(0).nullable().optional(),
  minimumChargeCents: z.number().finite().min(0).nullable().optional(),
});

export const pbv2TierBasisSchema: z.ZodType<Pbv2TierBasis> = z.enum(["line_item_quantity", "computed_sheet_usage"]);

export const pricingV2Schema: z.ZodType<PricingV2> = z.object({
  unitSystem: z.enum(["imperial", "metric"]).optional(),
  tierBasis: pbv2TierBasisSchema.optional(),
  base: pricingV2BaseSchema.optional(),
  qtyTiers: z.array(pricingV2TierSchema).optional(),
  sqftTiers: z.array(pricingV2TierSchema).optional(),
  optionMatrixPricingUnit: z.enum(["per_piece", "per_square_foot"]).optional(),
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

export const visibilityRuleSchema: z.ZodType<VisibilityRule> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("equals"), selectionKey: z.string(), value: z.any().optional() }),
    z.object({ type: z.literal("notEquals"), selectionKey: z.string(), value: z.any().optional() }),
    z.object({ type: z.literal("in"), selectionKey: z.string(), values: z.array(z.any()) }),
    z.object({ type: z.literal("truthy"), selectionKey: z.string() }),
    z.object({ type: z.literal("and"), rules: z.array(visibilityRuleSchema) }),
    z.object({ type: z.literal("or"), rules: z.array(visibilityRuleSchema) }),
    z.object({ type: z.literal("not"), rule: visibilityRuleSchema }),
  ])
);

export const visibilityConfigSchema: z.ZodType<VisibilityConfig> = z.object({
  condition: conditionExprSchema.optional(),
  rules: z.array(visibilityRuleSchema).optional(),
});

export const optionNodeV2Schema: z.ZodType<OptionNodeV2> = z.object({
  id: z.string(),
  kind: z.enum(["question", "group", "computed"]),
  type: z.string().optional(),
  status: z.enum(["ENABLED", "DISABLED", "DELETED"]).optional(),
  key: z.string().optional(),
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
      selectionKey: z.string().optional(),
      valueType: z.string().optional(),
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
        priceDeltaCents: z.number().int().optional(),
        pricingImpact: z.array(pricingImpactSchema).optional(), // v2.1: Choice-level pricing
        pricingOverride: choicePricingOverrideSchema.optional(),
        visibilityRules: z.array(visibilityRuleSchema).optional(),
        materialOverride: choiceMaterialOverrideSchema.optional(),
        inventoryConsumption: z.array(inventoryConsumptionSchema).optional(),
        workflowTags: z.array(z.string().min(1)).optional(),
      })
    )
    .optional(),
  visibility: visibilityConfigSchema.optional(),
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
  edges: z
    .array(
      z.object({
        id: z.string().optional(),
        status: z.enum(["ENABLED", "DISABLED", "DELETED"]).optional(),
        fromNodeId: z.string(),
        toNodeId: z.string(),
        priority: z.number().optional(),
        condition: z.any().optional(),
      })
    )
    .optional(),
  meta: z
    .object({
      title: z.string().optional(),
      updatedAt: z.string().optional(),
      updatedByUserId: z.string().optional(),
      notes: z.string().optional(),
      baseWeightOz: z.number().optional(),
      pricingProfileKey: z.string().optional(),
      pricingFormula: z.string().optional(),
      formulaOutputMeaning: z.enum(["billable", "final_price", "generic"]).optional(),
      outputMeaning: z.enum(["billable", "final_price", "generic"]).optional(),
      formulaVariables: z.record(z.union([z.number(), z.boolean()])).optional(),
      pricingFormulaVariables: z.record(z.union([z.number(), z.boolean()])).optional(),
      billingUnit: z.object({ kind: z.literal("hour"), selectionKey: z.string().min(1), step: z.number().positive() }).optional(),
      pricingV2: pricingV2Schema.optional(),
      shippingConfig: shippingConfigSchema.optional(),
      productImages: z.array(productImageSchema).optional(),
      requiresDimensions: z.boolean().optional(),
      fixedDimensions: z.object({
        widthIn: z.number().positive(),
        heightIn: z.number().positive(),
        unit: z.literal("in"),
        label: z.string().optional(),
        source: z.string().optional(),
        confidence: z.number().min(0).max(100).optional(),
      }).optional(),
      productIntake: z.object({
        architecture: z.literal("product_draft_intent").optional(),
        contractVersion: z.number().int().positive().optional(),
        intentId: z.string().optional(),
        revision: z.number().int().nonnegative().optional(),
        fingerprint: z.string().optional(),
        sessionId: z.string().optional(),
        productName: z.string().optional(),
        confidence: z.number().min(0).max(100).optional(),
        sizeMode: z.enum(["fixed_dropdown", "custom_dimension", "none"]).optional(),
        fixedDimensions: z.object({
          widthIn: z.number().positive(),
          heightIn: z.number().positive(),
          unit: z.literal("in"),
          label: z.string().optional(),
          source: z.string().optional(),
          confidence: z.number().min(0).max(100).optional(),
        }).optional(),
        size: z.object({
          behavior: z.enum(["fixed_dimensions", "custom_dimensions", "none"]),
          fixedDimensions: z.object({
            widthIn: z.number().positive(),
            heightIn: z.number().positive(),
            unit: z.literal("in"),
            label: z.string().optional(),
            source: z.string().optional(),
            confidence: z.number().min(0).max(100).optional(),
          }).optional(),
          customerFacingOptionGenerated: z.boolean(),
          sourceOptions: z.array(z.object({
            label: z.string(),
            normalizedGroup: z.string(),
            required: z.boolean(),
            confidence: z.number().min(0).max(100),
            sampleValues: z.array(z.string()),
            sourcePaths: z.array(z.string()),
          })),
          warning: z.string().nullable(),
        }).optional(),
        quantity: z.object({
          configured: z.boolean().optional(),
          behavior: z.string(),
          confidence: z.number().min(0).max(100),
          notes: z.string().nullable(),
          lineItemQuantitySource: z.boolean(),
          customerFacingOptionGenerated: z.boolean(),
          quantityOnly: z.boolean().optional(),
          sourceOptions: z.array(z.object({
            label: z.string(),
            normalizedGroup: z.string(),
            required: z.boolean(),
            confidence: z.number().min(0).max(100),
            sampleValues: z.array(z.string()),
            sourcePaths: z.array(z.string()),
          })),
          mapping: z.object({
            source: z.enum(["line_item_quantity", "fixed_quantity", "not_applicable"]),
            variable: z.enum(["q"]).nullable(),
            pricingBehavior: z.enum(["per_piece", "quantity_tiers", "flat_fee", "per_hour", "per_square_foot"]),
            pricingPreviewField: z.literal("quantity").nullable(),
            quoteLineItemField: z.literal("quantity").nullable(),
            orderLineItemField: z.literal("quantity").nullable(),
            matrixAxes: z.array(z.string()),
            fixedQuantity: z.number().int().positive().optional(),
          }).optional(),
          warning: z.string().nullable(),
        }).optional(),
        quantityWarnings: z.array(z.string()).optional(),
        pricingReadiness: z.object({
          base: pricingV2BaseSchema,
          sources: z.array(z.string()),
          warnings: z.array(z.string()),
          basePricingConfigured: z.boolean(),
          likelyMatrixPricing: z.boolean(),
          candidateDimensions: z.array(z.string()),
          matrixEvidence: z.array(z.string()),
          matrixType: z.string().optional(),
          matrixConfidence: z.number().min(0).max(100).optional(),
          detectedSizes: z.array(z.string()).optional(),
          detectedQuantityBreaks: z.array(z.number().int().positive()).optional(),
          detectedMaterials: z.array(z.string()).optional(),
          detectedPricingSignals: z.array(z.string()).optional(),
        }).optional(),
        matrixReadiness: z.object({
          required: z.boolean(),
          matrixType: z.enum(["NONE", "SIZE_QUANTITY", "QUANTITY_STOCK", "SIZE_MATERIAL", "QUANTITY_TIER", "MULTI_DIMENSION"]),
          matrixDimensions: z.array(z.string()),
          matrixConfidence: z.number().min(0).max(100),
          reasoning: z.array(z.string()),
          recommendedSetup: z.string(),
          detectedSizes: z.array(z.string()),
          detectedQuantityBreaks: z.array(z.number().int().positive()),
          detectedMaterials: z.array(z.string()),
          detectedPricingSignals: z.array(z.string()),
          noMatrixRowsGenerated: z.boolean(),
        }).optional(),
        matrixDraft: z.object({
          generatedByAI: z.literal(true),
          reviewRequired: z.literal(true),
          matrixConfidence: z.number().min(0).max(100),
          generationReasoning: z.array(z.string()),
          sourceSignals: z.array(z.string()),
          dimensions: z.array(z.string()),
          tiers: z.array(z.object({
            id: z.string(),
            label: z.string(),
            minQty: z.number().int().positive(),
            maxQty: z.number().int().positive().nullable(),
          })),
          rows: z.array(z.object({
            id: z.string(),
            label: z.string(),
            when: z.record(z.unknown()),
            prices: z.array(z.object({
              tierId: z.string(),
              label: z.string(),
              minQty: z.number().int().positive(),
              perPieceCents: z.number().int().positive().nullable().optional(),
              perSqftCents: z.number().int().positive().nullable().optional(),
              minimumChargeCents: z.number().int().positive().nullable().optional(),
            })),
          })),
          warnings: z.array(z.string()),
        }).optional(),
        productClassification: z.object({
          type: z.enum(["FORMULA_PRODUCT", "MATRIX_PRODUCT", "FIXED_SIZE_MATRIX", "PER_PIECE_PRODUCT", "FULFILLMENT_PRODUCT"]),
          confidence: z.number().min(0).max(100),
          reasons: z.array(z.string()),
        }).optional(),
        formulaAssignment: z.object({
          code: z.string(),
          name: z.string(),
          pricingProfileKey: z.string(),
          expression: z.string(),
          confidence: z.number().min(0).max(100),
          source: z.string(),
          pricingFormulaId: z.string().nullable().optional(),
        }).optional(),
        generatedBehaviors: z.object({
          optionRules: z.array(z.string()),
          pricingImpacts: z.array(z.record(z.unknown())),
        }).optional(),
        pricingWarnings: z.array(z.string()).optional(),
        materialMatch: z.object({
          materialId: z.string().nullable(),
          sku: z.string().nullable(),
          name: z.string(),
          confidence: z.number().min(0).max(100),
        }).nullable().optional(),
        materialMatchStatus: z.enum(["resolved", "review_required", "unresolved"]).optional(),
        materialAssociationRequired: z.boolean().optional(),
        sourceMaterialText: z.string().nullable().optional(),
        materialCandidateMatches: z.array(z.object({
          materialId: z.string().nullable(),
          sku: z.string().nullable(),
          name: z.string(),
          confidence: z.number().min(0).max(100),
        })).optional(),
        materialWarnings: z.array(z.string()).optional(),
        materialSelection: z.enum(["auto", "unset"]).optional(),
        requiresProofApproval: z.boolean().optional(),
        requiresProductionJob: z.boolean().nullable().optional(),
        productionRoute: z.string().nullable().optional(),
        missingDecisions: z.array(z.object({
          id: z.string(),
          question: z.string(),
          severity: z.enum(["blocker", "review", "info"]),
        })).optional(),
        draftQuality: z.object({
          label: z.enum(["Excellent", "Good", "Needs Review"]),
          score: z.number().int().min(0).max(100),
          reasons: z.array(z.string()),
          warnings: z.array(z.string()),
        }).optional(),
      }).superRefine((productIntake, ctx) => {
        // Legacy and manually-created trees predate this audit contract. New
        // canonical Product Intent trees are intentionally strict: a draft is
        // not a valid canonical quantity-only configuration without all of the
        // line-item quantity evidence Product Builder needs to explain it.
        if (productIntake.architecture !== "product_draft_intent" || !productIntake.quantity) return;
        const quantity = productIntake.quantity;
        for (const field of ["configured", "notes", "lineItemQuantitySource", "customerFacingOptionGenerated", "sourceOptions", "mapping"] as const) {
          if (quantity[field] === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity", field], message: "Required" });
        }
        if (quantity.mapping?.source === "not_applicable" ? quantity.configured !== false : quantity.configured !== true) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity", "configured"], message: "Canonical Product Intent quantity configured state must agree with its source mapping." });
        }
        if (quantity.mapping?.source === "line_item_quantity" && ["per_piece", "quantity_tiers"].includes(quantity.mapping.pricingBehavior) && (quantity.mapping.variable !== "q" || quantity.lineItemQuantitySource !== true)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity", "mapping"], message: "Line-item quantity must map to q." });
        }
        if (quantity.quantityOnly && quantity.mapping?.pricingBehavior === "per_square_foot") {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity", "mapping"], message: "Quantity-only metadata cannot use square-foot pricing." });
        }
      }).optional(),
    })
    .optional(),
});

export const lineItemOptionSelectionsV2Schema: z.ZodType<LineItemOptionSelectionsV2> = z.object({
  schemaVersion: z.literal(2),
  selected: z.record(z.object({
    value: z.any(),
    note: z.string().optional(),
    origin: z.enum(["DEFAULT", "AI_INFERRED", "SOURCE_EVIDENCE", "USER_SELECTED"]).optional(),
    evidence: z.string().nullable().optional(),
  })),
  resolved: z
    .object({
      visibleNodeIds: z.array(z.string()).optional(),
      pathTags: z.array(z.string()).optional(),
    })
    .optional(),
});

export const choicePricingOverrideMetadataSchema: z.ZodType<ChoicePricingOverrideMetadata> = z.object({
  priceDeltaCents: z.number().int().optional(),
  pricingImpact: z.array(pricingImpactSchema).optional(),
  pricingOverride: choicePricingOverrideSchema.optional(),
});

export const appliedChoicePricingOverrideSchema: z.ZodType<AppliedChoicePricingOverride> = z.object({
  selectionKey: z.string(),
  optionLabel: z.string(),
  choiceValue: z.string(),
  choiceLabel: z.string(),
  mode: z.enum(["set_base_rate", "add_base_rate", "multiply_base_rate"]),
  amount: z.number().finite(),
  unit: choicePricingOverrideUnitSchema.optional(),
  appliesTo: choicePricingOverrideAppliesToSchema.optional(),
  label: z.string().optional(),
});

export const optionChoiceRuntimeSelectionSchema: z.ZodType<OptionChoiceRuntimeSelection> = z.object({
  nodeId: z.string(),
  selectionKey: z.string(),
  optionLabel: z.string(),
  choiceValue: z.string(),
  choiceLabel: z.string(),
  pricing: choicePricingOverrideMetadataSchema.optional(),
  material: choiceMaterialOverrideSchema.optional(),
  inventoryConsumption: z.array(inventoryConsumptionSchema).optional(),
  workflowTags: z.array(z.string()).optional(),
  role: z.enum(["variant", "modifier"]),
});

export const optionRuntimeSelectionContextSchema: z.ZodType<OptionRuntimeSelectionContext> = z.object({
  selectedChoices: z.record(z.string()),
  resolvedChoices: z.record(optionChoiceRuntimeSelectionSchema),
  visibleNodeIds: z.array(z.string()),
  visibleGroupIds: z.array(z.string()),
  visibleChoiceIds: z.array(z.string()),
  workflowTags: z.array(z.string()),
  appliedPricingOverrides: z.array(appliedChoicePricingOverrideSchema),
  hiddenSelectionWarnings: z.array(
    z.object({
      selectionKey: z.string(),
      choiceValue: z.string().optional(),
      reason: z.enum(["hidden_node", "hidden_choice"]),
    })
  ),
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
