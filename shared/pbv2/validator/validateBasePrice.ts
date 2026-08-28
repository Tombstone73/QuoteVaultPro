import { errorFinding, type Finding } from "../findings";
import type { ValidationResult } from "./types";

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  if (!value || typeof value !== "object") return null;
  return value as AnyRecord;
}

function toResult(findings: Finding[]): ValidationResult {
  const errors = findings.filter((f) => f.severity === "ERROR");
  const warnings = findings.filter((f) => f.severity === "WARNING");
  const info = findings.filter((f) => f.severity === "INFO");
  const ok = errors.length === 0;
  return { ok, findings, errors, warnings, info };
}

function numericRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const numeric = Number(raw);
    if (key && Number.isFinite(numeric)) out[key] = numeric;
  }
  return out;
}

function hasFlatFeeFormula(meta: AnyRecord): boolean {
  const formula = typeof meta.pricingFormula === "string" ? meta.pricingFormula : "";
  if (!/\bflatFee\b/.test(formula)) return false;
  const variables = {
    ...numericRecord((meta as any).pricingFormulaVariables),
    ...numericRecord((meta as any).formulaVariables),
  };
  return Number.isFinite(variables.flatFee);
}

function hasHourlyFormula(meta: AnyRecord): boolean {
  const formula = typeof meta.pricingFormula === "string" ? meta.pricingFormula.replace(/\s+/g, "") : "";
  const variables = {
    ...numericRecord((meta as any).pricingFormulaVariables),
    ...numericRecord((meta as any).formulaVariables),
  };
  const billingUnit = asRecord((meta as any).billingUnit);
  return formula === "hours*hourly_rate"
    && billingUnit?.kind === "hour"
    && billingUnit?.selectionKey === "hours"
    && Number(billingUnit?.step) > 0
    && Number.isFinite(variables.hourly_rate)
    && variables.hourly_rate >= 0;
}

/**
 * Formula-priced matrix products deliberately keep the scalar base at zero:
 * the selected matrix row supplies `base_price` at runtime.  A positive row
 * is therefore a real production price source, not a missing fallback.
 */
function matrixRows(tree: AnyRecord, meta: AnyRecord): AnyRecord[] {
  const matrix = asRecord(tree.pricingMatrix) ?? asRecord(meta.pricingMatrix);
  return Array.isArray(matrix?.rows)
    ? matrix.rows.map(asRecord).filter((row): row is AnyRecord => row !== null)
    : [];
}

function matrixRowHasDirectBasePrice(row: AnyRecord): boolean {
  const variables = asRecord(row.variables) ?? asRecord(row.values);
  const basePrice = Number(variables?.base_price);
  return Number.isFinite(basePrice) && basePrice > 0;
}

function matrixRowHasQuantityTiers(row: AnyRecord): boolean {
  return Array.isArray(row.qtyTiers) && row.qtyTiers.length > 0;
}

function matrixBasePriceRowCount(tree: AnyRecord, meta: AnyRecord): number {
  return matrixRows(tree, meta).filter((row) => {
    return matrixRowHasDirectBasePrice(row);
  }).length;
}

function matrixQuantityTierRowCount(tree: AnyRecord, meta: AnyRecord): number {
  return matrixRows(tree, meta).filter(matrixRowHasQuantityTiers).length;
}

/**
 * A quantity-only PBV2 product may be priced entirely by its line-item
 * quantity tiers. The tier thresholds are canonical lower bounds: omitted
 * maxQty values cover through the next threshold and the final one is open.
 */
