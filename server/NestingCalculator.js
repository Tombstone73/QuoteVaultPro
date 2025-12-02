/**
 * Batman's Custom Nesting Calculator
 * For calculating optimal piece nesting on sheets (48x96, 24x48, etc.)
 * Accounts for waste, linear foot rounding, and actual material usage
 * Enhanced with configurable sheet waste/charging policies and option pricing
 */

const SheetRoundingMode = {
  EXACT: "exact",
  QUARTER: "quarter",
  HALF: "half",
  FULL: "full"
};

class OversizeDimensionRule {
  constructor(thresholdIn, axis, behavior, targetSheetFraction = null) {
    this.thresholdIn = thresholdIn;
    this.axis = axis;
    this.behavior = behavior;
    this.targetSheetFraction = targetSheetFraction;
  }
}

class SheetChargingPolicy {
  constructor(roundingMode = SheetRoundingMode.EXACT, minSheetFraction = 0, oversizeRules = []) {
    this.roundingMode = roundingMode;
    this.minSheetFraction = minSheetFraction;
    this.oversizeRules = oversizeRules;
  }
}

class NestingCalculator {
  constructor(sheetWidth, sheetHeight, sheetCost, minPricePerItem = null, volumePricing = null, sheetChargingPolicy = null) {
    this.sheetWidth = sheetWidth;
    this.sheetHeight = sheetHeight;
    this.sheetCost = sheetCost;
    this.sheetSqft = (sheetWidth * sheetHeight) / 144;
    this.costPerSqft = sheetCost / this.sheetSqft;
    this.fullSheetSqft = (48 * 96) / 144;
    this.minPricePerItem = minPricePerItem;
    this.volumePricing = volumePricing;
    this.sheetChargingPolicy = sheetChargingPolicy || new SheetChargingPolicy();
  }

  /**
   * Get the price per sheet based on volume pricing tiers
   */
  getPricePerSheet(sheetCount) {
    if (!this.volumePricing || !this.volumePricing.enabled || !this.volumePricing.tiers || this.volumePricing.tiers.length === 0) {
      return this.sheetCost;
    }

    for (const tier of this.volumePricing.tiers) {
      if (sheetCount >= tier.minSheets && (!tier.maxSheets || sheetCount <= tier.maxSheets)) {
        return tier.pricePerSheet;
      }
    }

    return this.sheetCost;
  }

  /**
   * Evaluate oversize rules and adjust max pieces per sheet and min sheet fraction
   */
  evaluateOversizeRules(pieceWidth, pieceHeight, maxPiecesPerSheet) {
    let adjustedMaxPieces = maxPiecesPerSheet;
    let adjustedMinSheetFraction = this.sheetChargingPolicy.minSheetFraction;

    for (const rule of this.sheetChargingPolicy.oversizeRules) {
      let dimension;
      if (rule.axis === "any") {
        dimension = Math.max(pieceWidth, pieceHeight);
      } else if (rule.axis === "width") {
        dimension = pieceWidth;
      } else if (rule.axis === "height") {
        dimension = pieceHeight;
      }

      if (dimension > rule.thresholdIn) {
        if (rule.behavior === "use_full_sheet_axis") {
          let effectiveWidth = pieceWidth;
          let effectiveHeight = pieceHeight;

          if (rule.axis === "width" || (rule.axis === "any" && pieceWidth >= pieceHeight)) {
            effectiveWidth = this.sheetWidth;
          }
          if (rule.axis === "height" || (rule.axis === "any" && pieceHeight > pieceWidth)) {
            effectiveHeight = this.sheetHeight;
          }

          const piecesWide = Math.floor(this.sheetWidth / effectiveWidth);
          const piecesHigh = Math.floor(this.sheetHeight / effectiveHeight);
          adjustedMaxPieces = Math.max(1, piecesWide * piecesHigh);
        } else if (rule.behavior === "bump_sheet_fraction" && rule.targetSheetFraction !== null) {
          adjustedMinSheetFraction = Math.max(adjustedMinSheetFraction, rule.targetSheetFraction);
        }
      }
    }

    return { adjustedMaxPieces, adjustedMinSheetFraction };
  }

