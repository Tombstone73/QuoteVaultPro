/**
 * Shared types for the Quote Editor feature
 */

export type QuoteLineItemDraft = {
  tempId?: string;
  id?: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  productType: string;
  width: number;
  height: number;
  quantity: number;
  specsJson: Record<string, any>;
  /** Option Tree v2 canonical selections (schemaVersion=2). */
  optionSelectionsJson?: any;
  /** PBV2 server-authoritative pricing snapshot fields. */
  pbv2TreeVersionId?: string | null;
  pbv2SnapshotJson?: any;
  pricedAt?: string | Date | null;
  materialUsages?: any[];
  selectedOptions: any[];
  linePrice: number;
  /**
   * Price override support (migration 0039).
   * - linePrice is the ACTIVE line price (calculated by default, overridden when overridePriceCents is set)
   * - formulaLinePrice tracks the last known formula price for easy reset
   */
  formulaLinePrice?: number;
  // NEW: Migration 0039 override fields
  priceOverride?: any | null;
  overridePriceCents?: number | null; // Manual price override in cents
  overrideAt?: string | null; // ISO timestamp when override was set
  overrideByUserId?: string | null; // User who set the override
  overrideReason?: string | null; // Optional reason for override
  description?: string | null; // Per-line-item description
  // Migration 0040: Production notes (internal only)
  productionNotes?: string | null; // Internal production notes (not shown to customers)
  // Migration 0015: Canonical routing intent for quote-to-order conversion.
  // requiresDesign: true  → converted order line item lands in needs_design
  // requiresPrepress: true  → ready_for_prepress (after design, if any)
  //                   false → production-direct (skip prepress)
  //                   null/undefined → fall back to productType / org default at conversion
  requiresDesign?: boolean;
  requiresPrepress?: boolean | null;
  requiresProofApproval?: boolean | null;
  // DEPRECATED: Legacy override fields (kept for backward compatibility)
  priceOverridden?: boolean;
  overriddenPrice?: number | null;
  priceBreakdown: any;
  displayOrder: number;
  notes?: string;
  productOptions?: any[];
  status?: "draft" | "active" | "canceled";
  pendingAttachments?: File[]; // TEMP: Files selected but not yet uploaded
};

export type Address = {
  street1: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type OptionSelection = {
  value: string | number | boolean;
  /** Per-option free-text note for choices marked requiresNote. */
  note?: string;
  grommetsLocation?: string;
  grommetsSpacingCount?: number;
  grommetsPerSign?: number;
  grommetsSpacingInches?: number;
  customPlacementNote?: string;
  hemsType?: string;
  polePocket?: string;
};
