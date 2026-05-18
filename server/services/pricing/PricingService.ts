/**
 * PricingService - Unified PBV2-only pricing for quotes and orders
 * 
 * This service replaces all legacy pricing logic (profiles, formulas, material pricing)
 * with a single PBV2-based pricing flow.
 */

import { db } from '../../db';
import { products, pbv2TreeVersions, materials } from '../../../shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { evaluate } from 'mathjs';
import { evaluateOptionTreeV2, pbv2ToWeightTotal } from '../optionTreeV2Evaluator';
import { buildFlatGoodsInput, flatGoodsCalculator, getProfile, type FlatGoodsConfig } from '../../../shared/pricingProfiles';
import type { 
  OptionTreeV2, 
  LineItemOptionSelectionsV2,
  OptionRuntimeSelectionContext,
} from '../../../shared/optionTreeV2';
import { normalizeSelectionMap, resolveRuntimeVisibility } from '../../../shared/optionTreeV2Runtime';
import {
  evaluateProductOptionRules,
  type ProductOptionRule,
  type ProductOptionRuleEvaluationResult,
} from '../../../shared/productOptionRules';
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from '../../../shared/pbv2/validator';
import type { Finding } from '../../../shared/pbv2/findings';
import {
  extractProductOptionPricingMatrix,
  resolveProductOptionPricingMatrix,
  type ProductOptionPricingMatrixErrorDetail,
  type ProductOptionPricingMatrixResolution,
} from '../../../shared/productOptionPricingMatrix';
import { PBV2_PRICING_VARIABLES, type PricingVariableDefinition } from '../../../shared/pbv2/pricingVariableRegistry';
import {
  buildFormulaScope,
  buildFormulaEvaluationScope,
  FORMULA_VARIABLE_PROTECTED_KEYS,
  MATRIX_VARIABLE_PROTECTED_KEYS,
} from '../../../shared/pbv2/formulaScope';
import { pbv2ToRuntimeSelectionContext, resolvePricingV2BaseRates } from '../../../shared/pbv2/pricingAdapter';
import { sheetConsumptionSqft } from '../../../shared/pbv2/formulaHelpers';
import {
  collectPbv2WeightMaterialIds,
  resolvePbv2WeightSource,
  type Pbv2WeightMaterialRecord,
  type Pbv2WeightWarning,
  type Pbv2WeightSource,
  type ResolvedPbv2WeightSource,
} from '../pbv2WeightResolver';
// @ts-ignore - NestingCalculator.js is plain JS without exported TS types
import NestingCalculator from '../../NestingCalculator.js';

export const PBV2_PREVIEW_FALLBACK_FORMULA = 'sqft * base_price * q';

// ============================================================================
// Types
// ============================================================================

export type PricingInput = {
  organizationId: string;
  productId: string;
  quantity: number;
  widthIn?: number;
  heightIn?: number;
  pbv2ExplicitSelections: Record<string, any>; // Option selections from frontend
  pbv2TreeVersionIdOverride?: string; // Optional: use specific tree version
  overridePriceCents?: number | null; // Manual price override (if set, skip calculation)
};

export type PricingOutput = {
  pbv2TreeVersionId: string;
  pbv2SnapshotJson: PBV2PricingSnapshot;
  lineTotalCents: number;
  breakdown: {
    baseCents: number;
    optionsCents: number;
    totalCents: number;
    nestingDetails?: unknown;
    pricingMethod?: string;
  };
  resolvedWeightSource?: ResolvedPbv2WeightSource;
  pricingOverrideApplied?: boolean; // True if overridePriceCents was used
};

export type PBV2PricingSnapshot = {
  treeVersionId: string;
  treeJson: any; // DB stores as jsonb, not strongly typed
  selections: Record<string, any>; // Option selections snapshot
  runtimeSelectionContext: OptionRuntimeSelectionContext;
  selectedOptions: any[];
  visibleNodeIds: string[];
  pricedAt: string; // ISO timestamp
  dimensions?: {
    widthIn?: number;
    heightIn?: number;
  };
  quantity: number;
  pricing: {
    baseCents: number;
    optionsCents: number;
    totalCents: number;
    nestingDetails?: unknown;
    pricingMethod?: string;
  };
  pbv2PricingSnapshot?: PBV2RuntimePricingSnapshot;
};

export type PBV2RuntimePricingSnapshot = {
  formula: string;
  formulaVariables: Record<string, number | string | boolean | null>;
  rawSelections: Record<string, any>;
  effectiveSelections: Record<string, any>;
  resolvedMatrixRowId?: string;
  resolvedMatrixVariables: Record<string, number>;
  calculatedPrice: number;
  capturedAt: string;
  resolvedWeightDebug?: PBV2ResolvedWeightSnapshotDebug;
};

export type PBV2ResolvedWeightSnapshotDebug = {
  totalOz: number | null;
  source: Pbv2WeightSource;
  sourceLabel?: string;
  materialId?: string;
  materialName?: string;
  materialSku?: string | null;
  weightValue?: number | null;
  weightUnit?: string | null;
  weightBasis?: string | null;
  weightOzPerBasis?: number | null;
  basisQuantity?: number | null;
  warnings: Pbv2WeightWarning[];
};

export type PricingPreviewEvaluationResult = {
  unitPrice: number;
  totalPrice: number;
  formulaUsed?: string;
  breakdown: {
    basePrice: number;
    optionsPrice: number;
    total: number;
    nestingDetails?: unknown;
    pricingMethod?: string;
  };
  derived: {
    sqft?: number;
    totalSqft?: number;
    linearFeet?: number;
    orderedWidth?: number;
    orderedHeight?: number;
    trimAllowanceX?: number;
    trimAllowanceY?: number;
    finishedWidth?: number;
    finishedHeight?: number;
  };
  debug?: {
    formulaRaw: string;
    formulaResolved?: string;
    variables: Record<string, number | string | boolean | null>;
    resultValue?: number;
    appliedAs?: 'unitPrice' | 'totalPrice' | 'unknown';
    steps?: Array<{ label: string; value: number | string }>;
    errors?: Array<{ code: string; message: string; detail?: any }>;
    usedFallbackFormula?: boolean;
    fallbackFormula?: string;
    preCeilSqftTotal?: number | null;
    postCeilSqftTotal?: number | null;
    rawSqftPerItem?: number;
    rawTotalSqft?: number;
    baseRateUsed?: number | null;
    inputs?: {
      widthIn: number;
      heightIn: number;
      quantity: number;
      ordered_width?: number;
      ordered_height?: number;
      trim_allowance_x?: number;
      trim_allowance_y?: number;
      finished_width?: number;
      finished_height?: number;
    };
    derived?: {
      sqft: number;
      totalSqft: number;
      linearFeet: number;
      ordered_width?: number;
      ordered_height?: number;
      trim_allowance_x?: number;
      trim_allowance_y?: number;
      finished_width?: number;
      finished_height?: number;
    };
    pricing?: {
      basePrice: number;
      optionsPrice: number;
      unitPrice: number;
      totalPrice: number;
    };
    runtimeSelectionContext?: OptionRuntimeSelectionContext;
    weight?: {
      baseWeightInput?: number | string | null;
      baseWeightSource?: 'meta.baseWeightOz' | 'shippingConfig.baseWeight' | 'none';
      baseWeightOz?: number | null;
      shippingConfigBaseWeight?: number | string | null;
      shippingConfigWeightUnit?: string | null;
      shippingConfigWeightBasis?: string | null;
      selectedWeightFields?: Array<{ label: string; oz: number }>;
      computedShippingWeightOz?: number | null;
      resolvedWeightSource?: Pbv2WeightSource;
      sourceLabel?: string;
      materialId?: string;
      materialName?: string;
      materialSku?: string | null;
      weightValue?: number | null;
      weightUnit?: string | null;
      weightBasis?: string | null;
      weightOzPerBasis?: number | null;
      basisQuantity?: number | null;
      warnings?: Pbv2WeightWarning[];
      warningCode?: string;
      errorCode?: string;
      errorMessage?: string;
    };
  };
};

export type PricingPreviewErrorDetail = {
  code: string;
  message: string;
  location?: number;
};

type PricingPreviewFormulaError = Error & {
  code: 'PBV2_FORMULA_ERROR';
  details: PricingPreviewErrorDetail[];
  debug?: PricingPreviewEvaluationResult['debug'];
};

export type Pbv2OptionRuleValidationDetail = {
  optionGroup: string;
  code: string;
  message: string;
};

export type Pbv2OptionRuleValidationError = Error & {
  code: 'PBV2_OPTION_RULE_VALIDATION_FAILED';
  details: Pbv2OptionRuleValidationDetail[];
  ruleEvaluation: ProductOptionRuleEvaluationResult;
};

export type Pbv2PricingMatrixError = Error & {
  code: 'PBV2_PRICING_MATRIX_ERROR';
  details: ProductOptionPricingMatrixErrorDetail[];
  resolution: ProductOptionPricingMatrixResolution;
};

export type Pbv2DefinitionValidationError = Error & {
  code: 'PBV2_DEFINITION_VALIDATION_FAILED';
  details: Finding[];
};

export function getPbv2PricingVariableDefinitions(): PricingVariableDefinition[] {
  return PBV2_PRICING_VARIABLES;
}

// ============================================================================
// Main Pricing Function
// ============================================================================

/**
 * Price a line item using PBV2 option tree evaluation
 * 
 * @throws Error if product not found, missing PBV2 tree, or evaluation fails
 */
