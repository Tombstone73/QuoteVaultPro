import type { PricingImpact } from "@shared/optionTreeV2";

export type PricingDisplayUnit = "each" | "per_qty" | "per_sqft" | "per_sqin" | "percent" | "multiplier";

export type UiPricingImpact = {
  mode: "none" | PricingImpact["mode"];
  // For unit=percent, this stores the percent value.
  // For unit=multiplier, this stores the factor value.
  // Otherwise, cents.
  amountCents: number;
  displayUnit: PricingDisplayUnit;
  // Not representable in current schema; returned as default `true`.
  taxable: boolean;
};

export function decodePricingImpact(schemaImpact?: PricingImpact | null): UiPricingImpact {
  if (!schemaImpact) {
    return { mode: "none", amountCents: 0, displayUnit: "each", taxable: true };
  }

  switch (schemaImpact.mode) {
    case "addFlat":
      return { mode: "addFlat", amountCents: schemaImpact.amountCents, displayUnit: "each", taxable: true };
    case "addPerQty":
      return { mode: "addPerQty", amountCents: schemaImpact.amountCents, displayUnit: "per_qty", taxable: true };
    case "addPerSqft":
      // NOTE: per_sqin is not safely persistable without schema support for UI metadata.
      // We always decode as per_sqft.
      return { mode: "addPerSqft", amountCents: schemaImpact.amountCents, displayUnit: "per_sqft", taxable: true };
    case "percentOfBase":
      return { mode: "percentOfBase", amountCents: schemaImpact.percent, displayUnit: "percent", taxable: true };
    case "multiplier":
      return { mode: "multiplier", amountCents: schemaImpact.factor, displayUnit: "multiplier", taxable: true };
    default: {
      const _exhaustive: never = schemaImpact;
      return { mode: "none", amountCents: 0, displayUnit: "each", taxable: true };
    }
  }
}

export function encodePricingImpact(uiImpact: UiPricingImpact): PricingImpact | null {
  const unit = uiImpact.displayUnit;
  const value = Number(uiImpact.amountCents);
  const normalized = Number.isFinite(value) ? value : 0;

  // If the UI is set to none, remove pricing.
  if (uiImpact.mode === "none") return null;

  // Map by display unit; this keeps the UI contract stable and avoids fake reload detection.
  switch (unit) {
    case "each":
      return { mode: "addFlat", amountCents: Math.round(normalized) };
    case "per_qty":
      return { mode: "addPerQty", amountCents: Math.round(normalized) };
    case "per_sqft":
      return { mode: "addPerSqft", amountCents: Math.round(normalized) };
    case "percent":
      return { mode: "percentOfBase", percent: normalized };
    case "multiplier":
      return { mode: "multiplier", factor: normalized };
    case "per_sqin":
      // Not safely supported today (no schema field to round-trip the UI unit).
      // Persist as per_sqft and accept that reload shows per_sqft.
      return { mode: "addPerSqft", amountCents: Math.round(normalized) * 144 };
    default: {
      const _exhaustive: never = unit;
      return null;
    }
  }
}
