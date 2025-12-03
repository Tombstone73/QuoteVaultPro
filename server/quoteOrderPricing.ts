/**
 * Quote and Order Pricing with Tax Integration - SaaS Multi-State Support
 * 
 * This module provides centralized pricing and tax calculation for quotes and orders.
 * It orchestrates calls to pricingService.ts and ensures consistent tax application.
 */

import type { Customer, Product, ProductVariant } from "@shared/schema";
import {
  resolveTaxRate,
  calculateLineTax,
  type TaxResolutionContext,
  type TaxAddress,
} from "./pricingService";

/**
 * Organization tax settings
 */
export interface OrganizationTaxSettings {
  id: string; // Organization ID for SaaS tax lookup
  defaultTaxRate: number;
  taxEnabled: boolean;
}

/**
 * Line item for pricing calculation (input) - now with tax category support
 */
export interface LineItemInput {
  productId: string;
  variantId?: string | null;
  linePrice: number; // Already calculated price from frontend
  isTaxable: boolean; // From product/variant
  taxCategoryId?: string | null; // For SaaS tax rules
}

/**
 * Line item with tax calculated (output)
 */
export interface LineItemWithTax {
  lineTotal: number;
  taxAmount: number;
  isTaxableSnapshot: boolean;
}

/**
 * Quote/Order totals with tax
 */
export interface QuoteOrderTotals {
  subtotal: number;
  taxableSubtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

/**
 * Calculate tax for a single line item (synchronous helper)
 */
export function calculateLineItemTax(
  lineTotal: number,
  isTaxable: boolean,
  taxRate: number
): LineItemWithTax {
  const taxAmount = calculateLineTax({
    lineTotal,
    isTaxable,
    taxRate,
  });

  return {
    lineTotal,
    taxAmount,
    isTaxableSnapshot: isTaxable,
  };
}

/**
 * Calculate aggregate totals for a quote or order - SaaS-ready async version
 * 
 * @param lineItems - Array of line items with pricing and tax info
 * @param orgSettings - Organization tax settings (includes org ID)
 * @param customer - Customer record (optional, for tax exemptions/overrides)
 * @param shipFrom - Ship-from address (optional, for SaaS tax zones)
 * @param shipTo - Ship-to address (optional, for SaaS tax zones)
 * @returns Aggregated totals with tax
 */
export async function calculateQuoteOrderTotals(
  lineItems: LineItemInput[],
  orgSettings: OrganizationTaxSettings,
  customer?: Pick<Customer, "isTaxExempt" | "taxRateOverride" | "pricingTier"> | null,
  shipFrom?: TaxAddress | null,
  shipTo?: TaxAddress | null
): Promise<QuoteOrderTotals & { lineItemsWithTax: LineItemWithTax[] }> {
  // For now, we'll resolve a single tax rate for the entire quote/order
  // Future enhancement: per-line-item tax resolution for mixed categories
  
  // Step 1: Resolve tax rate using SaaS context
  // Use first line item's tax category (or you can aggregate/pick most common)
  const firstItem = lineItems[0];
  const taxContext: TaxResolutionContext = {
    organizationId: orgSettings.id,
    companyDefaultTaxRate: orgSettings.defaultTaxRate ?? 0,
    taxEnabled: orgSettings.taxEnabled ?? true,
    customer: customer
      ? {
          isTaxExempt: customer.isTaxExempt ?? false,
          taxRateOverride: customer.taxRateOverride
            ? parseFloat(customer.taxRateOverride.toString())
            : null,
        }
      : undefined,
    product: firstItem
      ? {
          taxCategoryId: firstItem.taxCategoryId,
          isTaxable: firstItem.isTaxable,
        }
      : undefined,
    shipFrom,
    shipTo,
  };

  const taxRate = await resolveTaxRate(taxContext);

  // Step 2: Calculate tax for each line item
  const lineItemsWithTax = lineItems.map((item) => 
    calculateLineItemTax(item.linePrice, item.isTaxable, taxRate)
  );

  // Step 3: Aggregate totals
  const subtotal = lineItemsWithTax.reduce((sum, item) => sum + item.lineTotal, 0);
  const taxableSubtotal = lineItemsWithTax
    .filter((item) => item.isTaxableSnapshot)
    .reduce((sum, item) => sum + item.lineTotal, 0);
  const taxAmount = lineItemsWithTax.reduce((sum, item) => sum + item.taxAmount, 0);
  const total = subtotal + taxAmount;

  return {
    subtotal,
    taxableSubtotal,
    taxRate,
    taxAmount,
    total,
    lineItemsWithTax,
  };
}

/**
 * Helper to extract tax settings from organization record
 */
export function getOrganizationTaxSettings(org: {
  id: string;
  defaultTaxRate?: string | number | null;
  taxEnabled?: boolean | null;
}): OrganizationTaxSettings {
  return {
    id: org.id,
    defaultTaxRate: org.defaultTaxRate
      ? typeof org.defaultTaxRate === "number"
        ? org.defaultTaxRate
        : parseFloat(org.defaultTaxRate.toString())
      : 0,
    taxEnabled: org.taxEnabled ?? true,
  };
}