export async function priceLineItem(input: PricingInput): Promise<PricingOutput> {
  const {
    organizationId,
    productId,
    quantity,
    widthIn,
    heightIn,
    pbv2ExplicitSelections,
    pbv2TreeVersionIdOverride,
    overridePriceCents,
  } = input;

  // Step 0: Check for manual price override
  // If override is set, return it immediately without calculating PBV2
  if (overridePriceCents != null && typeof overridePriceCents === 'number') {
    // Still need minimal tree data for snapshot (use active or override tree version)
    const product = await loadProduct(organizationId, productId);
    const treeVersionId = pbv2TreeVersionIdOverride 
      || resolvePbv2Override(product)
      || product.pbv2ActiveTreeVersionId;

    if (!treeVersionId) {
      throw new Error(
        `Product ${productId} does not have a PBV2 tree. ` +
        `All products must have pbv2_active_tree_version_id set.`
      );
    }

    const treeVersion = await loadTreeVersion(organizationId, treeVersionId);
    const pricingMethod = String(product.pricingProfileKey || "default");
    const ruleValidatedSelections = resolveRuleValidatedSelectionsForPricing(
      treeVersion.treeJson as any,
      pbv2ExplicitSelections || {}
    );
    const pricingMatrixResolution = resolvePricingMatrixVariablesForPricing(
      treeVersion.treeJson as any,
      ruleValidatedSelections.selected
    );
    const selectionsV2: LineItemOptionSelectionsV2 = {
      schemaVersion: 2,
      selected: ruleValidatedSelections.selected,
    };
    const runtimeSelectionContext = pbv2ToRuntimeSelectionContext(
      treeVersion.treeJson as any,
      ruleValidatedSelections.selected,
      {
        widthIn: widthIn ?? 0,
        heightIn: heightIn ?? 0,
        quantity,
        sqft: (widthIn ?? 0) > 0 && (heightIn ?? 0) > 0 ? ((widthIn ?? 0) * (heightIn ?? 0)) / 144 : 0,
      },
    );
    const weightMaterialRecords = await loadWeightMaterials(
      organizationId,
      collectPbv2WeightMaterialIds({
        runtimeSelectionContext,
        productPrimaryMaterialId: product.primaryMaterialId,
      }),
    );
    const resolvedWeightSource = resolvePbv2WeightSource({
      treeJson: treeVersion.treeJson,
      selections: { schemaVersion: 2, selected: ruleValidatedSelections.selected },
      runtimeSelectionContext,
      productPrimaryMaterialId: product.primaryMaterialId,
      materialRecords: weightMaterialRecords,
      widthIn: widthIn ?? 0,
      heightIn: heightIn ?? 0,
      quantity,
    });

    // Build minimal snapshot
    const pricedAt = new Date().toISOString();
    const snapshot: PBV2PricingSnapshot = {
      treeVersionId,
      treeJson: cloneJsonValue(treeVersion.treeJson),
      selections: cloneJsonValue(ruleValidatedSelections.selected),
      runtimeSelectionContext: cloneJsonValue(runtimeSelectionContext),
      selectedOptions: [],
      visibleNodeIds: [],
      pricedAt,
      dimensions: {
        widthIn: widthIn ?? undefined,
        heightIn: heightIn ?? undefined,
      },
      quantity,
      pricing: {
        baseCents: 0,
        optionsCents: 0,
        totalCents: overridePriceCents,
        pricingMethod,
      },
      pbv2PricingSnapshot: buildRuntimePricingSnapshot({
        treeJson: treeVersion.treeJson,
        product,
        rawSelections: pbv2ExplicitSelections || {},
        effectiveSelections: ruleValidatedSelections.selected,
        pricingMatrixResolution,
        widthIn: widthIn ?? 0,
        heightIn: heightIn ?? 0,
        quantity,
        calculatedPriceCents: overridePriceCents,
        capturedAt: pricedAt,
        resolvedWeightSource,
      }),
    };

    return {
      pbv2TreeVersionId: treeVersionId,
      pbv2SnapshotJson: snapshot,
      lineTotalCents: overridePriceCents,
      breakdown: {
        baseCents: 0,
        optionsCents: 0,
        totalCents: overridePriceCents,
        pricingMethod,
      },
      resolvedWeightSource,
      pricingOverrideApplied: true,
    };
  }

  // Step 1: Load product (with org scoping)
  const product = await loadProduct(organizationId, productId);

  // Step 2: Determine which tree version to use
  const treeVersionId = pbv2TreeVersionIdOverride 
    || resolvePbv2Override(product)
    || product.pbv2ActiveTreeVersionId;

  if (!treeVersionId) {
    throw new Error(
      `Product ${productId} does not have a PBV2 tree. ` +
      `All products must have pbv2_active_tree_version_id set.`
    );
  }

  // Step 3: Load tree version
  const treeVersion = await loadTreeVersion(organizationId, treeVersionId);
  const ruleValidatedSelections = resolveRuleValidatedSelectionsForPricing(
    treeVersion.treeJson as any,
    pbv2ExplicitSelections
  );
  const pricingMatrixResolution = resolvePricingMatrixVariablesForPricing(
    treeVersion.treeJson as any,
    ruleValidatedSelections.selected
  );

  const runtimeSelectionContext = pbv2ToRuntimeSelectionContext(
    treeVersion.treeJson as any,
    ruleValidatedSelections.selected,
    {
      widthIn: widthIn ?? 0,
      heightIn: heightIn ?? 0,
      quantity,
      sqft: (widthIn ?? 0) > 0 && (heightIn ?? 0) > 0 ? ((widthIn ?? 0) * (heightIn ?? 0)) / 144 : 0,
    },
  );
  const weightMaterialRecords = await loadWeightMaterials(
    organizationId,
    collectPbv2WeightMaterialIds({
      runtimeSelectionContext,
      productPrimaryMaterialId: product.primaryMaterialId,
    }),
  );
  const resolvedWeightSource = resolvePbv2WeightSource({
    treeJson: treeVersion.treeJson,
    selections: { schemaVersion: 2, selected: ruleValidatedSelections.selected },
    runtimeSelectionContext,
    productPrimaryMaterialId: product.primaryMaterialId,
    materialRecords: weightMaterialRecords,
    widthIn: widthIn ?? 0,
    heightIn: heightIn ?? 0,
    quantity,
  });

  // Step 4: Calculate base price from tree metadata with dimensions/quantity
  const baseDetails = calculateBasePriceDetails(treeVersion.treeJson, {
    widthIn: widthIn ?? 0,
    heightIn: heightIn ?? 0,
    quantity,
  }, {
    explicitSelections: ruleValidatedSelections.selected,
    runtimeSelectionContext,
    pricingProfileKey: product.pricingProfileKey,
    pricingProfileConfig: product.pricingProfileConfig,
    productLegacy: {
      sheetWidth: product.sheetWidth,
      sheetHeight: product.sheetHeight,
      materialType: product.materialType,
      minPricePerItem: product.minPricePerItem,
      nestingVolumePricing: product.nestingVolumePricing,
    },
  });
  const basePriceCents = baseDetails.totalCents;
  const pricingMethod = String(baseDetails.pricingProfileKey || "default");

  // Step 5: Map selections to LineItemOptionSelectionsV2 format
  // Frontend sends Record<string, any> as pbv2ExplicitSelections
  // Evaluator expects { schemaVersion: 2, selected: Record<nodeId, { value, note? }> }
  const selectionsV2: LineItemOptionSelectionsV2 = {
    schemaVersion: 2,
    selected: ruleValidatedSelections.selected,
  };

  // DEV: Build identifier and calculation path logging
  if (process.env.NODE_ENV === "development") {
    const PBV2_BUILD_ID = "PBV2_DEBUG_V2_INPUT_FIX";
    console.log(`[PBV2_CALC_PATH] Build: ${PBV2_BUILD_ID}`);
    console.log(`[PBV2_CALC_PATH] Evaluator: evaluateOptionTreeV2`);
    console.log(`[PBV2_CALC_PATH] TreeVersionId: ${treeVersionId}`);
    console.log(`[PBV2_CALC_PATH] Selection keys:`, Object.keys(ruleValidatedSelections.selected || {}));
  }

  // PBV2_DEBUG: Log pricing entry point
  if (process.env.PBV2_DEBUG === "1") {
    console.log("[PBV2_PRICING_ENTRY] " + JSON.stringify({ 
      productId, 
      pbv2TreeVersionId: treeVersionId, 
      selectionKeys: Object.keys(selectionsV2.selected || {}) 
    }));
  }

  // Step 6: Evaluate PBV2 options
  const evalResult = await evaluateOptionTreeV2({
    tree: treeVersion.treeJson,
    selections: selectionsV2,
    width: widthIn ?? 0,
    height: heightIn ?? 0,
    quantity,
    basePrice: basePriceCents / 100, // Convert cents to dollars for evaluator
  });

  // PBV2_DEBUG: Log evaluator return values
  if (process.env.PBV2_DEBUG === "1") {
    console.log("[PBV2_EVAL_RETURN] " + JSON.stringify({ 
      optionsPrice: evalResult.optionsPrice, 
      optionsPriceCents: Math.round(evalResult.optionsPrice * 100),
      selectedOptionsLen: evalResult.selectedOptions?.length || 0,
      visibleNodeIdsLen: evalResult.visibleNodeIds?.length || 0
    }));
  }

  // Step 7: Build pricing breakdown
  // NOTE: basePriceCents already includes quantity (line-total from calculateBasePrice)
  // NOTE: optionsCents already includes quantity (evaluator multiplies internally)
  const optionsCents = Math.round(evalResult.optionsPrice * 100);
  const lineTotalCents = basePriceCents + optionsCents;

  // Debug log to verify quantity applied once
  console.log('[PBV2_PRICING_DEBUG]', {
    widthIn: widthIn ?? 0,
    heightIn: heightIn ?? 0,
    quantity,
    sqftPerItem: widthIn && heightIn ? ((widthIn * heightIn) / 144).toFixed(2) : 0,
    baseCents: basePriceCents,
    optionsCents,
    lineTotalCents,
    perUnitEstimate: quantity > 0 ? (lineTotalCents / quantity).toFixed(2) : 0,
  });

  // PBV2_DEBUG: Log final pricing result
  if (process.env.PBV2_DEBUG === "1") {
    console.log("[PBV2_PRICING_RESULT] " + JSON.stringify({ 
      basePriceCents, 
      optionsCents, 
      lineTotalCents 
    }));
  }

  // Step 8: Build snapshot
  const pricedAt = new Date().toISOString();
  const snapshot: PBV2PricingSnapshot = {
    treeVersionId,
    treeJson: cloneJsonValue(treeVersion.treeJson),
    selections: cloneJsonValue(ruleValidatedSelections.selected),
    runtimeSelectionContext: cloneJsonValue(runtimeSelectionContext),
    selectedOptions: cloneJsonValue(evalResult.selectedOptions),
    visibleNodeIds: cloneJsonValue(evalResult.visibleNodeIds),
    pricedAt,
    dimensions: widthIn || heightIn ? { widthIn, heightIn } : undefined,
    quantity,
    pricing: {
      baseCents: basePriceCents,
      optionsCents,
      totalCents: lineTotalCents, // Changed from totalCents to lineTotalCents for clarity
      nestingDetails: baseDetails.nestingDetails,
      pricingMethod,
    },
    pbv2PricingSnapshot: buildRuntimePricingSnapshot({
      treeJson: treeVersion.treeJson,
      product,
      rawSelections: pbv2ExplicitSelections || {},
      effectiveSelections: ruleValidatedSelections.selected,
      pricingMatrixResolution,
      widthIn: widthIn ?? 0,
      heightIn: heightIn ?? 0,
      quantity,
      baseDetails,
      calculatedPriceCents: lineTotalCents,
      capturedAt: pricedAt,
      resolvedWeightSource,
    }),
  };

  return {
    pbv2TreeVersionId: treeVersionId,
    pbv2SnapshotJson: snapshot,
    lineTotalCents,
    breakdown: {
      baseCents: basePriceCents,
      optionsCents,
      totalCents: lineTotalCents, // Changed from totalCents to lineTotalCents for clarity
      nestingDetails: baseDetails.nestingDetails,
      pricingMethod,
    },
    resolvedWeightSource,
  };
}

