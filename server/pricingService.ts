/**
 * Pricing Service - Wholesale/Retail Tiered Pricing Support + Sales Tax
 * 
 * This module provides helpers for selecting the correct pricing rates
 * based on customer pricing tiers (wholesale, retail, default) and applying
 * per-customer pricing modifiers (discount, markup, margin) and sales tax.
 */

import type { Customer } from "@shared/schema";

/**
 * Pricing tier types
 */
export type PricingTier = "default" | "wholesale" | "retail";

/**
 * Customer pricing modifiers
 */
export interface CustomerPricingModifiers {
  defaultDiscountPercent?: number | null;
  defaultMarkupPercent?: number | null;
  defaultMarginPercent?: number | null;
}

/**
 * Tax context for resolving applicable tax rate
 */
export interface TaxContext {
  companyDefaultTaxRate: number; // e.g., 0.07 for 7%
  taxEnabled: boolean;
  customer?: {
    isTaxExempt?: boolean;
    taxRateOverride?: number | null;
    pricingTier?: 'default' | 'wholesale' | 'retail';
  } | null;
}

/**
 * Entity with tiered pricing fields (Material or ProductVariant)
 */
export interface TieredPricingEntity {
  // Base/fallback pricing (always present)
  costPerUnit?: string | null;
  basePricePerSqft?: string | null;
  minPricePerItem?: string | null;
  
  // Wholesale pricing (optional)
  wholesaleBaseRate?: string | null;
  wholesaleMinCharge?: string | null;
  
  // Retail pricing (optional)
  retailBaseRate?: string | null;
  retailMinCharge?: string | null;
  
  // Vendor cost (for margin calculations)
  vendorCostPerUnit?: string | null;
  costPerRoll?: string | null;
}

/**
 * Result of effective pricing calculation
 */
export interface EffectivePricingRates {
  baseRate: number;
  minCharge: number | null;
  tier: PricingTier;
}

/**
 * Get the effective pricing rates for a product/material based on customer tier.
 * 
 * Logic:
 * - If customer tier is "wholesale" and wholesaleBaseRate is set, use wholesale pricing
 * - If customer tier is "retail" and retailBaseRate is set, use retail pricing
 * - Otherwise, fall back to base pricing (costPerUnit or basePricePerSqft)
 * 
 * @param options.entity - Material or ProductVariant with tiered pricing fields
 * @param options.customer - Customer object (or null for default pricing)
 * @returns Effective base rate, min charge, and tier used
 */
export function getEffectiveRatesForProduct(options: {
  entity: TieredPricingEntity;
  customer?: Customer | null;
}): EffectivePricingRates {
  const { entity, customer } = options;
  
  // Determine customer's pricing tier (default to "default")
  const customerTier = (customer?.pricingTier as PricingTier) ?? "default";
  
  // Parse base/fallback values
  const baseRate = parseFloat(
    entity.costPerUnit || entity.basePricePerSqft || "0"
  );
  const baseMinCharge = entity.minPricePerItem 
    ? parseFloat(entity.minPricePerItem) 
    : null;
  
  // WHOLESALE TIER
  if (customerTier === "wholesale") {
    const wholesaleRate = entity.wholesaleBaseRate 
      ? parseFloat(entity.wholesaleBaseRate) 
      : null;
    
    if (wholesaleRate !== null && !isNaN(wholesaleRate)) {
      const wholesaleMin = entity.wholesaleMinCharge 
        ? parseFloat(entity.wholesaleMinCharge) 
        : null;
      
      return {
        baseRate: wholesaleRate,
        minCharge: wholesaleMin !== null && !isNaN(wholesaleMin) 
          ? wholesaleMin 
          : baseMinCharge,
        tier: "wholesale",
      };
    }
    
    // Fall back to base pricing if wholesale not set
    return {
      baseRate,
      minCharge: baseMinCharge,
      tier: "default", // Indicate fallback
    };
  }
  
  // RETAIL TIER
  if (customerTier === "retail") {
    const retailRate = entity.retailBaseRate 
      ? parseFloat(entity.retailBaseRate) 
      : null;
    
    if (retailRate !== null && !isNaN(retailRate)) {
      const retailMin = entity.retailMinCharge 
        ? parseFloat(entity.retailMinCharge) 
        : null;
      
      return {
        baseRate: retailRate,
        minCharge: retailMin !== null && !isNaN(retailMin) 
          ? retailMin 
          : baseMinCharge,
        tier: "retail",
      };
    }
    
    // Fall back to base pricing if retail not set
    return {
      baseRate,
      minCharge: baseMinCharge,
      tier: "default", // Indicate fallback
    };
  }
  
  // DEFAULT TIER (or unknown)
  return {
    baseRate,
    minCharge: baseMinCharge,
    tier: "default",
  };
}

