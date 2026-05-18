/**
 * Utility functions for detecting and working with PBV2 (Product Builder V2) products
 */

import type { Product } from "@shared/schema";
import type { OptionTreeV2 } from "@shared/optionTreeV2";

/**
 * Determine if a product uses PBV2 (optionTreeJson with schemaVersion 2,
 * OR pbv2ActiveTreeVersionId is set which means it was published via the PBV2 editor).
 */
export function isPbv2Product(product: Product | null | undefined): boolean {
  if (!product) return false;
  
  // Check direct optionTreeJson field
  const optionTreeJson = (product as any)?.optionTreeJson;
  if (optionTreeJson && typeof optionTreeJson === "object" && (optionTreeJson as any)?.schemaVersion === 2) {
    return true;
  }

  // Fallback: pbv2ActiveTreeVersionId means the product was published via PBV2 editor
  return !!(product as any)?.pbv2ActiveTreeVersionId;
}

/**
 * Extract PBV2 option tree from product
 */
export function getPbv2Tree(product: Product | null | undefined): OptionTreeV2 | null {
  if (!isPbv2Product(product)) return null;
  
  return ((product as any)?.optionTreeJson ?? null) as OptionTreeV2 | null;
}
