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
  LineItemOptionSelectionsV2,
  SelectedOptionsSnapshotEntry 
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
  pbv2ExplicitSelections: LineItemOptionSelectionsV2;
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
  treeJson: OptionTreeV2;
  selections: LineItemOptionSelectionsV2;
  selectedOptions: SelectedOptionsSnapshotEntry[];
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

  // Step 4: Extract base price from tree
  const basePriceCents = extractBasePrice(treeVersion.treeJson);

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
      baseCents,
      optionsCents,
      totalCents,
    },
  };

  return {
    pbv2TreeVersionId: treeVersionId,
    pbv2SnapshotJson: snapshot,
    lineTotalCents,
    breakdown: {
      baseCents,
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

  return treeVersion;
}

/**
 * Extract base price from PBV2 tree root node
 * 
 * PBV2 trees store base price in root node's priceConfig:
 * { nodes: { root: { priceConfig: { basePrice: 100 } } } }
 */
function extractBasePrice(tree: OptionTreeV2): number {
  // Find root node (node with no parent or id === 'root')
  const rootNode = tree.nodes['root'] 
    || Object.values(tree.nodes).find(node => !node.parentId);

  if (!rootNode) {
    throw new Error('PBV2 tree has no root node');
  }

  const priceConfig = (rootNode as any).priceConfig;
  if (!priceConfig || typeof priceConfig.basePrice !== 'number') {
    throw new Error(
      'PBV2 tree root node must have priceConfig.basePrice defined'
    );
  }

  // basePrice in tree is in dollars, convert to cents
  return Math.round(priceConfig.basePrice * 100);
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
