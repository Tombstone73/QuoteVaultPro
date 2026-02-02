export type ProductStatus = 'draft' | 'active' | 'archived';

export type FulfillmentType = 'pickup-only' | 'shippable-estimate' | 'shippable-manual-quote';

export type OptionType = 'radio' | 'checkbox' | 'dropdown' | 'numeric' | 'dimension';

export type PricingType = 'none' | 'flat' | 'per-unit' | 'per-sqft' | 'formula' | 'tiered';

export type WeightMode = 'off' | 'per-sqft' | 'fixed' | 'derived';

export type WeightUnit = 'lb' | 'oz' | 'kg' | 'g';

export interface WeightModel {
  mode: WeightMode;
  unit: WeightUnit;
  baseWeight?: number; // For per-sqft or fixed modes
}

export interface Product {
  id: string;
  name: string;
  category: string;
  sku: string;
  status: ProductStatus;
  fulfillment: FulfillmentType;
  basePrice: number;
  weightModel: WeightModel;
  optionGroups: OptionGroup[];
  validationRules: ValidationRule[];
}

export interface OptionGroup {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  isRequired: boolean;
  isMultiSelect: boolean;
  options: Option[];
}

export interface WeightImpact {
  enabled: boolean;
  type: 'per-sqft' | 'fixed';
  value: number;
}

export interface Option {
  id: string;
  name: string;
  description: string;
  type: OptionType;
  sortOrder: number;
  isDefault: boolean;
  isRequired: boolean;
  pricingBehavior: PricingBehavior;
  weightImpact: WeightImpact;
  productionFlags: ProductionFlag[];
  conditionalLogic: ConditionalLogic | null;
}

export interface PricingBehavior {
  type: PricingType;
  flatAmount?: number;
  perUnitAmount?: number;
  perSqftAmount?: number;
  formula?: string;
  tiers?: PricingTier[];
}

export interface PricingTier {
  minQuantity: number;
  maxQuantity: number | null;
  amount: number;
}

export type ProductionFlag = 
  | 'bleed-required'
  | 'rotation-allowed'
  | 'double-sided'
  | 'finishing-required'
  | 'special-media'
  | 'bindery-routing'
  | 'proof-required';

export interface ConditionalLogic {
  operator: 'and' | 'or';
  conditions: Condition[];
}

export interface Condition {
  targetOptionId: string;
  operator: 'equals' | 'not-equals' | 'includes' | 'greater-than' | 'less-than';
  value: string | number;
}

export interface ValidationRule {
  id: string;
  type: 'conflict' | 'requirement' | 'warning';
  message: string;
  affectedOptions: string[];
}
