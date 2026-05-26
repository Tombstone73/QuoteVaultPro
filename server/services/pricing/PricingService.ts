/**
 * PricingService - Unified PBV2-only pricing for quotes and orders
 * 
 * This service replaces all legacy pricing logic (profiles, formulas, material pricing)
 * with a single PBV2-based pricing flow.
 */

import { db } from '../../db';
import { products, pbv2TreeVersions, materials, pricingFormulas } from '../../../shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { evaluate } from 'mathjs';
import { evaluateOptionTreeV2, pbv2ToWeightTotal } from '../optionTreeV2Evaluator';
import { buildFlatGoodsInput, flatGoodsCalculator, getProfile, type FlatGoodsConfig } from '../../../shared/pricingProfiles';
import type { 
  OptionTreeV2, 
  LineItemOptionSelectionsV2,
  OptionRuntimeSelectionContext,
  Pbv2TierBasis,
  PricingV2Tier,
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
  type ProductOptionPricingMatrixRow,
  type ProductOptionPricingMatrixResolution,
} from '../../../shared/productOptionPricingMatrix';
import { PBV2_PRICING_VARIABLES, type PricingVariableDefinition } from '../../../shared/pbv2/pricingVariableRegistry';
import {
  buildFormulaScope,
  buildFormulaEvaluationScope,
  FORMULA_VARIABLE_PROTECTED_KEYS,
  MATRIX_VARIABLE_PROTECTED_KEYS,
} from '../../../shared/pbv2/formulaScope';
import {
  pbv2ToRuntimeSelectionContext,
  resolvePricingV2BaseRates,
  type Pbv2TierResolution,
  type Pbv2TierResolutionWarning,
} from '../../../shared/pbv2/pricingAdapter';
import { calculateSheetYield, extractFormulaVariables, parseFormulaBoolean, sheetConsumptionSqft } from '../../../shared/pbv2/formulaHelpers';
import { buildNumericSelectionFormulaVariables } from '../../../shared/pbv2/numericSelectionFormulaVariables';
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
  pricingSystem: "pbv2";
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
  pricingSystem: "pbv2";
  formula: string;
  formulaSourceMode?: FormulaSourceMode;
  resolvedFormulaSource?: ResolvedFormulaSource;
  resolvedFormulaId?: string | null;
  resolvedFormulaName?: string | null;
  resolvedFormulaExpression?: string;
  manualFormulaPresent?: boolean;
  manualFormulaIgnored?: boolean;
  formulaVariables: Record<string, number | string | boolean | null>;
  formulaVariableSources?: Record<string, string>;
  rawSelections: Record<string, any>;
  effectiveSelections: Record<string, any>;
  resolvedMatrixRowId?: string;
  resolvedMatrixVariables: Record<string, number>;
  tierResolution?: PBV2TierResolutionSnapshot;
  selectedOptionValues?: Record<string, any>;
  basePriceSource?: string;
  rateUsedSource?: string;
  minimumApplied?: boolean;
  formulaScopeUsed?: Record<string, number | string | boolean | null>;
    formulaEvaluatedTotal?: number | null;
    rawBasePrice?: number | null;
    evaluatedFormulaTotalRaw?: number | null;
    evaluatedFormulaTotalRounded?: number | null;
    roundingAppliedAt?: "final_currency_total" | "not_applicable";
    pbv2BaseTotal?: number;
  finalTotalSource?: "formula" | "pbv2_base" | "manual_override";
  finalTotal?: number;
  sheetYield?: NonNullable<PricingPreviewEvaluationResult["debug"]>["sheetYield"];
  calculatedPrice: number;
  capturedAt: string;
  resolvedWeightDebug?: PBV2ResolvedWeightSnapshotDebug;
};

export type PBV2TierResolutionSnapshot = {
  quantity: number;
  enabled: boolean;
  source: "matrix_row" | "pbv2_product" | "pbv2_pricing_v2" | "none";
  matchedTierId: string | null;
  matchedTierLabel: string | null;
  originalBaseRate: number;
  tierBaseRate: number | null;
  effectiveBaseRateBeforeMatrix: number;
  matrixBasePriceOverride: boolean;
  matrixRowId?: string | null;
  matrixStaticBaseRate?: number | null;
  matrixBasePriceRaw?: number | null;
  matrixBasePriceIgnoredBecauseTierMatched?: boolean;
  matrixStaticBaseRateUsedAsFallback?: boolean;
  productTierFallbackUsed?: boolean;
  tierBasis?: Pbv2TierBasis;
  tierBasisValue?: number;
  tierBasisResolvedFrom?: "matrix_row" | "product" | "default";
  lineItemQuantity?: number;
  rawItemQuantity?: number;
  tierSelectionQuantity?: number;
  computedSheetUsage?: number | null;
  computedSheetUsageAvailable?: boolean;
  computedSheetUsageMode?: "exact_flat_goods" | "layout_yield" | "sheet_equivalent" | "unavailable";
  sheetUsageMethod?: "exact_flat_goods" | "layout_yield" | "mixed_layout" | "sqft_equivalent_fallback" | "sheet_equivalent" | "unavailable" | string | null;
  allowRotation?: boolean | null;
  allowRotationSource?: string | null;
  normalPiecesPerSheet?: number | null;
  rotatedPiecesPerSheet?: number | null;
  mixedPiecesPerSheet?: number | null;
  mixedLayoutDescription?: string | null;
  piecesPerSheet?: number | null;
  orientationUsed?: string | null;
  fullSheets?: number | null;
  partialSheetPieceCount?: number | null;
  partialSheetFinishedSqft?: number | null;
  partialSheetBillableSqft?: number | null;
  partialSheetPolicy?: string | null;
  totalSheetCount?: number | null;
  tierSheetWidth?: number | null;
  tierSheetLength?: number | null;
  tierUsableDropMin?: number | null;
  tierBillableLengthIncrement?: number | null;
  tierMinimumBillableSqft?: number | null;
  tierVariableSources?: Record<string, string>;
  computedSheetUsageUnavailableReason?: string | null;
  fallbackToLineItemQuantity?: boolean;
  selectedTierMinQty?: number | null;
  selectedTierRate?: number | null;
  selectedTierSource?: "matrix_row" | "pbv2_product" | "pbv2_pricing_v2" | "none" | null;
  selectedTierRateAppliedToBasePrice?: boolean;
  basePriceFinal?: number;
  basePriceSource?: string;
  finalBaseRateUsed: number;
  warnings: Pbv2TierResolutionWarning[];
  capturedAt: string;
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
    pricingSystem?: "pbv2";
    formulaRaw: string;
    formulaResolved?: string;
    variables: Record<string, number | string | boolean | null>;
    variableSources?: Record<string, string>;
    resultValue?: number;
    appliedAs?: 'unitPrice' | 'totalPrice' | 'unknown';
    steps?: Array<{ label: string; value: number | string }>;
    errors?: Array<{ code: string; message: string; detail?: any }>;
    likelyMisconfiguredFormula?: boolean;
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
      formulaEvaluatedTotal?: number | null;
      rawBasePrice?: number | null;
      evaluatedFormulaTotalRaw?: number | null;
      evaluatedFormulaTotalRounded?: number | null;
      roundingAppliedAt?: "final_currency_total" | "not_applicable";
      pbv2BaseTotal?: number;
      finalTotalSource?: "formula" | "pbv2_base" | "manual_override";
      finalTotal?: number;
    };
  formulaEvaluatedTotal?: number | null;
  rawBasePrice?: number | null;
  evaluatedFormulaTotalRaw?: number | null;
  evaluatedFormulaTotalRounded?: number | null;
  roundingAppliedAt?: "final_currency_total" | "not_applicable";
  pbv2BaseTotal?: number;
    finalTotalSource?: "formula" | "pbv2_base" | "manual_override";
    finalTotal?: number;
    formulaSourceMode?: FormulaSourceMode;
    resolvedFormulaSource?: ResolvedFormulaSource;
    resolvedFormulaId?: string | null;
    resolvedFormulaName?: string | null;
    resolvedFormulaExpression?: string;
    manualFormulaPresent?: boolean;
    manualFormulaIgnored?: boolean;
    formulaResultType?: "final_dollars";
    quantityBasisUsed?: string;
    selectedRate?: number | null;
    finalFormulaTotal?: number | null;
    sheetYield?: {
      finishedSqft: number;
      totalFinishedSqft: number;
      computedSheets?: number | null;
      billedSheets?: number | null;
      sheetCount?: number | null;
      sheetSqft?: number | null;
      billedSheetSqft?: number | null;
      mode?: ComputedSheetUsageMode;
      sheetUsageMethod?: string | null;
      allowRotation?: boolean | null;
      allowRotationSource?: string | null;
      normalPiecesPerSheet?: number | null;
      rotatedPiecesPerSheet?: number | null;
      mixedPiecesPerSheet?: number | null;
      mixedLayoutDescription?: string | null;
      piecesPerSheet?: number | null;
      orientationUsed?: string | null;
      fullSheets?: number | null;
      partialSheetPieceCount?: number | null;
      partialSheetFinishedSqft?: number | null;
      partialSheetBillableSqft?: number | null;
      partialSheetPolicy?: string | null;
      totalSheetCount?: number | null;
      available?: boolean;
    };
    tierResolution?: PBV2TierResolutionSnapshot;
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
  path?: string;
  missingSymbol?: string | null;
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
      pricingSystem: "pbv2",
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
  const pricingFormulaLibrary = await loadProductPricingFormulaLibrary(organizationId, product);

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
  const selectionFormulaVariables = buildNumericSelectionFormulaVariables({
    treeJson: treeVersion.treeJson,
    selections: ruleValidatedSelections.selected,
  });
  const treeFormulaForPricing = typeof (treeVersion.treeJson as any)?.meta?.pricingFormula === "string"
    ? String((treeVersion.treeJson as any).meta.pricingFormula).trim()
    : "";
  const productFormulaForPricing = typeof product.pricingFormula === "string"
    ? product.pricingFormula.trim()
    : "";
  const productFormulaSourceMode = normalizeFormulaSourceMode(
    product.pricingEngine,
    Boolean(pricingFormulaLibrary?.expression),
    Boolean(productFormulaForPricing),
  );
  const pricingFormulaExpressionForSheetYield = productFormulaSourceMode === "library"
    ? (pricingFormulaLibrary?.expression || treeFormulaForPricing || null)
    : productFormulaSourceMode === "manual"
      ? (productFormulaForPricing || treeFormulaForPricing || null)
      : (treeFormulaForPricing || productFormulaForPricing || null);
  const formulaVariableResolution = resolveFormulaVariablesForPricing({
    treeJson: treeVersion.treeJson,
    product,
    pricingFormulaLibrary,
    pricingFormulaExpression: pricingFormulaExpressionForSheetYield,
    selectionFormulaVariables,
  });
  const formulaVariablesForPricing = formulaVariableResolution.variables;
  const allowRotationResolution = resolveAllowRotationForPricing({
    treeJson: treeVersion.treeJson,
    selections: ruleValidatedSelections.selected,
    formulaVariables: formulaVariablesForPricing,
    formulaVariableSources: formulaVariableResolution.sources,
    pricingMatrixVariables: pricingMatrixResolution.variables,
  });
  formulaVariableResolution.sources.allow_rotation = allowRotationResolution.source;

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
    pricingMatrixVariables: pricingMatrixResolution.variables,
    pricingMatrixResolution,
    pricingProfileKey: product.pricingProfileKey,
    pricingProfileConfig: product.pricingProfileConfig,
    formulaVariables: formulaVariablesForPricing,
    formulaVariableSources: formulaVariableResolution.sources,
    allowRotation: allowRotationResolution.value,
    allowRotationSource: allowRotationResolution.source,
    pricingFormulaExpression: pricingFormulaExpressionForSheetYield,
    productLegacy: {
      sheetWidth: product.sheetWidth,
      sheetHeight: product.sheetHeight,
      materialType: product.materialType,
      minPricePerItem: product.minPricePerItem,
      nestingVolumePricing: product.nestingVolumePricing,
    },
  });
  const pricingMatrixVariablesForFormula = getPricingMatrixVariablesForFormula(
    pricingMatrixResolution.variables,
    baseDetails.tierResolution,
  );
  const formulaBasePrice = calculateFormulaAwareBasePrice({
    treeJson: treeVersion.treeJson,
    product,
    baseDetails,
    quantity,
    formulaSourceMode: product.pricingEngine,
    pricingFormulaLibrary,
    formulaVariables: formulaVariablesForPricing,
    formulaVariableSources: formulaVariableResolution.sources,
    pricingMatrixVariables: pricingMatrixVariablesForFormula,
  });
  const basePriceCents = formulaBasePrice.basePriceCents;
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
    formulaVariables: formulaVariablesForPricing,
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
    pricingSystem: "pbv2",
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
      formulaBasePrice,
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
  manualFormulaText?: string | null;
  formulaSourceMode?: FormulaSourceMode | "formulaLibrary" | "pricingFormula" | "pricingProfile" | null;
  pricingFormulaLibrary?: PricingFormulaLibraryResolution | null;
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
  const selectionFormulaVariables = buildNumericSelectionFormulaVariables({
    treeJson: input.treeJson,
    selections: ruleValidatedSelections.selected,
  });
  const treeFormulaForPricing = typeof input.treeJson?.meta?.pricingFormula === "string"
    ? String(input.treeJson.meta.pricingFormula).trim()
    : "";
  const previewFormulaSourceMode = normalizeFormulaSourceMode(
    input.formulaSourceMode,
    Boolean(input.pricingFormulaLibrary?.expression),
    typeof input.pricingFormulaOverride === "string" && input.pricingFormulaOverride.trim().length > 0,
  );
  const pricingFormulaExpressionForSheetYield = previewFormulaSourceMode === "library"
    ? (input.pricingFormulaLibrary?.expression || treeFormulaForPricing || null)
    : previewFormulaSourceMode === "manual"
      ? ((typeof input.pricingFormulaOverride === "string" ? input.pricingFormulaOverride.trim() : "") || treeFormulaForPricing || null)
      : (treeFormulaForPricing || null);
  const formulaVariableResolution = resolveFormulaVariablesForPricing({
    treeJson: input.treeJson,
    pricingProfileConfig: input.pricingProfileConfig,
    pricingFormulaLibrary: input.pricingFormulaLibrary,
    pricingFormulaExpression: pricingFormulaExpressionForSheetYield,
    explicitFormulaVariables: input.formulaVariables,
    selectionFormulaVariables,
  });
  const formulaVariablesForPricing = formulaVariableResolution.variables;
  const allowRotationResolution = resolveAllowRotationForPricing({
    treeJson: input.treeJson,
    selections: ruleValidatedSelections.selected,
    formulaVariables: formulaVariablesForPricing,
    formulaVariableSources: formulaVariableResolution.sources,
    pricingMatrixVariables: pricingMatrixResolution.variables,
  });
  formulaVariableResolution.sources.allow_rotation = allowRotationResolution.source;
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
    pricingMatrixVariables: pricingMatrixResolution.variables,
    pricingMatrixResolution,
    pricingProfileKey: input.pricingProfileKey,
    pricingProfileConfig: input.pricingProfileConfig,
    formulaVariables: formulaVariablesForPricing,
    formulaVariableSources: formulaVariableResolution.sources,
    allowRotation: allowRotationResolution.value,
    allowRotationSource: allowRotationResolution.source,
    pricingFormulaExpression: pricingFormulaExpressionForSheetYield,
  });
  const pricingMethod = String(baseDetails.pricingProfileKey || "default");
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
  let formulaBasePrice: FormulaAwareBasePriceResult;
  try {
    const pricingMatrixVariablesForFormula = getPricingMatrixVariablesForFormula(
      pricingMatrixResolution.variables,
      baseDetails.tierResolution,
    );
    formulaBasePrice = calculateFormulaAwareBasePrice({
      treeJson: input.treeJson,
      baseDetails,
      quantity,
      pricingFormulaOverride: input.pricingFormulaOverride,
      manualFormulaText: input.manualFormulaText,
      formulaSourceMode: input.formulaSourceMode,
      pricingFormulaLibrary: input.pricingFormulaLibrary ?? null,
      formulaVariables: formulaVariablesForPricing,
      formulaVariableSources: formulaVariableResolution.sources,
      pricingMatrixVariables: pricingMatrixVariablesForFormula,
    });
  } catch (error: any) {
    if (error?.code === 'PBV2_FORMULA_ERROR' && error?.debug) {
      error.debug = {
        ...error.debug,
        tierResolution: buildTierResolutionSnapshot(baseDetails.tierResolution, new Date().toISOString()),
        weight: weightDebug,
      };
    }
    throw error;
  }
  const basePriceCents = formulaBasePrice.basePriceCents;
  const formulaToUse = formulaBasePrice.formulaToUse;
  const formulaDebug = formulaBasePrice.formulaDebug;

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
    formulaVariables: formulaVariablesForPricing,
  });

  const optionsCents = Math.round(evalResult.optionsPrice * 100);
  const totalCents = basePriceCents + optionsCents;
  const sqft = baseDetails.sqftPerItem;
  const totalSqft = baseDetails.totalSqft;
  const linearFeet = baseDetails.linearFeet;
  const pricingDebug = {
    basePrice: basePriceCents / 100,
    optionsPrice: optionsCents / 100,
    unitPrice: quantity > 0 ? totalCents / 100 / quantity : 0,
    totalPrice: totalCents / 100,
    formulaEvaluatedTotal: formulaBasePrice.formulaEvaluatedTotalCents == null
      ? null
      : formulaBasePrice.formulaEvaluatedTotalCents / 100,
    rawBasePrice: formulaBasePrice.rawBasePrice,
    evaluatedFormulaTotalRaw: formulaBasePrice.formulaEvaluatedTotalRaw,
    evaluatedFormulaTotalRounded: formulaBasePrice.formulaEvaluatedTotalRounded,
    roundingAppliedAt: formulaBasePrice.roundingAppliedAt,
    pbv2BaseTotal: formulaBasePrice.pbv2BaseTotalCents / 100,
    finalTotalSource: formulaBasePrice.finalTotalSource,
    finalTotal: formulaBasePrice.finalTotalCents / 100,
    formulaSourceMode: formulaDebug.formulaSourceMode,
    resolvedFormulaSource: formulaDebug.resolvedFormulaSource,
    resolvedFormulaId: formulaDebug.resolvedFormulaId,
    resolvedFormulaName: formulaDebug.resolvedFormulaName,
    resolvedFormulaExpression: formulaDebug.resolvedFormulaExpression,
    manualFormulaPresent: formulaDebug.manualFormulaPresent,
    manualFormulaIgnored: formulaDebug.manualFormulaIgnored,
  };
  const consistencyDebug = {
    pricingSystem: "pbv2" as const,
    ...formulaDebug,
    formulaEvaluatedTotal: pricingDebug.formulaEvaluatedTotal,
    rawBasePrice: pricingDebug.rawBasePrice,
    evaluatedFormulaTotalRaw: pricingDebug.evaluatedFormulaTotalRaw,
    evaluatedFormulaTotalRounded: pricingDebug.evaluatedFormulaTotalRounded,
    roundingAppliedAt: pricingDebug.roundingAppliedAt,
    pbv2BaseTotal: pricingDebug.pbv2BaseTotal,
    finalTotalSource: pricingDebug.finalTotalSource,
    finalTotal: pricingDebug.finalTotal,
    pricing: pricingDebug,
  };
  const finalTotalMismatch = buildFinalTotalMismatchError({
    formulaBasePrice,
    basePriceCents,
    optionsCents,
    totalCents,
    debug: consistencyDebug,
  });
  if (finalTotalMismatch) throw finalTotalMismatch;
  const formulaDebugMismatch = buildFormulaDebugMismatchError({
    formulaBasePrice,
    debug: consistencyDebug,
  });
  if (formulaDebugMismatch) throw formulaDebugMismatch;

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
      pricingSystem: "pbv2",
      formulaRaw: formulaDebug.formulaRaw,
      formulaResolved: formulaDebug.formulaResolved,
      variables: formulaDebug.variables,
      variableSources: formulaDebug.variableSources,
      resultValue: formulaDebug.resultValue,
      appliedAs: formulaDebug.appliedAs,
      steps: formulaDebug.steps,
      errors: formulaDebug.errors,
      likelyMisconfiguredFormula: formulaDebug.likelyMisconfiguredFormula,
      preCeilSqftTotal: formulaDebug.preCeilSqftTotal,
      postCeilSqftTotal: formulaDebug.postCeilSqftTotal,
      rawSqftPerItem: widthIn > 0 && heightIn > 0 ? (widthIn * heightIn) / 144 : 0,
      rawTotalSqft: (widthIn > 0 && heightIn > 0 ? (widthIn * heightIn) / 144 : 0) * quantity,
      baseRateUsed: formulaDebug.baseRateUsed,
      formulaResultType: formulaDebug.formulaResultType,
      quantityBasisUsed: formulaDebug.quantityBasisUsed,
      selectedRate: formulaDebug.selectedRate,
      finalFormulaTotal: formulaDebug.finalFormulaTotal,
      sheetYield: formulaDebug.sheetYield,
      formulaEvaluatedTotal: pricingDebug.formulaEvaluatedTotal,
      rawBasePrice: pricingDebug.rawBasePrice,
      evaluatedFormulaTotalRaw: pricingDebug.evaluatedFormulaTotalRaw,
      evaluatedFormulaTotalRounded: pricingDebug.evaluatedFormulaTotalRounded,
      roundingAppliedAt: pricingDebug.roundingAppliedAt,
      pbv2BaseTotal: pricingDebug.pbv2BaseTotal,
      finalTotalSource: pricingDebug.finalTotalSource,
      finalTotal: pricingDebug.finalTotal,
      formulaSourceMode: formulaDebug.formulaSourceMode,
      resolvedFormulaSource: formulaDebug.resolvedFormulaSource,
      resolvedFormulaId: formulaDebug.resolvedFormulaId,
      resolvedFormulaName: formulaDebug.resolvedFormulaName,
      resolvedFormulaExpression: formulaDebug.resolvedFormulaExpression,
      manualFormulaPresent: formulaDebug.manualFormulaPresent,
      manualFormulaIgnored: formulaDebug.manualFormulaIgnored,
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
      pricing: pricingDebug,
      tierResolution: buildTierResolutionSnapshot(formulaBasePrice.tierResolution, new Date().toISOString()),
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