  /**
   * Apply sheet charging policy with rounding and minimum sheet fraction
   */
  applySheetChargingPolicy(rawSheetsUsed, adjustedMinSheetFraction) {
    let billableSheets = rawSheetsUsed;

    switch (this.sheetChargingPolicy.roundingMode) {
      case SheetRoundingMode.QUARTER:
        billableSheets = Math.ceil(rawSheetsUsed * 4) / 4;
        break;
      case SheetRoundingMode.HALF:
        billableSheets = Math.ceil(rawSheetsUsed * 2) / 2;
        break;
      case SheetRoundingMode.FULL:
        billableSheets = Math.ceil(rawSheetsUsed);
        break;
      case SheetRoundingMode.EXACT:
      default:
        billableSheets = rawSheetsUsed;
        break;
    }

    if (billableSheets < adjustedMinSheetFraction) {
      billableSheets = adjustedMinSheetFraction;
    }

    return billableSheets;
  }

  /**
   * Calculate how many pieces fit in a single orientation on a specific sheet size
   */
  calculateGridFitOnSheet(pieceWidth, pieceHeight, sheetWidth, sheetHeight) {
    const piecesWide = Math.floor(sheetWidth / pieceWidth);
    const piecesHigh = Math.floor(sheetHeight / pieceHeight);
    const totalPieces = piecesWide * piecesHigh;

    if (totalPieces === 0) {
      return null;
    }

    const costPerPiece = this.sheetCost / totalPieces;
    const pieceSqft = (pieceWidth * pieceHeight) / 144;
    const efficiency = ((totalPieces * pieceSqft) / this.sheetSqft) * 100;

    return {
      orientation: `${pieceWidth}x${pieceHeight}`,
      piecesWide,
      piecesHigh,
      totalPieces,
      costPerPiece: costPerPiece.toFixed(2),
      efficiency: Math.round(efficiency),
      description: `${totalPieces} pieces (${piecesWide} wide × ${piecesHigh} high)`,
    };
  }

  /**
   * Calculate how many pieces fit in a single orientation (uses instance sheet dimensions)
   */
  calculateGridFit(pieceWidth, pieceHeight) {
    return this.calculateGridFitOnSheet(pieceWidth, pieceHeight, this.sheetWidth, this.sheetHeight);
  }

  /**
   * Test both orientations and return the best
   */
  findOptimalOrientation(pieceWidth, pieceHeight) {
    const vertical = this.calculateGridFit(pieceWidth, pieceHeight);
    const horizontal = this.calculateGridFit(pieceHeight, pieceWidth);

    if (!vertical && !horizontal) return null;
    if (!vertical) return horizontal;
    if (!horizontal) return vertical;

    return vertical.totalPieces >= horizontal.totalPieces ? vertical : horizontal;
  }

