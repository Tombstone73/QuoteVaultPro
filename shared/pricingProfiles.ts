/**
 * Pricing Profiles - Single Source of Truth
 * 
 * This module defines all available pricing calculators/profiles.
 * Products reference these profiles by key to determine how pricing is calculated.
 */

// Flat goods config for nesting calculator
export interface FlatGoodsConfig {
  sheetWidth: number;
  sheetHeight: number;
  allowRotation: boolean;
  minSheets?: number;
  materialType: "sheet" | "roll";
  minPricePerItem?: number | null;
}

// Profile configuration types
export type PricingProfileConfig = FlatGoodsConfig | Record<string, never>;

// Profile definition
export interface PricingProfile {
  key: string;
  label: string;
  description: string;
  kind: "flat_goods" | "sqft_formula" | "qty_only";
  requiresDimensions: boolean;
  /** If true, this profile uses the NestingCalculator */
  usesNestingCalculator: boolean;
  /** If true, this profile uses pricingFormula with mathjs evaluation */
  usesFormula: boolean;
  /** Default formula for this profile (if usesFormula) */
  defaultFormula?: string;
}

/**
 * Master list of pricing profiles
 * 
 * - flat_goods: Uses NestingCalculator for sheet-based products (foam board, ACM, banners)
 * - sqft_formula: Uses mathjs formula evaluation with sqft, width, height, quantity
 * - qty_only: Simple quantity * unit price calculation, no dimensions needed
 */
export const PRICING_PROFILES: Record<string, PricingProfile> = {
  default: {
    key: "default",
    label: "Default (Formula)",
    description: "Uses pricing formula with sqft, width, height, quantity variables",
    kind: "sqft_formula",
    requiresDimensions: true,
    usesNestingCalculator: false,
    usesFormula: true,
    defaultFormula: "sqft * p * q",
  },
  flat_goods: {
    key: "flat_goods",
    label: "Flat Goods / Sheets",
    description: "Sheet-based products with nesting calculator (foam board, ACM, coroplast)",
    kind: "flat_goods",
    requiresDimensions: true,
    usesNestingCalculator: true,
    usesFormula: false,
  },
  qty_only: {
    key: "qty_only",
    label: "Quantity Only",
    description: "Simple quantity-based pricing, no dimensions (yard stakes, hardware)",
    kind: "qty_only",
    requiresDimensions: false,
    usesNestingCalculator: false,
    usesFormula: true,
    defaultFormula: "q * unitPrice",
  },
  fee: {
    key: "fee",
    label: "Fee / Service",
    description: "Flat fees with no dimensions (design fee, rush fee, shipping)",
    kind: "qty_only",
    requiresDimensions: false,
    usesNestingCalculator: false,
    usesFormula: true,
    defaultFormula: "flatFee",
  },
};

// Type for profile keys
export type PricingProfileKey = keyof typeof PRICING_PROFILES;

// List of valid profile keys for Zod validation
export const PRICING_PROFILE_KEYS = Object.keys(PRICING_PROFILES) as PricingProfileKey[];

/**
 * Get profile by key with fallback to default
 */
export function getProfile(key: string | null | undefined): PricingProfile {
  if (!key || !PRICING_PROFILES[key]) {
    return PRICING_PROFILES.default;
  }
  return PRICING_PROFILES[key];
}

/**
 * Check if a profile requires width/height dimensions
 */
export function profileRequiresDimensions(key: string | null | undefined): boolean {
  return getProfile(key).requiresDimensions;
}

/**
 * Get default formula for a profile
 */
export function getDefaultFormula(key: string | null | undefined): string {
  const profile = getProfile(key);
  return profile.defaultFormula || "sqft * p * q";
}

// ─────────────────────────────────────────────────────────────────────────────
// Flat Goods Calculator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Roll material configuration for pricing (used when materialType === "roll")
 */
