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
  selectedOptions: any[];
  linePrice: number;
  /**
   * Price override support (client-side for now).
   * - linePrice is the ACTIVE line price (formula by default, overridden when set)
   * - formulaLinePrice tracks the last known formula price for easy reset
   */
  priceOverridden?: boolean;
  overriddenPrice?: number | null;
  formulaLinePrice?: number;
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
