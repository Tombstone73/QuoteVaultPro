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
  if (!base) {
    return toResult([
      errorFinding({
        code: "PBV2_E_BASE_PRICE_MISSING",
        message: "Base pricing (meta.pricingV2.base) must be configured before activation. Set at least one of: perSqftCents, perPieceCents, or minimumChargeCents.",
        path: "tree.meta.pricingV2.base",
      }),
    ]);
  }

  // Check if at least ONE pricing field is non-zero
  const perSqftCents = typeof base.perSqftCents === "number" ? base.perSqftCents : 0;
  const perPieceCents = typeof base.perPieceCents === "number" ? base.perPieceCents : 0;
  const minimumChargeCents = typeof base.minimumChargeCents === "number" ? base.minimumChargeCents : 0;

  if (perSqftCents === 0 && perPieceCents === 0 && minimumChargeCents === 0) {
    findings.push(
      errorFinding({
        code: "PBV2_E_BASE_PRICE_MISSING",
        message: "Base pricing requires at least one non-zero value: perSqftCents, perPieceCents, or minimumChargeCents.",
        path: "tree.meta.pricingV2.base",
        context: {
          perSqftCents,
          perPieceCents,
          minimumChargeCents,
        },
      })
    );
  }

  return toResult(findings);
}
