/**
 * Utility functions for detecting and working with PBV2 (Product Builder V2) products
 */

import type { Product } from "@shared/schema";
import type { OptionTreeV2 } from "@shared/optionTreeV2";

/**
 * Determine if a product uses PBV2 (optionTreeJson with schemaVersion 2)
 */
export function isPbv2Product(product: Product | null | undefined): boolean {
  if (!product) return false;
  
  const optionTreeJson = (product as any)?.optionTreeJson;
  if (!optionTreeJson || typeof optionTreeJson !== "object") return false;
  
  return (optionTreeJson as any)?.schemaVersion === 2;
}

/**
 * Extract PBV2 option tree from product
 */
export function getPbv2Tree(product: Product | null | undefined): OptionTreeV2 | null {
  if (!isPbv2Product(product)) return null;
  
  return ((product as any)?.optionTreeJson ?? null) as OptionTreeV2 | null;
}