async function loadProductPricingFormulaLibrary(organizationId: string, product: any): Promise<PricingFormulaLibraryResolution | null> {
  const pricingFormulaId = typeof product?.pricingFormulaId === "string"
    ? product.pricingFormulaId.trim()
    : "";
  if (!pricingFormulaId) return null;

  const [formula] = await db
    .select({
      id: pricingFormulas.id,
      name: pricingFormulas.name,
      code: pricingFormulas.code,
      expression: pricingFormulas.expression,
      config: pricingFormulas.config,
    })
    .from(pricingFormulas)
    .where(and(eq(pricingFormulas.id, pricingFormulaId), eq(pricingFormulas.organizationId, organizationId)))
    .limit(1);

  if (typeof formula?.expression === "string" && formula.expression.trim()) {
    return {
      id: formula.id,
      name: formula.name,
      code: formula.code,
      expression: formula.expression,
      config: formula.config as any,
    };
  }

  throw Object.assign(new Error(`Selected Formula Library item '${pricingFormulaId}' could not be resolved.`), {
    code: "PBV2_E_FORMULA_LIBRARY_NOT_FOUND",
    details: [{
      code: "PBV2_E_FORMULA_LIBRARY_NOT_FOUND",
      message: `Selected Formula Library item '${pricingFormulaId}' could not be resolved.`,
    }],
  });

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
    pricingMatrixVariables?: Record<string, number>;
    pricingMatrixResolution?: ProductOptionPricingMatrixResolution;
    pricingProfileKey?: string | null;
    pricingProfileConfig?: unknown;
    formulaVariables?: Record<string, number>;
    formulaVariableSources?: Record<string, string>;
    pricingFormulaExpression?: string | null;
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

function isValidRateCents(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function dollarsFromCents(value: number): number {
  return value / 100;
}

function getMatrixRowQtyTiers(row?: ProductOptionPricingMatrixRow): PricingV2Tier[] {
  return Array.isArray(row?.qtyTiers) ? row.qtyTiers : [];
}

function getBestQtyTier(tiers: PricingV2Tier[], quantity: number): PricingV2Tier | null {
  const validTiers = tiers
    .filter((tier) => typeof tier?.minQty === "number" && Number.isFinite(tier.minQty) && tier.minQty > 0)
    .sort((a, b) => Number(b.minQty) - Number(a.minQty));
  return validTiers.find((tier) => quantity >= Number(tier.minQty)) ?? null;
}

function getTierIdentity(tier: PricingV2Tier | null): { id: string | null; label: string | null } {
  if (!tier) return { id: null, label: null };
  return {
    id: typeof tier.id === "string" && tier.id.trim() ? tier.id.trim() : null,
    label: typeof tier.label === "string" && tier.label.trim() ? tier.label.trim() : null,
  };
}

function getPricingMatrixVariablesForFormula(
  variables: Record<string, number>,
  tierResolution: Pbv2TierResolution,
): Record<string, number> {
  if (typeof variables.base_price !== "number") {
    return variables;
  }

  const matrixBasePrice = Number(variables.base_price);
  const shouldIgnoreMatrixBasePrice =
    !Number.isFinite(matrixBasePrice) ||
    matrixBasePrice <= 0 ||
    (
      tierResolution.tierSource === "matrix_row" &&
      !tierResolution.matrixStaticBaseRateUsedAsFallback &&
      typeof tierResolution.selectedTierRate === "number"
    );

  if (!shouldIgnoreMatrixBasePrice) return variables;

  const { base_price: _staticBasePrice, ...rest } = variables;
  return rest;
}

type TierBasisResolvedFrom = "matrix_row" | "product" | "default";
type ComputedSheetUsageMode = "exact_flat_goods" | "layout_yield" | "sheet_equivalent" | "unavailable";

type SheetYieldMetrics = {
  computedSheets: number | null;
  billedSheets: number | null;
  sheetCount: number | null;
  sheetSqft: number | null;
  billedSheetSqft: number | null;
  sheetUsageMethod?: string | null;
  allowRotation?: boolean | null;
  allowRotationSource?: string | null;
  normalPiecesPerSheet?: number | null;
  rotatedPiecesPerSheet?: number | null;
  mixedPiecesPerSheet?: number | null;
  mixedLayoutDescription?: string | null;
  piecesPerSheet?: number | null;
  orientationUsed?: string | null;
  fullSheets?: number | null;
  partialSheetPieceCount?: number | null;
  partialSheetFinishedSqft?: number | null;
  partialSheetBillableSqft?: number | null;
  partialSheetPolicy?: string | null;
  totalSheetCount?: number | null;
  tierSheetWidth?: number | null;
  tierSheetLength?: number | null;
  tierUsableDropMin?: number | null;
  tierBillableLengthIncrement?: number | null;
  tierMinimumBillableSqft?: number | null;
  tierVariableSources?: Record<string, string>;
  computedSheetUsageUnavailableReason?: string | null;
  finishedSqft: number;
  totalFinishedSqft: number;
  available: boolean;
  mode: ComputedSheetUsageMode;
  warnings: Pbv2TierResolutionWarning[];
};

type TierBasisState = {
  tierBasis: Pbv2TierBasis;
  tierBasisValue: number;
  tierBasisResolvedFrom: TierBasisResolvedFrom;
  lineItemQuantity: number;
  computedSheetUsage: number | null;
  computedSheetUsageAvailable: boolean;
  computedSheetUsageMode: ComputedSheetUsageMode;
  sheetUsageMethod?: string | null;
  allowRotation?: boolean | null;
  allowRotationSource?: string | null;
  normalPiecesPerSheet?: number | null;
  rotatedPiecesPerSheet?: number | null;
  mixedPiecesPerSheet?: number | null;
  mixedLayoutDescription?: string | null;
  piecesPerSheet?: number | null;
  orientationUsed?: string | null;
  fullSheets?: number | null;
  partialSheetPieceCount?: number | null;
  partialSheetFinishedSqft?: number | null;
  partialSheetBillableSqft?: number | null;
  partialSheetPolicy?: string | null;
  totalSheetCount?: number | null;
  tierSheetWidth?: number | null;
  tierSheetLength?: number | null;
  tierUsableDropMin?: number | null;
  tierBillableLengthIncrement?: number | null;
  tierMinimumBillableSqft?: number | null;
  tierVariableSources?: Record<string, string>;
  computedSheetUsageUnavailableReason?: string | null;
  fallbackToLineItemQuantity: boolean;
  warnings: Pbv2TierResolutionWarning[];
};

function isPbv2TierBasis(value: unknown): value is Pbv2TierBasis {
  return value === "line_item_quantity" || value === "computed_sheet_usage";
}

function getFiniteNumberFromRecord(record: Record<string, unknown>, key: string): number | null {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : null;
}

function toFormulaIdentifier(value: string): string {
  const collapsed = value.trim().toLowerCase().replace(/[^a-z0-9_$]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z_$]/.test(collapsed) ? collapsed : collapsed ? `_${collapsed}` : "";
}

function getSelectionValue(rawValue: unknown): unknown {
  if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) && Object.prototype.hasOwnProperty.call(rawValue, "value")) {
    return (rawValue as { value?: unknown }).value;
  }
  return rawValue;
}

function resolveAllowRotationFromSelectedChoices(input: {
  treeJson: any;
  selections: Record<string, unknown>;
}): { value: boolean; source: string } | null {
  const nodes = extractNodesRecord(input.treeJson);
  const selectionEntries = toSelectionEntryMap(input.selections);

  for (const [selectionKey, entry] of Object.entries(selectionEntries)) {
    const selectedValue = getSelectionValue(entry);
    const keyMatches = toFormulaIdentifier(selectionKey) === "allow_rotation";
    const node = Object.values(nodes).find((candidate: any) => getNodeSelectionKey(candidate) === selectionKey);
    const labelMatches = node ? toFormulaIdentifier(String(node.label ?? node.input?.label ?? "")) === "allow_rotation" : false;
    if (!keyMatches && !labelMatches) continue;

    const direct = parseFormulaBoolean(selectedValue);
    if (direct !== null) return { value: direct, source: `pbv2.choice:${selectionKey}` };

    const choice = Array.isArray((node as any)?.choices)
      ? (node as any).choices.find((candidate: any) => String(candidate?.value) === String(selectedValue))
      : null;
    const fromChoiceValue = parseFormulaBoolean(choice?.value);
    if (fromChoiceValue !== null) return { value: fromChoiceValue, source: `pbv2.choice:${selectionKey}` };
    const fromChoiceLabel = parseFormulaBoolean(choice?.label);
    if (fromChoiceLabel !== null) return { value: fromChoiceLabel, source: `pbv2.choice:${selectionKey}` };
  }

  return null;
}

function resolveAllowRotationForPricing(input: {
  treeJson: any;
  selections: Record<string, unknown>;
  formulaVariables?: Record<string, number>;
  formulaVariableSources?: Record<string, string>;
  pricingMatrixVariables?: Record<string, number>;
}): { value: boolean; source: string } {
  let resolved: { value: boolean; source: string } = { value: false, source: "default.allow_rotation=false" };

  const formulaVariableValue = input.formulaVariables && Object.prototype.hasOwnProperty.call(input.formulaVariables, "allow_rotation")
    ? parseFormulaBoolean(input.formulaVariables.allow_rotation)
    : null;
  if (formulaVariableValue !== null) {
    resolved = {
      value: formulaVariableValue,
      source: input.formulaVariableSources?.allow_rotation ?? "formulaVariables.allow_rotation",
    };
  }

  const matrixValue = input.pricingMatrixVariables && Object.prototype.hasOwnProperty.call(input.pricingMatrixVariables, "allow_rotation")
    ? parseFormulaBoolean(input.pricingMatrixVariables.allow_rotation)
    : null;
  if (matrixValue !== null) {
    resolved = { value: matrixValue, source: "pricing_matrix.variables.allow_rotation" };
  }

  const selectedChoice = resolveAllowRotationFromSelectedChoices({
    treeJson: input.treeJson,
    selections: input.selections,
  });
  if (selectedChoice) resolved = selectedChoice;

  return resolved;
}