/**
 * Get a human-readable description of the pricing tier used
 */
export function getPricingTierLabel(tier: PricingTier): string {
  switch (tier) {
    case "wholesale":
      return "Wholesale (Trade)";
    case "retail":
      return "Retail (Consumer)";
    case "default":
      return "Default (Base)";
    default:
      return "Default";
  }
}

/**
 * Validate that a pricing tier value is valid
 */
export function isValidPricingTier(tier: string): tier is PricingTier {
  return tier === "default" || tier === "wholesale" || tier === "retail";
}

/**
 * Apply per-customer pricing modifiers after tier-based pricing.
 * 
 * Precedence order (only one applies):
 * 1. Margin (requires cost, overrides markup and discount)
 * 2. Markup (overrides discount)
 * 3. Discount
 * 
 * Min charge is enforced after all modifiers are applied.
 * 
 * @param options.basePrice - Price after tier selection (wholesale/retail/default)
 * @param options.minCharge - Minimum charge from tier selection (nullable)
 * @param options.costPerUnit - Unit cost for margin calculation (nullable)
 * @param options.customer - Customer object with pricing modifiers
 * @returns Final price and which modifier was applied
 */
export function applyCustomerModifiers(options: {
  basePrice: number;
  minCharge: number | null;
  costPerUnit?: number | null;
  customer?: {
    pricingTier?: PricingTier | string | null;
    defaultDiscountPercent?: string | number | null;
    defaultMarkupPercent?: string | number | null;
    defaultMarginPercent?: string | number | null;
  } | null;
}): { 
  finalPrice: number; 
  effectiveRule: 'discount' | 'markup' | 'margin' | 'none';
  appliedValue?: number; // The percentage/multiplier that was applied
} {
  // 1. Start with base price
  let price = options.basePrice;
  let applied: 'discount' | 'markup' | 'margin' | 'none' = 'none';
  let appliedValue: number | undefined;

  // Parse customer modifiers
  const discount = options.customer?.defaultDiscountPercent 
    ? parseFloat(options.customer.defaultDiscountPercent.toString())
    : null;
  const markup = options.customer?.defaultMarkupPercent 
    ? parseFloat(options.customer.defaultMarkupPercent.toString())
    : null;
  const margin = options.customer?.defaultMarginPercent 
    ? parseFloat(options.customer.defaultMarginPercent.toString())
    : null;
  const costPerUnit = options.costPerUnit ?? null;

  // 2. Apply precedence: margin > markup > discount
  // Only one type of modifier applies at a time
  
  // MARGIN (highest priority, requires cost)
  if (margin != null && !isNaN(margin) && margin > 0 && margin < 95 && 
      costPerUnit != null && costPerUnit > 0) {
    const targetMargin = margin / 100;
    // Formula: price = cost / (1 - margin)
    // Example: cost=$2, margin=50% → price = 2/(1-0.5) = $4
    price = costPerUnit / (1 - targetMargin);
    applied = 'margin';
    appliedValue = margin;
  } 
  // MARKUP (second priority)
  else if (markup != null && !isNaN(markup) && markup > 0) {
    const factor = 1 + markup / 100;
    price = price * factor;
    applied = 'markup';
    appliedValue = markup;
  } 
  // DISCOUNT (lowest priority)
  else if (discount != null && !isNaN(discount) && discount > 0 && discount < 100) {
    const factor = 1 - discount / 100;
    price = price * factor;
    applied = 'discount';
    appliedValue = discount;
  }

  // 3. Enforce minimum charge if present
  if (options.minCharge != null && options.minCharge > 0 && price < options.minCharge) {
    price = options.minCharge;
  }

  return { 
    finalPrice: price, 
    effectiveRule: applied,
    appliedValue 
  };
}

