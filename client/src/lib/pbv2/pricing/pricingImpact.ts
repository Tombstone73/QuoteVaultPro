/**
 * Pure helpers for editing choice-level Pricing Impacts in the PBV2 builder.
 *
 * These are TEMP/editor-only: they shape values the user is actively editing.
 * They never persist anything and never auto-repair stored product data — the
 * draft is only written through the normal builder save flow.
 */

import { currencyInputToCents } from "../currency";

/** Choice-level pricing impact modes supported by the option choice editor. */
export type ChoiceImpactMode = "addCents" | "addPercent" | "addPerUnit";

export const CHOICE_IMPACT_MODES: ChoiceImpactMode[] = ["addCents", "addPercent", "addPerUnit"];

/**
 * Result of interpreting a money input's current draft string.
 * - `empty`   — the field is blank; the caller decides how to settle it
 *               (the PBV2 builder settles a blank amount to 0 on blur).
 * - `partial` — mid-edit / unparseable (e.g. "-", "1.2.3"); do not write.
 * - `valid`   — a finite cents value ready to store.
 */
export type MoneyCommit =
  | { status: "empty" }
  | { status: "partial" }
  | { status: "valid"; cents: number };

/**
 * Interpret a raw money input string (dollars) into a commit decision (cents).
 * Blank stays blank — it is never silently coerced to 0 while typing — and
 * unparseable input is reported as `partial` so no NaN/garbage is written.
 */
export function parseMoneyInputDraft(raw: string): MoneyCommit {
  if (typeof raw !== "string" || raw.trim() === "") return { status: "empty" };
  const cents = currencyInputToCents(raw);
  if (cents === undefined || !Number.isFinite(cents)) return { status: "partial" };
  return { status: "valid", cents };
}

/** The canonical cents amount field for a given choice-level impact mode. */
export function canonicalAmountField(mode: string): "cents" | "centsPerUnit" | null {
  if (mode === "addPerUnit") return "centsPerUnit";
  if (mode === "addCents") return "cents";
  return null;
}

function readAmountCents(impact: any): number | null {
  if (typeof impact?.cents === "number" && Number.isFinite(impact.cents)) return impact.cents;
  if (typeof impact?.centsPerUnit === "number" && Number.isFinite(impact.centsPerUnit)) {
    return impact.centsPerUnit;
  }
  return null;
}

/**
 * Re-shape a pricing impact when its Type changes.
 *
 * - Preserves the cents amount across compatible modes (addCents <-> addPerUnit).
 * - Initializes the required field(s) for the selected mode, so a type change
 *   never leaves a saved impact missing its canonical numeric/unit field.
 * - Drops fields that do not belong to the selected mode to avoid ambiguity.
 *
 * Pure: returns a new object, never mutates the input.
 */
export function normalizePricingImpactForMode(impact: any, newMode: string): any {
  const source = impact && typeof impact === "object" ? impact : {};
  const prevAmountCents = readAmountCents(source);

  const next: any = { ...source, mode: newMode };
  delete next.cents;
  delete next.centsPerUnit;
  delete next.percent;
  delete next.basis;
  delete next.unit;

  if (newMode === "addPerUnit") {
    next.centsPerUnit = prevAmountCents ?? 0;
    next.unit =
      typeof source.unit === "string" && source.unit.trim() !== "" ? source.unit : "perPiece";
  } else if (newMode === "addPercent") {
    next.percent =
      typeof source.percent === "number" && Number.isFinite(source.percent) ? source.percent : 0;
    next.basis =
      typeof source.basis === "string" && source.basis.trim() !== "" ? source.basis : "base";
  } else {
    // addCents (and any unknown mode falls back to a flat-cents shape).
    next.cents = prevAmountCents ?? 0;
  }
  return next;
}

export interface PricingImpactWarnings {
  /** Amount field is missing/invalid. */
  amount?: string;
  /** Unit field is missing (unit-based impacts only). */
  unit?: string;
  /** Mode is missing or not a recognized pricing type. */
  type?: string;
}

/**
 * Inspect a single choice-level pricing impact and return user-facing warnings
 * for any incomplete required fields. Empty object => the impact is valid.
 */
export function getPricingImpactWarnings(impact: any): PricingImpactWarnings {
  const warnings: PricingImpactWarnings = {};
  const mode = impact?.mode;

  if (typeof mode !== "string" || !CHOICE_IMPACT_MODES.includes(mode as ChoiceImpactMode)) {
    warnings.type = "Choose a valid pricing type.";
    return warnings;
  }

  if (mode === "addPercent") {
    if (typeof impact?.percent !== "number" || !Number.isFinite(impact.percent)) {
      warnings.amount = "Enter an amount.";
    }
    return warnings;
  }

  const amountField = mode === "addPerUnit" ? "centsPerUnit" : "cents";
  const amount = impact?.[amountField];
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    warnings.amount = "Enter an amount.";
  }

  if (mode === "addPerUnit") {
    if (typeof impact?.unit !== "string" || impact.unit.trim() === "") {
      warnings.unit = "Choose a unit.";
    }
  }

  return warnings;
}

/** True when the impact has at least one incomplete/invalid field. */
export function hasPricingImpactWarnings(warnings: PricingImpactWarnings): boolean {
  return Boolean(warnings.amount || warnings.unit || warnings.type);
}
