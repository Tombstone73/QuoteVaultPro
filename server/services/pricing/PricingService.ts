/**
 * PricingService - Unified PBV2-only pricing for quotes and orders
 * 
 * This service replaces all legacy pricing logic (profiles, formulas, material pricing)
 * with a single PBV2-based pricing flow.
 */

import { db } from '../../db';
import { products, pbv2TreeVersions } from '../../../shared/schema';
import { eq, and } from 'drizzle-orm';
import { evaluateOptionTreeV2 } from '../optionTreeV2Evaluator';
import type { 
  OptionTreeV2, 
  LineItemOptionSelectionsV2
} from '../../../shared/optionTreeV2';

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
  } = input;

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

  // Step 5: Evaluate PBV2 options
  const evalResult = await evaluateOptionTreeV2({
    tree: treeVersion.treeJson,
    selections: pbv2ExplicitSelections,
    width: widthIn ?? 0,
    height: heightIn ?? 0,
    quantity,
    basePrice: basePriceCents / 100, // Convert cents to dollars for evaluator
  });

  // Step 6: Build pricing breakdown
  const optionsCents = Math.round(evalResult.optionsPrice * 100);
  const totalCents = basePriceCents + optionsCents;
  const lineTotalCents = totalCents * quantity;

  // Step 7: Build snapshot
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
      totalCents,
    },
  };

  return {
    pbv2TreeVersionId: treeVersionId,
    pbv2SnapshotJson: snapshot,
    lineTotalCents,
    breakdown: {
      baseCents: basePriceCents,
      optionsCents,
      totalCents,
    },
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
  const sqft = widthIn > 0 && heightIn > 0 ? (widthIn * heightIn) / 144 : 0;

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

  // Apply best-match sqftTier (highest minSqft <= sqft)
  let bestSqftTier: any = null;
  for (const tier of sqftTiers) {
    if (!tier || typeof tier !== 'object') continue;
    const minSqft = typeof tier.minSqft === 'number' ? tier.minSqft : 0;
    if (minSqft <= sqft) {
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

  // Compute total
  const sqftComponent = perSqftCents * sqft;
  const pieceComponent = perPieceCents * quantity;
  let total = sqftComponent + pieceComponent;

  // Apply minimum charge
  if (minimumChargeCents > 0 && total < minimumChargeCents) {
    total = minimumChargeCents;
  }

  return Math.round(total);
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