  /**
   * Test mixed orientations (some vertical, some horizontal)
   * Tests both sheet orientations to ensure consistent results
   */
  testMixedOrientations(pieceWidth, pieceHeight) {
    const results = [];

    console.log(`[MIXED DEBUG] Testing piece ${pieceWidth}×${pieceHeight} on sheet ${this.sheetWidth}×${this.sheetHeight}`);

    // Test both sheet orientations to find the best nesting
    // This ensures 48×96 and 96×48 produce the same results
    const orientations = [
      { width: this.sheetWidth, height: this.sheetHeight, label: 'original' },
      { width: this.sheetHeight, height: this.sheetWidth, label: 'rotated' }
    ];

    for (const orientation of orientations) {
      const sheetW = orientation.width;
      const sheetH = orientation.height;

      console.log(`[MIXED DEBUG] Testing sheet orientation: ${sheetW}×${sheetH} (${orientation.label})`);

      // Test pure grid patterns on this orientation
      const vertical = this.calculateGridFitOnSheet(pieceWidth, pieceHeight, sheetW, sheetH);
      const horizontal = this.calculateGridFitOnSheet(pieceHeight, pieceWidth, sheetW, sheetH);

      console.log(`[MIXED DEBUG] - Vertical (${pieceWidth}×${pieceHeight}):`, vertical ? `${vertical.totalPieces} pieces` : 'none');
      console.log(`[MIXED DEBUG] - Horizontal (${pieceHeight}×${pieceWidth}):`, horizontal ? `${horizontal.totalPieces} pieces` : 'none');

      if (vertical) results.push(vertical);
      if (horizontal) results.push(horizontal);

      // Test mixed patterns: vertical + horizontal on this sheet orientation
      if (vertical && horizontal) {
        const vertPiecesWide = Math.floor(sheetW / pieceWidth);
        const vertPiecesHigh = Math.floor(sheetH / pieceHeight);
        const maxVertPieces = vertPiecesWide * vertPiecesHigh;

        const horizPiecesWide = Math.floor(sheetW / pieceHeight);
        const horizPiecesHigh = Math.floor(sheetH / pieceWidth);
        const maxHorizPieces = horizPiecesWide * horizPiecesHigh;

        // Pattern A: Try filling with vertical first, then horizontal below
        for (let v = 0; v <= maxVertPieces; v++) {
          const vertRows = Math.ceil(v / vertPiecesWide);
          const vertHeightUsed = vertRows * pieceHeight;
          const remainingHeight = sheetH - vertHeightUsed;

          if (remainingHeight >= pieceWidth) {
            const horizPiecesInRemaining = Math.floor(sheetW / pieceHeight);
            const horizRowsInRemaining = Math.floor(remainingHeight / pieceWidth);
            const h = horizPiecesInRemaining * horizRowsInRemaining;

            if (h > 0) {
              const totalPieces = v + h;
              const costPerPiece = this.sheetCost / totalPieces;
              const pieceSqft = (pieceWidth * pieceHeight) / 144;
              const efficiency = ((totalPieces * pieceSqft) / this.sheetSqft) * 100;

              console.log(`[MIXED DEBUG A] Sheet ${sheetW}×${sheetH}: v=${v} first: ${vertRows} rows × ${pieceHeight}" = ${vertHeightUsed}", remaining ${remainingHeight}", horiz: ${horizPiecesInRemaining}×${horizRowsInRemaining} = ${h}, total: ${totalPieces}`);

              results.push({
                orientation: "mixed",
                totalPieces,
                costPerPiece: costPerPiece.toFixed(2),
                efficiency: Math.round(efficiency),
                description: `${v} vertical (${pieceWidth}x${pieceHeight}) + ${h} horizontal (${pieceHeight}x${pieceWidth})`,
              });
            }
          }
        }

        // Pattern B: Try filling with horizontal first, then vertical below
        for (let h = 0; h <= maxHorizPieces; h++) {
          const horizRows = Math.ceil(h / horizPiecesWide);
          const horizHeightUsed = horizRows * pieceWidth;
          const remainingHeight = sheetH - horizHeightUsed;

          if (remainingHeight >= pieceHeight) {
            const vertPiecesInRemaining = Math.floor(sheetW / pieceWidth);
            const vertRowsInRemaining = Math.floor(remainingHeight / pieceHeight);
            const v = vertPiecesInRemaining * vertRowsInRemaining;

            if (v > 0) {
              const totalPieces = h + v;
              const costPerPiece = this.sheetCost / totalPieces;
              const pieceSqft = (pieceWidth * pieceHeight) / 144;
              const efficiency = ((totalPieces * pieceSqft) / this.sheetSqft) * 100;

              console.log(`[MIXED DEBUG B] Sheet ${sheetW}×${sheetH}: h=${h} first: ${horizRows} rows × ${pieceWidth}" = ${horizHeightUsed}", remaining ${remainingHeight}", vert: ${vertPiecesInRemaining}×${vertRowsInRemaining} = ${v}, total: ${totalPieces}`);

              results.push({
                orientation: "mixed",
                totalPieces,
                costPerPiece: costPerPiece.toFixed(2),
                efficiency: Math.round(efficiency),
                description: `${h} horizontal (${pieceHeight}x${pieceWidth}) + ${v} vertical (${pieceWidth}x${pieceHeight})`,
              });
            }
          }
        }
      }
    }

    // Sort by total pieces (descending), then by efficiency
    results.sort((a, b) => {
      if (b.totalPieces !== a.totalPieces) {
        return b.totalPieces - a.totalPieces;
      }
      return b.efficiency - a.efficiency;
    });

    return results;
  }