export interface RollMaterialConfig {
  /** Roll width in inches */
  rollWidthIn: number;
  /** Roll length in feet */
  rollLengthFt: number;
  /** Cost per roll (vendor cost) */
  costPerRoll: number;
  /** Edge waste per side in inches */
  edgeWasteInPerSide?: number;
  /** Lead waste in feet */
  leadWasteFt?: number;
  /** Tail waste in feet */
  tailWasteFt?: number;
  /** Pre-computed cost per usable sqft (if already calculated) */
  costPerSqft?: number;
}

/**
 * Input for the flat goods calculator
 */
export interface FlatGoodsInput {
  /** Piece width in inches */
  pieceWidth: number;
  /** Piece height in inches */
  pieceHeight: number;
  /** Number of pieces requested */
  quantity: number;
  /** Base price per square foot from variant */
  basePricePerSqft: number;
  /** Sheet width in inches (from profile config or legacy product field) */
  sheetWidth: number;
  /** Sheet height in inches (from profile config or legacy product field) */
  sheetHeight: number;
  /** Material type: "sheet" or "roll" */
  materialType: "sheet" | "roll";
  /** Minimum price per item (optional) */
  minPricePerItem?: number | null;
  /** Volume pricing tiers (optional, from variant or product) */
  volumePricing?: {
    enabled: boolean;
    tiers?: Array<{
      minSheets: number;
      maxSheets?: number;
      pricePerSheet: number;
    }>;
  } | null;
  /** Roll material configuration for accurate cost calculation */
  rollMaterial?: RollMaterialConfig | null;
}

/**
 * Output from the flat goods calculator
 */
export interface FlatGoodsResult {
  /** Total price for the order */
  totalPrice: number;
  /** Price per unit/piece */
  unitPrice: number;
  /** Number of sheets used (for sheet material) */
  sheetCount: number;
  /** Total square footage of material used */
  usedSqft: number;
  /** Detailed nesting information (for display in quote) */
  nestingDetails?: NestingDetails;
  /** Error message if calculation failed */
  error?: string;
}

/**
 * Detailed nesting information for display
 */
export interface NestingDetails {
  piecesPerSheet?: number;
  nestingPattern?: string;
  orientation?: string;
  sheetWidth: number;
  sheetHeight: number;
  fullSheets?: number;
  fullSheetsCost?: number;
  remainingPieces?: number;
  partialSheet?: any;
  totalPrice: number;
  averageCostPerPiece: number;
  // Roll-specific fields
  piecesAcrossWidth?: number;
  linearFeet?: number;
  pattern?: string;
  efficiency?: number;
  costPerPiece?: number;
}

/**
 * Interface for nesting calculator (to avoid importing the JS module in shared code)
 * The actual NestingCalculator is injected by the server.
 */
export interface NestingCalculatorInterface {
  calculatePricingWithWaste(pieceWidth: number, pieceHeight: number, quantity: number): {
    error?: boolean;
    message?: string;
    totalPrice?: number;
    maxPiecesPerSheet?: number;
    nestingPattern?: string;
    orientation?: string;
    sheetWidth?: number;
    sheetHeight?: number;
    fullSheets?: number;
    fullSheetsCost?: number;
    remainingPieces?: number;
    partialSheetDetails?: any;
    averageCostPerPiece?: number;
    sheetsNeeded?: number;
  };
}

/**
 * Factory function type for creating nesting calculator instances
 */
export type NestingCalculatorFactory = (
  sheetWidth: number,
  sheetHeight: number,
  sheetCost: number,
  minPricePerItem: number | null,
  volumePricing: any
) => NestingCalculatorInterface;

/**
 * Calculate pricing for flat goods (sheet-based or roll-based products)
 * 
 * This function centralizes the flat goods pricing logic for:
 * - Sheet materials (foam board, ACM, coroplast) using nesting calculator
 * - Roll materials (vinyl, banner material) using linear foot calculation
 * 
 * @param input - Flat goods input parameters
 * @param createNestingCalculator - Factory function to create NestingCalculator instances
 * @returns FlatGoodsResult with pricing and nesting details
 */