function resolveComputedSheetTierSelectionQuantity(metrics: SheetYieldMetrics): number | null {
  if (!metrics.available) return null;

  const candidates: number[] = [];
  const computedSheets = Number(metrics.computedSheets);
  if (Number.isFinite(computedSheets) && computedSheets > 0) {
    candidates.push(computedSheets);
  }

  const billedSheets = Number(metrics.billedSheets);
  if (Number.isFinite(billedSheets) && billedSheets > 0) {
    candidates.push(billedSheets);
  }

  const sheetSqft = Number(metrics.sheetSqft);
  const billedSheetSqft = Number(metrics.billedSheetSqft);
  if (Number.isFinite(sheetSqft) && sheetSqft > 0 && Number.isFinite(billedSheetSqft) && billedSheetSqft > 0) {
    candidates.push(billedSheetSqft / sheetSqft);
  }

  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function mergeNumericVariablesWithSources(
  target: { variables: Record<string, number>; sources: Record<string, string> },
  source: unknown,
  sourceLabel: string,
  sourceOverrides?: Record<string, string>,
): void {
  if (!source || typeof source !== "object" || Array.isArray(source)) return;
  for (const [key, rawValue] of Object.entries(source as Record<string, unknown>)) {
    const value = key === "allow_rotation"
      ? parseFormulaBoolean(rawValue)
      : Number(rawValue);
    if (!key || value === null || !Number.isFinite(Number(value))) continue;
    target.variables[key] = Number(value);
    target.sources[key] = sourceOverrides?.[key] ?? sourceLabel;
  }
}

function getFormulaVariableRecord(
  meta: Record<string, unknown>,
  activeProfileConfig: FlatGoodsConfig | null,
  pricingMatrixVariables: Record<string, number>,
  explicitFormulaVariables?: Record<string, number>,
  explicitFormulaVariableSources?: Record<string, string>,
): { variables: Record<string, number>; sources: Record<string, string> } {
  const out = { variables: {} as Record<string, number>, sources: {} as Record<string, string> };
  if (explicitFormulaVariables && Object.keys(explicitFormulaVariables).length > 0) {
    mergeNumericVariablesWithSources(out, explicitFormulaVariables, "formulaVariables", explicitFormulaVariableSources);
  } else {
    mergeNumericVariablesWithSources(out, (activeProfileConfig as any)?.formulaVariables, "pricingProfileConfig.formulaVariables");
    mergeNumericVariablesWithSources(out, (meta as any).pricingFormulaVariables, "tree.meta.pricingFormulaVariables");
    mergeNumericVariablesWithSources(out, (meta as any).formulaVariables, "tree.meta.formulaVariables");
  }
  mergeNumericVariablesWithSources(out, pricingMatrixVariables, "pricing_matrix.variables");
  return out;
}

function splitFormulaArguments(argumentList: string): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of argumentList) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) args.push(current.trim());
  return args;
}

function resolveFormulaArgumentNumber(arg: string, variables: Record<string, number>): number | null {
  const numeric = Number(arg);
  if (Number.isFinite(numeric)) return numeric;

  const variableName = arg.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName)) return null;

  const variableValue = Number(variables[variableName]);
  return Number.isFinite(variableValue) ? variableValue : null;
}

function extractSheetConsumptionFormulaVariables(
  formulaExpression: string | null | undefined,
  variables: Record<string, number>,
): Record<string, number> {
  if (!formulaExpression || typeof formulaExpression !== "string") return {};

  const match = formulaExpression.match(/\bsheet_consumption_sqft\s*\(([^)]*)\)/i);
  if (!match) return {};

  const args = splitFormulaArguments(match[1] ?? "");
  if (args.length < 8) return {};

  const mappings: Array<[number, string]> = [
    [3, "sheet_width"],
    [4, "sheet_length"],
    [5, "usable_drop_min"],
    [6, "billable_length_increment"],
    [7, "minimum_billable_sqft"],
  ];

  const out: Record<string, number> = {};
  for (const [argIndex, variableName] of mappings) {
    const value = resolveFormulaArgumentNumber(args[argIndex] ?? "", variables);
    if (value !== null) out[variableName] = value;
  }

  return out;
}

function resolveComputedSheetUsage(input: {
  meta: Record<string, unknown>;
  activePricingProfileKey: string;
  activeProfileConfig: FlatGoodsConfig | null;
  productLegacy: {
    sheetWidth?: string | null;
    sheetHeight?: string | null;
    materialType?: "sheet" | "roll" | null;
    minPricePerItem?: string | null;
    nestingVolumePricing?: any;
  };
  pricingMatrixVariables: Record<string, number>;
  formulaVariables?: Record<string, number>;
  formulaVariableSources?: Record<string, string>;
  allowRotation?: boolean;
  allowRotationSource?: string;
  pricingFormulaExpression?: string | null;
  orderedWidthIn: number;
  orderedHeightIn: number;
  finishedWidthIn: number;
  finishedHeightIn: number;
  quantity: number;
}): SheetYieldMetrics {
  const warnings: Pbv2TierResolutionWarning[] = [];
  const finishedSqft = input.finishedWidthIn > 0 && input.finishedHeightIn > 0
    ? (input.finishedWidthIn * input.finishedHeightIn) / 144
    : 0;
  const totalFinishedSqft = finishedSqft * input.quantity;

  if (input.activePricingProfileKey === "flat_goods" && input.productLegacy.materialType !== "roll") {
    try {
      const flatGoodsAllowRotation = input.allowRotation ?? input.activeProfileConfig?.allowRotation ?? false;
      const flatGoodsProfileConfig: FlatGoodsConfig = {
        sheetWidth: input.activeProfileConfig?.sheetWidth ?? (input.productLegacy.sheetWidth ? Number(input.productLegacy.sheetWidth) : 48),
        sheetHeight: input.activeProfileConfig?.sheetHeight ?? (input.productLegacy.sheetHeight ? Number(input.productLegacy.sheetHeight) : 96),
        materialType: input.activeProfileConfig?.materialType ?? input.productLegacy.materialType ?? "sheet",
        minSheets: input.activeProfileConfig?.minSheets,
        minPricePerItem: input.activeProfileConfig?.minPricePerItem ?? (input.productLegacy.minPricePerItem ? Number(input.productLegacy.minPricePerItem) : null),
        allowRotation: flatGoodsAllowRotation,
      };
      const flatGoodsInput = buildFlatGoodsInput(
        flatGoodsProfileConfig,
        input.productLegacy,
        { basePricePerSqft: "1" },
        input.finishedWidthIn,
        input.finishedHeightIn,
        input.quantity,
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
            allowRotation ?? flatGoodsAllowRotation,
          ),
      );

      if (flatGoodsResult.error) {
        warnings.push({
          code: "PBV2_TIER_COMPUTED_SHEET_USAGE_FAILED",
          severity: "warning",
          message: "Computed sheet usage could not use flat-goods nesting.",
          detail: { error: flatGoodsResult.error },
        });
      } else if (Number.isFinite(flatGoodsResult.sheetCount) && flatGoodsResult.sheetCount > 0) {
        const sheetWidth = Number(flatGoodsResult.nestingDetails?.sheetWidth ?? input.activeProfileConfig?.sheetWidth ?? input.productLegacy.sheetWidth ?? 48);
        const sheetHeight = Number(flatGoodsResult.nestingDetails?.sheetHeight ?? input.activeProfileConfig?.sheetHeight ?? input.productLegacy.sheetHeight ?? 96);
        const sheetSqft = sheetWidth > 0 && sheetHeight > 0 ? (sheetWidth * sheetHeight) / 144 : null;
        const computedSheets = Number(flatGoodsResult.sheetCount);
        return {
          computedSheets,
          billedSheets: computedSheets,
          sheetCount: computedSheets,
          sheetSqft,
          billedSheetSqft: sheetSqft !== null ? computedSheets * sheetSqft : null,
          sheetUsageMethod: "exact_flat_goods",
          allowRotation: input.allowRotation ?? false,
          allowRotationSource: input.allowRotationSource ?? "default.allow_rotation=false",
          normalPiecesPerSheet: null,
          rotatedPiecesPerSheet: null,
          mixedPiecesPerSheet: null,
          mixedLayoutDescription: null,
          totalSheetCount: computedSheets,
          finishedSqft,
          totalFinishedSqft,
          available: true,
          mode: "exact_flat_goods",
          warnings,
        };
      } else {
        warnings.push({
          code: "PBV2_TIER_COMPUTED_SHEET_USAGE_INVALID",
          severity: "warning",
          message: "Computed flat-goods sheet usage was zero or invalid.",
          detail: { sheetCount: flatGoodsResult.sheetCount },
        });
      }
    } catch (error: any) {
      warnings.push({
        code: "PBV2_TIER_COMPUTED_SHEET_USAGE_FAILED",
        severity: "warning",
        message: "Computed sheet usage calculation failed while running flat-goods nesting.",
        detail: { error: error?.message ?? String(error) },
      });
    }
  }

  const formulaVariableRecord = getFormulaVariableRecord(
    input.meta,
    input.activeProfileConfig,
    input.pricingMatrixVariables,
    input.formulaVariables,
    input.formulaVariableSources,
  );
  const formulaVariables = formulaVariableRecord.variables;
  const formulaVariableSources = formulaVariableRecord.sources;
  const expressionVariables = extractSheetConsumptionFormulaVariables(input.pricingFormulaExpression, formulaVariables);
  for (const [key, value] of Object.entries(expressionVariables)) {
    formulaVariables[key] = value;
    formulaVariableSources[key] = formulaVariableSources[key] ?? "formula.expression";
  }
  const sheetWidth = getFiniteNumberFromRecord(formulaVariables, "sheet_width");
  const sheetLength = getFiniteNumberFromRecord(formulaVariables, "sheet_length");
  const usableDropMin = getFiniteNumberFromRecord(formulaVariables, "usable_drop_min");
  const billableLengthIncrement = getFiniteNumberFromRecord(formulaVariables, "billable_length_increment");
  const minimumBillableSqft = getFiniteNumberFromRecord(formulaVariables, "minimum_billable_sqft");
  const formulaAllowRotation = Object.prototype.hasOwnProperty.call(formulaVariables, "allow_rotation")
    ? parseFormulaBoolean(formulaVariables.allow_rotation)
    : null;
  const allowRotation = input.allowRotation ?? formulaAllowRotation ?? false;
  const allowRotationSource = input.allowRotationSource
    ?? (formulaAllowRotation !== null ? formulaVariableSources.allow_rotation ?? "formulaVariables.allow_rotation" : "default.allow_rotation=false");
  const tierVariableSources: Record<string, string> = {};
  for (const key of ["sheet_width", "sheet_length", "usable_drop_min", "billable_length_increment", "minimum_billable_sqft"]) {
    if (formulaVariableSources[key]) tierVariableSources[key] = formulaVariableSources[key];
  }
  tierVariableSources.allow_rotation = allowRotationSource;

  if (
    sheetWidth === null ||
    sheetLength === null ||
    usableDropMin === null ||
    billableLengthIncrement === null ||
    minimumBillableSqft === null
  ) {
    const missingVariables = [
      ["sheet_width", sheetWidth],
      ["sheet_length", sheetLength],
      ["usable_drop_min", usableDropMin],
      ["billable_length_increment", billableLengthIncrement],
      ["minimum_billable_sqft", minimumBillableSqft],
    ]
      .filter(([, value]) => value === null)
      .map(([key]) => String(key));
    const unavailableReason = `missing_variables:${missingVariables.join(",")}`;
    warnings.push({
      code: "PBV2_E_TIER_COMPUTED_SHEET_USAGE_UNAVAILABLE",
      severity: "error",
      message: "Computed sheet usage was selected, but required sheet consumption variables are not available.",
      detail: {
        requiredVariables: ["sheet_width", "sheet_length", "usable_drop_min", "billable_length_increment", "minimum_billable_sqft"],
        missingVariables,
        variableSources: tierVariableSources,
      },
    });
    return {
      computedSheets: null,
      billedSheets: null,
      sheetCount: null,
      sheetSqft: null,
      billedSheetSqft: null,
      sheetUsageMethod: "unavailable",
      allowRotation,
      allowRotationSource,
      normalPiecesPerSheet: null,
      rotatedPiecesPerSheet: null,
      mixedPiecesPerSheet: null,
      mixedLayoutDescription: null,
      piecesPerSheet: null,
      orientationUsed: null,
      fullSheets: null,
        partialSheetPieceCount: null,
        partialSheetFinishedSqft: null,
        partialSheetBillableSqft: null,
        partialSheetPolicy: null,
        totalSheetCount: null,
      tierSheetWidth: sheetWidth,
      tierSheetLength: sheetLength,
      tierUsableDropMin: usableDropMin,
      tierBillableLengthIncrement: billableLengthIncrement,
      tierMinimumBillableSqft: minimumBillableSqft,
      tierVariableSources,
      computedSheetUsageUnavailableReason: unavailableReason,
      finishedSqft,
      totalFinishedSqft,
      available: false,
      mode: "unavailable",
      warnings,
    };
  }

  try {
    const sheetYield = calculateSheetYield(
      input.orderedWidthIn,
      input.orderedHeightIn,
      input.quantity,
      sheetWidth,
      sheetLength,
      usableDropMin,
      billableLengthIncrement,
      minimumBillableSqft,
      allowRotation,
      allowRotationSource,
    );

    if (!Number.isFinite(sheetYield.totalSheetCount) || sheetYield.totalSheetCount <= 0) {
      warnings.push({
        code: "PBV2_TIER_COMPUTED_SHEET_USAGE_INVALID",
        severity: "warning",
        message: "Computed sheet-yield usage was zero or invalid.",
        detail: { sheetYield },
      });
      return {
        computedSheets: null,
        billedSheets: null,
        sheetCount: null,
        sheetSqft: Number.isFinite(sheetYield.sheetSqft) && sheetYield.sheetSqft > 0 ? sheetYield.sheetSqft : null,
        billedSheetSqft: null,
        sheetUsageMethod: "unavailable",
        allowRotation: sheetYield.allowRotation,
        allowRotationSource: sheetYield.allowRotationSource,
        normalPiecesPerSheet: sheetYield.normalPiecesPerSheet,
        rotatedPiecesPerSheet: sheetYield.rotatedPiecesPerSheet,
        mixedPiecesPerSheet: sheetYield.mixedPiecesPerSheet,
        mixedLayoutDescription: sheetYield.mixedLayoutDescription,
        piecesPerSheet: sheetYield.piecesPerSheet,
        orientationUsed: sheetYield.orientationUsed,
        fullSheets: sheetYield.fullSheets,
        partialSheetPieceCount: sheetYield.partialSheetPieceCount,
        partialSheetFinishedSqft: sheetYield.partialSheetFinishedSqft,
        partialSheetBillableSqft: sheetYield.partialSheetBillableSqft,
        partialSheetPolicy: sheetYield.partialSheetPolicy,
        totalSheetCount: null,
        tierSheetWidth: sheetWidth,
        tierSheetLength: sheetLength,
        tierUsableDropMin: usableDropMin,
        tierBillableLengthIncrement: billableLengthIncrement,
        tierMinimumBillableSqft: minimumBillableSqft,
        tierVariableSources,
        computedSheetUsageUnavailableReason: "sheet_usage_invalid",
        finishedSqft,
        totalFinishedSqft,
        available: false,
        mode: "unavailable",
        warnings,
      };
    }

    return {
      computedSheets: sheetYield.totalSheetCount,
      billedSheets: sheetYield.sheetSqft > 0 ? sheetYield.billedSheetSqft / sheetYield.sheetSqft : sheetYield.totalSheetCount,
      sheetCount: sheetYield.totalSheetCount,
      sheetSqft: sheetYield.sheetSqft,
      billedSheetSqft: sheetYield.billedSheetSqft,
      sheetUsageMethod: sheetYield.sheetUsageMethod,
      allowRotation: sheetYield.allowRotation,
      allowRotationSource: sheetYield.allowRotationSource,
      normalPiecesPerSheet: sheetYield.normalPiecesPerSheet,
      rotatedPiecesPerSheet: sheetYield.rotatedPiecesPerSheet,
      mixedPiecesPerSheet: sheetYield.mixedPiecesPerSheet,
      mixedLayoutDescription: sheetYield.mixedLayoutDescription,
      piecesPerSheet: sheetYield.piecesPerSheet,
      orientationUsed: sheetYield.orientationUsed,
      fullSheets: sheetYield.fullSheets,
      partialSheetPieceCount: sheetYield.partialSheetPieceCount,
      partialSheetFinishedSqft: sheetYield.partialSheetFinishedSqft,
      partialSheetBillableSqft: sheetYield.partialSheetBillableSqft,
      partialSheetPolicy: sheetYield.partialSheetPolicy,
      totalSheetCount: sheetYield.totalSheetCount,
      tierSheetWidth: sheetWidth,
      tierSheetLength: sheetLength,
      tierUsableDropMin: usableDropMin,
      tierBillableLengthIncrement: billableLengthIncrement,
      tierMinimumBillableSqft: minimumBillableSqft,
      tierVariableSources,
      computedSheetUsageUnavailableReason: null,
      finishedSqft,
      totalFinishedSqft,
      available: true,
      mode: "layout_yield",
      warnings,
    };
  } catch (error: any) {
    warnings.push({
      code: "PBV2_E_SHEET_YIELD_UNAVAILABLE",
      severity: "error",
      message: "Computed sheet usage tier basis is selected, but actual sheet yield could not be computed.",
      detail: { error: error?.message ?? String(error) },
    });
    return {
      computedSheets: null,
      billedSheets: null,
      sheetCount: null,
      sheetSqft: null,
      billedSheetSqft: null,
      sheetUsageMethod: "unavailable",
      allowRotation,
      allowRotationSource,
      normalPiecesPerSheet: null,
      rotatedPiecesPerSheet: null,
      mixedPiecesPerSheet: null,
      mixedLayoutDescription: null,
      piecesPerSheet: null,
      orientationUsed: null,
      fullSheets: null,
      partialSheetPieceCount: null,
      partialSheetFinishedSqft: null,
      partialSheetBillableSqft: null,
      partialSheetPolicy: null,
      totalSheetCount: null,
      tierSheetWidth: sheetWidth,
      tierSheetLength: sheetLength,
      tierUsableDropMin: usableDropMin,
      tierBillableLengthIncrement: billableLengthIncrement,
      tierMinimumBillableSqft: minimumBillableSqft,
      tierVariableSources,
      computedSheetUsageUnavailableReason: error?.message ?? "sheet_consumption_failed",
      finishedSqft,
      totalFinishedSqft,
      available: false,
      mode: "unavailable",
      warnings,
    };
  }
}

