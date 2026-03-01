/**
 * PricingService - Unified PBV2-only pricing for quotes and orders
 * 
 * This service replaces all legacy pricing logic (profiles, formulas, material pricing)
 * with a single PBV2-based pricing flow.
 */

import { db } from '../../db';
import { products, pbv2TreeVersions } from '../../../shared/schema';
import { eq, and } from 'drizzle-orm';
import { evaluate } from 'mathjs';
import { evaluateOptionTreeV2 } from '../optionTreeV2Evaluator';
import type { 
  OptionTreeV2, 
  LineItemOptionSelectionsV2
} from '../../../shared/optionTreeV2';
import { PBV2_PRICING_VARIABLES, type PricingVariableDefinition } from '../../../shared/pbv2/pricingVariableRegistry';

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
  };
  pricingOverrideApplied?: boolean; // True if overridePriceCents was used
};

export type PBV2PricingSnapshot = {
  treeVersionId: string;
  treeJson: any; // DB stores as jsonb, not strongly typed
  selections: Record<string, any>; // Option selections snapshot
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
  };
};

export type PricingPreviewEvaluationResult = {
  unitPrice: number;
  totalPrice: number;
  formulaUsed?: string;
  breakdown: {
    basePrice: number;
    optionsPrice: number;
    total: number;
  };
  derived: {
    sqft?: number;
    totalSqft?: number;
    linearFeet?: number;
  };
  debug?: {
    inputs: {
      widthIn: number;
      heightIn: number;
      quantity: number;
    };
    derived: {
      sqft: number;
      totalSqft: number;
      linearFeet: number;
    };
    pricing: {
      basePrice: number;
      optionsPrice: number;
      unitPrice: number;
      totalPrice: number;
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
    const selectionsV2: LineItemOptionSelectionsV2 = {
      schemaVersion: 2,
      selected: pbv2ExplicitSelections || {},
    };

    // Build minimal snapshot
    const snapshot: PBV2PricingSnapshot = {
      treeVersionId,
      treeJson: treeVersion.treeJson,
      selections: pbv2ExplicitSelections || {},
      selectedOptions: [],
      visibleNodeIds: [],
      pricedAt: new Date().toISOString(),
      dimensions: {
        widthIn: widthIn ?? undefined,
        heightIn: heightIn ?? undefined,
      },
      quantity,
      pricing: {
        baseCents: 0,
        optionsCents: 0,
        totalCents: overridePriceCents,
      },
    };

    return {
      pbv2TreeVersionId: treeVersionId,
      pbv2SnapshotJson: snapshot,
      lineTotalCents: overridePriceCents,
      breakdown: {
        baseCents: 0,
        optionsCents: 0,
        totalCents: overridePriceCents,
      },
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

  // Step 4: Calculate base price from tree metadata with dimensions/quantity
  const basePriceCents = calculateBasePrice(treeVersion.treeJson, {
    widthIn: widthIn ?? 0,
    heightIn: heightIn ?? 0,
    quantity,
  });

  // Step 5: Map selections to LineItemOptionSelectionsV2 format
  // Frontend sends Record<string, any> as pbv2ExplicitSelections
  // Evaluator expects { schemaVersion: 2, selected: Record<nodeId, { value, note? }> }
  const selectionsV2: LineItemOptionSelectionsV2 = {
    schemaVersion: 2,
    selected: pbv2ExplicitSelections || {},
  };

  // DEV: Build identifier and calculation path logging
  if (process.env.NODE_ENV === "development") {
    const PBV2_BUILD_ID = "PBV2_DEBUG_V2_INPUT_FIX";
    console.log(`[PBV2_CALC_PATH] Build: ${PBV2_BUILD_ID}`);
    console.log(`[PBV2_CALC_PATH] Evaluator: evaluateOptionTreeV2`);
    console.log(`[PBV2_CALC_PATH] TreeVersionId: ${treeVersionId}`);
    console.log(`[PBV2_CALC_PATH] Selection keys:`, Object.keys(pbv2ExplicitSelections || {}));
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
  const snapshot: PBV2PricingSnapshot = {
    treeVersionId,
    treeJson: treeVersion.treeJson,
    selections: pbv2ExplicitSelections,
    selectedOptions: evalResult.selectedOptions,
    visibleNodeIds: evalResult.visibleNodeIds,
    pricedAt: new Date().toISOString(),
    dimensions: widthIn || heightIn ? { widthIn, heightIn } : undefined,
    quantity,
    pricing: {
      baseCents: basePriceCents,
      optionsCents,
      totalCents: lineTotalCents, // Changed from totalCents to lineTotalCents for clarity
    },
  };

  return {
    pbv2TreeVersionId: treeVersionId,
    pbv2SnapshotJson: snapshot,
    lineTotalCents,
    breakdown: {
      baseCents: basePriceCents,
      optionsCents,
      totalCents: lineTotalCents, // Changed from totalCents to lineTotalCents for clarity
    },
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

  const baseDetails = calculateBasePriceDetails(input.treeJson, {
    widthIn,
    heightIn,
    quantity,
  });
  let basePriceCents = baseDetails.totalCents;

  const formulaFromTree = typeof input?.treeJson?.meta?.pricingFormula === 'string'
    ? input.treeJson.meta.pricingFormula.trim()
    : '';
  const formulaToUse = typeof input.pricingFormulaOverride === 'string'
    ? input.pricingFormulaOverride.trim()
    : formulaFromTree;

  if (formulaToUse) {
    basePriceCents = evaluatePreviewFormulaToCents({
      formula: formulaToUse,
      widthIn,
      heightIn,
      quantity,
      baseRatePerSqft: baseDetails.perSqftCents / 100,
      sqftPerItem: baseDetails.sqftPerItem,
      totalSqft: baseDetails.totalSqft,
      linearFeet: baseDetails.linearFeet,
    });
  }

  const selectionsV2: LineItemOptionSelectionsV2 = {
    schemaVersion: 2,
    selected: pbv2ExplicitSelections,
  };

  const evalResult = evaluateOptionTreeV2({
    tree: input.treeJson,
    selections: selectionsV2,
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
    },
    derived: {
      sqft: Number.isFinite(sqft) ? sqft : undefined,
      totalSqft: Number.isFinite(totalSqft) ? totalSqft : undefined,
      linearFeet: Number.isFinite(linearFeet) ? linearFeet : undefined,
    },
    debug: input.debug ? {
      inputs: { widthIn, heightIn, quantity },
      derived: {
        sqft,
        totalSqft,
        linearFeet,
      },
      pricing: {
        basePrice: basePriceCents / 100,
        optionsPrice: optionsCents / 100,
        unitPrice: quantity > 0 ? totalCents / 100 / quantity : 0,
        totalPrice: totalCents / 100,
      },
    } : undefined,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

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
  context: { widthIn: number; heightIn: number; quantity: number }
): number {
  return calculateBasePriceDetails(tree, context).totalCents;
}

function calculateBasePriceDetails(
  tree: any,
  context: { widthIn: number; heightIn: number; quantity: number }
): {
  totalCents: number;
  perSqftCents: number;
  perPieceCents: number;
  minimumChargeCents: number;
  sqftPerItem: number;
  totalSqft: number;
  linearFeet: number;
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

  const qtyTiers = Array.isArray(pricingV2.qtyTiers) ? pricingV2.qtyTiers : [];
  const sqftTiers = Array.isArray(pricingV2.sqftTiers) ? pricingV2.sqftTiers : [];

  // Start with base rates
  let perSqftCents = typeof base.perSqftCents === 'number' ? base.perSqftCents : 0;
  let perPieceCents = typeof base.perPieceCents === 'number' ? base.perPieceCents : 0;
  let minimumChargeCents = typeof base.minimumChargeCents === 'number' ? base.minimumChargeCents : 0;

  // Validate at least one pricing field is non-zero
  if (perSqftCents === 0 && perPieceCents === 0 && minimumChargeCents === 0) {
    throw new Error(
      'This product needs base pricing configured before it can be quoted. Please edit the product and set at least one base price ($/sqft, $/piece, or minimum charge) in the Base Pricing section.'
    );
  }

  const { widthIn, heightIn, quantity } = context;
  const sqftPerItem = widthIn > 0 && heightIn > 0 ? (widthIn * heightIn) / 144 : 0;

  // Apply best-match qtyTier (highest minQty <= quantity)
  let bestQtyTier: any = null;
  for (const tier of qtyTiers) {
    if (!tier || typeof tier !== 'object') continue;
    const minQty = typeof tier.minQty === 'number' ? tier.minQty : 0;
    if (minQty <= quantity) {
      if (!bestQtyTier || minQty > (bestQtyTier.minQty || 0)) {
        bestQtyTier = tier;
      }
    }
  }

  if (bestQtyTier) {
    if (typeof bestQtyTier.perSqftCents === 'number') perSqftCents = bestQtyTier.perSqftCents;
    if (typeof bestQtyTier.perPieceCents === 'number') perPieceCents = bestQtyTier.perPieceCents;
    if (typeof bestQtyTier.minimumChargeCents === 'number') minimumChargeCents = bestQtyTier.minimumChargeCents;
  }

  // Apply best-match sqftTier (highest minSqft <= sqftPerItem)
  let bestSqftTier: any = null;
  for (const tier of sqftTiers) {
    if (!tier || typeof tier !== 'object') continue;
    const minSqft = typeof tier.minSqft === 'number' ? tier.minSqft : 0;
    if (minSqft <= sqftPerItem) {
      if (!bestSqftTier || minSqft > (bestSqftTier.minSqft || 0)) {
        bestSqftTier = tier;
      }
    }
  }

  if (bestSqftTier) {
    if (typeof bestSqftTier.perSqftCents === 'number') perSqftCents = bestSqftTier.perSqftCents;
    if (typeof bestSqftTier.perPieceCents === 'number') perPieceCents = bestSqftTier.perPieceCents;
    if (typeof bestSqftTier.minimumChargeCents === 'number') minimumChargeCents = bestSqftTier.minimumChargeCents;
  }

  // Compute line base total: perSqft applies to total sqft across all items
  const totalSqft = sqftPerItem * quantity;
  const sqftComponent = perSqftCents * totalSqft;
  const pieceComponent = perPieceCents * quantity;
  const lineBaseCents = sqftComponent + pieceComponent;
  const linearFeet = widthIn > 0 ? widthIn / 12 : 0;

  // Apply minimum charge once per line item (not per unit)
  const total = minimumChargeCents > 0 ? Math.max(lineBaseCents, minimumChargeCents) : lineBaseCents;

  return {
    totalCents: Math.round(total),
    perSqftCents,
    perPieceCents,
    minimumChargeCents,
    sqftPerItem,
    totalSqft,
    linearFeet,
  };
}

function evaluatePreviewFormulaToCents(input: {
  formula: string;
  widthIn: number;
  heightIn: number;
  quantity: number;
  baseRatePerSqft: number;
  sqftPerItem: number;
  totalSqft: number;
  linearFeet: number;
}): number {
  const scope = {
    width: input.widthIn,
    w: input.widthIn,
    height: input.heightIn,
    h: input.heightIn,
    quantity: input.quantity,
    q: input.quantity,
    base_price: input.baseRatePerSqft,
    basePricePerSqft: input.baseRatePerSqft,
    pricePerSqft: input.baseRatePerSqft,
    unitPrice: input.baseRatePerSqft,
    price: input.baseRatePerSqft,
    p: input.baseRatePerSqft,
    sqft: input.sqftPerItem,
    total_sqft: input.totalSqft,
    linear_feet: input.linearFeet,
  };

  try {
    const evaluated = evaluate(input.formula, scope);
    const value = Number(evaluated);
    if (!Number.isFinite(value)) {
      throw new Error('Formula returned a non-numeric result');
    }
    return Math.round(value * 100);
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : 'Invalid formula';
    const location = extractMathErrorLocation(message);
    const formulaError = new Error(`Formula error: ${message}`) as PricingPreviewFormulaError;
    formulaError.code = 'PBV2_FORMULA_ERROR';
    formulaError.details = [{
      code: 'PBV2_FORMULA_ERROR',
      message,
      location,
    }];
    throw formulaError;
  }
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