/**
 * Read-only pricing preview for PBV2 draft trees.
 * Uses the same base-price + evaluateOptionTreeV2 path as production quote pricing.
 */
export function evaluatePricingPreviewFromTree(input: {
  treeJson: any;
  widthIn: number;
  heightIn: number;
  quantity: number;
  pbv2ExplicitSelections?: Record<string, any>;
  pricingFormulaOverride?: string | null;
  pricingProfileKey?: string | null;
  pricingProfileConfig?: unknown;
  formulaVariables?: Record<string, number>;
  productPrimaryMaterialId?: string | null;
  materialRecords?: Pbv2WeightMaterialRecord[];
  debug?: boolean;
}): PricingPreviewEvaluationResult {
  const widthIn = Number(input.widthIn);
  const heightIn = Number(input.heightIn);
  const quantity = Number(input.quantity);

  if (!Number.isFinite(widthIn) || widthIn <= 0) {
    throw new Error("width must be a positive number");
  }
  if (!Number.isFinite(heightIn) || heightIn <= 0) {
    throw new Error("height must be a positive number");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("quantity must be a positive number");
  }

  const pbv2ExplicitSelections = input.pbv2ExplicitSelections ?? {};
  if (!pbv2ExplicitSelections || typeof pbv2ExplicitSelections !== "object" || Array.isArray(pbv2ExplicitSelections)) {
    throw new Error("optionSelectionsJson must be an object mapping optionId -> selection");
  }

  assertRuleAndMatrixDefinitionsValidForPricing(input.treeJson);

  const selectionsV2: LineItemOptionSelectionsV2 = {
    schemaVersion: 2,
    selected: pbv2ExplicitSelections,
  };
  const ruleValidatedSelections = resolveRuleValidatedSelectionsForPricing(input.treeJson, selectionsV2);
  const pricingMatrixResolution = resolvePricingMatrixVariablesForPricing(
    input.treeJson,
    ruleValidatedSelections.selected
  );
  const runtimeSelectionContext = pbv2ToRuntimeSelectionContext(
    input.treeJson as any,
    ruleValidatedSelections.selected,
    {
      widthIn,
      heightIn,
      quantity,
      sqft: widthIn > 0 && heightIn > 0 ? (widthIn * heightIn) / 144 : 0,
    },
  );

  const baseDetails = calculateBasePriceDetails(input.treeJson, {
    widthIn,
    heightIn,
    quantity,
  }, {
    explicitSelections: ruleValidatedSelections.selected,
    runtimeSelectionContext,
    pricingProfileKey: input.pricingProfileKey,
    pricingProfileConfig: input.pricingProfileConfig,
  });
  let basePriceCents = baseDetails.totalCents;
  const pricingMethod = String(baseDetails.pricingProfileKey || "default");

  const activeProfile = getProfile(baseDetails.pricingProfileKey);
  const profileUsesFormula = Boolean(activeProfile.usesFormula);

  const formulaFromTree = typeof input?.treeJson?.meta?.pricingFormula === 'string'
    ? input.treeJson.meta.pricingFormula.trim()
    : '';
  const overrideFormula = typeof input.pricingFormulaOverride === 'string'
    ? input.pricingFormulaOverride.trim()
    : '';
  const formulaCandidate = overrideFormula || formulaFromTree;
  const usedFallbackFormula = profileUsesFormula && !formulaCandidate;
  const formulaToUse = profileUsesFormula ? (formulaCandidate || PBV2_PREVIEW_FALLBACK_FORMULA) : '';

  const formulaDebug = buildBaseFormulaDebugContext({
    formulaRaw: formulaToUse,
    orderedWidthIn: baseDetails.orderedWidthIn,
    orderedHeightIn: baseDetails.orderedHeightIn,
    trimAllowanceX: baseDetails.trimAllowanceX,
    trimAllowanceY: baseDetails.trimAllowanceY,
    finishedWidthIn: baseDetails.finishedWidthIn,
    finishedHeightIn: baseDetails.finishedHeightIn,
    quantity,
    baseRatePerSqft: baseDetails.perSqftCents / 100,
    sqftPerItem: baseDetails.sqftPerItem,
    totalSqft: baseDetails.totalSqft,
    linearFeet: baseDetails.linearFeet,
    usedFallbackFormula,
    formulaVariables: input.formulaVariables,
    pricingMatrixVariables: pricingMatrixResolution.variables,
  });
  const weightDebug = buildPricingPreviewWeightDebug({
    treeJson: input.treeJson,
    selections: {
      schemaVersion: 2,
      selected: ruleValidatedSelections.selected,
    },
    runtimeSelectionContext,
    productPrimaryMaterialId: input.productPrimaryMaterialId,
    materialRecords: input.materialRecords,
    widthIn,
    heightIn,
    quantity,
  });

  if (profileUsesFormula) {
    let formulaEvaluation;
    try {
      formulaEvaluation = evaluatePreviewFormulaToCents({
        formula: formulaToUse,
        orderedWidthIn: baseDetails.orderedWidthIn,
        orderedHeightIn: baseDetails.orderedHeightIn,
        trimAllowanceX: baseDetails.trimAllowanceX,
        trimAllowanceY: baseDetails.trimAllowanceY,
        finishedWidthIn: baseDetails.finishedWidthIn,
        finishedHeightIn: baseDetails.finishedHeightIn,
        quantity,
        baseRatePerSqft: baseDetails.perSqftCents / 100,
        sqftPerItem: baseDetails.sqftPerItem,
        totalSqft: baseDetails.totalSqft,
        linearFeet: baseDetails.linearFeet,
        usedFallbackFormula,
        fallbackFormula: PBV2_PREVIEW_FALLBACK_FORMULA,
        formulaVariables: input.formulaVariables,
        pricingMatrixVariables: pricingMatrixResolution.variables,
      });
    } catch (error: any) {
      if (error?.code === 'PBV2_FORMULA_ERROR' && error?.debug) {
        error.debug = {
          ...error.debug,
          weight: weightDebug,
        };
      }
      throw error;
    }
    formulaDebug.formulaResolved = formulaEvaluation.formulaResolved;
    formulaDebug.resultValue = formulaEvaluation.resultValue;
    formulaDebug.appliedAs = formulaEvaluation.appliedAs;
    formulaDebug.steps = formulaEvaluation.steps;
    formulaDebug.preCeilSqftTotal = formulaEvaluation.preCeilSqftTotal;
    formulaDebug.postCeilSqftTotal = formulaEvaluation.postCeilSqftTotal;
    formulaDebug.baseRateUsed = formulaEvaluation.baseRateUsed;

    const formulaValueCents = Math.round(formulaEvaluation.resultValue * 100);
    basePriceCents = formulaEvaluation.appliedAs === 'unitPrice'
      ? formulaValueCents * quantity
      : formulaValueCents;
  }

  const evalResult = evaluateOptionTreeV2({
    tree: input.treeJson,
    selections: {
      schemaVersion: 2,
      selected: ruleValidatedSelections.selected,
    },
    width: widthIn,
    height: heightIn,
    quantity,
    basePrice: basePriceCents / 100,
  });

  const optionsCents = Math.round(evalResult.optionsPrice * 100);
  const totalCents = basePriceCents + optionsCents;
  const sqft = baseDetails.sqftPerItem;
  const totalSqft = baseDetails.totalSqft;
  const linearFeet = baseDetails.linearFeet;

  return {
    unitPrice: quantity > 0 ? totalCents / 100 / quantity : 0,
    totalPrice: totalCents / 100,
    formulaUsed: formulaToUse || undefined,
    breakdown: {
      basePrice: basePriceCents / 100,
      optionsPrice: optionsCents / 100,
      total: totalCents / 100,
      nestingDetails: baseDetails.nestingDetails,
      pricingMethod,
    },
    derived: {
      sqft: Number.isFinite(sqft) ? sqft : undefined,
      totalSqft: Number.isFinite(totalSqft) ? totalSqft : undefined,
      linearFeet: Number.isFinite(linearFeet) ? linearFeet : undefined,
      orderedWidth: Number.isFinite(baseDetails.orderedWidthIn) ? baseDetails.orderedWidthIn : undefined,
      orderedHeight: Number.isFinite(baseDetails.orderedHeightIn) ? baseDetails.orderedHeightIn : undefined,
      trimAllowanceX: Number.isFinite(baseDetails.trimAllowanceX) ? baseDetails.trimAllowanceX : undefined,
      trimAllowanceY: Number.isFinite(baseDetails.trimAllowanceY) ? baseDetails.trimAllowanceY : undefined,
      finishedWidth: Number.isFinite(baseDetails.finishedWidthIn) ? baseDetails.finishedWidthIn : undefined,
      finishedHeight: Number.isFinite(baseDetails.finishedHeightIn) ? baseDetails.finishedHeightIn : undefined,
    },
    debug: input.debug ? {
      formulaRaw: formulaDebug.formulaRaw,
      formulaResolved: formulaDebug.formulaResolved,
      variables: formulaDebug.variables,
      resultValue: formulaDebug.resultValue,
      appliedAs: formulaDebug.appliedAs,
      steps: formulaDebug.steps,
      errors: formulaDebug.errors,
      usedFallbackFormula,
      fallbackFormula: usedFallbackFormula ? PBV2_PREVIEW_FALLBACK_FORMULA : undefined,
      preCeilSqftTotal: formulaDebug.preCeilSqftTotal,
      postCeilSqftTotal: formulaDebug.postCeilSqftTotal,
      rawSqftPerItem: widthIn > 0 && heightIn > 0 ? (widthIn * heightIn) / 144 : 0,
      rawTotalSqft: (widthIn > 0 && heightIn > 0 ? (widthIn * heightIn) / 144 : 0) * quantity,
      baseRateUsed: formulaDebug.baseRateUsed,
      inputs: {
        widthIn,
        heightIn,
        quantity,
        ordered_width: baseDetails.orderedWidthIn,
        ordered_height: baseDetails.orderedHeightIn,
        trim_allowance_x: baseDetails.trimAllowanceX,
        trim_allowance_y: baseDetails.trimAllowanceY,
        finished_width: baseDetails.finishedWidthIn,
        finished_height: baseDetails.finishedHeightIn,
      },
      derived: {
        sqft,
        totalSqft,
        linearFeet,
        ordered_width: baseDetails.orderedWidthIn,
        ordered_height: baseDetails.orderedHeightIn,
        trim_allowance_x: baseDetails.trimAllowanceX,
        trim_allowance_y: baseDetails.trimAllowanceY,
        finished_width: baseDetails.finishedWidthIn,
        finished_height: baseDetails.finishedHeightIn,
      },
      pricing: {
        basePrice: basePriceCents / 100,
        optionsPrice: optionsCents / 100,
        unitPrice: quantity > 0 ? totalCents / 100 / quantity : 0,
        totalPrice: totalCents / 100,
      },
      runtimeSelectionContext,
      weight: weightDebug,
    } : undefined,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function extractProductOptionRules(tree: any): ProductOptionRule[] {
  const candidates = [
    tree?.rules,
    tree?.optionRules,
    tree?.meta?.optionRules,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as ProductOptionRule[];
  }

  return [];
}

function extractNodesRecord(tree: any): Record<string, any> {
  const nodesRaw = tree?.nodes;
  if (Array.isArray(nodesRaw)) {
    const out: Record<string, any> = {};
    for (const node of nodesRaw) {
      if (node && typeof node === "object" && typeof node.id === "string" && node.id.trim()) {
        out[node.id] = node;
      }
    }
    return out;
  }

  if (nodesRaw && typeof nodesRaw === "object") {
    return nodesRaw as Record<string, any>;
  }

  return {};
}

function getNodeSelectionKey(node: any): string | null {
  const input = node?.input && typeof node.input === "object" ? node.input : null;
  if (typeof input?.selectionKey === "string" && input.selectionKey.trim()) return input.selectionKey;
  if (typeof node?.key === "string" && node.key.trim()) return node.key;
  if (typeof node?.id === "string" && node.id.trim()) return node.id;
  return null;
}

function collectTreeOptionGroupKeys(tree: any): string[] {
  const out = new Set<string>();
  const nodes = extractNodesRecord(tree);
  for (const node of Object.values(nodes)) {
    if (!node || typeof node !== "object") continue;
    if (node.kind === "group") continue;
    const selectionKey = getNodeSelectionKey(node);
    if (selectionKey) out.add(selectionKey);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function collectRequiredOptionGroupKeys(tree: any): string[] {
  const out = new Set<string>();
  const nodes = extractNodesRecord(tree);
  for (const node of Object.values(nodes)) {
    if (!node || typeof node !== "object") continue;
    if (!node?.input?.required) continue;
    const selectionKey = getNodeSelectionKey(node);
    if (selectionKey) out.add(selectionKey);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function collectVisibleOptionGroupKeys(tree: any, visibleNodeIds: string[]): string[] {
  const nodes = extractNodesRecord(tree);
  const out = new Set<string>();
  for (const nodeId of visibleNodeIds) {
    const node = nodes[nodeId];
    if (!node || typeof node !== "object") continue;
    if (node.kind === "group") continue;
    const selectionKey = getNodeSelectionKey(node);
    if (selectionKey) out.add(selectionKey);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function toSelectionEntryMap(selections: LineItemOptionSelectionsV2 | Record<string, unknown> | undefined): Record<string, { value?: any; note?: string }> {
  if (!selections || typeof selections !== "object") return {};

  const selectedRaw =
    "selected" in selections && selections.selected && typeof selections.selected === "object"
      ? selections.selected as Record<string, unknown>
      : selections as Record<string, unknown>;

  const out: Record<string, { value?: any; note?: string }> = {};
  for (const [selectionKey, rawValue] of Object.entries(selectedRaw)) {
    if (!selectionKey) continue;
    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) && Object.prototype.hasOwnProperty.call(rawValue, "value")) {
      const entry = rawValue as { value?: any; note?: string };
      out[selectionKey] = {
        value: entry.value,
        ...(typeof entry.note === "string" ? { note: entry.note } : {}),
      };
    } else {
      out[selectionKey] = { value: rawValue };
    }
  }
  return out;
}

function optionRuleValidationError(
  details: Pbv2OptionRuleValidationDetail[],
  ruleEvaluation: ProductOptionRuleEvaluationResult
): Pbv2OptionRuleValidationError {
  const error = new Error(details.map((detail) => detail.message).join(" ")) as Pbv2OptionRuleValidationError;
  error.code = "PBV2_OPTION_RULE_VALIDATION_FAILED";
  error.details = details;
  error.ruleEvaluation = ruleEvaluation;
  return error;
}

function pricingMatrixError(
  details: ProductOptionPricingMatrixErrorDetail[],
  resolution: ProductOptionPricingMatrixResolution
): Pbv2PricingMatrixError {
  const error = new Error(details.map((detail) => detail.message).join(" ")) as Pbv2PricingMatrixError;
  error.code = "PBV2_PRICING_MATRIX_ERROR";
  error.details = details;
  error.resolution = resolution;
  return error;
}

function isRuleOrMatrixDefinitionFinding(finding: Finding): boolean {
  return finding.code.startsWith("PBV2_E_OPTION_RULE_") || finding.code.startsWith("PBV2_E_PRICING_MATRIX_");
}

function assertRuleAndMatrixDefinitionsValidForPricing(tree: any): void {
  const validation = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
  const details = validation.errors.filter(isRuleOrMatrixDefinitionFinding);
  if (details.length === 0) return;

  const error = new Error(details.map((detail) => detail.message).join(" ")) as Pbv2DefinitionValidationError;
  error.code = "PBV2_DEFINITION_VALIDATION_FAILED";
  error.details = details;
  throw error;
}

/**
 * Build a map from option group key / selectionKey / node id → human-readable label.
 * Used to replace raw node IDs in pricing matrix error messages.
 */
function buildOptionGroupLabelMap(tree: any): Map<string, string> {
  const map = new Map<string, string>();
  const nodesRaw = tree?.nodes;
  const nodes: any[] = Array.isArray(nodesRaw)
    ? nodesRaw
    : nodesRaw && typeof nodesRaw === 'object' ? Object.values(nodesRaw) : [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const label = String(node.label || node.key || node.id || '');
    if (!label) continue;
    const selectionKey = node?.input?.selectionKey;
    if (selectionKey && typeof selectionKey === 'string') map.set(selectionKey, label);
    if (node.key && typeof node.key === 'string') map.set(String(node.key), label);
    if (node.id && typeof node.id === 'string') map.set(String(node.id), label);
  }
  return map;
}

function resolvePricingMatrixVariablesForPricing(
  tree: any,
  selections: LineItemOptionSelectionsV2 | Record<string, unknown> | undefined
): ProductOptionPricingMatrixResolution {
  const pricingMatrix = extractProductOptionPricingMatrix(tree);
  const resolution = resolveProductOptionPricingMatrix({
    pricingMatrix,
    selections,
  });

  if (resolution.errors.length > 0) {
    const missingSelections = resolution.errors.filter(
      (e) => e.code === 'PBV2_PRICING_MATRIX_MISSING_SELECTION'
    );
    if (missingSelections.length > 0) {
      const labelMap = buildOptionGroupLabelMap(tree);
      const labels = missingSelections.map(
        (e) => labelMap.get(e.optionGroup ?? '') ?? e.optionGroup ?? 'Unknown option'
      );
      const humanMessage = `Select required options before pricing: ${labels.join(', ')}.`;
      const humanDetails = missingSelections.map((e, i) => ({
        ...e,
        message: `${labels[i]} is required to resolve pricing matrix variables.`,
      }));
      const err = new Error(humanMessage) as Pbv2PricingMatrixError;
      err.code = 'PBV2_PRICING_MATRIX_ERROR';
      err.details = humanDetails;
      err.resolution = resolution;
      throw err;
    }
    throw pricingMatrixError(resolution.errors, resolution);
  }

  return resolution;
}

function resolveRuleValidatedSelectionsForPricing(
  tree: any,
  selections: LineItemOptionSelectionsV2 | Record<string, unknown> | undefined
): { selected: Record<string, { value?: any; note?: string }>; ruleEvaluation?: ProductOptionRuleEvaluationResult } {
  const rules = extractProductOptionRules(tree);
  if (rules.length === 0) {
    return { selected: toSelectionEntryMap(selections) };
  }

  const explicitSelections = normalizeSelectionMap(selections);
  const runtimeVisibility = resolveRuntimeVisibility(tree, {
    schemaVersion: 2,
    selected: toSelectionEntryMap(selections),
  });

  const structuralDetails: Pbv2OptionRuleValidationDetail[] = [];
  for (const optionGroup of Object.keys(explicitSelections).sort((a, b) => a.localeCompare(b))) {
    if (Object.prototype.hasOwnProperty.call(runtimeVisibility.effectiveSelections, optionGroup)) continue;
    structuralDetails.push({
      optionGroup,
      code: "PBV2_OPTION_SELECTION_NOT_VISIBLE",
      message: `${optionGroup} is not available for the current product selections.`,
    });
  }

  const ruleEvaluation = evaluateProductOptionRules({
    rules,
    selections: runtimeVisibility.effectiveSelections,
    optionGroups: collectTreeOptionGroupKeys(tree),
    visibleOptionGroups: collectVisibleOptionGroupKeys(tree, runtimeVisibility.visibleNodeIds),
    requiredOptionGroups: collectRequiredOptionGroupKeys(tree),
  });

  const ruleDetails: Pbv2OptionRuleValidationDetail[] = [
    ...ruleEvaluation.errors.map((entry) => ({
      optionGroup: entry.optionGroup,
      code: entry.code,
      message: entry.message,
    })),
    ...ruleEvaluation.clearedOptionGroups.map((optionGroup) => ({
      optionGroup,
      code: "PBV2_OPTION_SELECTION_CLEARED_BY_RULE",
      message: `${optionGroup} is not valid for the current selections and must be cleared before pricing.`,
    })),
  ];

  const details = [...structuralDetails, ...ruleDetails];
  if (details.length > 0) {
    throw optionRuleValidationError(details, ruleEvaluation);
  }

  return {
    selected: toSelectionEntryMap(ruleEvaluation.effectiveSelections),
    ruleEvaluation,
  };
}

/**
 * Load product from database with organization scoping
 */
async function loadProduct(organizationId: string, productId: string) {
  const [product] = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.id, productId),
        eq(products.organizationId, organizationId)
      )
    )
    .limit(1);

  if (!product) {
    throw new Error(
      `Product ${productId} not found in organization ${organizationId}`
    );
  }

  return product;
}

async function loadWeightMaterials(organizationId: string, materialIds: string[]): Promise<Pbv2WeightMaterialRecord[]> {
  const uniqueMaterialIds = Array.from(new Set(materialIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueMaterialIds.length === 0) return [];

  return db
    .select()
    .from(materials)
    .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, uniqueMaterialIds)));
}

/**
 * Check for pbv2Override in product's pricingProfileConfig
 * 
 * Legacy field reused for PBV2 version overrides:
 * pricingProfileConfig: { pbv2Override: { enabled: true, versionId: "..." } }
 */
function resolvePbv2Override(product: any): string | null {
  if (!product.pricingProfileConfig) return null;

  const config = product.pricingProfileConfig as any;
  if (config.pbv2Override?.enabled && config.pbv2Override?.versionId) {
    return config.pbv2Override.versionId;
  }

  return null;
}

/**
 * Load PBV2 tree version from database
 */
async function loadTreeVersion(organizationId: string, treeVersionId: string) {
  const [treeVersion] = await db
    .select()
    .from(pbv2TreeVersions)
    .where(
      and(
        eq(pbv2TreeVersions.id, treeVersionId),
        eq(pbv2TreeVersions.organizationId, organizationId)
      )
    )
    .limit(1);

  if (!treeVersion) {
    throw new Error(
      `PBV2 tree version ${treeVersionId} not found in organization ${organizationId}`
    );
  }

  if (!treeVersion.treeJson) {
    throw new Error(
      `PBV2 tree version ${treeVersionId} has no tree data`
    );
  }

  // Log loaded tree details at debug level
  const treeSchemaVersion = (treeVersion.treeJson as any)?.schemaVersion ?? 'unknown';
  console.log(`[PBV2_PRICING_DEBUG] Loaded tree: versionId=${treeVersionId} schemaVersion=${treeSchemaVersion} status=${treeVersion.status}`);

  // DEV: Sample tree nodes to check for choice-level pricingImpact
  if (process.env.NODE_ENV === "development") {
    const nodes = (treeVersion.treeJson as any)?.nodes || {};
    const nodeIds = Object.keys(nodes);
    console.log(`[PBV2_TREE_DEBUG] Tree has ${nodeIds.length} nodes`);
    
    // Find first node with choices that have pricingImpact
    for (const nodeId of nodeIds.slice(0, 10)) {  // Check first 10 nodes
      const node = nodes[nodeId];
      if (Array.isArray(node?.choices)) {
        const choicesWithPricing = node.choices.filter((c: any) => Array.isArray(c.pricingImpact) && c.pricingImpact.length > 0);
        if (choicesWithPricing.length > 0) {
          console.log(`[PBV2_TREE_DEBUG] Node "${node.label}" (${nodeId}) has ${choicesWithPricing.length} choices with pricing:`);
          choicesWithPricing.forEach((c: any) => {
            console.log(`  - Choice "${c.label}" (value: ${c.value}): ${c.pricingImpact.length} impacts`, JSON.stringify(c.pricingImpact));
          });
        }
      }
    }
  }

  // CRITICAL: Validate schemaVersion = 2
  if (treeSchemaVersion !== 2) {
    const error = new Error(
      `PBV2 tree version ${treeVersionId} has outdated schema (v${treeSchemaVersion}). ` +
      `This product's active PBV2 config must be upgraded to v2. ` +
      `Open the product in the PBV2 builder and re-save to upgrade, then activate.`
    );
    (error as any).code = 'PBV2_E_SCHEMA_VERSION_MISMATCH';
    (error as any).schemaVersion = treeSchemaVersion;
    throw error;
  }

  assertRuleAndMatrixDefinitionsValidForPricing(treeVersion.treeJson as any);

  return treeVersion;
}

/**
 * Calculate base price from PBV2 tree metadata with tier-based pricing
 * 
 * PBV2 trees store base price in meta.pricingV2.base with optional qtyTiers and sqftTiers:
 * {
 *   meta: {
 *     pricingV2: {
 *       base: { perSqftCents, perPieceCents, minimumChargeCents },
 *       qtyTiers: [{ minQty, perSqftCents?, perPieceCents?, minimumChargeCents? }, ...],
 *       sqftTiers: [{ minSqft, perSqftCents?, perPieceCents?, minimumChargeCents? }, ...]
 *     }
 *   }
 * }
 * 
 * This mirrors computeBasePriceFromPricingV2 in shared/pbv2/pricingAdapter.ts
 */
function calculateBasePrice(
  tree: any,
  context: { widthIn: number; heightIn: number; quantity: number },
  pricingContext?: {
    explicitSelections?: Record<string, any>;
    runtimeSelectionContext?: OptionRuntimeSelectionContext;
    pricingProfileKey?: string | null;
    pricingProfileConfig?: unknown;
    productLegacy?: {
      sheetWidth?: string | null;
      sheetHeight?: string | null;
      materialType?: "sheet" | "roll" | null;
      minPricePerItem?: string | null;
      nestingVolumePricing?: any;
    };
  },
): number {
  return calculateBasePriceDetails(tree, context, pricingContext).totalCents;
}

function calculateBasePriceDetails(
  tree: any,
  context: { widthIn: number; heightIn: number; quantity: number },
  pricingContext?: {
    explicitSelections?: Record<string, any>;
    runtimeSelectionContext?: OptionRuntimeSelectionContext;
    pricingProfileKey?: string | null;
    pricingProfileConfig?: unknown;
    productLegacy?: {
      sheetWidth?: string | null;
      sheetHeight?: string | null;
      materialType?: "sheet" | "roll" | null;
      minPricePerItem?: string | null;
      nestingVolumePricing?: any;
    };
  },
): {
  totalCents: number;
  perSqftCents: number;
  perPieceCents: number;
  minimumChargeCents: number;
  pricingProfileKey: string;
  orderedWidthIn: number;
  orderedHeightIn: number;
  trimAllowanceX: number;
  trimAllowanceY: number;
  finishedWidthIn: number;
  finishedHeightIn: number;
  sqftPerItem: number;
  totalSqft: number;
  linearFeet: number;
  nestingDetails?: unknown;
} {
  const meta = tree?.meta;
  if (!meta || typeof meta !== 'object') {
    throw new Error(
      'PBV2 tree metadata missing. Base pricing configuration required.'
    );
  }

  const pricingV2 = (meta as any).pricingV2;
  if (!pricingV2 || typeof pricingV2 !== 'object') {
    throw new Error(
      'PBV2 tree base pricing (meta.pricingV2) not configured. Configure base pricing before using this product.'
    );
  }

  const base = pricingV2.base;
  if (!base || typeof base !== 'object') {
    throw new Error(
      'PBV2 tree base pricing (meta.pricingV2.base) not configured. Set at least one of: $/sqft, $/piece, or minimum charge.'
    );
  }

  let perSqftCents = typeof base.perSqftCents === 'number' ? base.perSqftCents : 0;
  let perPieceCents = typeof base.perPieceCents === 'number' ? base.perPieceCents : 0;
  let minimumChargeCents = typeof base.minimumChargeCents === 'number' ? base.minimumChargeCents : 0;

  const { widthIn, heightIn, quantity } = context;
  const profileFromTree = typeof (meta as any)?.pricingProfileKey === 'string'
    ? String((meta as any).pricingProfileKey)
    : null;
  const activePricingProfileKey =
    pricingContext?.pricingProfileKey
    ?? profileFromTree
    ?? 'default';
  const activeProfileConfig = (pricingContext?.pricingProfileConfig ?? (meta as any)?.pricingProfileConfig ?? null) as FlatGoodsConfig | null;

  const { trimAllowanceX, trimAllowanceY } = getTrimAllowancesInches(tree);
  const orderedWidthIn = widthIn > 0 ? widthIn : 0;
  const orderedHeightIn = heightIn > 0 ? heightIn : 0;
  const finishedWidthIn = orderedWidthIn + trimAllowanceX;
  const finishedHeightIn = orderedHeightIn + trimAllowanceY;
  const sqftPerItem = finishedWidthIn > 0 && finishedHeightIn > 0 ? (finishedWidthIn * finishedHeightIn) / 144 : 0;

  const resolvedBaseRates = resolvePricingV2BaseRates(
    tree,
    pricingContext?.explicitSelections,
    {
      widthIn: orderedWidthIn,
      heightIn: orderedHeightIn,
      quantity,
      sqft: sqftPerItem,
    },
    {
      runtimeSelectionContext: pricingContext?.runtimeSelectionContext,
    }
  );
  perSqftCents = resolvedBaseRates.perSqftCents;
  perPieceCents = resolvedBaseRates.perPieceCents;
  minimumChargeCents = resolvedBaseRates.minimumChargeCents;

  if (perSqftCents === 0 && perPieceCents === 0 && minimumChargeCents === 0) {
    throw new Error(
      'This product needs base pricing configured before it can be quoted. Please edit the product and set at least one base price ($/sqft, $/piece, or minimum charge) in the Base Pricing section.'
    );
  }

  // Compute line base total: perSqft applies to total sqft across all items
  const totalSqft = sqftPerItem * quantity;
  const sqftComponent = perSqftCents * totalSqft;
  const pieceComponent = perPieceCents * quantity;
  const lineBaseCents = sqftComponent + pieceComponent;
  const linearFeet = orderedWidthIn > 0 ? orderedWidthIn / 12 : 0;

  if (activePricingProfileKey === 'flat_goods') {
    const productLegacy = pricingContext?.productLegacy ?? {};
    const flatGoodsInput = buildFlatGoodsInput(
      activeProfileConfig,
      {
        sheetWidth: productLegacy.sheetWidth,
        sheetHeight: productLegacy.sheetHeight,
        materialType: productLegacy.materialType,
        minPricePerItem: productLegacy.minPricePerItem,
        nestingVolumePricing: productLegacy.nestingVolumePricing,
      },
      {
        basePricePerSqft: (perSqftCents / 100).toString(),
      },
      finishedWidthIn,
      finishedHeightIn,
      quantity,
      null,
    );

    const flatGoodsResult = flatGoodsCalculator(
      flatGoodsInput,
      (sheetWidth, sheetHeight, sheetCost, minPricePerItem, volumePricing, allowRotation) =>
        new NestingCalculator(
          sheetWidth,
          sheetHeight,
          sheetCost,
          minPricePerItem,
          volumePricing,
          null,
          allowRotation ?? true,
        ),
    );

    if (flatGoodsResult.error) {
      throw new Error(flatGoodsResult.error);
    }

    return {
      totalCents: Math.round(flatGoodsResult.totalPrice * 100),
      perSqftCents,
      perPieceCents,
      minimumChargeCents,
      pricingProfileKey: activePricingProfileKey,
      orderedWidthIn,
      orderedHeightIn,
      trimAllowanceX,
      trimAllowanceY,
      finishedWidthIn,
      finishedHeightIn,
      sqftPerItem,
      totalSqft,
      linearFeet,
      nestingDetails: {
        ...flatGoodsResult.nestingDetails,
        sheetCount: flatGoodsResult.sheetCount,
        usedSqft: flatGoodsResult.usedSqft,
      },
    };
  }

  // Apply minimum charge once per line item (not per unit)
  const total = minimumChargeCents > 0 ? Math.max(lineBaseCents, minimumChargeCents) : lineBaseCents;

  return {
    totalCents: Math.round(total),
    perSqftCents,
    perPieceCents,
    minimumChargeCents,
    pricingProfileKey: activePricingProfileKey,
    orderedWidthIn,
    orderedHeightIn,
    trimAllowanceX,
    trimAllowanceY,
    finishedWidthIn,
    finishedHeightIn,
    sqftPerItem,
    totalSqft,
    linearFeet,
  };
}

type BasePriceDetails = ReturnType<typeof calculateBasePriceDetails>;

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function toPlainSelectionValues(selections: LineItemOptionSelectionsV2 | Record<string, unknown> | undefined): Record<string, any> {
  return cloneJsonValue(normalizeSelectionMap(selections));
}

function numericRecordOrUndefined(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) out[key] = parsed;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function resolveSnapshotFormulaVariables(treeJson: any, product: any): Record<string, number> | undefined {
  const meta = treeJson?.meta && typeof treeJson.meta === "object" ? treeJson.meta : {};
  const pricingProfileConfig = product?.pricingProfileConfig && typeof product.pricingProfileConfig === "object"
    ? product.pricingProfileConfig
    : {};

  return (
    numericRecordOrUndefined((meta as any).formulaVariables) ??
    numericRecordOrUndefined((meta as any).pricingFormulaVariables) ??
    numericRecordOrUndefined((pricingProfileConfig as any).formulaVariables)
  );
}

function resolveSnapshotFormula(treeJson: any, product: any, pricingProfileKey: string): { formula: string; usedFallbackFormula: boolean } {
  const profile = getProfile(pricingProfileKey);
  if (!profile.usesFormula) return { formula: "", usedFallbackFormula: false };

  const formulaFromTree = typeof treeJson?.meta?.pricingFormula === "string"
    ? treeJson.meta.pricingFormula.trim()
    : "";
  const formulaFromProduct = typeof product?.pricingFormula === "string"
    ? product.pricingFormula.trim()
    : "";
  const formulaFromProfile = typeof profile.defaultFormula === "string"
    ? profile.defaultFormula.trim()
    : "";
  const formula = formulaFromTree || formulaFromProduct || formulaFromProfile || PBV2_PREVIEW_FALLBACK_FORMULA;

  return {
    formula,
    usedFallbackFormula: !formulaFromTree && !formulaFromProduct && !formulaFromProfile,
  };
}

export function buildResolvedWeightSnapshotDebug(
  resolvedWeightSource?: ResolvedPbv2WeightSource | null,
): PBV2ResolvedWeightSnapshotDebug | undefined {
  if (!resolvedWeightSource) return undefined;

  return cloneJsonValue({
    totalOz: resolvedWeightSource.totalOz,
    source: resolvedWeightSource.source,
    ...(resolvedWeightSource.sourceLabel !== undefined ? { sourceLabel: resolvedWeightSource.sourceLabel } : {}),
    ...(resolvedWeightSource.materialId !== undefined ? { materialId: resolvedWeightSource.materialId } : {}),
    ...(resolvedWeightSource.materialName !== undefined ? { materialName: resolvedWeightSource.materialName } : {}),
    ...(resolvedWeightSource.materialSku !== undefined ? { materialSku: resolvedWeightSource.materialSku } : {}),
    ...(resolvedWeightSource.weightValue !== undefined ? { weightValue: resolvedWeightSource.weightValue } : {}),
    ...(resolvedWeightSource.weightUnit !== undefined ? { weightUnit: resolvedWeightSource.weightUnit } : {}),
    ...(resolvedWeightSource.weightBasis !== undefined ? { weightBasis: resolvedWeightSource.weightBasis } : {}),
    ...(resolvedWeightSource.weightOzPerBasis !== undefined ? { weightOzPerBasis: resolvedWeightSource.weightOzPerBasis } : {}),
    ...(resolvedWeightSource.basisQuantity !== undefined ? { basisQuantity: resolvedWeightSource.basisQuantity } : {}),
    warnings: Array.isArray(resolvedWeightSource.warnings)
      ? resolvedWeightSource.warnings.map((warning) => ({
          code: warning.code,
          message: warning.message,
        }))
      : [],
  });
}

function buildRuntimePricingSnapshot(input: {
  treeJson: any;
  product: any;
  rawSelections: Record<string, any>;
  effectiveSelections: Record<string, any>;
  pricingMatrixResolution: ProductOptionPricingMatrixResolution;
  widthIn: number;
  heightIn: number;
  quantity: number;
  baseDetails?: BasePriceDetails;
  calculatedPriceCents: number;
  capturedAt: string;
  resolvedWeightSource?: ResolvedPbv2WeightSource;
}): PBV2RuntimePricingSnapshot {
  const trimAllowances = getTrimAllowancesInches(input.treeJson);
  const orderedWidthIn = input.baseDetails?.orderedWidthIn ?? input.widthIn;
  const orderedHeightIn = input.baseDetails?.orderedHeightIn ?? input.heightIn;
  const trimAllowanceX = input.baseDetails?.trimAllowanceX ?? trimAllowances.trimAllowanceX;
  const trimAllowanceY = input.baseDetails?.trimAllowanceY ?? trimAllowances.trimAllowanceY;
  const finishedWidthIn = input.baseDetails?.finishedWidthIn ?? orderedWidthIn + trimAllowanceX;
  const finishedHeightIn = input.baseDetails?.finishedHeightIn ?? orderedHeightIn + trimAllowanceY;
  const sqftPerItem = input.baseDetails?.sqftPerItem ?? (
    finishedWidthIn > 0 && finishedHeightIn > 0 ? (finishedWidthIn * finishedHeightIn) / 144 : 0
  );
  const totalSqft = input.baseDetails?.totalSqft ?? sqftPerItem * input.quantity;
  const linearFeet = input.baseDetails?.linearFeet ?? (orderedWidthIn > 0 ? orderedWidthIn / 12 : 0);
  const pricingProfileKey = String(input.baseDetails?.pricingProfileKey ?? input.product?.pricingProfileKey ?? "default");
  const formulaSnapshot = resolveSnapshotFormula(input.treeJson, input.product, pricingProfileKey);
  const formulaVariables = resolveSnapshotFormulaVariables(input.treeJson, input.product);
  const formulaDebug = buildBaseFormulaDebugContext({
    formulaRaw: formulaSnapshot.formula,
    orderedWidthIn,
    orderedHeightIn,
    trimAllowanceX,
    trimAllowanceY,
    finishedWidthIn,
    finishedHeightIn,
    quantity: input.quantity,
    baseRatePerSqft: input.baseDetails ? input.baseDetails.perSqftCents / 100 : 0,
    sqftPerItem,
    totalSqft,
    linearFeet,
    usedFallbackFormula: formulaSnapshot.usedFallbackFormula,
    formulaVariables,
    pricingMatrixVariables: input.pricingMatrixResolution.variables,
  });

  return cloneJsonValue({
    formula: formulaSnapshot.formula,
    formulaVariables: formulaDebug.variables,
    rawSelections: toPlainSelectionValues(input.rawSelections),
    effectiveSelections: toPlainSelectionValues(input.effectiveSelections),
    ...(input.pricingMatrixResolution.matchedRow?.id
      ? { resolvedMatrixRowId: input.pricingMatrixResolution.matchedRow.id }
      : {}),
    resolvedMatrixVariables: input.pricingMatrixResolution.variables,
    calculatedPrice: input.calculatedPriceCents / 100,
    capturedAt: input.capturedAt,
    ...(input.resolvedWeightSource
      ? { resolvedWeightDebug: buildResolvedWeightSnapshotDebug(input.resolvedWeightSource) }
      : {}),
  });
}

function getTrimAllowancesInches(tree: any): { trimAllowanceX: number; trimAllowanceY: number } {
  const geometry = tree?.meta?.geometry;
  const legacy = Number(geometry?.trimAllowance ?? 0);
  const normalizedLegacy = Number.isFinite(legacy) && legacy >= 0 ? legacy : 0;

  const xRaw = Number(geometry?.trimAllowanceX);
  const yRaw = Number(geometry?.trimAllowanceY);

  const trimAllowanceX = Number.isFinite(xRaw) && xRaw >= 0 ? xRaw : normalizedLegacy;
  const trimAllowanceY = Number.isFinite(yRaw) && yRaw >= 0 ? yRaw : normalizedLegacy;

  return { trimAllowanceX, trimAllowanceY };
}

function evaluatePreviewFormulaToCents(input: {
  formula: string;
  orderedWidthIn: number;
  orderedHeightIn: number;
  trimAllowanceX: number;
  trimAllowanceY: number;
  finishedWidthIn: number;
  finishedHeightIn: number;
  quantity: number;
  baseRatePerSqft: number;
  sqftPerItem: number;
  totalSqft: number;
  linearFeet: number;
  usedFallbackFormula: boolean;
  fallbackFormula: string;
  formulaVariables?: Record<string, number>;
  pricingMatrixVariables?: Record<string, number>;
}): {
  resultValue: number;
  formulaResolved?: string;
  appliedAs: 'unitPrice' | 'totalPrice' | 'unknown';
  steps: Array<{ label: string; value: number | string }>;
  preCeilSqftTotal: number | null;
  postCeilSqftTotal: number | null;
  baseRateUsed: number;
} {
  const scope = buildFormulaScope(input);
  const formulaScope = buildFormulaEvaluationScope({
    scope,
    formulaVariables: input.formulaVariables,
    pricingMatrixVariables: input.pricingMatrixVariables,
  });
  // Use the scope-resolved base_price (matrix may have overridden the tiered fallback).
  const resolvedBaseRate = typeof formulaScope.base_price === 'number' ? formulaScope.base_price : input.baseRatePerSqft;
  let preCeilSqftTotal: number | null = null;
  let postCeilSqftTotal: number | null = null;
  const evalScope: Record<string, any> = {
    ...formulaScope,
    ceil: (value: unknown) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return Math.ceil(numeric);
      preCeilSqftTotal = numeric;
      postCeilSqftTotal = Math.ceil(numeric);
      return postCeilSqftTotal;
    },
    sheet_consumption_sqft: (
      w: unknown,
      h: unknown,
      q: unknown,
      sheet_width: unknown,
      sheet_length: unknown,
      usable_drop_min: unknown,
      billable_length_increment: unknown,
      minimum_billable_sqft: unknown,
    ) =>
      sheetConsumptionSqft(
        Number(w),
        Number(h),
        Number(q),
        Number(sheet_width),
        Number(sheet_length),
        Number(usable_drop_min),
        Number(billable_length_increment),
        Number(minimum_billable_sqft),
      ),
  };
  const formulaResolved = resolveFormulaAliases(input.formula);
  const appliedAs = inferFormulaApplication(input.formula);
  const steps: Array<{ label: string; value: number | string }> = [
    { label: 'ordered_w*ordered_h', value: input.orderedWidthIn * input.orderedHeightIn },
    { label: 'finished_w*finished_h', value: input.finishedWidthIn * input.finishedHeightIn },
    { label: '(w*h)/144', value: input.sqftPerItem },
    { label: 'sqft*q', value: input.totalSqft },
    { label: 'p(base_rate_per_sqft)', value: resolvedBaseRate },
  ];

  // Pre-validate: reject JavaScript-style Math.xxx function calls before they hit mathjs
  const mathDotUsages = detectMathDotUsage(input.formula);
  if (mathDotUsages.length > 0) {
    const examples = mathDotUsages.map((m) => {
      const fnName = m.replace('Math.', '').toLowerCase();
      return `${m} is not supported. Use ${fnName}(...) instead.`;
    });
    const message = examples.join(' ');
    const formulaError = new Error(`Formula error: ${message}`) as PricingPreviewFormulaError;
    formulaError.code = 'PBV2_FORMULA_ERROR';
    formulaError.details = examples.map((msg, i) => ({
      code: 'PBV2_FORMULA_JS_MATH_UNSUPPORTED',
      message: msg,
      location: undefined,
    }));
    formulaError.debug = {
      formulaRaw: input.formula,
      formulaResolved,
      variables: formulaScope,
      appliedAs,
      steps,
      errors: formulaError.details,
      usedFallbackFormula: input.usedFallbackFormula,
      fallbackFormula: input.usedFallbackFormula ? input.fallbackFormula : undefined,
      preCeilSqftTotal,
      postCeilSqftTotal,
      baseRateUsed: resolvedBaseRate,
    };
    throw formulaError;
  }

  // Pre-validate: reject bracket-style variable references like [W], [H], [Q]
  const bracketVars = detectBracketVariables(input.formula);
  if (bracketVars.length > 0) {
    const examples = bracketVars.map((b) => {
      const inner = b.slice(1, -1).toLowerCase();
      return `${b} is not a valid variable. Use ${inner} instead (e.g., w, h, q).`;
    });
    const message = examples.join(' ');
    const formulaError = new Error(`Formula error: ${message}`) as PricingPreviewFormulaError;
    formulaError.code = 'PBV2_FORMULA_ERROR';
    formulaError.details = examples.map((msg) => ({
      code: 'PBV2_FORMULA_MISSING_VARIABLE',
      message: msg,
      location: undefined,
    }));
    formulaError.debug = {
      formulaRaw: input.formula,
      formulaResolved,
      variables: formulaScope,
      appliedAs,
      steps,
      errors: formulaError.details,
      usedFallbackFormula: input.usedFallbackFormula,
      fallbackFormula: input.usedFallbackFormula ? input.fallbackFormula : undefined,
      preCeilSqftTotal,
      postCeilSqftTotal,
      baseRateUsed: resolvedBaseRate,
    };
    throw formulaError;
  }

  try {
    const evaluated = evaluate(input.formula, evalScope);
    const value = Number(evaluated);
    if (!Number.isFinite(value)) {
      throw new Error('Formula returned a non-numeric result');
    }
    return {
      resultValue: value,
      formulaResolved,
      appliedAs,
      steps,
      preCeilSqftTotal,
      postCeilSqftTotal,
      baseRateUsed: resolvedBaseRate,
    };
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : 'Invalid formula';
    const location = extractMathErrorLocation(message);
    const errorCode = inferFormulaErrorCode(message);
    const formulaError = new Error(`Formula error: ${message}`) as PricingPreviewFormulaError;
    formulaError.code = 'PBV2_FORMULA_ERROR';
    formulaError.details = [{
      code: errorCode,
      message,
      location,
    }];
    formulaError.debug = {
      formulaRaw: input.formula,
      formulaResolved,
      variables: formulaScope,
      appliedAs,
      steps,
      errors: [{ code: errorCode, message }],
      usedFallbackFormula: input.usedFallbackFormula,
      fallbackFormula: input.usedFallbackFormula ? input.fallbackFormula : undefined,
      preCeilSqftTotal,
      postCeilSqftTotal,
      baseRateUsed: resolvedBaseRate,
    };
    throw formulaError;
  }
}