function resolveTierBasisState(input: {
  pricingV2: Record<string, unknown>;
  matchedMatrixRow?: ProductOptionPricingMatrixRow;
  meta: Record<string, unknown>;
  activePricingProfileKey: string;
  activeProfileConfig: FlatGoodsConfig | null;
  productLegacy: {
    sheetWidth?: string | null;
    sheetHeight?: string | null;
    materialType?: "sheet" | "roll" | null;
    minPricePerItem?: string | null;
    nestingVolumePricing?: any;
  };
  pricingMatrixVariables: Record<string, number>;
  formulaVariables?: Record<string, number>;
  allowRotation?: boolean;
  allowRotationSource?: string;
  sheetYieldMetrics: SheetYieldMetrics;
  orderedWidthIn: number;
  orderedHeightIn: number;
  finishedWidthIn: number;
  finishedHeightIn: number;
  quantity: number;
}): TierBasisState {
  const warnings: Pbv2TierResolutionWarning[] = [];
  const rowBasisRaw = input.matchedMatrixRow?.tierBasis;
  const productBasisRaw = input.pricingV2.tierBasis;
  const productBasis = isPbv2TierBasis(productBasisRaw) ? productBasisRaw : null;
  const rowBasis = isPbv2TierBasis(rowBasisRaw) ? rowBasisRaw : null;
  const tierBasis = rowBasis ?? productBasis ?? "line_item_quantity";
  const tierBasisResolvedFrom: TierBasisResolvedFrom = rowBasis ? "matrix_row" : productBasis ? "product" : "default";

  if (rowBasis && productBasis && rowBasis !== productBasis) {
    warnings.push({
      code: "PBV2_TIER_MATRIX_ROW_BASIS_OVERRIDES_PRODUCT",
      severity: "warning",
      message: "Matrix row tier basis overrides the product-level tier basis for this row.",
      detail: { rowBasis, productBasis, matrixRowId: input.matchedMatrixRow?.id ?? null },
    });
  }

  if (tierBasis === "line_item_quantity") {
    return {
      tierBasis,
      tierBasisValue: input.quantity,
      tierBasisResolvedFrom,
      lineItemQuantity: input.quantity,
      computedSheetUsage: null,
      computedSheetUsageAvailable: false,
      computedSheetUsageMode: "unavailable",
      sheetUsageMethod: "unavailable",
      fallbackToLineItemQuantity: false,
      warnings,
    };
  }

  const computed = input.sheetYieldMetrics;
  warnings.push(...computed.warnings);
  const computedTierSelectionQuantity = resolveComputedSheetTierSelectionQuantity(computed);
  if (computed.available && computed.computedSheets !== null && Number.isFinite(computed.computedSheets) && computed.computedSheets > 0 && computedTierSelectionQuantity !== null) {
    return {
      tierBasis,
      tierBasisValue: computedTierSelectionQuantity,
      tierBasisResolvedFrom,
      lineItemQuantity: input.quantity,
      computedSheetUsage: computed.computedSheets,
      computedSheetUsageAvailable: true,
      computedSheetUsageMode: computed.mode,
      sheetUsageMethod: computed.sheetUsageMethod ?? computed.mode,
      allowRotation: computed.allowRotation,
      allowRotationSource: computed.allowRotationSource,
      normalPiecesPerSheet: computed.normalPiecesPerSheet,
      rotatedPiecesPerSheet: computed.rotatedPiecesPerSheet,
      mixedPiecesPerSheet: computed.mixedPiecesPerSheet,
      mixedLayoutDescription: computed.mixedLayoutDescription,
      piecesPerSheet: computed.piecesPerSheet,
      orientationUsed: computed.orientationUsed,
      fullSheets: computed.fullSheets,
      partialSheetPieceCount: computed.partialSheetPieceCount,
      partialSheetFinishedSqft: computed.partialSheetFinishedSqft,
      partialSheetBillableSqft: computed.partialSheetBillableSqft,
      partialSheetPolicy: computed.partialSheetPolicy,
      totalSheetCount: computed.totalSheetCount ?? computed.sheetCount,
      tierSheetWidth: computed.tierSheetWidth,
      tierSheetLength: computed.tierSheetLength,
      tierUsableDropMin: computed.tierUsableDropMin,
      tierBillableLengthIncrement: computed.tierBillableLengthIncrement,
      tierMinimumBillableSqft: computed.tierMinimumBillableSqft,
      tierVariableSources: computed.tierVariableSources,
      computedSheetUsageUnavailableReason: computed.computedSheetUsageUnavailableReason,
      fallbackToLineItemQuantity: false,
      warnings,
    };
  }

  warnings.push({
    code: "PBV2_E_TIER_COMPUTED_SHEET_USAGE_UNAVAILABLE",
    severity: "error",
    message: "Computed sheet usage tier basis is selected, but sheet usage could not be computed.",
    detail: {
      lineItemQuantity: input.quantity,
      unavailableReason: computed.computedSheetUsageUnavailableReason ?? "unavailable",
    },
  });
  return {
    tierBasis,
    tierBasisValue: 0,
    tierBasisResolvedFrom,
    lineItemQuantity: input.quantity,
    computedSheetUsage: computed.computedSheets,
    computedSheetUsageAvailable: false,
    computedSheetUsageMode: "unavailable",
    sheetUsageMethod: computed.sheetUsageMethod ?? "unavailable",
    allowRotation: computed.allowRotation,
    allowRotationSource: computed.allowRotationSource,
    normalPiecesPerSheet: computed.normalPiecesPerSheet,
    rotatedPiecesPerSheet: computed.rotatedPiecesPerSheet,
    mixedPiecesPerSheet: computed.mixedPiecesPerSheet,
    mixedLayoutDescription: computed.mixedLayoutDescription,
    piecesPerSheet: computed.piecesPerSheet,
    orientationUsed: computed.orientationUsed,
    fullSheets: computed.fullSheets,
    partialSheetPieceCount: computed.partialSheetPieceCount,
    partialSheetFinishedSqft: computed.partialSheetFinishedSqft,
    partialSheetBillableSqft: computed.partialSheetBillableSqft,
    partialSheetPolicy: computed.partialSheetPolicy,
    totalSheetCount: computed.totalSheetCount,
    tierSheetWidth: computed.tierSheetWidth,
    tierSheetLength: computed.tierSheetLength,
    tierUsableDropMin: computed.tierUsableDropMin,
    tierBillableLengthIncrement: computed.tierBillableLengthIncrement,
    tierMinimumBillableSqft: computed.tierMinimumBillableSqft,
    tierVariableSources: computed.tierVariableSources,
    computedSheetUsageUnavailableReason: computed.computedSheetUsageUnavailableReason ?? "unavailable",
    fallbackToLineItemQuantity: false,
    warnings,
  };
}

