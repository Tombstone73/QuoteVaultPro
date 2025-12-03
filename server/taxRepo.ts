/**
 * Tax Repository - Data Access Layer for SaaS Tax System
 * 
 * Provides helpers for querying tax zones, categories, nexus, and rules.
 * Used by pricingService.ts for multi-state tax resolution.
 */

import { and, eq, gte, lte, isNull, or } from "drizzle-orm";
import { db } from "./db";
import {
  taxZones,
  taxCategories,
  organizationTaxNexus,
  taxRules,
  type TaxZone,
  type TaxCategory,
  type OrganizationTaxNexus,
  type TaxRule,
} from "@shared/schema";

/**
 * Get organization tax settings (simple flags)
 */
export async function getOrgTaxSettings(organizationId: string): Promise<{
  taxEnabled: boolean;
  defaultTaxRate: number;
} | null> {
  const [org] = await db.query.organizations.findMany({
    where: (orgs, { eq }) => eq(orgs.id, organizationId),
    columns: {
      taxEnabled: true,
      defaultTaxRate: true,
    },
    limit: 1,
  });

  if (!org) return null;

  return {
    taxEnabled: org.taxEnabled ?? false,
    defaultTaxRate: parseFloat(org.defaultTaxRate || "0"),
  };
}

/**
 * Get all active tax nexus records for organization
 */
export async function getOrgTaxNexus(organizationId: string): Promise<OrganizationTaxNexus[]> {
  return await db
    .select()
    .from(organizationTaxNexus)
    .where(
      and(
        eq(organizationTaxNexus.organizationId, organizationId),
        eq(organizationTaxNexus.active, true)
      )
    );
}

/**
 * Check if organization has tax nexus in a specific state
 * 
 * Backward compatibility: If no nexus records exist, returns true (nexus everywhere).
 * If nexus records exist, must match state explicitly.
 */
export async function orgHasNexusIn(params: {
  organizationId: string;
  country: string;
  state: string;
}): Promise<boolean> {
  const { organizationId, country, state } = params;

  // Check if ANY nexus records exist for this org
  const allNexus = await db
    .select({ id: organizationTaxNexus.id })
    .from(organizationTaxNexus)
    .where(eq(organizationTaxNexus.organizationId, organizationId))
    .limit(1);

  // Backward compatibility: no nexus records = nexus everywhere
  if (allNexus.length === 0) {
    return true;
  }

  // Nexus records exist - check for specific match
  const matches = await db
    .select({ id: organizationTaxNexus.id })
    .from(organizationTaxNexus)
    .where(
      and(
        eq(organizationTaxNexus.organizationId, organizationId),
        eq(organizationTaxNexus.country, country),
        eq(organizationTaxNexus.state, state),
        eq(organizationTaxNexus.active, true)
      )
    )
    .limit(1);

  return matches.length > 0;
}

/**
 * Find the most applicable tax zone for a ship-to address
 * 
 * Match priority:
 * 1. Postal code range match (most specific)
 * 2. City/county match
 * 3. State-only match
 * 
 * Returns null if no zone found.
 */
export async function findApplicableTaxZone(params: {
  organizationId: string;
  country: string;
  state: string;
  county?: string | null;
  city?: string | null;
  postalCode?: string | null;
}): Promise<TaxZone | null> {
  const { organizationId, country, state, county, city, postalCode } = params;

  // Build base query conditions
  const baseConditions = [
    eq(taxZones.organizationId, organizationId),
    eq(taxZones.country, country),
    eq(taxZones.state, state),
    eq(taxZones.active, true),
  ];

  // Try postal code range match first (most specific)
  if (postalCode) {
    const postalMatches = await db
      .select()
      .from(taxZones)
      .where(
        and(
          ...baseConditions,
          gte(taxZones.postalStart, postalCode),
          lte(taxZones.postalEnd, postalCode)
        )
      )
      .limit(1);

    if (postalMatches.length > 0) {
      return postalMatches[0];
    }
  }

  // Try city/county match
  if (city || county) {
    const conditions = [...baseConditions];
    if (city) {
      conditions.push(eq(taxZones.city, city));
    }
    if (county) {
      conditions.push(eq(taxZones.county, county));
    }

    const localMatches = await db
      .select()
      .from(taxZones)
      .where(and(...conditions))
      .limit(1);

    if (localMatches.length > 0) {
      return localMatches[0];
    }
  }

  // Fall back to state-only match
  const stateMatches = await db
    .select()
    .from(taxZones)
    .where(
      and(
        ...baseConditions,
        isNull(taxZones.city),
        isNull(taxZones.county),
        isNull(taxZones.postalStart),
        isNull(taxZones.postalEnd)
      )
    )
    .limit(1);

  return stateMatches.length > 0 ? stateMatches[0] : null;
}

/**
 * Get tax rule for specific zone and category
 * 
 * Used to determine if a product category has special treatment in a zone
 * (e.g., labor is non-taxable, or has reduced rate).
 */
export async function getTaxRuleForZoneAndCategory(params: {
  organizationId: string;
  taxZoneId: string;
  taxCategoryId: string;
}): Promise<TaxRule | null> {
  const { organizationId, taxZoneId, taxCategoryId } = params;

  const matches = await db
    .select()
    .from(taxRules)
    .where(
      and(
        eq(taxRules.organizationId, organizationId),
        eq(taxRules.taxZoneId, taxZoneId),
        eq(taxRules.taxCategoryId, taxCategoryId)
      )
    )
    .limit(1);

  return matches.length > 0 ? matches[0] : null;
}

/**
 * Get all tax categories for organization
 */
export async function getTaxCategories(organizationId: string): Promise<TaxCategory[]> {
  return await db
    .select()
    .from(taxCategories)
    .where(eq(taxCategories.organizationId, organizationId));
}

/**
 * Get tax category by ID
 */
export async function getTaxCategoryById(
  organizationId: string,
  categoryId: string
): Promise<TaxCategory | null> {
  const matches = await db
    .select()
    .from(taxCategories)
    .where(
      and(
        eq(taxCategories.id, categoryId),
        eq(taxCategories.organizationId, organizationId)
      )
    )
    .limit(1);

  return matches.length > 0 ? matches[0] : null;
}
