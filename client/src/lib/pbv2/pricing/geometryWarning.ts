import { evaluate } from "mathjs";

export function detectsManualGeometryRebuild(formula: string, trimActive: boolean): boolean {
  if (!trimActive) return false;
  const source = String(formula || "");
  if (!source.trim()) return false;

  if (/\bordered_width\b|\bordered_height\b/i.test(source)) return true;
  if (/\bwidth\b\s*\*\s*\bheight\b|\bheight\b\s*\*\s*\bwidth\b/i.test(source)) return true;
  if (/\/\s*144\b/i.test(source)) return true;

  return false;
}

type FormulaAppliedAs = "unitPrice" | "totalPrice" | "unknown" | undefined;

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function evaluateNumber(formula: string, scope: Record<string, unknown>): number | null {
  try {
    const result = evaluate(formula, scope);
    return toFiniteNumber(result);
  } catch {
    return null;
  }
}

function normalizeToTotalPrice(value: number | null, appliedAs: FormulaAppliedAs, quantity: number): number | null {
  if (value == null) return null;
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  if (appliedAs === "unitPrice") return value * safeQuantity;
  return value;
}

export function compareCanonicalGeometryPricing(
  formula: string,
  scope: Record<string, unknown>,
  appliedAs: FormulaAppliedAs,
  quantity: number,
): { formulaPrice: number | null; canonicalPrice: number | null; relativeDifference: number | null } {
  const formulaPriceRaw = evaluateNumber(formula, scope);
  const formulaPrice = normalizeToTotalPrice(formulaPriceRaw, appliedAs, quantity);

  const canonicalScope: Record<string, unknown> = { ...scope };
  const finishedWidth = toFiniteNumber(scope.finished_width) ?? toFiniteNumber(scope.fw);
  const finishedHeight = toFiniteNumber(scope.finished_height) ?? toFiniteNumber(scope.fh);

  if (finishedWidth != null) {
    canonicalScope.width = finishedWidth;
    canonicalScope.ordered_width = finishedWidth;
    canonicalScope.w = finishedWidth;
  }
  if (finishedHeight != null) {
    canonicalScope.height = finishedHeight;
    canonicalScope.ordered_height = finishedHeight;
    canonicalScope.h = finishedHeight;
  }

  const canonicalPriceRaw = evaluateNumber(formula, canonicalScope);
  const canonicalPrice = normalizeToTotalPrice(canonicalPriceRaw, appliedAs, quantity);

  if (formulaPrice == null || canonicalPrice == null) {
    return { formulaPrice, canonicalPrice, relativeDifference: null };
  }

  const denominator = Math.max(Math.abs(canonicalPrice), 1e-9);
  const relativeDifference = Math.abs(formulaPrice - canonicalPrice) / denominator;
  return { formulaPrice, canonicalPrice, relativeDifference };
}