function calculateBasePriceDetails(
  tree: any,
  context: { widthIn: number; heightIn: number; quantity: number },
  pricingContext?: {
    explicitSelections?: Record<string, any>;
    runtimeSelectionContext?: OptionRuntimeSelectionContext;
    pricingMatrixVariables?: Record<string, number>;
    pricingMatrixResolution?: ProductOptionPricingMatrixResolution;
    pricingProfileKey?: string | null;
    pricingProfileConfig?: unknown;
    formulaVariables?: Record<string, number>;
    formulaVariableSources?: Record<string, string>;
    allowRotation?: boolean;
    allowRotationSource?: string;
    pricingFormulaExpression?: string | null;
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
  preMinimumCents: number;
  minimumApplied: boolean;
  basePriceSource: string;
  rateUsedSource: string;
  tierResolution: Pbv2TierResolution;
  sheetYieldMetrics: SheetYieldMetrics;
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

  const pricingMatrixVariables =
    pricingContext?.pricingMatrixResolution?.variables
    ?? pricingContext?.pricingMatrixVariables
    ?? {};
  const matchedMatrixRow = pricingContext?.pricingMatrixResolution?.matchedRow;
  const matrixRowId = typeof matchedMatrixRow?.id === "string" && matchedMatrixRow.id.trim()
    ? matchedMatrixRow.id.trim()
    : null;
  const matrixRowQtyTiers = getMatrixRowQtyTiers(matchedMatrixRow);
  const hasMatrixRowQtyTiers = matrixRowQtyTiers.length > 0;
  const matrixBasePrice = pricingMatrixVariables.base_price;
  const matrixBasePriceRaw = typeof matrixBasePrice === "number" && Number.isFinite(matrixBasePrice)
    ? matrixBasePrice
    : null;
  const hasMatrixBasePrice = matrixBasePriceRaw !== null && matrixBasePriceRaw > 0;
  const base = pricingV2.base && typeof pricingV2.base === 'object' ? pricingV2.base : {};
  if (Object.keys(base).length === 0 && !hasMatrixBasePrice && !hasMatrixRowQtyTiers) {
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
  const productLegacy = pricingContext?.productLegacy ?? {};
  const sheetYieldMetrics = resolveComputedSheetUsage({
    meta: meta as Record<string, unknown>,
    activePricingProfileKey,
    activeProfileConfig,
    productLegacy,
    pricingMatrixVariables,
    formulaVariables: pricingContext?.formulaVariables,
    formulaVariableSources: pricingContext?.formulaVariableSources,
    allowRotation: pricingContext?.allowRotation,
    allowRotationSource: pricingContext?.allowRotationSource,
    pricingFormulaExpression: pricingContext?.pricingFormulaExpression,
    orderedWidthIn,
    orderedHeightIn,
    finishedWidthIn,
    finishedHeightIn,
    quantity,
  });
  const tierBasisState = resolveTierBasisState({
    pricingV2: pricingV2 as Record<string, unknown>,
    matchedMatrixRow,
    meta: meta as Record<string, unknown>,
    activePricingProfileKey,
    activeProfileConfig,
    productLegacy,
    pricingMatrixVariables,
    formulaVariables: pricingContext?.formulaVariables,
    allowRotation: pricingContext?.allowRotation,
    allowRotationSource: pricingContext?.allowRotationSource,
    sheetYieldMetrics,
    orderedWidthIn,
    orderedHeightIn,
    finishedWidthIn,
    finishedHeightIn,
    quantity,
  });

  let basePriceSource = hasMatrixBasePrice ? "pricing_matrix.base_price" : "pricingV2.base";
  let rateUsedSource = hasMatrixBasePrice ? "pricing_matrix.base_price" : "pricingV2.base";
  let tierResolution: Pbv2TierResolution;

  if (hasMatrixRowQtyTiers) {
    const matchedRowTier = getBestQtyTier(matrixRowQtyTiers, tierBasisState.tierBasisValue);
    const matchedTierIdentity = getTierIdentity(matchedRowTier);
    const rowTierWarnings: Pbv2TierResolutionWarning[] = [];
    const matrixStaticBaseRate = hasMatrixBasePrice ? matrixBasePrice : null;

    if (matchedRowTier) {
      let appliedRateField = false;
      let selectedTierRateAppliedToBasePrice = false;
      const rowTier = matchedRowTier as Record<string, unknown>;

      if ("perSqftCents" in rowTier) {
        if (isValidRateCents(rowTier.perSqftCents)) {
          perSqftCents = rowTier.perSqftCents;
          appliedRateField = true;
          selectedTierRateAppliedToBasePrice = true;
        } else if (rowTier.perSqftCents !== undefined && rowTier.perSqftCents !== null) {
          rowTierWarnings.push({
            code: "PBV2_TIER_INVALID_RATE",
            severity: "warning",
            message: "Matched matrix row quantity tier has an invalid $/sq ft rate; base pricing fallback was used for $/sq ft.",
            detail: { matrixRowId, tierId: matchedTierIdentity.id, field: "perSqftCents" },
          });
        }
      }

      if ("perPieceCents" in rowTier) {
        if (isValidRateCents(rowTier.perPieceCents)) {
          perPieceCents = rowTier.perPieceCents;
          appliedRateField = true;
        } else if (rowTier.perPieceCents !== undefined && rowTier.perPieceCents !== null) {
          rowTierWarnings.push({
            code: "PBV2_TIER_INVALID_RATE",
            severity: "warning",
            message: "Matched matrix row quantity tier has an invalid $/piece rate; base pricing fallback was used for $/piece.",
            detail: { matrixRowId, tierId: matchedTierIdentity.id, field: "perPieceCents" },
          });
        }
      }

      if ("minimumChargeCents" in rowTier) {
        if (isValidRateCents(rowTier.minimumChargeCents)) {
          minimumChargeCents = rowTier.minimumChargeCents;
          appliedRateField = true;
        } else if (rowTier.minimumChargeCents !== undefined && rowTier.minimumChargeCents !== null) {
          rowTierWarnings.push({
            code: "PBV2_TIER_INVALID_RATE",
            severity: "warning",
            message: "Matched matrix row quantity tier has an invalid minimum charge; base pricing fallback was used for minimum charge.",
            detail: { matrixRowId, tierId: matchedTierIdentity.id, field: "minimumChargeCents" },
          });
        }
      }

      if (!appliedRateField) {
        rowTierWarnings.push({
          code: "PBV2_TIER_INVALID_RATE",
          severity: "warning",
          message: "Matched matrix row quantity tier does not define a valid rate; base pricing fallback was used.",
          detail: { matrixRowId, tierId: matchedTierIdentity.id },
        });
      }

      basePriceSource = "pricing_matrix.row_qty_tier";
      rateUsedSource = "pricing_matrix.row_qty_tier";
      tierResolution = {
        quantity,
        tierSystemEnabled: true,
        tierSource: "matrix_row",
        matrixRowId,
        matchedTierId: matchedTierIdentity.id,
        matchedTierLabel: matchedTierIdentity.label,
        originalBaseRate: dollarsFromCents(typeof base.perSqftCents === "number" ? base.perSqftCents : 0),
        tierBaseRate: dollarsFromCents(perSqftCents),
        effectiveBaseRateBeforeMatrix: dollarsFromCents(perSqftCents),
        matrixBasePriceOverride: false,
        matrixStaticBaseRate,
        matrixBasePriceRaw,
        matrixBasePriceIgnoredBecauseTierMatched: matrixBasePriceRaw !== null,
        matrixStaticBaseRateUsedAsFallback: false,
        productTierFallbackUsed: false,
        tierBasis: tierBasisState.tierBasis,
        tierBasisValue: tierBasisState.tierBasisValue,
        tierBasisResolvedFrom: tierBasisState.tierBasisResolvedFrom,
        lineItemQuantity: tierBasisState.lineItemQuantity,
        rawItemQuantity: tierBasisState.lineItemQuantity,
        tierSelectionQuantity: tierBasisState.tierBasisValue,
        computedSheetUsage: tierBasisState.computedSheetUsage,
        computedSheetUsageAvailable: tierBasisState.computedSheetUsageAvailable,
        computedSheetUsageMode: tierBasisState.computedSheetUsageMode,
        sheetUsageMethod: tierBasisState.sheetUsageMethod,
        allowRotation: tierBasisState.allowRotation,
        allowRotationSource: tierBasisState.allowRotationSource,
        normalPiecesPerSheet: tierBasisState.normalPiecesPerSheet,
        rotatedPiecesPerSheet: tierBasisState.rotatedPiecesPerSheet,
        mixedPiecesPerSheet: tierBasisState.mixedPiecesPerSheet,
        mixedLayoutDescription: tierBasisState.mixedLayoutDescription,
        piecesPerSheet: tierBasisState.piecesPerSheet,
        orientationUsed: tierBasisState.orientationUsed,
        fullSheets: tierBasisState.fullSheets,
        partialSheetPieceCount: tierBasisState.partialSheetPieceCount,
        partialSheetFinishedSqft: tierBasisState.partialSheetFinishedSqft,
        partialSheetBillableSqft: tierBasisState.partialSheetBillableSqft,
        partialSheetPolicy: tierBasisState.partialSheetPolicy,
        totalSheetCount: tierBasisState.totalSheetCount,
        tierSheetWidth: tierBasisState.tierSheetWidth,
        tierSheetLength: tierBasisState.tierSheetLength,
        tierUsableDropMin: tierBasisState.tierUsableDropMin,
        tierBillableLengthIncrement: tierBasisState.tierBillableLengthIncrement,
        tierMinimumBillableSqft: tierBasisState.tierMinimumBillableSqft,
        tierVariableSources: tierBasisState.tierVariableSources,
        computedSheetUsageUnavailableReason: tierBasisState.computedSheetUsageUnavailableReason,
        fallbackToLineItemQuantity: tierBasisState.fallbackToLineItemQuantity,
        selectedTierMinQty: typeof matchedRowTier.minQty === "number" ? matchedRowTier.minQty : null,
        selectedTierRate: dollarsFromCents(perSqftCents),
        selectedTierSource: "matrix_row",
        selectedTierRateAppliedToBasePrice,
        basePriceFinal: dollarsFromCents(perSqftCents),
        basePriceSource,
        finalBaseRateUsed: dollarsFromCents(perSqftCents),
        warnings: [...tierBasisState.warnings, ...rowTierWarnings],
      };
    } else {
      const warnings: Pbv2TierResolutionWarning[] = [{
        code: "PBV2_TIER_MATRIX_ROW_NO_MATCH",
        severity: "warning",
        message: "Matched pricing matrix row has quantity tiers, but no row-level tier matched the selected tier basis value.",
        detail: { matrixRowId, quantity: tierBasisState.tierBasisValue, lineItemQuantity: quantity },
      }];

      if (hasMatrixBasePrice) {
        perSqftCents = matrixBasePrice * 100;
        basePriceSource = "pricing_matrix.base_price_fallback";
        rateUsedSource = "pricing_matrix.base_price_fallback";
        warnings.push({
          code: "PBV2_TIER_MATRIX_STATIC_BASE_FALLBACK",
          severity: "warning",
          message: "Static matrix base_price was used because no row-level quantity tier matched.",
          detail: { matrixRowId, matrixBasePrice },
        });
      }

      tierResolution = {
        quantity,
        tierSystemEnabled: true,
        tierSource: "matrix_row",
        matrixRowId,
        matchedTierId: null,
        matchedTierLabel: null,
        originalBaseRate: dollarsFromCents(typeof base.perSqftCents === "number" ? base.perSqftCents : 0),
        tierBaseRate: null,
        effectiveBaseRateBeforeMatrix: dollarsFromCents(perSqftCents),
        matrixBasePriceOverride: hasMatrixBasePrice,
        matrixStaticBaseRate,
        matrixBasePriceRaw,
        matrixBasePriceIgnoredBecauseTierMatched: false,
        matrixStaticBaseRateUsedAsFallback: hasMatrixBasePrice,
        productTierFallbackUsed: false,
        tierBasis: tierBasisState.tierBasis,
        tierBasisValue: tierBasisState.tierBasisValue,
        tierBasisResolvedFrom: tierBasisState.tierBasisResolvedFrom,
        lineItemQuantity: tierBasisState.lineItemQuantity,
        rawItemQuantity: tierBasisState.lineItemQuantity,
        tierSelectionQuantity: tierBasisState.tierBasisValue,
        computedSheetUsage: tierBasisState.computedSheetUsage,
        computedSheetUsageAvailable: tierBasisState.computedSheetUsageAvailable,
        computedSheetUsageMode: tierBasisState.computedSheetUsageMode,
        sheetUsageMethod: tierBasisState.sheetUsageMethod,
        allowRotation: tierBasisState.allowRotation,
        allowRotationSource: tierBasisState.allowRotationSource,
        normalPiecesPerSheet: tierBasisState.normalPiecesPerSheet,
        rotatedPiecesPerSheet: tierBasisState.rotatedPiecesPerSheet,
        mixedPiecesPerSheet: tierBasisState.mixedPiecesPerSheet,
        mixedLayoutDescription: tierBasisState.mixedLayoutDescription,
        piecesPerSheet: tierBasisState.piecesPerSheet,
        orientationUsed: tierBasisState.orientationUsed,
        fullSheets: tierBasisState.fullSheets,
        partialSheetPieceCount: tierBasisState.partialSheetPieceCount,
        partialSheetFinishedSqft: tierBasisState.partialSheetFinishedSqft,
        partialSheetBillableSqft: tierBasisState.partialSheetBillableSqft,
        partialSheetPolicy: tierBasisState.partialSheetPolicy,
        totalSheetCount: tierBasisState.totalSheetCount,
        tierSheetWidth: tierBasisState.tierSheetWidth,
        tierSheetLength: tierBasisState.tierSheetLength,
        tierUsableDropMin: tierBasisState.tierUsableDropMin,
        tierBillableLengthIncrement: tierBasisState.tierBillableLengthIncrement,
        tierMinimumBillableSqft: tierBasisState.tierMinimumBillableSqft,
        tierVariableSources: tierBasisState.tierVariableSources,
        computedSheetUsageUnavailableReason: tierBasisState.computedSheetUsageUnavailableReason,
        fallbackToLineItemQuantity: tierBasisState.fallbackToLineItemQuantity,
        selectedTierMinQty: null,
        selectedTierRate: null,
        selectedTierSource: "matrix_row",
        selectedTierRateAppliedToBasePrice: false,
        basePriceFinal: dollarsFromCents(perSqftCents),
        basePriceSource,
        finalBaseRateUsed: dollarsFromCents(perSqftCents),
        warnings: [...tierBasisState.warnings, ...warnings],
      };
    }
  } else {
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
        tierQuantity: tierBasisState.tierBasisValue,
      }
    );
    perSqftCents = resolvedBaseRates.perSqftCents;
    perPieceCents = resolvedBaseRates.perPieceCents;
    minimumChargeCents = resolvedBaseRates.minimumChargeCents;
    tierResolution = {
      ...resolvedBaseRates.tierResolution,
      matrixRowId,
      matrixStaticBaseRate: hasMatrixBasePrice ? matrixBasePrice : null,
      matrixBasePriceRaw,
      matrixBasePriceIgnoredBecauseTierMatched: false,
      matrixStaticBaseRateUsedAsFallback: false,
      productTierFallbackUsed: Boolean(matchedMatrixRow)
        && (
          resolvedBaseRates.tierResolution.tierSource === "pbv2_product"
          || resolvedBaseRates.tierResolution.tierSource === "pbv2_pricing_v2"
        ),
      tierBasis: tierBasisState.tierBasis,
      tierBasisValue: tierBasisState.tierBasisValue,
      tierBasisResolvedFrom: tierBasisState.tierBasisResolvedFrom,
      lineItemQuantity: tierBasisState.lineItemQuantity,
      rawItemQuantity: tierBasisState.lineItemQuantity,
      tierSelectionQuantity: tierBasisState.tierBasisValue,
      computedSheetUsage: tierBasisState.computedSheetUsage,
      computedSheetUsageAvailable: tierBasisState.computedSheetUsageAvailable,
      computedSheetUsageMode: tierBasisState.computedSheetUsageMode,
      sheetUsageMethod: tierBasisState.sheetUsageMethod,
      allowRotation: tierBasisState.allowRotation,
      allowRotationSource: tierBasisState.allowRotationSource,
      normalPiecesPerSheet: tierBasisState.normalPiecesPerSheet,
      rotatedPiecesPerSheet: tierBasisState.rotatedPiecesPerSheet,
      mixedPiecesPerSheet: tierBasisState.mixedPiecesPerSheet,
      mixedLayoutDescription: tierBasisState.mixedLayoutDescription,
      piecesPerSheet: tierBasisState.piecesPerSheet,
      orientationUsed: tierBasisState.orientationUsed,
      fullSheets: tierBasisState.fullSheets,
      partialSheetPieceCount: tierBasisState.partialSheetPieceCount,
      partialSheetFinishedSqft: tierBasisState.partialSheetFinishedSqft,
      partialSheetBillableSqft: tierBasisState.partialSheetBillableSqft,
      partialSheetPolicy: tierBasisState.partialSheetPolicy,
      totalSheetCount: tierBasisState.totalSheetCount,
      tierSheetWidth: tierBasisState.tierSheetWidth,
      tierSheetLength: tierBasisState.tierSheetLength,
      tierUsableDropMin: tierBasisState.tierUsableDropMin,
      tierBillableLengthIncrement: tierBasisState.tierBillableLengthIncrement,
      tierMinimumBillableSqft: tierBasisState.tierMinimumBillableSqft,
      tierVariableSources: tierBasisState.tierVariableSources,
      computedSheetUsageUnavailableReason: tierBasisState.computedSheetUsageUnavailableReason,
      fallbackToLineItemQuantity: tierBasisState.fallbackToLineItemQuantity,
      selectedTierMinQty: resolvedBaseRates.tierResolution.selectedTierMinQty ?? null,
      selectedTierRate: resolvedBaseRates.tierResolution.selectedTierRate ?? null,
      selectedTierSource: resolvedBaseRates.tierResolution.selectedTierSource ?? null,
      selectedTierRateAppliedToBasePrice: typeof resolvedBaseRates.tierResolution.selectedTierRate === "number",
      basePriceFinal: perSqftCents / 100,
      basePriceSource,
      warnings: [...tierBasisState.warnings, ...resolvedBaseRates.tierResolution.warnings],
    };

    if (hasMatrixBasePrice) {
      perSqftCents = matrixBasePrice * 100;
      tierResolution = {
        ...tierResolution,
        matrixBasePriceOverride: true,
        finalBaseRateUsed: matrixBasePrice,
        basePriceFinal: matrixBasePrice,
        basePriceSource: "pricing_matrix.base_price",
        warnings: [
          ...tierResolution.warnings,
          {
            code: "PBV2_TIER_MATRIX_BASE_PRICE_OVERRIDE",
            severity: "warning",
            message: "Pricing matrix base_price explicitly overrode the tier-resolved base rate.",
            detail: {
              effectiveBaseRateBeforeMatrix: tierResolution.effectiveBaseRateBeforeMatrix,
              matrixBasePrice: matrixBasePrice,
              matrixRowId,
            },
          },
        ],
      };
    } else {
      tierResolution = {
        ...tierResolution,
        matrixBasePriceOverride: false,
        basePriceFinal: perSqftCents / 100,
        basePriceSource,
        finalBaseRateUsed: perSqftCents / 100,
      };
    }
  }

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
    const flatGoodsAllowRotation = pricingContext?.allowRotation ?? activeProfileConfig?.allowRotation ?? false;
    const flatGoodsProfileConfig: FlatGoodsConfig = {
      sheetWidth: activeProfileConfig?.sheetWidth ?? (productLegacy.sheetWidth ? Number(productLegacy.sheetWidth) : 48),
      sheetHeight: activeProfileConfig?.sheetHeight ?? (productLegacy.sheetHeight ? Number(productLegacy.sheetHeight) : 96),
      materialType: activeProfileConfig?.materialType ?? productLegacy.materialType ?? "sheet",
      minSheets: activeProfileConfig?.minSheets,
      minPricePerItem: activeProfileConfig?.minPricePerItem ?? (productLegacy.minPricePerItem ? Number(productLegacy.minPricePerItem) : null),
      allowRotation: flatGoodsAllowRotation,
    };
    const flatGoodsInput = buildFlatGoodsInput(
      flatGoodsProfileConfig,
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
          allowRotation ?? flatGoodsAllowRotation,
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
      preMinimumCents: Math.round(flatGoodsResult.totalPrice * 100),
      minimumApplied: false,
      basePriceSource,
      rateUsedSource,
      tierResolution,
      sheetYieldMetrics,
      nestingDetails: {
        ...flatGoodsResult.nestingDetails,
        sheetCount: flatGoodsResult.sheetCount,
        usedSqft: flatGoodsResult.usedSqft,
      },
    };
  }

  // Apply minimum charge once per line item (not per unit)
  const total = minimumChargeCents > 0 ? Math.max(lineBaseCents, minimumChargeCents) : lineBaseCents;
  const minimumApplied = minimumChargeCents > 0 && minimumChargeCents > lineBaseCents;

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
    preMinimumCents: Math.round(lineBaseCents),
    minimumApplied,
    basePriceSource,
    rateUsedSource,
    tierResolution,
    sheetYieldMetrics,
  };
}

type BasePriceDetails = ReturnType<typeof calculateBasePriceDetails>;

type FormulaAwareBasePriceResult = {
  basePriceCents: number;
  formulaToUse: string;
  formulaDebug: NonNullable<PricingPreviewEvaluationResult["debug"]>;
  formulaApplied: boolean;
  formulaEvaluatedTotalCents: number | null;
  formulaEvaluatedTotalRaw: number | null;
  formulaEvaluatedTotalRounded: number | null;
  rawBasePrice: number | null;
  roundingAppliedAt: "final_currency_total" | "not_applicable";
  pbv2BaseTotalCents: number;
  finalTotalSource: "formula" | "pbv2_base";
  finalTotalCents: number;
  minimumApplied: boolean;
  preMinimumCents: number;
  tierResolution: Pbv2TierResolution;
  resolvedFormulaSource: ResolvedFormulaSource;
};

type FormulaSourceMode = "library" | "manual" | "profile";
type ResolvedFormulaSource = "library" | "manual" | "tree_meta" | "product" | "profile" | "none";

type PricingFormulaLibraryResolution = {
  id: string;
  name?: string | null;
  code?: string | null;
  expression: string;
  config?: Record<string, any> | null;
};

type FormulaVariableResolution = {
  variables: Record<string, number>;
  sources: Record<string, string>;
};

const SHEET_CONSUMPTION_SAFE_DEFAULTS: Record<string, number> = {
  sheet_width: 48,
  sheet_length: 96,
  usable_drop_min: 0,
  billable_length_increment: 1,
  minimum_billable_sqft: 32,
};

type FormulaSourceResolution = {
  formula: string;
  source: ResolvedFormulaSource;
  mode: FormulaSourceMode;
  formulaId: string | null;
  formulaName: string | null;
  manualFormulaPresent: boolean;
  manualFormulaIgnored: boolean;
  warnings: Array<{ code: string; message: string; detail?: any }>;
};