export function validateQuantityOnlyPerPieceTierFamily(pricingV2: unknown): ValidationResult {
  const pricing = asRecord(pricingV2);
  if (!pricing) {
    return toResult([errorFinding({
      code: "PBV2_E_QTY_TIER_MISSING",
      message: "Quantity tiers are missing.",
      path: "tree.meta.pricingV2.qtyTiers",
    })]);
  }
  if (pricing.tierBasis !== "line_item_quantity") {
    return toResult([errorFinding({
      code: "PBV2_E_QTY_TIER_BASIS_INVALID",
      message: "Quantity-only tier pricing requires the Line Item Quantity tier basis.",
      path: "tree.meta.pricingV2.tierBasis",
    })]);
  }
  const tiers = Array.isArray(pricing.qtyTiers) ? pricing.qtyTiers : [];
  if (tiers.length === 0) {
    return toResult([errorFinding({
      code: "PBV2_E_QTY_TIER_MISSING",
      message: "Quantity tiers are missing.",
      path: "tree.meta.pricingV2.qtyTiers",
    })]);
  }

  let previousMin: number | null = null;
  let previousMax: number | null | undefined = undefined;
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = asRecord(tiers[index]);
    const path = `tree.meta.pricingV2.qtyTiers[${index}]`;
    const minQty = tier?.minQty;
    const rate = tier?.perPieceCents;
    const hasMax = Boolean(tier && Object.prototype.hasOwnProperty.call(tier, "maxQty"));
    const maxQty = hasMax ? tier?.maxQty : undefined;

    if (!Number.isInteger(minQty) || Number(minQty) < 1) {
      return toResult([errorFinding({ code: "PBV2_E_QTY_TIER_COVERAGE_INVALID", message: "Quantity tier coverage must begin at 1 and use positive whole-number thresholds.", path: `${path}.minQty` })]);
    }
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      return toResult([errorFinding({ code: "PBV2_E_QTY_TIER_RATE_MISSING", message: "Every quantity tier must define a positive per-piece rate.", path: `${path}.perPieceCents` })]);
    }
    if (index === 0 && minQty !== 1) {
      return toResult([errorFinding({ code: "PBV2_E_QTY_TIER_COVERAGE_INVALID", message: "Quantity tier coverage must begin at 1.", path: `${path}.minQty` })]);
    }
    if (previousMin !== null) {
      if (previousMax === null || Number(minQty) <= previousMin || (typeof previousMax === "number" && Number(minQty) <= previousMax)) {
        return toResult([errorFinding({ code: "PBV2_E_QTY_TIER_OVERLAP", message: "Quantity tiers overlap or are out of order.", path })]);
      }
      if (typeof previousMax === "number" && Number(minQty) !== previousMax + 1) {
        return toResult([errorFinding({ code: "PBV2_E_QTY_TIER_COVERAGE_INVALID", message: "Quantity tiers must provide continuous coverage.", path })]);
      }
    }
    if (maxQty !== undefined && maxQty !== null && (!Number.isInteger(maxQty) || Number(maxQty) < Number(minQty))) {
      return toResult([errorFinding({ code: "PBV2_E_QTY_TIER_FINAL_INVALID", message: "Quantity tier maximums must be whole numbers no lower than their minimum.", path: `${path}.maxQty` })]);
    }
    if (index < tiers.length - 1 && maxQty === null) {
      return toResult([errorFinding({ code: "PBV2_E_QTY_TIER_FINAL_INVALID", message: "An open-ended quantity tier must be the final tier.", path: `${path}.maxQty` })]);
    }
    if (index === tiers.length - 1 && typeof maxQty === "number") {
      return toResult([errorFinding({ code: "PBV2_E_QTY_TIER_FINAL_INVALID", message: "The final quantity tier must be open-ended.", path: `${path}.maxQty` })]);
    }
    previousMin = Number(minQty);
    previousMax = maxQty as number | null | undefined;
  }

  return toResult([]);
}

/**
 * Validate that PBV2 tree has base pricing configured
 * 
 * Checks that meta.pricingV2.base has at least one non-zero pricing field:
 * - perSqftCents
 * - perPieceCents
 * - minimumChargeCents
 * 
 * Without base pricing, the tree cannot be used for quotes/orders.
 */
