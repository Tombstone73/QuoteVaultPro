/**
 * Pricing Pipeline for Option-Based Pricing Rules
 * Wraps NestingCalculator with pre- and post-calculation pricing logic
 */

import NestingCalculator from './NestingCalculator.js';

const PricingStage = {
  PRE: "pre",
  POST: "post"
};

const PricingBasis = {
  SHEET: "sheet",
  SQFT: "sqft",
  ITEM: "item",
  ORDER: "order"
};

const PricingMode = {
  MULTIPLIER: "multiplier",
  FLAT_ADD: "flat_add",
  OVERRIDE_BASE: "override_base"
};

class OptionPricingRule {
  constructor(stage, basis, mode, value, label = "") {
    this.stage = stage;
    this.basis = basis;
    this.mode = mode;
    this.value = value;
    this.label = label;
  }
}

class PricingPipeline {
  static execute(
    baseSheetCost,
    sheetWidth,
    sheetHeight,
    pieceWidth,
    pieceHeight,
    quantity,
    minPricePerItem,
    volumePricing,
    sheetChargingPolicy,
    optionPricingRules = []
  ) {
    const breakdown = {
      baseSheetCost,
      preRulesApplied: [],
      adjustedSheetCost: baseSheetCost,
      nestingDetails: null,
      rawSheetsUsed: 0,
      billableSheets: 0,
      effectiveSheetCost: 0,
      wasteRulesApplied: [],
      baseItemPrice: 0,
      postRulesApplied: [],
      finalItemPrice: 0,
      finalTotal: 0,
      floorApplied: false
    };

    let adjustedSheetCost = baseSheetCost;

    const preRules = optionPricingRules.filter(r => r.stage === PricingStage.PRE);
    for (const rule of preRules) {
      if (rule.basis === PricingBasis.SHEET) {
        const before = adjustedSheetCost;
        if (rule.mode === PricingMode.MULTIPLIER) {
          adjustedSheetCost *= rule.value;
        } else if (rule.mode === PricingMode.FLAT_ADD) {
          adjustedSheetCost += rule.value;
        } else if (rule.mode === PricingMode.OVERRIDE_BASE) {
          adjustedSheetCost = rule.value;
        }
        breakdown.preRulesApplied.push({
          label: rule.label,
          mode: rule.mode,
          value: rule.value,
          before: parseFloat(before.toFixed(2)),
          after: parseFloat(adjustedSheetCost.toFixed(2))
        });
      }
    }

    breakdown.adjustedSheetCost = parseFloat(adjustedSheetCost.toFixed(2));

    const calculator = new NestingCalculator(
      sheetWidth,
      sheetHeight,
      adjustedSheetCost,
      minPricePerItem,
      volumePricing,
      sheetChargingPolicy
    );

    const nestingResult = calculator.calculatePricingWithWaste(pieceWidth, pieceHeight, quantity);

    if (nestingResult.error) {
      return {
        error: true,
        message: nestingResult.message
      };
    }

    breakdown.nestingDetails = nestingResult;
    breakdown.rawSheetsUsed = nestingResult.rawSheetsUsed;
    breakdown.billableSheets = nestingResult.billableSheets;
    breakdown.effectiveSheetCost = nestingResult.effectiveSheetCost;
    breakdown.baseItemPrice = nestingResult.averageCostPerPiece;

    if (sheetChargingPolicy) {
      breakdown.wasteRulesApplied.push({
        roundingMode: sheetChargingPolicy.roundingMode,
        minSheetFraction: sheetChargingPolicy.minSheetFraction,
        oversizeRules: sheetChargingPolicy.oversizeRules.length
      });
    }

    let postItemPrice = breakdown.baseItemPrice;
    let orderAdjustment = 0;

    const postRules = optionPricingRules.filter(r => r.stage === PricingStage.POST);
    for (const rule of postRules) {
      if (rule.basis === PricingBasis.ITEM) {
        const before = postItemPrice;
        if (rule.mode === PricingMode.MULTIPLIER) {
          postItemPrice *= rule.value;
        } else if (rule.mode === PricingMode.FLAT_ADD) {
          postItemPrice += rule.value;
        }
        breakdown.postRulesApplied.push({
          label: rule.label,
          basis: rule.basis,
          mode: rule.mode,
          value: rule.value,
          before: parseFloat(before.toFixed(2)),
          after: parseFloat(postItemPrice.toFixed(2))
        });
      } else if (rule.basis === PricingBasis.ORDER) {
        if (rule.mode === PricingMode.MULTIPLIER) {
          orderAdjustment += (postItemPrice * quantity * (rule.value - 1));
        } else if (rule.mode === PricingMode.FLAT_ADD) {
          orderAdjustment += rule.value;
        }
        breakdown.postRulesApplied.push({
          label: rule.label,
          basis: rule.basis,
          mode: rule.mode,
          value: rule.value,
          adjustment: parseFloat(orderAdjustment.toFixed(2))
        });
      }
    }

    let finalItemPrice = postItemPrice;
    if (minPricePerItem && finalItemPrice < minPricePerItem) {
      breakdown.floorApplied = true;
      finalItemPrice = minPricePerItem;
    }

    const finalTotal = (finalItemPrice * quantity) + orderAdjustment;

    breakdown.finalItemPrice = parseFloat(finalItemPrice.toFixed(2));
    breakdown.finalTotal = parseFloat(finalTotal.toFixed(2));

    return {
      error: false,
      baseSheetCost: breakdown.baseSheetCost,
      adjustedSheetCost: breakdown.adjustedSheetCost,
      rawSheetsUsed: breakdown.rawSheetsUsed,
      billableSheets: breakdown.billableSheets,
      effectiveSheetCost: breakdown.effectiveSheetCost,
      baseItemPrice: breakdown.baseItemPrice,
      finalItemPrice: breakdown.finalItemPrice,
      finalTotal: breakdown.finalTotal,
      priceBreakdown: breakdown,
      nestingDetails: breakdown.nestingDetails
    };
  }
}

export { PricingPipeline, OptionPricingRule, PricingStage, PricingBasis, PricingMode };