function normalizeFormulaSourceMode(value: unknown, hasLibraryFormula: boolean, hasManualFormula: boolean): FormulaSourceMode {
  const raw = String(value || "").trim();
  if (raw === "library" || raw === "formulaLibrary") return "library";
  if (raw === "manual" || raw === "pricingFormula") return "manual";
  if (raw === "profile" || raw === "pricingProfile") return "profile";
  if (hasLibraryFormula) return "library";
  if (hasManualFormula) return "manual";
  return "profile";
}

function numericRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const parsedBoolean = key === "allow_rotation" ? parseFormulaBoolean(rawValue) : null;
    const numeric = parsedBoolean === null ? Number(rawValue) : Number(parsedBoolean);
    if (key && Number.isFinite(numeric)) out[key] = numeric;
  }
  return out;
}

function formulaReferencesSheetDefaultVariables(expression: string | null | undefined): boolean {
  if (!expression || typeof expression !== "string") return false;
  return /\bsheet_consumption_sqft\s*\(/i.test(expression)
    || Object.keys(SHEET_CONSUMPTION_SAFE_DEFAULTS).some((key) => new RegExp(`\\b${key}\\b`).test(expression));
}

function mergeFormulaVariables(
  target: FormulaVariableResolution,
  source: Record<string, number> | undefined,
  sourceLabel: string,
): void {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    const parsedBoolean = key === "allow_rotation" ? parseFormulaBoolean(value) : null;
    const numeric = parsedBoolean === null ? Number(value) : Number(parsedBoolean);
    if (!key || !Number.isFinite(numeric)) continue;
    target.variables[key] = numeric;
    target.sources[key] = sourceLabel;
  }
}

function resolveFormulaLibraryDefaultVariables(library: PricingFormulaLibraryResolution | null | undefined): Record<string, number> {
  if (!library?.config || typeof library.config !== "object" || Array.isArray(library.config)) return {};
  return extractFormulaVariables(library.config);
}

function resolveProductFormulaVariables(treeJson: any, product?: any, pricingProfileConfigOverride?: unknown): FormulaVariableResolution {
  const meta = treeJson?.meta && typeof treeJson.meta === "object" ? treeJson.meta : {};
  const pricingProfileConfigSource = pricingProfileConfigOverride ?? product?.pricingProfileConfig;
  const pricingProfileConfig = pricingProfileConfigSource && typeof pricingProfileConfigSource === "object"
    ? pricingProfileConfigSource
    : {};
  const resolved: FormulaVariableResolution = { variables: {}, sources: {} };

  mergeFormulaVariables(resolved, numericRecord((pricingProfileConfig as any).formulaVariables), "product.pricingProfileConfig.formulaVariables");
  mergeFormulaVariables(resolved, numericRecord((meta as any).pricingFormulaVariables), "tree.meta.pricingFormulaVariables");
  mergeFormulaVariables(resolved, numericRecord((meta as any).formulaVariables), "tree.meta.formulaVariables");

  return resolved;
}

function resolveFormulaVariablesForPricing(input: {
  treeJson: any;
  product?: any;
  pricingProfileConfig?: unknown;
  pricingFormulaLibrary?: PricingFormulaLibraryResolution | null;
  pricingFormulaExpression?: string | null;
  explicitFormulaVariables?: Record<string, number>;
  selectionFormulaVariables?: Record<string, number>;
}): FormulaVariableResolution {
  const resolved: FormulaVariableResolution = { variables: {}, sources: {} };

  if (formulaReferencesSheetDefaultVariables(input.pricingFormulaExpression)) {
    mergeFormulaVariables(resolved, SHEET_CONSUMPTION_SAFE_DEFAULTS, "safe.sheet_consumption_defaults");
  }

  mergeFormulaVariables(
    resolved,
    resolveFormulaLibraryDefaultVariables(input.pricingFormulaLibrary),
    "formula_library.config.variables",
  );

  const productVariables = resolveProductFormulaVariables(input.treeJson, input.product, input.pricingProfileConfig);
  mergeFormulaVariables(resolved, productVariables.variables, "product_or_tree.formulaVariables");
  for (const [key, source] of Object.entries(productVariables.sources)) {
    if (Object.prototype.hasOwnProperty.call(productVariables.variables, key)) {
      resolved.sources[key] = source;
    }
  }

  mergeFormulaVariables(resolved, input.explicitFormulaVariables, "preview.formulaVariables");
  mergeFormulaVariables(resolved, input.selectionFormulaVariables, "pbv2.numericSelection");

  return resolved;
}

function resolveFormulaSource(input: {
  formulaSourceMode?: string | null;
  overrideFormula: string;
  manualFormulaText?: string;
  formulaFromTree: string;
  formulaFromLibrary: string;
  formulaLibraryId?: string | null;
  formulaLibraryName?: string | null;
  formulaFromProduct: string;
  formulaFromProfile: string;
}): FormulaSourceResolution {
  const mode = normalizeFormulaSourceMode(input.formulaSourceMode, Boolean(input.formulaFromLibrary), Boolean(input.overrideFormula));
  const manualFormulaForDebug = input.overrideFormula || input.manualFormulaText || (
    mode === "library" || mode === "manual" ? input.formulaFromProduct : ""
  );
  const manualFormulaPresent = Boolean(manualFormulaForDebug);
  const warnings: FormulaSourceResolution["warnings"] = [];

  if (mode === "library") {
    if (!input.formulaFromLibrary) {
      return {
        formula: "",
        source: "none",
        mode,
        formulaId: input.formulaLibraryId ?? null,
        formulaName: input.formulaLibraryName ?? null,
        manualFormulaPresent,
        manualFormulaIgnored: manualFormulaPresent,
        warnings,
      };
    }

    if (manualFormulaPresent && manualFormulaForDebug !== input.formulaFromLibrary) {
      warnings.push({
        code: "PBV2_W_LIBRARY_FORMULA_DETACHED",
        message: "Manual formula text differs from the selected Formula Library expression and was ignored because Formula Library mode is selected.",
        detail: {
          manualFormula: manualFormulaForDebug,
          libraryFormula: input.formulaFromLibrary,
        },
      });
    }

    return {
      formula: input.formulaFromLibrary,
      source: "library",
      mode,
      formulaId: input.formulaLibraryId ?? null,
      formulaName: input.formulaLibraryName ?? null,
      manualFormulaPresent,
      manualFormulaIgnored: manualFormulaPresent,
      warnings,
    };
  }

  if (mode === "manual" && (input.overrideFormula || input.formulaFromProduct)) {
    return {
      formula: input.overrideFormula || input.formulaFromProduct,
      source: "manual",
      mode,
      formulaId: null,
      formulaName: null,
      manualFormulaPresent,
      manualFormulaIgnored: false,
      warnings,
    };
  }

  if (input.formulaFromTree) {
    return {
      formula: input.formulaFromTree,
      source: "tree_meta",
      mode,
      formulaId: null,
      formulaName: null,
      manualFormulaPresent,
      manualFormulaIgnored: mode !== "manual" && manualFormulaPresent,
      warnings,
    };
  }

  if (input.formulaFromProduct) {
    return {
      formula: input.formulaFromProduct,
      source: "product",
      mode,
      formulaId: null,
      formulaName: null,
      manualFormulaPresent,
      manualFormulaIgnored: mode !== "manual" && manualFormulaPresent,
      warnings,
    };
  }

  if (input.formulaFromProfile) {
    return {
      formula: input.formulaFromProfile,
      source: "profile",
      mode,
      formulaId: null,
      formulaName: null,
      manualFormulaPresent,
      manualFormulaIgnored: mode !== "manual" && manualFormulaPresent,
      warnings,
    };
  }

  return {
    formula: "",
    source: "none",
    mode,
    formulaId: null,
    formulaName: null,
    manualFormulaPresent,
    manualFormulaIgnored: mode !== "manual" && manualFormulaPresent,
    warnings,
  };
}

function centsEqual(left: number, right: number): boolean {
  return Math.abs(Math.round(left) - Math.round(right)) <= 0;
}

function roundCurrencyCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function buildFinalTotalMismatchError(input: {
  formulaBasePrice: FormulaAwareBasePriceResult;
  basePriceCents: number;
  optionsCents: number;
  totalCents: number;
  debug: NonNullable<PricingPreviewEvaluationResult["debug"]>;
}): PricingPreviewFormulaError | null {
  const { formulaBasePrice } = input;
  if (formulaBasePrice.finalTotalSource !== "formula") return null;

  const expectedBaseCents = formulaBasePrice.finalTotalCents;
  const expectedTotalCents = expectedBaseCents + input.optionsCents;
  const mismatches: string[] = [];

  if (!centsEqual(input.basePriceCents, expectedBaseCents)) {
    mismatches.push(`base=${input.basePriceCents / 100} expected_formula_base=${expectedBaseCents / 100}`);
  }

  if (!centsEqual(input.totalCents, expectedTotalCents)) {
    mismatches.push(`total=${input.totalCents / 100} expected_formula_total=${expectedTotalCents / 100}`);
  }

  if (
    !formulaBasePrice.minimumApplied &&
    formulaBasePrice.formulaEvaluatedTotalCents != null &&
    !centsEqual(formulaBasePrice.formulaEvaluatedTotalCents, formulaBasePrice.finalTotalCents)
  ) {
    mismatches.push(
      `formula_evaluated_total=${formulaBasePrice.formulaEvaluatedTotalCents / 100} final_total=${formulaBasePrice.finalTotalCents / 100}`,
    );
  }

  if (mismatches.length === 0) return null;

  return buildPbv2PricingFormulaError({
    code: "PBV2_E_FINAL_TOTAL_MISMATCH",
    message: `PBV2 formula final total mismatch: ${mismatches.join("; ")}`,
    debug: input.debug,
  });
}

function buildFormulaDebugMismatchError(input: {
  formulaBasePrice: FormulaAwareBasePriceResult;
  debug: NonNullable<PricingPreviewEvaluationResult["debug"]>;
}): PricingPreviewFormulaError | null {
  if (input.formulaBasePrice.finalTotalSource !== "formula") return null;

  const resolvedExpression = String(input.debug.resolvedFormulaExpression || "").trim();
  const formulaUsed = String(input.formulaBasePrice.formulaToUse || "").trim();
  if (!resolvedExpression || !formulaUsed || resolvedExpression === formulaUsed) return null;

  return buildPbv2PricingFormulaError({
    code: "PBV2_E_FORMULA_DEBUG_MISMATCH",
    message: "PBV2 formula debug expression does not match the formula expression used for final pricing.",
    debug: input.debug,
  });
}

function formulaReferencesTierVariables(formula: string): boolean {
  return /\b(?:original_base_price|tier_base_price|tier_rate|effective_base_price)\b/.test(formula);
}

function withFormulaTierReferenceWarning(tierResolution: Pbv2TierResolution, formula: string): Pbv2TierResolution {
  if (!formula || tierResolution.tierSystemEnabled || !formulaReferencesTierVariables(formula)) {
    return { ...tierResolution, warnings: [...tierResolution.warnings] };
  }

  return {
    ...tierResolution,
    warnings: [
      ...tierResolution.warnings,
      {
        code: "PBV2_TIER_FORMULA_REFERENCE_WITHOUT_TIER_SYSTEM",
        severity: "warning",
        message: "Formula references tier variables, but no PBV2 quantity tier system is configured; base-rate fallback values were used.",
      },
    ],
  };
}

/**
 * Shared PBV2 runtime pricing boundary for Product Builder preview and order entry.
 * Both paths must resolve option rules, resolve the pricing matrix, build this formula
 * scope, and only then evaluate options against the calculated base line price.
 */