export function validateTreeHasBasePrice(tree: unknown): ValidationResult {
  const findings: Finding[] = [];

  const t = asRecord(tree);
  if (!t) {
    return toResult([
      errorFinding({
        code: "PBV2_E_TREE_INVALID",
        message: "Tree must be an object",
        path: "tree",
      }),
    ]);
  }

  const meta = asRecord(t.meta);
  if (!meta) {
    return toResult([
      errorFinding({
        code: "PBV2_E_BASE_PRICE_MISSING",
        message: "Tree metadata is missing. Cannot validate base pricing.",
        path: "tree.meta",
      }),
    ]);
  }

  if (meta.pricingProfileKey === "fee" && hasFlatFeeFormula(meta)) {
    return toResult([]);
  }
  if (meta.pricingProfileKey === "hourly" && hasHourlyFormula(meta)) {
    return toResult([]);
  }

  const pricingV2 = asRecord((meta as any).pricingV2);
  if (!pricingV2) {
    return toResult([
      errorFinding({
        code: "PBV2_E_BASE_PRICE_MISSING",
        message: "Base pricing (meta.pricingV2) must be configured before activation. Set at least one of: perSqftCents, perPieceCents, or minimumChargeCents.",
        path: "tree.meta.pricingV2",
      }),
    ]);
  }

  const base = asRecord((pricingV2 as any).base);
  const perSqftCents = typeof base?.perSqftCents === "number" ? base.perSqftCents : 0;
  const perPieceCents = typeof base?.perPieceCents === "number" ? base.perPieceCents : 0;
  const minimumChargeCents = typeof base?.minimumChargeCents === "number" ? base.minimumChargeCents : 0;
  const hasScalarBasePrice = perSqftCents > 0 || perPieceCents > 0 || minimumChargeCents > 0;
  const matrixBasePriceRows = matrixBasePriceRowCount(t, meta);
  const matrixQuantityTierRows = matrixQuantityTierRowCount(t, meta);
  // `qty_only` is a profile default, not a mandate to invent tiers. A selected
  // matrix row with a direct base_price (or its own tiers) is already a complete
  // pricing source. This also safely reads imported legacy profile metadata.
  const quantityOnlyTierPricing = meta.pricingProfileKey === "qty_only"
    && !hasScalarBasePrice
    && matrixBasePriceRows === 0
    && matrixQuantityTierRows === 0;
  if (quantityOnlyTierPricing) return validateQuantityOnlyPerPieceTierFamily(pricingV2);

  if (!base) {
    return toResult([
      errorFinding({
        code: "PBV2_E_BASE_PRICE_MISSING",
        message: "Base pricing (meta.pricingV2.base) must be configured before activation. Set at least one of: perSqftCents, perPieceCents, or minimumChargeCents.",
        path: "tree.meta.pricingV2.base",
      }),
    ]);
  }

  // Check if at least ONE pricing field is non-zero.
  const quantityTierRates = Array.isArray((pricingV2 as any).qtyTiers)
    ? (pricingV2 as any).qtyTiers.filter((tier: unknown) => {
      const value = asRecord(tier)?.perPieceCents;
      return typeof value === "number" && Number.isFinite(value) && value > 0;
    })
    : [];
  const hasProductQuantityTierRates = quantityTierRates.length > 0;

  if (!hasScalarBasePrice && !hasProductQuantityTierRates && matrixBasePriceRows === 0 && matrixQuantityTierRows === 0) {
    findings.push(
      errorFinding({
        code: "PBV2_E_BASE_PRICE_MISSING",
        message: "Base pricing requires at least one non-zero value: perSqftCents, perPieceCents, or minimumChargeCents.",
        path: "tree.meta.pricingV2.base",
        context: {
          perSqftCents,
          perPieceCents,
          minimumChargeCents,
          quantityTierRateCount: quantityTierRates.length,
          matrixBasePriceRowCount: matrixBasePriceRows,
        },
      })
    );
  }

  // If neither a product-level scalar nor product-level tiers can price every
  // selection, every matrix row must carry its own direct price or tier family.
  // This prevents a mixed matrix from being publishable just because some other
  // row happens to have a base_price.
  if (!hasScalarBasePrice && !hasProductQuantityTierRates && matrixRows(t, meta).length > 0) {
    const missingRowIndex = matrixRows(t, meta).findIndex((row) => !matrixRowHasDirectBasePrice(row) && !matrixRowHasQuantityTiers(row));
    if (missingRowIndex >= 0) {
      findings.push(
        errorFinding({
          code: "PBV2_E_PRICING_MATRIX_ROW_PRICE_MISSING",
          message: "Each pricing matrix row requires a direct base_price or quantity tiers when no product-level price source is configured.",
          path: `tree.pricingMatrix.rows[${missingRowIndex}]`,
        })
      );
    }
  }

  return toResult(findings);
}