  /**
   * Full analysis: returns best option and all alternatives
   */
  analyze(pieceWidth, pieceHeight) {
    const allPatterns = this.testMixedOrientations(pieceWidth, pieceHeight);

    if (!allPatterns || allPatterns.length === 0) {
      return null;
    }

    const best = allPatterns[0];

    return {
      sheet: {
        width: this.sheetWidth,
        height: this.sheetHeight,
        sqft: this.sheetSqft.toFixed(4),
        cost: this.sheetCost,
        costPerSqft: this.costPerSqft.toFixed(4),
      },
      piece: {
        width: pieceWidth,
        height: pieceHeight,
        sqft: ((pieceWidth * pieceHeight) / 144).toFixed(4),
      },
      bestOption: best,
      allOptions: allPatterns,
      wasteCost: (this.sheetCost - best.totalPieces * parseFloat(best.costPerPiece)).toFixed(2),
    };
  }

  /**
   * Calculate pricing with waste accounting for a specific quantity
   * Handles full sheets + partial sheets with linear foot rounding
   * Uses mixed orientation nesting to maximize pieces per sheet
   */
  calculatePricingWithWaste(pieceWidth, pieceHeight, quantity) {
    // Use the sheet dimensions from the constructor (configured in admin settings)
    const useSheetWidth = this.sheetWidth;
    const useSheetHeight = this.sheetHeight;

    // Check if piece fits on the sheet (either orientation)
    const fitsNormal = pieceWidth <= useSheetWidth && pieceHeight <= useSheetHeight;
    const fitsRotated = pieceHeight <= useSheetWidth && pieceWidth <= useSheetHeight;

    if (!fitsNormal && !fitsRotated) {
      // Oversized - doesn't fit
      return {
        error: true,
        message: "This size exceeds our standard media dimensions. Please contact us for a custom quote:\n📧 dale@titan-graphics.com\n📞 317-739-0001"
      };
    }

    // Find best nesting pattern using mixed orientations
    const nestingPatterns = this.testMixedOrientations(pieceWidth, pieceHeight);
    if (!nestingPatterns || nestingPatterns.length === 0) {
      return {
        error: true,
        message: "Unable to calculate nesting pattern for this piece size."
      };
    }

    const bestPattern = nestingPatterns[0];
    let maxPiecesPerSheet = bestPattern.totalPieces;

    // Apply oversize rules
    const oversizeResult = this.evaluateOversizeRules(pieceWidth, pieceHeight, maxPiecesPerSheet);
    maxPiecesPerSheet = oversizeResult.adjustedMaxPieces;
    const adjustedMinSheetFraction = oversizeResult.adjustedMinSheetFraction;

    console.log(`[NESTING DEBUG] Piece: ${pieceWidth}×${pieceHeight}, Sheet: ${useSheetWidth}×${useSheetHeight}, Max pieces: ${maxPiecesPerSheet}, Pattern: ${bestPattern.description}, Sheet cost: $${this.sheetCost.toFixed(2)}`);

    if (maxPiecesPerSheet === 0) {
      return {
        error: true,
        message: "Piece dimensions are too large for the sheet size."
      };
    }

    // Calculate raw and billable sheets
    const rawSheetsUsed = quantity / maxPiecesPerSheet;
    const billableSheets = this.applySheetChargingPolicy(rawSheetsUsed, adjustedMinSheetFraction);

    // Apply volume pricing based on billable sheets
    const effectiveSheetCountForPricing = Math.ceil(billableSheets);
    const effectiveSheetCost = this.getPricePerSheet(effectiveSheetCountForPricing);

    console.log(`[NESTING DEBUG] Raw sheets: ${rawSheetsUsed.toFixed(4)}, Billable sheets: ${billableSheets.toFixed(4)}, Effective count: ${effectiveSheetCountForPricing}, Base cost: $${this.sheetCost.toFixed(2)}, Volume-adjusted: $${effectiveSheetCost.toFixed(2)}`);

    // Calculate price per piece based on billable sheets and effective cost
    let pricePerPiece = (effectiveSheetCost * billableSheets) / quantity;

    // Apply minimum price per item if set
    if (this.minPricePerItem && pricePerPiece < this.minPricePerItem) {
      console.log(`[NESTING DEBUG] Applying minimum price: $${pricePerPiece.toFixed(2)} -> $${this.minPricePerItem.toFixed(2)}`);
      pricePerPiece = this.minPricePerItem;
    }

    const totalPrice = pricePerPiece * quantity;

    console.log(`[NESTING DEBUG] Price per piece: $${pricePerPiece.toFixed(2)}, Total for ${quantity}: $${totalPrice.toFixed(2)}`);

    // Calculate how many sheets are actually used
    const sheetsNeeded = Math.ceil(quantity / maxPiecesPerSheet);
    const fullSheets = Math.floor(quantity / maxPiecesPerSheet);
    const remainingPieces = quantity % maxPiecesPerSheet;

    let partialSheetDetails = null;

    // Calculate nesting details for the last sheet if it's not full
    if (remainingPieces > 0) {
      // Use the same nesting logic as full sheets to find optimal pattern
      // Parse the best pattern to understand the layout
      const piecesWideNormal = Math.floor(useSheetWidth / pieceWidth);
      const piecesHighNormal = Math.floor(useSheetHeight / pieceHeight);
      const piecesWideRotated = Math.floor(useSheetWidth / pieceHeight);
      const piecesHighRotated = Math.floor(useSheetHeight / pieceWidth);

      let bestNesting = null;
      let minHeight = Infinity;

      // Try all possible combinations to find the one that minimizes height
      // Option 1: All normal orientation (grid pattern)
      if (piecesWideNormal > 0) {
        const rowsNeeded = Math.ceil(remainingPieces / piecesWideNormal);
        const actualPiecesInLastRow = remainingPieces % piecesWideNormal || piecesWideNormal;
        const height = rowsNeeded * pieceHeight;
        const width = Math.min(actualPiecesInLastRow, piecesWideNormal) * pieceWidth;

        if (height <= useSheetHeight && height < minHeight) {
          minHeight = height;
          bestNesting = {
            normalPieces: remainingPieces,
            rotatedPieces: 0,
            width: useSheetWidth, // Always charge for full width
            height: height,
            pattern: `${remainingPieces} normal (${pieceWidth}×${pieceHeight})`
          };
        }
      }

      // Option 2: All rotated orientation (grid pattern)
      if (piecesWideRotated > 0) {
        const rowsNeeded = Math.ceil(remainingPieces / piecesWideRotated);
        const actualPiecesInLastRow = remainingPieces % piecesWideRotated || piecesWideRotated;
        const height = rowsNeeded * pieceWidth;
        const width = Math.min(actualPiecesInLastRow, piecesWideRotated) * pieceHeight;

        if (height <= useSheetHeight && height < minHeight) {
          minHeight = height;
          bestNesting = {
            normalPieces: 0,
            rotatedPieces: remainingPieces,
            width: useSheetWidth, // Always charge for full width
            height: height,
            pattern: `${remainingPieces} rotated (${pieceHeight}×${pieceWidth})`
          };
        }
      }

      // Option 3: Mixed orientation - try different combinations
      // This matches the logic from testMixedOrientations
      if (piecesWideNormal > 0 && piecesWideRotated > 0 && pieceWidth !== pieceHeight) {
        // Try filling rows with normal pieces, then add rotated pieces below
        for (let normalCount = 0; normalCount <= remainingPieces; normalCount++) {
          const rotatedCount = remainingPieces - normalCount;

          let normalHeight = 0;
          if (normalCount > 0) {
            const normalRows = Math.ceil(normalCount / piecesWideNormal);
            normalHeight = normalRows * pieceHeight;
          }

          let rotatedHeight = 0;
          if (rotatedCount > 0) {
            const rotatedRows = Math.ceil(rotatedCount / piecesWideRotated);
            rotatedHeight = rotatedRows * pieceWidth;
          }

          const totalHeight = normalHeight + rotatedHeight;

          if (totalHeight <= useSheetHeight && totalHeight < minHeight) {
            minHeight = totalHeight;
            bestNesting = {
              normalPieces: normalCount,
              rotatedPieces: rotatedCount,
              width: useSheetWidth,
              height: totalHeight,
              pattern: normalCount > 0 && rotatedCount > 0
                ? `${normalCount} normal + ${rotatedCount} rotated`
                : normalCount > 0
                  ? `${normalCount} normal`
                  : `${rotatedCount} rotated`
            };
          }
        }
      }

      if (!bestNesting) {
        return {
          error: true,
          message: "Unable to nest the remaining pieces on a sheet."
        };
      }

      // Calculate bounding box
      const boundingWidth = bestNesting.width;
      const boundingHeight = bestNesting.height;

      // Round height to next linear foot (12 inches)
      const roundedHeight = Math.ceil(boundingHeight / 12) * 12;

      // Calculate waste dimensions (for display only)
      const wasteWidth = useSheetWidth;
      const wasteHeight = useSheetHeight - roundedHeight;

      // Usable waste rule: If waste is 24" or wider, it's sellable
      let usableWaste = wasteWidth >= 24 && wasteHeight > 0;

      // Calculate material used (for display only)
      const chargeWidth = useSheetWidth;
      const chargeHeight = roundedHeight;
      const materialUsedSqft = (chargeWidth * chargeHeight) / 144;
      const wasteSqft = (wasteWidth * wasteHeight) / 144;

      partialSheetDetails = {
        pieces: remainingPieces,
        normalPieces: bestNesting.normalPieces,
        rotatedPieces: bestNesting.rotatedPieces,
        pattern: bestNesting.pattern,
        boundingWidth,
        boundingHeight,
        roundedHeight,
        chargeWidth,
        chargeHeight,
        materialUsedSqft: parseFloat(materialUsedSqft.toFixed(2)),
        wasteSqft: parseFloat(wasteSqft.toFixed(2)),
        wasteWidth,
        wasteHeight,
        usableWaste,
        cost: parseFloat((pricePerPiece * remainingPieces).toFixed(2)),
        costPerPiece: parseFloat(pricePerPiece.toFixed(2))
      };
    }

    return {
      error: false,
      pieceWidth,
      pieceHeight,
      sheetWidth: useSheetWidth,
      sheetHeight: useSheetHeight,
      maxPiecesPerSheet,
      nestingPattern: bestPattern.description,
      orientation: bestPattern.orientation,
      quantity,
      sheetsNeeded,
      fullSheets,
      fullSheetsCost: parseFloat((fullSheets * this.sheetCost).toFixed(2)),
      remainingPieces,
      partialSheetDetails,
      rawSheetsUsed: parseFloat(rawSheetsUsed.toFixed(4)),
      billableSheets: parseFloat(billableSheets.toFixed(4)),
      effectiveSheetCost: parseFloat(effectiveSheetCost.toFixed(2)),
      totalPrice: parseFloat(totalPrice.toFixed(2)),
      averageCostPerPiece: parseFloat(pricePerPiece.toFixed(2))
    };
  }
}

// Export for ES modules
export { NestingCalculator, SheetChargingPolicy, OversizeDimensionRule, SheetRoundingMode };
export default NestingCalculator;