export function flatGoodsCalculator(
  input: FlatGoodsInput,
  createNestingCalculator: NestingCalculatorFactory
): FlatGoodsResult {
  const {
    pieceWidth,
    pieceHeight,
    quantity,
    basePricePerSqft,
    sheetWidth,
    sheetHeight,
    materialType,
    minPricePerItem,
    volumePricing,
    rollMaterial,
  } = input;

  // Calculate sheet cost based on variant price per sqft
  const sheetSqft = (sheetWidth * sheetHeight) / 144;
  const sheetCost = basePricePerSqft * sheetSqft;

  if (materialType === "roll") {
    // ─────────────────────────────────────────────────────────────────────
    // Roll Material Calculation
    // ─────────────────────────────────────────────────────────────────────
    
    // Determine effective roll width - use rollMaterial config if available
    const rollWidth = rollMaterial?.rollWidthIn ?? sheetWidth;
    
    // Calculate usable width (accounting for edge waste)
    const edgeWaste = rollMaterial?.edgeWasteInPerSide ?? 0;
    const usableWidth = Math.max(0, rollWidth - 2 * edgeWaste);
    
    // Pieces across usable width
    const piecesAcrossWidth = Math.floor(usableWidth / pieceWidth);

    if (piecesAcrossWidth === 0) {
      return {
        totalPrice: 0,
        unitPrice: 0,
        sheetCount: 0,
        usedSqft: 0,
        error: `Piece width (${pieceWidth}") exceeds usable roll width (${usableWidth}")`,
      };
    }

    const linearInchesPerPiece = pieceHeight;
    const totalLinearInches = Math.ceil(quantity / piecesAcrossWidth) * linearInchesPerPiece;
    const linearFeet = totalLinearInches / 12;

    // Calculate used square footage (using usable width)
    const usedSqft = (usableWidth * totalLinearInches) / 144;

    // Determine cost per sqft:
    // 1. If rollMaterial has pre-computed costPerSqft, use it
    // 2. If rollMaterial has costPerRoll, compute costPerSqft from usable sqft
    // 3. Fall back to basePricePerSqft from variant
    let effectiveCostPerSqft = basePricePerSqft;
    
    if (rollMaterial?.costPerSqft && rollMaterial.costPerSqft > 0) {
      effectiveCostPerSqft = rollMaterial.costPerSqft;
    } else if (rollMaterial?.costPerRoll && rollMaterial.rollLengthFt) {
      // Compute usable sqft per roll
      const leadWaste = rollMaterial.leadWasteFt ?? 0;
      const tailWaste = rollMaterial.tailWasteFt ?? 0;
      const usableLengthFt = Math.max(0, rollMaterial.rollLengthFt - leadWaste - tailWaste);
      const usableSqftPerRoll = (usableWidth / 12) * usableLengthFt;
      
      if (usableSqftPerRoll > 0) {
        effectiveCostPerSqft = rollMaterial.costPerRoll / usableSqftPerRoll;
      }
    }

    // Calculate total material cost based on actual used sqft
    const totalPrice = usedSqft * effectiveCostPerSqft;
    const unitPrice = totalPrice / quantity;

    return {
      totalPrice: parseFloat(totalPrice.toFixed(2)),
      unitPrice: parseFloat(unitPrice.toFixed(2)),
      sheetCount: 0, // Rolls don't have discrete sheets
      usedSqft: parseFloat(usedSqft.toFixed(2)),
      nestingDetails: {
        piecesAcrossWidth,
        linearFeet: parseFloat(linearFeet.toFixed(2)),
        pattern: `${piecesAcrossWidth} pieces across ${usableWidth}" usable width (${rollWidth}" - ${edgeWaste * 2}" edge waste)`,
        efficiency: usableWidth > 0 ? parseFloat(((usableWidth / rollWidth) * 100).toFixed(1)) : 0,
        costPerPiece: parseFloat(unitPrice.toFixed(2)),
        sheetWidth: rollWidth,
        sheetHeight: 0, // Roll has no fixed height
        totalPrice: parseFloat(totalPrice.toFixed(2)),
        averageCostPerPiece: parseFloat(unitPrice.toFixed(2)),
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Sheet Material Calculation (using NestingCalculator)
  // ─────────────────────────────────────────────────────────────────────────
  const calc = createNestingCalculator(
    sheetWidth,
    sheetHeight,
    sheetCost,
    minPricePerItem ?? null,
    volumePricing ?? null
  );

  const pricingResult = calc.calculatePricingWithWaste(pieceWidth, pieceHeight, quantity);

  // Check for errors (oversized pieces)
  if (pricingResult.error) {
    return {
      totalPrice: 0,
      unitPrice: 0,
      sheetCount: 0,
      usedSqft: 0,
      error: pricingResult.message || "Nesting calculation failed",
    };
  }

  const totalPrice = pricingResult.totalPrice ?? 0;
  const sheetCount = pricingResult.sheetsNeeded ?? 0;
  const unitPrice = pricingResult.averageCostPerPiece ?? 0;
  const usedSqft = sheetCount * sheetSqft;

  return {
    totalPrice: parseFloat(totalPrice.toFixed(2)),
    unitPrice: parseFloat(unitPrice.toFixed(2)),
    sheetCount,
    usedSqft: parseFloat(usedSqft.toFixed(2)),
    nestingDetails: {
      piecesPerSheet: pricingResult.maxPiecesPerSheet,
      nestingPattern: pricingResult.nestingPattern,
      orientation: pricingResult.orientation,
      sheetWidth: pricingResult.sheetWidth ?? sheetWidth,
      sheetHeight: pricingResult.sheetHeight ?? sheetHeight,
      fullSheets: pricingResult.fullSheets,
      fullSheetsCost: pricingResult.fullSheetsCost,
      remainingPieces: pricingResult.remainingPieces,
      partialSheet: pricingResult.partialSheetDetails,
      totalPrice: parseFloat(totalPrice.toFixed(2)),
      averageCostPerPiece: parseFloat(unitPrice.toFixed(2)),
    },
  };
}

/**
 * Build FlatGoodsInput from product/variant data with fallbacks
 * 
 * This helper handles backward compatibility with legacy product fields
 * when pricingProfileConfig is not set.
 * 
 * @param profileConfig - Profile config from pricing formula or null
 * @param product - Product with legacy fields
 * @param variant - Variant with pricing info
 * @param pieceWidth - Requested piece width
 * @param pieceHeight - Requested piece height
 * @param quantity - Requested quantity
 * @param rollMaterial - Optional roll material configuration for roll-type materials
 */
export function buildFlatGoodsInput(
  profileConfig: FlatGoodsConfig | null | undefined,
  product: {
    sheetWidth?: string | null;
    sheetHeight?: string | null;
    materialType?: "sheet" | "roll" | null;
    minPricePerItem?: string | null;
    nestingVolumePricing?: any;
  },
  variant: {
    basePricePerSqft: string;
    volumePricing?: any;
  } | null,
  pieceWidth: number,
  pieceHeight: number,
  quantity: number,
  rollMaterial?: RollMaterialConfig | null
): FlatGoodsInput {
  // Get sheet dimensions from profile config or legacy product fields
  const sheetWidth = profileConfig?.sheetWidth 
    ?? (product.sheetWidth ? parseFloat(product.sheetWidth) : 48);
  const sheetHeight = profileConfig?.sheetHeight 
    ?? (product.sheetHeight ? parseFloat(product.sheetHeight) : 96);
  const materialType = profileConfig?.materialType 
    ?? product.materialType 
    ?? "sheet";
  const minPricePerItem = profileConfig?.minPricePerItem 
    ?? (product.minPricePerItem ? parseFloat(product.minPricePerItem) : null);

  // Use variant-level volume pricing if available, otherwise fall back to product-level
  const volumePricing = (variant?.volumePricing) 
    ? variant.volumePricing 
    : (product.nestingVolumePricing || null);

  const basePricePerSqft = variant ? parseFloat(variant.basePricePerSqft) : 0;

  return {
    pieceWidth,
    pieceHeight,
    quantity,
    basePricePerSqft,
    sheetWidth,
    sheetHeight,
    materialType,
    minPricePerItem,
    volumePricing,
    rollMaterial: rollMaterial ?? null,
  };
}