function calculateFormulaAwareBasePrice(input: {
  treeJson: any;
  product?: any;
  baseDetails: BasePriceDetails;
  quantity: number;
  pricingFormulaOverride?: string | null;
  manualFormulaText?: string | null;
  formulaSourceMode?: FormulaSourceMode | "formulaLibrary" | "pricingFormula" | "pricingProfile" | null;
  pricingFormulaLibrary?: PricingFormulaLibraryResolution | null;
  formulaVariables?: Record<string, number>;
  formulaVariableSources?: Record<string, string>;
  pricingMatrixVariables?: Record<string, number>;
}): FormulaAwareBasePriceResult {
  const baseDetails = input.baseDetails;
  const activeProfile = getProfile(baseDetails.pricingProfileKey);
  const profileUsesFormula = Boolean(activeProfile.usesFormula);
  const formulaFromTree = typeof input?.treeJson?.meta?.pricingFormula === "string"
    ? input.treeJson.meta.pricingFormula.trim()
    : "";
  const formulaFromProduct = typeof input.product?.pricingFormula === "string"
    ? input.product.pricingFormula.trim()
    : "";
  const formulaFromLibrary = typeof input.pricingFormulaLibrary?.expression === "string"
    ? input.pricingFormulaLibrary.expression.trim()
    : "";
  const formulaFromProfile = typeof activeProfile.defaultFormula === "string"
    ? activeProfile.defaultFormula.trim()
    : "";
  const overrideFormula = typeof input.pricingFormulaOverride === "string"
    ? input.pricingFormulaOverride.trim()
    : "";
  const manualFormulaText = typeof input.manualFormulaText === "string"
    ? input.manualFormulaText.trim()
    : "";
  const sourceResolution = resolveFormulaSource({
    formulaSourceMode: input.formulaSourceMode,
    overrideFormula,
    manualFormulaText,
    formulaFromTree,
    formulaFromLibrary,
    formulaLibraryId: input.pricingFormulaLibrary?.id ?? null,
    formulaLibraryName: input.pricingFormulaLibrary?.name ?? null,
    formulaFromProduct,
    formulaFromProfile,
  });
  const formulaCandidate = sourceResolution.formula;
  const shouldEvaluateFormula = Boolean(formulaCandidate);
  const formulaToUse = shouldEvaluateFormula ? formulaCandidate : "";
  const tierResolution = withFormulaTierReferenceWarning(baseDetails.tierResolution, formulaToUse);
  const formulaVariables = input.formulaVariables
    ?? (input.product ? resolveSnapshotFormulaVariables(input.treeJson, input.product) : undefined);

  const formulaDebug = buildBaseFormulaDebugContext({
    formulaRaw: formulaToUse,
    orderedWidthIn: baseDetails.orderedWidthIn,
    orderedHeightIn: baseDetails.orderedHeightIn,
    trimAllowanceX: baseDetails.trimAllowanceX,
    trimAllowanceY: baseDetails.trimAllowanceY,
    finishedWidthIn: baseDetails.finishedWidthIn,
    finishedHeightIn: baseDetails.finishedHeightIn,
    quantity: input.quantity,
    baseRatePerSqft: baseDetails.perSqftCents / 100,
    originalBaseRate: tierResolution.originalBaseRate,
    tierBaseRate: tierResolution.tierBaseRate,
    effectiveBaseRate: tierResolution.effectiveBaseRateBeforeMatrix,
    sqftPerItem: baseDetails.sqftPerItem,
    totalSqft: baseDetails.totalSqft,
    linearFeet: baseDetails.linearFeet,
    sheetYieldMetrics: baseDetails.sheetYieldMetrics,
    formulaVariables,
    formulaVariableSources: input.formulaVariableSources,
    pricingMatrixVariables: input.pricingMatrixVariables,
  });
  formulaDebug.formulaSourceMode = sourceResolution.mode;
  formulaDebug.resolvedFormulaSource = sourceResolution.source;
  formulaDebug.resolvedFormulaId = sourceResolution.formulaId;
  formulaDebug.resolvedFormulaName = sourceResolution.formulaName;
  formulaDebug.resolvedFormulaExpression = sourceResolution.formula || undefined;
  formulaDebug.manualFormulaPresent = sourceResolution.manualFormulaPresent;
  formulaDebug.manualFormulaIgnored = sourceResolution.manualFormulaIgnored;
  formulaDebug.errors = [
    ...(formulaDebug.errors ?? []),
    ...sourceResolution.warnings,
  ];

  if (sourceResolution.mode === "library" && sourceResolution.source !== "library") {
    throw buildPbv2PricingFormulaError({
      message: sourceResolution.formulaId
        ? `Selected Formula Library item '${sourceResolution.formulaId}' could not be resolved.`
        : "Formula Library mode is selected, but no Formula Library item is selected.",
      code: "PBV2_E_FORMULA_LIBRARY_NOT_FOUND",
      debug: formulaDebug,
    });
  }

  if (sourceResolution.source === "library" && !sourceResolution.manualFormulaIgnored && sourceResolution.manualFormulaPresent) {
    throw buildPbv2PricingFormulaError({
      message: "Formula Library source was selected, but manual formula text was not ignored.",
      code: "PBV2_E_FORMULA_SOURCE_MISMATCH",
      debug: formulaDebug,
    });
  }

  if (!shouldEvaluateFormula) {
    if (profileUsesFormula) {
      throw buildPbv2PricingFormulaError({
        message: "PBV2 formula pricing is selected, but no formula expression is configured.",
        code: "PBV2_FORMULA_MISSING",
        debug: formulaDebug,
      });
    }
    return {
      basePriceCents: baseDetails.totalCents,
      formulaToUse,
      formulaDebug,
      formulaApplied: false,
      formulaEvaluatedTotalCents: null,
      formulaEvaluatedTotalRaw: null,
      formulaEvaluatedTotalRounded: null,
      rawBasePrice: baseDetails.perSqftCents / 100,
      roundingAppliedAt: "not_applicable",
      pbv2BaseTotalCents: baseDetails.totalCents,
      finalTotalSource: "pbv2_base",
      finalTotalCents: baseDetails.totalCents,
      minimumApplied: baseDetails.minimumApplied,
      preMinimumCents: baseDetails.preMinimumCents,
      tierResolution,
      resolvedFormulaSource: sourceResolution.source,
    };
  }

  const formulaEvaluation = evaluatePreviewFormulaToCents({
    formula: formulaToUse,
    orderedWidthIn: baseDetails.orderedWidthIn,
    orderedHeightIn: baseDetails.orderedHeightIn,
    trimAllowanceX: baseDetails.trimAllowanceX,
    trimAllowanceY: baseDetails.trimAllowanceY,
    finishedWidthIn: baseDetails.finishedWidthIn,
    finishedHeightIn: baseDetails.finishedHeightIn,
    quantity: input.quantity,
    baseRatePerSqft: baseDetails.perSqftCents / 100,
    originalBaseRate: tierResolution.originalBaseRate,
    tierBaseRate: tierResolution.tierBaseRate,
    effectiveBaseRate: tierResolution.effectiveBaseRateBeforeMatrix,
    sqftPerItem: baseDetails.sqftPerItem,
    totalSqft: baseDetails.totalSqft,
    linearFeet: baseDetails.linearFeet,
    sheetYieldMetrics: baseDetails.sheetYieldMetrics,
    formulaVariables,
    formulaVariableSources: input.formulaVariableSources,
    pricingMatrixVariables: input.pricingMatrixVariables,
  });

  formulaDebug.formulaResolved = formulaEvaluation.formulaResolved;
  formulaDebug.resultValue = formulaEvaluation.resultValue;
  formulaDebug.appliedAs = formulaEvaluation.appliedAs;
  formulaDebug.steps = formulaEvaluation.steps;
  formulaDebug.preCeilSqftTotal = formulaEvaluation.preCeilSqftTotal;
  formulaDebug.postCeilSqftTotal = formulaEvaluation.postCeilSqftTotal;
  formulaDebug.baseRateUsed = formulaEvaluation.baseRateUsed;
  formulaDebug.formulaResultType = formulaEvaluation.formulaResultType;
  formulaDebug.quantityBasisUsed = formulaEvaluation.quantityBasisUsed;
  formulaDebug.selectedRate = formulaEvaluation.selectedRate;
  formulaDebug.likelyMisconfiguredFormula = formulaEvaluation.likelyMisconfiguredFormula;
  formulaDebug.errors = [
    ...(formulaDebug.errors ?? []),
    ...formulaEvaluation.warnings,
  ];

  const formulaTotalRaw = formulaEvaluation.appliedAs === "unitPrice"
    ? formulaEvaluation.resultValue * input.quantity
    : formulaEvaluation.resultValue;
  const preMinimumCents = roundCurrencyCents(formulaTotalRaw);
  const evaluatedFormulaTotalRounded = preMinimumCents / 100;
  const minimumApplied = baseDetails.minimumChargeCents > 0 && baseDetails.minimumChargeCents > preMinimumCents;
  const finalTotalCents = minimumApplied ? baseDetails.minimumChargeCents : preMinimumCents;
  formulaDebug.rawBasePrice = baseDetails.perSqftCents / 100;
  formulaDebug.evaluatedFormulaTotalRaw = formulaTotalRaw;
  formulaDebug.evaluatedFormulaTotalRounded = evaluatedFormulaTotalRounded;
  formulaDebug.roundingAppliedAt = "final_currency_total";
  formulaDebug.finalFormulaTotal = formulaTotalRaw;

  return {
    basePriceCents: finalTotalCents,
    formulaToUse,
    formulaDebug,
    formulaApplied: true,
    formulaEvaluatedTotalCents: preMinimumCents,
    formulaEvaluatedTotalRaw: formulaTotalRaw,
    formulaEvaluatedTotalRounded: evaluatedFormulaTotalRounded,
    rawBasePrice: baseDetails.perSqftCents / 100,
    roundingAppliedAt: "final_currency_total",
    pbv2BaseTotalCents: baseDetails.totalCents,
    finalTotalSource: "formula",
    finalTotalCents,
    minimumApplied,
    preMinimumCents,
    tierResolution,
    resolvedFormulaSource: sourceResolution.source,
  };
}

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
    const parsedBoolean = key === "allow_rotation" ? parseFormulaBoolean(raw) : null;
    const parsed = parsedBoolean === null ? Number(raw) : Number(parsedBoolean);
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

