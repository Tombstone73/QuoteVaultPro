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
  selectedOptions: any[];
  linePrice: number;
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
  grommetsLocation?: string;
  grommetsSpacingCount?: number;
  grommetsPerSign?: number;
  grommetsSpacingInches?: number;
  customPlacementNote?: string;
  hemsType?: string;
  polePocket?: string;
};