function buildBaseFormulaDebugContext(input: {
  formulaRaw: string;
  orderedWidthIn: number;
  orderedHeightIn: number;
  trimAllowanceX: number;
  trimAllowanceY: number;
  finishedWidthIn: number;
  finishedHeightIn: number;
  quantity: number;
  baseRatePerSqft: number;
  sqftPerItem: number;
  totalSqft: number;
  linearFeet: number;
  usedFallbackFormula: boolean;
  formulaVariables?: Record<string, number>;
  pricingMatrixVariables?: Record<string, number>;
}): NonNullable<PricingPreviewEvaluationResult['debug']> {
  const scope = buildFormulaScope({
    formula: input.formulaRaw,
    orderedWidthIn: input.orderedWidthIn,
    orderedHeightIn: input.orderedHeightIn,
    trimAllowanceX: input.trimAllowanceX,
    trimAllowanceY: input.trimAllowanceY,
    finishedWidthIn: input.finishedWidthIn,
    finishedHeightIn: input.finishedHeightIn,
    quantity: input.quantity,
    baseRatePerSqft: input.baseRatePerSqft,
    sqftPerItem: input.sqftPerItem,
    totalSqft: input.totalSqft,
    linearFeet: input.linearFeet,
  });
  const variables = buildFormulaEvaluationScope({
    scope,
    formulaVariables: input.formulaVariables,
    pricingMatrixVariables: input.pricingMatrixVariables,
  });
  // Read the resolved base_price after matrix overrides (may differ from input.baseRatePerSqft).
  const resolvedBaseRate = typeof variables.base_price === 'number' ? variables.base_price : input.baseRatePerSqft;

  return {
    formulaRaw: input.formulaRaw,
    formulaResolved: input.formulaRaw ? resolveFormulaAliases(input.formulaRaw) : undefined,
    variables,
    appliedAs: input.formulaRaw ? inferFormulaApplication(input.formulaRaw) : 'unknown',
    steps: [
      { label: 'ordered_w*ordered_h', value: input.orderedWidthIn * input.orderedHeightIn },
      { label: 'finished_w*finished_h', value: input.finishedWidthIn * input.finishedHeightIn },
      { label: '(w*h)/144', value: input.sqftPerItem },
      { label: 'sqft*q', value: input.totalSqft },
      { label: 'p(base_rate_per_sqft)', value: resolvedBaseRate },
    ],
    errors: [],
    usedFallbackFormula: input.usedFallbackFormula,
    fallbackFormula: input.usedFallbackFormula ? PBV2_PREVIEW_FALLBACK_FORMULA : undefined,
    preCeilSqftTotal: null,
    postCeilSqftTotal: null,
    baseRateUsed: resolvedBaseRate,
  };
}