function resolveSnapshotFormula(treeJson: any, product: any, pricingProfileKey: string): { formula: string } {
  const profile = getProfile(pricingProfileKey);
  if (!profile.usesFormula) return { formula: "" };

  const formulaFromTree = typeof treeJson?.meta?.pricingFormula === "string"
    ? treeJson.meta.pricingFormula.trim()
    : "";
  const formulaFromProduct = typeof product?.pricingFormula === "string"
    ? product.pricingFormula.trim()
    : "";
  const formulaFromProfile = typeof profile.defaultFormula === "string"
    ? profile.defaultFormula.trim()
    : "";
  const formula = formulaFromTree || formulaFromProduct || formulaFromProfile || "";

  return { formula };
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

function buildTierResolutionSnapshot(
  tierResolution: Pbv2TierResolution | undefined,
  capturedAt: string,
): PBV2TierResolutionSnapshot | undefined {
  if (!tierResolution) return undefined;
  return cloneJsonValue({
    quantity: tierResolution.quantity,
    enabled: tierResolution.tierSystemEnabled,
    source: tierResolution.tierSource,
    matchedTierId: tierResolution.matchedTierId,
    matchedTierLabel: tierResolution.matchedTierLabel,
    originalBaseRate: tierResolution.originalBaseRate,
    tierBaseRate: tierResolution.tierBaseRate,
    effectiveBaseRateBeforeMatrix: tierResolution.effectiveBaseRateBeforeMatrix,
    matrixBasePriceOverride: tierResolution.matrixBasePriceOverride,
    matrixRowId: tierResolution.matrixRowId,
    matrixStaticBaseRate: tierResolution.matrixStaticBaseRate,
    matrixBasePriceRaw: tierResolution.matrixBasePriceRaw,
    matrixBasePriceIgnoredBecauseTierMatched: tierResolution.matrixBasePriceIgnoredBecauseTierMatched,
    matrixStaticBaseRateUsedAsFallback: tierResolution.matrixStaticBaseRateUsedAsFallback,
    productTierFallbackUsed: tierResolution.productTierFallbackUsed,
    tierBasis: tierResolution.tierBasis,
    tierBasisValue: tierResolution.tierBasisValue,
    tierBasisResolvedFrom: tierResolution.tierBasisResolvedFrom,
    lineItemQuantity: tierResolution.lineItemQuantity,
    rawItemQuantity: tierResolution.rawItemQuantity,
    tierSelectionQuantity: tierResolution.tierSelectionQuantity,
    computedSheetUsage: tierResolution.computedSheetUsage,
    computedSheetUsageAvailable: tierResolution.computedSheetUsageAvailable,
    computedSheetUsageMode: tierResolution.computedSheetUsageMode,
    sheetUsageMethod: tierResolution.sheetUsageMethod,
    allowRotation: tierResolution.allowRotation,
    allowRotationSource: tierResolution.allowRotationSource,
    normalPiecesPerSheet: tierResolution.normalPiecesPerSheet,
    rotatedPiecesPerSheet: tierResolution.rotatedPiecesPerSheet,
    mixedPiecesPerSheet: tierResolution.mixedPiecesPerSheet,
    mixedLayoutDescription: tierResolution.mixedLayoutDescription,
    piecesPerSheet: tierResolution.piecesPerSheet,
    orientationUsed: tierResolution.orientationUsed,
    fullSheets: tierResolution.fullSheets,
    partialSheetPieceCount: tierResolution.partialSheetPieceCount,
    partialSheetFinishedSqft: tierResolution.partialSheetFinishedSqft,
    partialSheetBillableSqft: tierResolution.partialSheetBillableSqft,
    partialSheetPolicy: tierResolution.partialSheetPolicy,
    totalSheetCount: tierResolution.totalSheetCount,
    tierSheetWidth: tierResolution.tierSheetWidth,
    tierSheetLength: tierResolution.tierSheetLength,
    tierUsableDropMin: tierResolution.tierUsableDropMin,
    tierBillableLengthIncrement: tierResolution.tierBillableLengthIncrement,
    tierMinimumBillableSqft: tierResolution.tierMinimumBillableSqft,
    tierVariableSources: tierResolution.tierVariableSources,
    computedSheetUsageUnavailableReason: tierResolution.computedSheetUsageUnavailableReason,
    fallbackToLineItemQuantity: tierResolution.fallbackToLineItemQuantity,
    selectedTierMinQty: tierResolution.selectedTierMinQty,
    selectedTierRate: tierResolution.selectedTierRate,
    selectedTierSource: tierResolution.selectedTierSource,
    selectedTierRateAppliedToBasePrice: tierResolution.selectedTierRateAppliedToBasePrice,
    basePriceFinal: tierResolution.basePriceFinal,
    basePriceSource: tierResolution.basePriceSource,
    finalBaseRateUsed: tierResolution.finalBaseRateUsed,
    warnings: tierResolution.warnings,
    capturedAt,
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
  formulaBasePrice?: FormulaAwareBasePriceResult;
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
  const formulaSnapshot = input.formulaBasePrice
    ? {
        formula: input.formulaBasePrice.formulaToUse,
      }
    : resolveSnapshotFormula(input.treeJson, input.product, pricingProfileKey);
  const formulaVariables = resolveSnapshotFormulaVariables(input.treeJson, input.product);
  const tierResolution = input.formulaBasePrice?.tierResolution ?? input.baseDetails?.tierResolution;
  const formulaDebug = input.formulaBasePrice?.formulaDebug ?? buildBaseFormulaDebugContext({
    formulaRaw: formulaSnapshot.formula,
    orderedWidthIn,
    orderedHeightIn,
    trimAllowanceX,
    trimAllowanceY,
    finishedWidthIn,
    finishedHeightIn,
    quantity: input.quantity,
    baseRatePerSqft: input.baseDetails ? input.baseDetails.perSqftCents / 100 : 0,
    originalBaseRate: tierResolution?.originalBaseRate,
    tierBaseRate: tierResolution?.tierBaseRate,
    effectiveBaseRate: tierResolution?.effectiveBaseRateBeforeMatrix,
    sqftPerItem,
    totalSqft,
    linearFeet,
    sheetYieldMetrics: input.baseDetails?.sheetYieldMetrics,
    formulaVariables,
    pricingMatrixVariables: input.pricingMatrixResolution.variables,
  });
  const hasMatrixBasePrice = typeof input.pricingMatrixResolution.variables.base_price === "number";

  return cloneJsonValue({
    pricingSystem: "pbv2",
    formula: formulaSnapshot.formula,
    formulaSourceMode: formulaDebug.formulaSourceMode,
    resolvedFormulaSource: formulaDebug.resolvedFormulaSource,
    resolvedFormulaId: formulaDebug.resolvedFormulaId,
    resolvedFormulaName: formulaDebug.resolvedFormulaName,
    resolvedFormulaExpression: formulaDebug.resolvedFormulaExpression ?? formulaSnapshot.formula,
    manualFormulaPresent: formulaDebug.manualFormulaPresent,
    manualFormulaIgnored: formulaDebug.manualFormulaIgnored,
    formulaVariables: formulaDebug.variables,
    formulaVariableSources: formulaDebug.variableSources,
    rawSelections: toPlainSelectionValues(input.rawSelections),
    effectiveSelections: toPlainSelectionValues(input.effectiveSelections),
    selectedOptionValues: toPlainSelectionValues(input.effectiveSelections),
    ...(input.pricingMatrixResolution.matchedRow?.id
      ? { resolvedMatrixRowId: input.pricingMatrixResolution.matchedRow.id }
      : {}),
    resolvedMatrixVariables: input.pricingMatrixResolution.variables,
    ...(tierResolution
      ? { tierResolution: buildTierResolutionSnapshot(tierResolution, input.capturedAt) }
      : {}),
    basePriceSource: input.baseDetails?.basePriceSource ?? (hasMatrixBasePrice ? "pricing_matrix.base_price" : "pricingV2.base"),
    rateUsedSource: input.baseDetails?.rateUsedSource ?? (hasMatrixBasePrice ? "pricing_matrix.base_price" : "pricingV2.base"),
    minimumApplied: input.formulaBasePrice?.minimumApplied ?? input.baseDetails?.minimumApplied ?? false,
    formulaScopeUsed: formulaDebug.variables,
    formulaEvaluatedTotal: input.formulaBasePrice?.formulaEvaluatedTotalCents == null
      ? null
      : input.formulaBasePrice.formulaEvaluatedTotalCents / 100,
    rawBasePrice: input.formulaBasePrice?.rawBasePrice ?? (input.baseDetails ? input.baseDetails.perSqftCents / 100 : null),
    evaluatedFormulaTotalRaw: input.formulaBasePrice?.formulaEvaluatedTotalRaw ?? null,
    evaluatedFormulaTotalRounded: input.formulaBasePrice?.formulaEvaluatedTotalRounded ?? null,
    roundingAppliedAt: input.formulaBasePrice?.roundingAppliedAt ?? "not_applicable",
    pbv2BaseTotal: input.formulaBasePrice
      ? input.formulaBasePrice.pbv2BaseTotalCents / 100
      : input.baseDetails ? input.baseDetails.totalCents / 100 : undefined,
    finalTotalSource: input.formulaBasePrice?.finalTotalSource ?? "pbv2_base",
    finalTotal: input.formulaBasePrice
      ? input.formulaBasePrice.finalTotalCents / 100
      : input.calculatedPriceCents / 100,
    sheetYield: formulaDebug.sheetYield,
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

function buildFormulaVariableSourceDebug(input: {
  scope: Record<string, number | string | boolean | null>;
  formulaVariables?: Record<string, number>;
  formulaVariableSources?: Record<string, string>;
  pricingMatrixVariables?: Record<string, number>;
  formulaScope: Record<string, number | string | boolean | null>;
}): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const key of Object.keys(input.scope)) {
    sources[key] = "runtime";
  }

  for (const [key, value] of Object.entries(input.formulaVariables ?? {})) {
    if (FORMULA_VARIABLE_PROTECTED_KEYS.has(key)) continue;
    if (!Number.isFinite(Number(value))) continue;
    sources[key] = input.formulaVariableSources?.[key] ?? "formulaVariables";
  }

  for (const [key, value] of Object.entries(input.pricingMatrixVariables ?? {})) {
    if (MATRIX_VARIABLE_PROTECTED_KEYS.has(key)) continue;
    if (!Number.isFinite(Number(value))) continue;
    sources[key] = "pricing_matrix.variables";
  }

  const finalBasePrice = input.formulaScope.base_price;
  if (typeof finalBasePrice === "number") {
    for (const alias of ["p", "basePricePerSqft", "pricePerSqft", "price", "unitPrice"]) {
      sources[alias] = sources.base_price ?? sources[alias] ?? "runtime";
    }
  }

  if (input.formulaVariableSources?.allow_rotation) {
    sources.allow_rotation = input.formulaVariableSources.allow_rotation;
  }

  return sources;
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
  originalBaseRate?: number;
  tierBaseRate?: number | null;
  effectiveBaseRate?: number;
  sqftPerItem: number;
  totalSqft: number;
  linearFeet: number;
  sheetYieldMetrics?: SheetYieldMetrics;
  formulaVariables?: Record<string, number>;
  formulaVariableSources?: Record<string, string>;
  pricingMatrixVariables?: Record<string, number>;
}): {
  resultValue: number;
  formulaResolved?: string;
  appliedAs: 'unitPrice' | 'totalPrice' | 'unknown';
  steps: Array<{ label: string; value: number | string }>;
  preCeilSqftTotal: number | null;
  postCeilSqftTotal: number | null;
  baseRateUsed: number;
  formulaResultType: "final_dollars";
  quantityBasisUsed: string;
  selectedRate: number | null;
  finalFormulaTotal: number | null;
  likelyMisconfiguredFormula: boolean;
  warnings: Array<{ code: string; message: string; detail?: any }>;
} {
  const scope = buildFormulaScope({
    ...input,
    computedSheets: input.sheetYieldMetrics?.computedSheets,
    billedSheets: input.sheetYieldMetrics?.billedSheets,
    sheetCount: input.sheetYieldMetrics?.sheetCount,
    sheetSqft: input.sheetYieldMetrics?.sheetSqft,
    billedSheetSqft: input.sheetYieldMetrics?.billedSheetSqft,
    piecesPerSheet: input.sheetYieldMetrics?.piecesPerSheet,
    fullSheets: input.sheetYieldMetrics?.fullSheets,
    partialSheetPieceCount: input.sheetYieldMetrics?.partialSheetPieceCount,
    partialSheetFinishedSqft: input.sheetYieldMetrics?.partialSheetFinishedSqft,
    partialSheetBillableSqft: input.sheetYieldMetrics?.partialSheetBillableSqft,
    totalSheetCount: input.sheetYieldMetrics?.totalSheetCount,
    allowRotation: input.sheetYieldMetrics?.allowRotation,
  });
  const formulaScope = buildFormulaEvaluationScope({
    scope,
    formulaVariables: input.formulaVariables,
    pricingMatrixVariables: input.pricingMatrixVariables,
  });
  const variableSources = buildFormulaVariableSourceDebug({
    scope,
    formulaVariables: input.formulaVariables,
    formulaVariableSources: input.formulaVariableSources,
    pricingMatrixVariables: input.pricingMatrixVariables,
    formulaScope,
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
      allow_rotation?: unknown,
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
        (allow_rotation ?? formulaScope.allow_rotation) as string | number | boolean | null | undefined,
        input.sheetYieldMetrics?.allowRotationSource ?? variableSources.allow_rotation,
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
  if (input.sheetYieldMetrics?.available) {
    steps.push(
      { label: 'computed_sheets', value: input.sheetYieldMetrics.computedSheets ?? "unavailable" },
      { label: 'allow_rotation', value: input.sheetYieldMetrics.allowRotation == null ? "unavailable" : String(input.sheetYieldMetrics.allowRotation) },
      { label: 'pieces_per_sheet', value: input.sheetYieldMetrics.piecesPerSheet ?? "unavailable" },
      { label: 'total_sheet_count', value: input.sheetYieldMetrics.totalSheetCount ?? input.sheetYieldMetrics.sheetCount ?? "unavailable" },
      { label: 'partial_sheet_policy', value: input.sheetYieldMetrics.partialSheetPolicy ?? "unavailable" },
      { label: 'billed_sheet_sqft', value: input.sheetYieldMetrics.billedSheetSqft ?? "unavailable" },
    );
  }

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
      pricingSystem: "pbv2",
      formulaRaw: input.formula,
      formulaResolved,
      variables: formulaScope,
      variableSources,
      appliedAs,
      steps,
      errors: formulaError.details,
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
      pricingSystem: "pbv2",
      formulaRaw: input.formula,
      formulaResolved,
      variables: formulaScope,
      variableSources,
      appliedAs,
      steps,
      errors: formulaError.details,
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
      formulaResultType: "final_dollars",
      quantityBasisUsed: inferFormulaQuantityBasis(input.formula),
      selectedRate: resolvedBaseRate,
      finalFormulaTotal: value,
      likelyMisconfiguredFormula: isLikelyGeometryOnlyFormula(input.formula),
      warnings: buildFormulaOutputWarnings(input.formula),
    };
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : 'Invalid formula';
    const location = extractMathErrorLocation(message);
    const errorCode = inferFormulaErrorCode(message);
    const missingSymbol = extractUndefinedFormulaSymbol(message);
    const friendlyMessage = missingSymbol
      ? `Pricing formula references missing symbol "${missingSymbol}". Configure that formula variable before using this product in order entry.`
      : message;
    const formulaError = new Error(`Formula error: ${friendlyMessage}`) as PricingPreviewFormulaError;
    formulaError.code = 'PBV2_FORMULA_ERROR';
    formulaError.details = [{
      code: errorCode,
      message: friendlyMessage,
      location,
      path: "pricingFormula",
      missingSymbol,
    }];
    formulaError.debug = {
      pricingSystem: "pbv2",
      formulaRaw: input.formula,
      formulaResolved,
      variables: formulaScope,
      variableSources,
      appliedAs,
      steps,
      errors: [{ code: errorCode, message: friendlyMessage, detail: missingSymbol ? { missingSymbol } : undefined }],
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
  originalBaseRate?: number;
  tierBaseRate?: number | null;
  effectiveBaseRate?: number;
  sqftPerItem: number;
  totalSqft: number;
  linearFeet: number;
  sheetYieldMetrics?: SheetYieldMetrics;
  formulaVariables?: Record<string, number>;
  formulaVariableSources?: Record<string, string>;
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
    originalBaseRate: input.originalBaseRate,
    tierBaseRate: input.tierBaseRate,
    effectiveBaseRate: input.effectiveBaseRate,
    sqftPerItem: input.sqftPerItem,
    totalSqft: input.totalSqft,
    linearFeet: input.linearFeet,
    computedSheets: input.sheetYieldMetrics?.computedSheets,
    billedSheets: input.sheetYieldMetrics?.billedSheets,
    sheetCount: input.sheetYieldMetrics?.sheetCount,
    sheetSqft: input.sheetYieldMetrics?.sheetSqft,
    billedSheetSqft: input.sheetYieldMetrics?.billedSheetSqft,
    piecesPerSheet: input.sheetYieldMetrics?.piecesPerSheet,
    fullSheets: input.sheetYieldMetrics?.fullSheets,
    partialSheetPieceCount: input.sheetYieldMetrics?.partialSheetPieceCount,
    partialSheetFinishedSqft: input.sheetYieldMetrics?.partialSheetFinishedSqft,
    partialSheetBillableSqft: input.sheetYieldMetrics?.partialSheetBillableSqft,
    totalSheetCount: input.sheetYieldMetrics?.totalSheetCount,
    allowRotation: input.sheetYieldMetrics?.allowRotation,
  });
  const variables = buildFormulaEvaluationScope({
    scope,
    formulaVariables: input.formulaVariables,
    pricingMatrixVariables: input.pricingMatrixVariables,
  });
  const variableSources = buildFormulaVariableSourceDebug({
    scope,
    formulaVariables: input.formulaVariables,
    formulaVariableSources: input.formulaVariableSources,
    pricingMatrixVariables: input.pricingMatrixVariables,
    formulaScope: variables,
  });
  // Read the resolved base_price after matrix overrides (may differ from input.baseRatePerSqft).
  const resolvedBaseRate = typeof variables.base_price === 'number' ? variables.base_price : input.baseRatePerSqft;

  return {
    pricingSystem: "pbv2",
    formulaRaw: input.formulaRaw,
    formulaResolved: input.formulaRaw ? resolveFormulaAliases(input.formulaRaw) : undefined,
    variables,
    variableSources,
    appliedAs: input.formulaRaw ? inferFormulaApplication(input.formulaRaw) : 'unknown',
    steps: [
      { label: 'ordered_w*ordered_h', value: input.orderedWidthIn * input.orderedHeightIn },
      { label: 'finished_w*finished_h', value: input.finishedWidthIn * input.finishedHeightIn },
      { label: '(w*h)/144', value: input.sqftPerItem },
      { label: 'sqft*q', value: input.totalSqft },
      { label: 'p(base_rate_per_sqft)', value: resolvedBaseRate },
      ...(input.sheetYieldMetrics?.available ? [
        { label: 'computed_sheets', value: input.sheetYieldMetrics.computedSheets ?? "unavailable" },
        { label: 'allow_rotation', value: input.sheetYieldMetrics.allowRotation == null ? "unavailable" : String(input.sheetYieldMetrics.allowRotation) },
        { label: 'pieces_per_sheet', value: input.sheetYieldMetrics.piecesPerSheet ?? "unavailable" },
        { label: 'total_sheet_count', value: input.sheetYieldMetrics.totalSheetCount ?? input.sheetYieldMetrics.sheetCount ?? "unavailable" },
        { label: 'partial_sheet_policy', value: input.sheetYieldMetrics.partialSheetPolicy ?? "unavailable" },
        { label: 'billed_sheet_sqft', value: input.sheetYieldMetrics.billedSheetSqft ?? "unavailable" },
      ] : []),
    ],
    errors: [],
    likelyMisconfiguredFormula: input.formulaRaw ? isLikelyGeometryOnlyFormula(input.formulaRaw) : false,
    preCeilSqftTotal: null,
    postCeilSqftTotal: null,
    baseRateUsed: resolvedBaseRate,
    formulaResultType: input.formulaRaw ? "final_dollars" : undefined,
    quantityBasisUsed: input.formulaRaw ? inferFormulaQuantityBasis(input.formulaRaw) : undefined,
    selectedRate: resolvedBaseRate,
    finalFormulaTotal: null,
    sheetYield: input.sheetYieldMetrics ? {
      finishedSqft: input.sheetYieldMetrics.finishedSqft,
      totalFinishedSqft: input.sheetYieldMetrics.totalFinishedSqft,
      computedSheets: input.sheetYieldMetrics.computedSheets,
      billedSheets: input.sheetYieldMetrics.billedSheets,
      sheetCount: input.sheetYieldMetrics.sheetCount,
      sheetSqft: input.sheetYieldMetrics.sheetSqft,
      billedSheetSqft: input.sheetYieldMetrics.billedSheetSqft,
      sheetUsageMethod: input.sheetYieldMetrics.sheetUsageMethod,
      allowRotation: input.sheetYieldMetrics.allowRotation,
      allowRotationSource: input.sheetYieldMetrics.allowRotationSource,
      normalPiecesPerSheet: input.sheetYieldMetrics.normalPiecesPerSheet,
      rotatedPiecesPerSheet: input.sheetYieldMetrics.rotatedPiecesPerSheet,
      mixedPiecesPerSheet: input.sheetYieldMetrics.mixedPiecesPerSheet,
      mixedLayoutDescription: input.sheetYieldMetrics.mixedLayoutDescription,
      piecesPerSheet: input.sheetYieldMetrics.piecesPerSheet,
      orientationUsed: input.sheetYieldMetrics.orientationUsed,
      fullSheets: input.sheetYieldMetrics.fullSheets,
      partialSheetPieceCount: input.sheetYieldMetrics.partialSheetPieceCount,
      partialSheetFinishedSqft: input.sheetYieldMetrics.partialSheetFinishedSqft,
      partialSheetBillableSqft: input.sheetYieldMetrics.partialSheetBillableSqft,
      partialSheetPolicy: input.sheetYieldMetrics.partialSheetPolicy,
      totalSheetCount: input.sheetYieldMetrics.totalSheetCount,
      mode: input.sheetYieldMetrics.mode,
      available: input.sheetYieldMetrics.available,
    } : undefined,
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

function inferFormulaQuantityBasis(formula: string): string {
  const normalized = String(formula || "").toLowerCase();
  if (/\bcomputed_sheets\b/.test(normalized)) return "computed_sheets";
  if (/\btotal_sheet_count\b/.test(normalized)) return "total_sheet_count";
  if (/\bsheet_count\b/.test(normalized)) return "sheet_count";
  if (/\bbilled_sheet_sqft\b/.test(normalized)) return "billed_sheet_sqft";
  if (/\bpartial_sheet_billable_sqft\b/.test(normalized)) return "partial_sheet_billable_sqft";
  if (/\bpieces_per_sheet\b/.test(normalized)) return "pieces_per_sheet";
  if (/\bbilled_sheets\b/.test(normalized)) return "billed_sheets";
  if (/\btotal_finished_sqft\b/.test(normalized)) return "total_finished_sqft";
  if (/\bfinished_sqft\b/.test(normalized)) return "finished_sqft";
  if (/\btotal_sqft\b/.test(normalized)) return "total_sqft";
  if (/\bsqft\b/.test(normalized)) return "sqft";
  if (/\bsheet_consumption_sqft\s*\(/.test(normalized)) return "sheet_consumption_sqft";
  return "unknown";
}

function formulaReferencesPricingRate(formula: string): boolean {
  return /\b(?:base_price|p|basepricepersqft|pricepersqft|unitprice|price|sqft_rate|sheet_price|tier_rate|tier_base_price|effective_base_price|original_base_price)\b/i.test(formula);
}

function isLikelyGeometryOnlyFormula(formula: string): boolean {
  const normalized = String(formula || "").toLowerCase();
  if (!normalized.trim()) return false;
  const usesGeometryQuantity =
    /\bsheet_consumption_sqft\s*\(/.test(normalized) ||
    /\b(?:billed_sheet_sqft|computed_sheets|total_sheet_count|sheet_count|billed_sheets|pieces_per_sheet|partial_sheet_billable_sqft|partial_sheet_finished_sqft|total_finished_sqft|finished_sqft|total_sqft|sqft)\b/.test(normalized);
  return usesGeometryQuantity && !formulaReferencesPricingRate(normalized);
}

function buildFormulaOutputWarnings(formula: string): Array<{ code: string; message: string; detail?: any }> {
  if (!isLikelyGeometryOnlyFormula(formula)) return [];
  return [{
    code: "PBV2_FORMULA_GEOMETRY_OUTPUT_ONLY",
    message: "Formula appears to return a geometry quantity without multiplying by a PBV2 price or rate. PBV2 formula output is interpreted as final dollars.",
    detail: {
      expectedFormulaOutput: "final_dollars",
      examples: [
        "total_finished_sqft * base_price",
        "billed_sheet_sqft * base_price",
        "computed_sheets * sheet_price",
      ],
    },
  }];
}

function buildPbv2PricingFormulaError(input: {
  message: string;
  code: string;
  debug: NonNullable<PricingPreviewEvaluationResult["debug"]>;
}): PricingPreviewFormulaError {
  const formulaError = new Error(`Formula error: ${input.message}`) as PricingPreviewFormulaError;
  formulaError.code = "PBV2_FORMULA_ERROR";
  formulaError.details = [{
    code: input.code,
    message: input.message,
  }];
  formulaError.debug = {
    ...input.debug,
    pricingSystem: "pbv2",
    errors: [
      ...(input.debug.errors ?? []),
      { code: input.code, message: input.message },
    ],
  };
  return formulaError;
}

function inferFormulaApplication(formula: string): 'unitPrice' | 'totalPrice' | 'unknown' {
  const normalized = String(formula || '').toLowerCase();
  if (!normalized.trim()) return 'unknown';
  if (/\b(quantity|q|total_sqft|total_finished_sqft|computed_sheets|total_sheet_count|billed_sheets|sheet_count|billed_sheet_sqft|partial_sheet_billable_sqft)\b/.test(normalized) || /\bsheet_consumption_sqft\s*\(/.test(normalized)) {
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

function extractUndefinedFormulaSymbol(message: string): string | null {
  const match = message.match(/undefined\s+(?:symbol|variable)\s+([A-Za-z_][A-Za-z0-9_]*)/i);
  return match?.[1] ?? null;
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