/**
 * Complete pricing pipeline: tier selection + customer modifiers.
 * 
 * This is a convenience function that combines getEffectiveRatesForProduct
 * and applyCustomerModifiers into a single call.
 * 
 * @param options.entity - Material or ProductVariant
 * @param options.customer - Customer (with tier and modifiers)
 * @param options.quantity - Quantity for calculation (default 1)
 * @param options.area - Area in sqft for area-based pricing (optional)
 * @returns Complete pricing breakdown
 */
export function calculateFinalPrice(options: {
  entity: TieredPricingEntity;
  customer?: Customer | null;
  quantity?: number;
  area?: number;
}): {
  baseRate: number;
  tierUsed: PricingTier;
  minCharge: number | null;
  basePrice: number;
  finalPrice: number;
  modifierApplied: 'discount' | 'markup' | 'margin' | 'none';
  modifierValue?: number;
} {
  const quantity = options.quantity ?? 1;
  const area = options.area ?? 0;
  
  // Step 1: Get tier-based rates
  const { baseRate, minCharge, tier } = getEffectiveRatesForProduct({
    entity: options.entity,
    customer: options.customer,
  });
  
  // Step 2: Calculate base price (before modifiers)
  const basePrice = area > 0 ? baseRate * area : baseRate * quantity;
  
  // Step 3: Get cost for margin calculation
  const costPerUnit = options.entity.vendorCostPerUnit 
    ? parseFloat(options.entity.vendorCostPerUnit)
    : null;
  
  // Step 4: Apply customer modifiers
  const { finalPrice, effectiveRule, appliedValue } = applyCustomerModifiers({
    basePrice,
    minCharge,
    costPerUnit,
    customer: options.customer,
  });
  
  return {
    baseRate,
    tierUsed: tier,
    minCharge,
    basePrice,
    finalPrice,
    modifierApplied: effectiveRule,
    modifierValue: appliedValue,
  };
}

// ========================================================================
// TAX RESOLUTION AND APPLICATION - SaaS Multi-State Support
// ========================================================================

/**
 * Address information for tax resolution
 */
export interface TaxAddress {
  country?: string;
  state?: string;
  county?: string;
  city?: string;
  postalCode?: string;
}

/**
 * Tax Resolution Context - SaaS-ready with zone/nexus support
 * 
 * Backward compatible: still works with simple single-org setup.
 */
export interface TaxResolutionContext {
  organizationId: string;
  taxEnabled: boolean;
  companyDefaultTaxRate: number;
  customer?: {
    isTaxExempt?: boolean;
    taxRateOverride?: number | null;
  } | null;
  product?: {
    taxCategoryId?: string | null;
    isTaxable?: boolean | null;
  } | null;
  shipFrom?: TaxAddress | null;
  shipTo?: TaxAddress | null;
}