function parseWeightInput(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function convertWeightToOz(value: number, unit: unknown): number {
  switch (unit) {
    case 'lb':
      return value * 16;
    case 'g':
      return value * 0.03527396195;
    case 'kg':
      return value * 35.27396195;
    case 'oz':
    default:
      return value;
  }
}

function buildPricingPreviewWeightDebug(input: {
  treeJson: any;
  selections: LineItemOptionSelectionsV2;
  runtimeSelectionContext?: OptionRuntimeSelectionContext | null;
  productPrimaryMaterialId?: string | null;
  materialRecords?: Pbv2WeightMaterialRecord[];
  widthIn: number;
  heightIn: number;
  quantity: number;
}): NonNullable<PricingPreviewEvaluationResult['debug']>['weight'] {
  const meta = input.treeJson?.meta && typeof input.treeJson.meta === 'object' ? input.treeJson.meta : {};
  const shippingConfig = meta?.shippingConfig && typeof meta.shippingConfig === 'object' ? meta.shippingConfig : {};
  const rawMetaBaseWeightOz = typeof meta?.baseWeightOz === 'number' && Number.isFinite(meta.baseWeightOz) ? meta.baseWeightOz : null;
  const shippingConfigBaseWeight = shippingConfig?.baseWeight ?? null;
  const shippingConfigWeightUnit = typeof shippingConfig?.weightUnit === 'string' ? shippingConfig.weightUnit : null;
  const shippingConfigWeightBasis = typeof shippingConfig?.weightBasis === 'string' ? shippingConfig.weightBasis : null;
  const parsedShippingConfigBaseWeight = parseWeightInput(shippingConfigBaseWeight);
  const convertedShippingBaseWeightOz = parsedShippingConfigBaseWeight !== null
    ? convertWeightToOz(parsedShippingConfigBaseWeight, shippingConfigWeightUnit || 'oz')
    : null;

  let errorCode: string | undefined;
  let errorMessage: string | undefined;
  if (rawMetaBaseWeightOz !== null && rawMetaBaseWeightOz < 0) {
    errorCode = 'PBV2_E_WEIGHT_NEGATIVE';
    errorMessage = 'meta.baseWeightOz is negative.';
  } else if (parsedShippingConfigBaseWeight !== null && parsedShippingConfigBaseWeight < 0) {
    errorCode = 'PBV2_E_WEIGHT_NEGATIVE';
    errorMessage = 'shippingConfig.baseWeight is negative.';
  }

  let baseWeightSource: 'meta.baseWeightOz' | 'shippingConfig.baseWeight' | 'none' = 'none';
  let baseWeightInput: number | string | null = null;
  let baseWeightOz: number | null = null;
  let baseWeightContributionOz = 0;

  if (rawMetaBaseWeightOz !== null && rawMetaBaseWeightOz > 0) {
    baseWeightSource = 'meta.baseWeightOz';
    baseWeightInput = rawMetaBaseWeightOz;
    baseWeightOz = rawMetaBaseWeightOz;
    baseWeightContributionOz = rawMetaBaseWeightOz;
  } else if (convertedShippingBaseWeightOz !== null && convertedShippingBaseWeightOz > 0) {
    const basis = shippingConfigWeightBasis || 'per_item';
    const totalSqft = (input.widthIn * input.heightIn) / 144;
    baseWeightSource = 'shippingConfig.baseWeight';
    baseWeightInput = shippingConfigBaseWeight;
    baseWeightOz = convertedShippingBaseWeightOz;
    if (basis === 'per_sqft') {
      baseWeightContributionOz = convertedShippingBaseWeightOz * totalSqft;
    } else if (basis === 'per_order') {
      baseWeightContributionOz = convertedShippingBaseWeightOz;
    } else {
      baseWeightContributionOz = convertedShippingBaseWeightOz * input.quantity;
    }
  }

  const resolvedWeight = resolvePbv2WeightSource({
    treeJson: input.treeJson,
    selections: input.selections,
    runtimeSelectionContext: input.runtimeSelectionContext,
    productPrimaryMaterialId: input.productPrimaryMaterialId,
    materialRecords: input.materialRecords,
    widthIn: input.widthIn,
    heightIn: input.heightIn,
    quantity: input.quantity,
  });

  try {
    const rawWeightResult = pbv2ToWeightTotal({
      tree: input.treeJson,
      selections: input.selections,
      widthIn: input.widthIn,
      heightIn: input.heightIn,
      quantity: input.quantity,
    });

    const selectedWeightFields = rawWeightResult.breakdown.filter((entry) => entry.label !== 'Base weight');
    const fallbackComputedShippingWeightOz = baseWeightSource === 'shippingConfig.baseWeight'
      ? rawWeightResult.totalOz + baseWeightContributionOz
      : rawWeightResult.totalOz;
    const computedShippingWeightOz = resolvedWeight.totalOz ?? fallbackComputedShippingWeightOz;
    const warningCode = !errorCode && computedShippingWeightOz <= 0 ? 'PBV2_W_WEIGHT_MISSING' : undefined;

    return {
      baseWeightInput,
      baseWeightSource,
      baseWeightOz,
      shippingConfigBaseWeight,
      shippingConfigWeightUnit,
      shippingConfigWeightBasis,
      selectedWeightFields,
      computedShippingWeightOz,
      resolvedWeightSource: resolvedWeight.source,
      sourceLabel: resolvedWeight.sourceLabel,
      materialId: resolvedWeight.materialId,
      materialName: resolvedWeight.materialName,
      materialSku: resolvedWeight.materialSku,
      weightValue: resolvedWeight.weightValue,
      weightUnit: resolvedWeight.weightUnit,
      weightBasis: resolvedWeight.weightBasis,
      weightOzPerBasis: resolvedWeight.weightOzPerBasis,
      basisQuantity: resolvedWeight.basisQuantity,
      warnings: resolvedWeight.warnings,
      warningCode: resolvedWeight.warnings[0]?.code ?? warningCode,
      errorCode,
      errorMessage,
    };
  } catch (error: any) {
    return {
      baseWeightInput,
      baseWeightSource,
      baseWeightOz,
      shippingConfigBaseWeight,
      shippingConfigWeightUnit,
      shippingConfigWeightBasis,
      selectedWeightFields: [],
      computedShippingWeightOz: resolvedWeight.totalOz ?? (baseWeightContributionOz || null),
      resolvedWeightSource: resolvedWeight.source,
      sourceLabel: resolvedWeight.sourceLabel,
      materialId: resolvedWeight.materialId,
      materialName: resolvedWeight.materialName,
      materialSku: resolvedWeight.materialSku,
      weightValue: resolvedWeight.weightValue,
      weightUnit: resolvedWeight.weightUnit,
      weightBasis: resolvedWeight.weightBasis,
      weightOzPerBasis: resolvedWeight.weightOzPerBasis,
      basisQuantity: resolvedWeight.basisQuantity,
      warnings: resolvedWeight.warnings,
      warningCode: resolvedWeight.warnings[0]?.code,
      errorCode: errorCode || 'PBV2_WEIGHT_DEBUG_UNAVAILABLE',
      errorMessage: errorMessage || (typeof error?.message === 'string' ? error.message : 'Weight debug unavailable'),
    };
  }
}

// buildFormulaScope, buildFormulaEvaluationScope, FORMULA_VARIABLE_PROTECTED_KEYS,
// and MATRIX_VARIABLE_PROTECTED_KEYS are imported from shared/pbv2/formulaScope.ts.

function inferFormulaApplication(formula: string): 'unitPrice' | 'totalPrice' | 'unknown' {
  const normalized = String(formula || '').toLowerCase();
  if (!normalized.trim()) return 'unknown';
  if (/\b(quantity|q|total_sqft)\b/.test(normalized)) {
    return 'totalPrice';
  }
  return 'unitPrice';
}

function resolveFormulaAliases(formula: string): string {
  const aliasToCanonical = new Map<string, string>();
  for (const variable of PBV2_PRICING_VARIABLES) {
    for (const alias of variable.aliases) {
      if (!aliasToCanonical.has(alias)) {
        aliasToCanonical.set(alias, variable.key);
      }
    }
  }

  let resolved = formula;
  aliasToCanonical.forEach((canonical, alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    resolved = resolved.replace(new RegExp(`\\b${escaped}\\b`, 'g'), canonical);
  });
  return resolved;
}

function inferFormulaErrorCode(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('math.') || lower.includes('unsupported javascript-style')) return 'PBV2_FORMULA_JS_MATH_UNSUPPORTED';
  if (lower.includes('undefined symbol') || lower.includes('undefined variable')) return 'PBV2_FORMULA_MISSING_VARIABLE';
  if (lower.includes('non-numeric') || lower.includes('nan') || lower.includes('infinity')) return 'PBV2_FORMULA_NON_FINITE';
  return 'PBV2_FORMULA_PARSE_ERROR';
}

/**
 * Detect JavaScript-style Math.xxx function calls in a formula string.
 * Returns a list of unsupported references found (e.g. "Math.ceil", "Math.round").
 */
function detectMathDotUsage(formula: string): string[] {
  const matches: string[] = [];
  const re = /\bMath\.([a-zA-Z]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) {
    const full = m[0]; // e.g. "Math.ceil"
    if (!matches.includes(full)) matches.push(full);
  }
  return matches;
}

/**
 * Detect bracket-style variable references like [W], [H], [Q] which are NOT
 * supported by the formula evaluator. Returns found bracket tokens.
 */
function detectBracketVariables(formula: string): string[] {
  const matches: string[] = [];
  const re = /\[([A-Za-z_][A-Za-z0-9_]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) {
    const full = m[0]; // e.g. "[W]"
    if (!matches.includes(full)) matches.push(full);
  }
  return matches;
}

function extractMathErrorLocation(message: string): number | undefined {
  const charMatch = /char\s+(\d+)/i.exec(message);
  if (!charMatch) return undefined;
  const parsed = Number(charMatch[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// ============================================================================
// Validation Helpers (for future guardrails)
// ============================================================================

/**
 * Check if a product is ready for PBV2 pricing
 * 
 * Returns error message if invalid, null if valid
 */
export function validateProductForPricing(product: any): string | null {
  if (!product.pbv2ActiveTreeVersionId && !product.pricingProfileConfig?.pbv2Override?.versionId) {
    return 'Product does not have a PBV2 tree assigned. Please configure a PBV2 option tree in the product builder.';
  }

  return null;
}

/**
 * Check if selections are valid for given tree
 * 
 * This is a lightweight pre-check; full validation happens in evaluateOptionTreeV2
 */
export function validateSelectionsShape(selections: any): string | null {
  if (!selections || typeof selections !== 'object') {
    return 'Invalid selections: must be an object';
  }

  if (selections.schemaVersion !== 2) {
    return 'Invalid selections: schemaVersion must be 2';
  }

  if (!selections.selected || typeof selections.selected !== 'object') {
    return 'Invalid selections: must have "selected" object';
  }

  return null;
}