/**
 * Resolve the effective tax rate for a transaction.
 * 
 * SaaS Tax Precedence:
 * 1. If tax is disabled globally → 0%
 * 2. If customer is tax exempt → 0%
 * 3. If customer has a tax rate override → use override (ignores zones)
 * 4. If no shipTo address or organizationId → fallback to companyDefaultTaxRate
 * 5. Check organization nexus in shipTo state → if no nexus, 0%
 * 6. Find applicable tax zone for shipTo address
 * 7. If product has tax category, check for zone+category rule override
 * 8. Otherwise → use zone.combinedRate or fallback to companyDefaultTaxRate
 * 
 * @param ctx - Tax resolution context
 * @returns Effective tax rate as decimal (0.07 for 7%)
 */
export async function resolveTaxRate(ctx: TaxResolutionContext): Promise<number> {
  const {
    organizationId,
    taxEnabled,
    companyDefaultTaxRate,
    customer,
    product,
    shipFrom,
    shipTo,
  } = ctx;

  // 1) Global tax switch
  if (!taxEnabled) return 0;

  // 2) Customer exemptions
  if (customer?.isTaxExempt) return 0;

  // 3) Customer-specific override (takes precedence over all zone logic)
  if (customer?.taxRateOverride != null && customer.taxRateOverride >= 0) {
    const override = typeof customer.taxRateOverride === 'number' 
      ? customer.taxRateOverride 
      : parseFloat(String(customer.taxRateOverride));
    
    return !isNaN(override) && override >= 0 ? override : 0;
  }

  // 4) Fallback if no advanced tax data available
  if (!organizationId || !shipTo?.state) {
    return companyDefaultTaxRate ?? 0;
  }

  // Lazy-load taxRepo to avoid circular dependencies
  const taxRepo = await import("./taxRepo");

  // 5) Check organization nexus – if org has no nexus in shipTo state, no tax
  const hasNexus = await taxRepo.orgHasNexusIn({
    organizationId,
    country: shipTo.country ?? "US",
    state: shipTo.state,
  });

  if (!hasNexus) {
    return 0;
  }

  // 6) Find applicable tax zone for shipTo address
  const zone = await taxRepo.findApplicableTaxZone({
    organizationId,
    country: shipTo.country ?? "US",
    state: shipTo.state,
    county: shipTo.county,
    city: shipTo.city,
    postalCode: shipTo.postalCode,
  });

  // If no zone found, fall back to org default
  if (!zone) {
    return companyDefaultTaxRate ?? 0;
  }

  let rate = parseFloat(zone.combinedRate || "0");

  // 7) Apply product-category-specific rule if available
  if (product?.taxCategoryId) {
    const rule = await taxRepo.getTaxRuleForZoneAndCategory({
      organizationId,
      taxZoneId: zone.id,
      taxCategoryId: product.taxCategoryId,
    });

    if (rule) {
      // If rule says non-taxable, return 0
      if (!rule.taxable) {
        return 0;
      }
      // If rule has rate override, use it
      if (rule.rateOverride != null) {
        rate = parseFloat(rule.rateOverride.toString());
      }
    }
  }

  // 8) Final rate validation
  if (rate < 0) rate = 0;

  return rate;
}

/**
 * Legacy synchronous tax context (for backward compatibility)
 * 
 * @deprecated Use TaxResolutionContext with resolveTaxRate (async) instead
 */
export interface TaxContext {
  companyDefaultTaxRate: number;
  taxEnabled: boolean;
  customer?: {
    isTaxExempt?: boolean;
    taxRateOverride?: number | null;
    pricingTier?: 'default' | 'wholesale' | 'retail';
  } | null;
}

/**
 * Calculate tax amount for a line item.
 * 
 * Tax is only applied if:
 * - The product is taxable (isTaxable = true)
 * - The resolved tax rate is greater than 0
 * 
 * @param options.lineTotal - Total price for the line item (after tier + modifiers)
 * @param options.isTaxable - Whether the product/variant is taxable
 * @param options.taxRate - Resolved tax rate (from resolveTaxRate)
 * @returns Tax amount for this line item
 */
export function calculateLineTax(options: {
  lineTotal: number;
  isTaxable: boolean;
  taxRate: number;
}): number {
  if (!options.isTaxable) return 0;
  if (options.taxRate <= 0) return 0;
  
  return options.lineTotal * options.taxRate;
}

/**
 * Calculate aggregate tax totals for a quote or order.
 * 
 * @param lineItems - Array of line items with prices and tax flags
 * @param taxRate - Resolved tax rate for the transaction
 * @returns Tax summary with taxable subtotal and total tax amount
 */
export function calculateAggregateTax(
  lineItems: Array<{
    lineTotal: number;
    isTaxable: boolean;
  }>,
  taxRate: number
): {
  taxableSubtotal: number;
  taxAmount: number;
} {
  let taxableSubtotal = 0;
  let taxAmount = 0;

  for (const item of lineItems) {
    if (item.isTaxable) {
      taxableSubtotal += item.lineTotal;
      taxAmount += calculateLineTax({
        lineTotal: item.lineTotal,
        isTaxable: item.isTaxable,
        taxRate,
      });
    }
  }

  return { taxableSubtotal, taxAmount };
}

/**
 * Complete pricing + tax pipeline for a single line item.
 * 
 * This combines:
 * 1. Tier selection (wholesale/retail/default)
 * 2. Customer pricing modifiers (discount/markup/margin)
 * 3. Tax calculation (if product is taxable)
 * 
 * @param options Configuration object
 * @returns Complete pricing breakdown with tax
 */
/**
 * Calculate line item pricing with tax - LEGACY synchronous version
 * 
 * @deprecated Use async resolveTaxRate with TaxResolutionContext for SaaS tax zones.
 * This function remains for backward compatibility with simple tax scenarios.
 */
export function calculateLineItemWithTax(options: {
  entity: TieredPricingEntity & { isTaxable?: boolean };
  customer?: Customer | null;
  quantity?: number;
  area?: number;
  taxContext: TaxContext;
}): {
  baseRate: number;
  tierUsed: PricingTier;
  minCharge: number | null;
  basePrice: number;
  finalPrice: number;
  modifierApplied: 'discount' | 'markup' | 'margin' | 'none';
  modifierValue?: number;
  taxRate: number;
  isTaxable: boolean;
  taxAmount: number;
  totalWithTax: number;
} {
  // Step 1: Calculate final price (tier + modifiers)
  const pricing = calculateFinalPrice({
    entity: options.entity,
    customer: options.customer,
    quantity: options.quantity,
    area: options.area,
  });

  // Step 2: Resolve tax rate (synchronous fallback - uses simple tax logic only)
  // For SaaS tax zones, use async resolveTaxRate with TaxResolutionContext instead
  let taxRate = 0;
  if (!options.taxContext.taxEnabled) {
    taxRate = 0;
  } else if (options.taxContext.customer?.isTaxExempt) {
    taxRate = 0;
  } else if (options.taxContext.customer?.taxRateOverride != null && options.taxContext.customer.taxRateOverride >= 0) {
    const override = typeof options.taxContext.customer.taxRateOverride === 'number' 
      ? options.taxContext.customer.taxRateOverride 
      : parseFloat(String(options.taxContext.customer.taxRateOverride));
    taxRate = !isNaN(override) && override >= 0 ? override : 0;
  } else {
    taxRate = options.taxContext.companyDefaultTaxRate ?? 0;
    if (taxRate < 0) taxRate = 0;
  }

  // Step 3: Determine if product is taxable
  const isTaxable = options.entity.isTaxable ?? true;

  // Step 4: Calculate tax amount
  const taxAmount = calculateLineTax({
    lineTotal: pricing.finalPrice,
    isTaxable,
    taxRate,
  });

  // Step 5: Calculate total with tax
  const totalWithTax = pricing.finalPrice + taxAmount;

  return {
    ...pricing,
    taxRate,
    isTaxable,
    taxAmount,
    totalWithTax,
  };
}
