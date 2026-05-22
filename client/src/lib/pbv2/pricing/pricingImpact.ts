/**
 * Pure helpers for editing PBV2 pricing impacts.
 *
 * These are TEMP/editor-only: they shape values the user is actively editing.
 * They do not persist by themselves; persistence only happens through the
 * normal builder save flow.
 */

import { currencyInputToCents } from "../currency";

/** Choice-level pricing impact modes supported by the option choice editor. */
export type ChoiceImpactMode = "addCents" | "addPercent" | "addPerUnit";
export type NodePricingImpactMode = "addFlat" | "addPerQty" | "addPerSqft" | "addFormula";
export type PricingImpactMode =
  | ChoiceImpactMode
  | NodePricingImpactMode
  | "percentOfBase"
  | "multiplier";
export type PerUnitPricingImpactUnit =
  | "perPiece"
  | "perQty"
  | "perSqft"
  | "perLinearFoot"
  | "perInch";

export type NormalizePricingImpactOptions = {
  /**
   * Formula impacts are schema-valid only when formula is non-empty. During
   * text editing, though, the draft must be allowed to become blank so the
   * input does not keep injecting the fallback "0" while the user types.
   */
  settleBlankFormula?: boolean;
};

export const CHOICE_IMPACT_MODES: ChoiceImpactMode[] = ["addCents", "addPercent", "addPerUnit"];

const PER_UNIT_UNITS = new Set<PerUnitPricingImpactUnit>([
  "perPiece",
  "perQty",
  "perSqft",
  "perLinearFoot",
  "perInch",
]);

/**
 * Result of interpreting a money input's current draft string.
 * - `empty`   - the field is blank; the caller decides how to settle it
 *               (the PBV2 builder settles a blank amount to 0 on blur).
 * - `partial` - mid-edit / unparseable (e.g. "-", "1.2.3"); do not write.
 * - `valid`   - a finite cents value ready to store.
 */
export type MoneyCommit =
  | { status: "empty" }
  | { status: "partial" }
  | { status: "valid"; cents: number };

/**
 * Interpret a raw money input string (dollars) into a commit decision (cents).
 * Blank stays blank and unparseable input is reported as `partial`, so no
 * NaN/garbage is written while the user types.
 */
export function parseMoneyInputDraft(raw: string): MoneyCommit {
  if (typeof raw !== "string" || raw.trim() === "") return { status: "empty" };
  const cents = currencyInputToCents(raw);
  if (cents === undefined || !Number.isFinite(cents)) return { status: "partial" };
  return { status: "valid", cents };
}

/** The canonical cents amount field for a given impact mode. */
export function canonicalAmountField(
  mode: string,
): "cents" | "amountCents" | "centsPerUnit" | null {
  if (mode === "addPerUnit") return "centsPerUnit";
  if (mode === "addCents") return "cents";
  if (mode === "addFlat" || mode === "addPerQty" || mode === "addPerSqft") return "amountCents";
  return null;
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeRoundedCents(value: unknown, fallback = 0): number {
  return Math.round(safeNumber(value, fallback));
}

function safePerUnitUnit(value: unknown): PerUnitPricingImpactUnit {
  return typeof value === "string" && PER_UNIT_UNITS.has(value as PerUnitPricingImpactUnit)
    ? (value as PerUnitPricingImpactUnit)
    : "perPiece";
}

function readAmountCents(impact: any): number | null {
  if (typeof impact?.cents === "number" && Number.isFinite(impact.cents)) return impact.cents;
  if (typeof impact?.amountCents === "number" && Number.isFinite(impact.amountCents)) {
    return impact.amountCents;
  }
  if (typeof impact?.centsPerUnit === "number" && Number.isFinite(impact.centsPerUnit)) {
    return impact.centsPerUnit;
  }
  return null;
}

function normalizeMode(mode: unknown): string {
  if (typeof mode !== "string") return "addCents";
  switch (mode) {
    case "addFlatCents":
      return "addFlat";
    case "addPerQtyCents":
      return "addPerQty";
    case "addPerSqftCents":
      return "addPerSqft";
    default:
      return mode;
  }
}

/**
 * Convert known legacy editor shapes into the PBV2 schema shape.
 *
 * Known legacy modes are repaired, required numeric fields are initialized to
 * finite numbers, and unknown modes are preserved so validation can still report
 * them clearly.
 */
export function normalizeLegacyPricingImpact(
  impact: any,
  fallbackMode = "addCents",
  options: NormalizePricingImpactOptions = {},
): any {
  const source = impact && typeof impact === "object" ? impact : {};
  const mode = normalizeMode(source.mode ?? fallbackMode);
  const amount = readAmountCents(source) ?? 0;
  const settleBlankFormula = options.settleBlankFormula ?? true;
  const common = {
    ...(source.applyWhen !== undefined ? { applyWhen: source.applyWhen } : {}),
    ...(typeof source.label === "string" ? { label: source.label } : {}),
  };

  switch (mode) {
    case "addCents":
      return { ...common, mode, cents: safeRoundedCents(amount) };
    case "addFlat":
    case "addPerQty":
    case "addPerSqft":
      return { ...common, mode, amountCents: safeRoundedCents(amount) };
    case "addPerUnit":
      return {
        ...common,
        mode,
        centsPerUnit: safeRoundedCents(source.centsPerUnit ?? amount),
        unit: safePerUnitUnit(source.unit),
      };
    case "addFormula":
      const formula = typeof source.formula === "string" ? source.formula : "";
      return {
        ...common,
        mode,
        formula: formula.trim() ? formula : settleBlankFormula ? "0" : formula,
      };
    case "addPercent":
      return {
        ...common,
        mode,
        percent: safeNumber(source.percent),
        basis: typeof source.basis === "string" && source.basis.trim() !== "" ? source.basis : "base",
      };
    case "percentOfBase":
      return { ...common, mode, percent: safeNumber(source.percent) };
    case "multiplier":
      return { ...common, mode, factor: safeNumber(source.factor, 1) };
    default:
      return { ...source, mode };
  }
}

export function normalizePricingImpactList(impacts: unknown, fallbackMode = "addCents"): any[] {
  if (!Array.isArray(impacts)) return [];
  return impacts.map((impact) => normalizeLegacyPricingImpact(impact, fallbackMode));
}

export function normalizeTreePricingImpacts(treeJson: unknown): { tree: any; changed: boolean } {
  if (!treeJson || typeof treeJson !== "object") return { tree: treeJson, changed: false };
  const tree: any = treeJson;
  const rawNodes = tree.nodes;
  const nodeEntries = Array.isArray(rawNodes)
    ? rawNodes.map((node, index) => [index, node] as const)
    : rawNodes && typeof rawNodes === "object"
      ? Object.entries(rawNodes)
      : [];

  let changed = false;

  const normalizeNode = (node: any) => {
    if (!node || typeof node !== "object") return node;
    let nextNode = node;

    if (Array.isArray(node.pricingImpact)) {
      const nextPricing = normalizePricingImpactList(node.pricingImpact, "addFlat");
      if (JSON.stringify(nextPricing) !== JSON.stringify(node.pricingImpact)) {
        nextNode = { ...nextNode, pricingImpact: nextPricing };
        changed = true;
      }
    }

    if (Array.isArray(node.choices)) {
      let choicesChanged = false;
      const nextChoices = node.choices.map((choice: any) => {
        if (!choice || typeof choice !== "object" || !Array.isArray(choice.pricingImpact)) return choice;
        const nextPricing = normalizePricingImpactList(choice.pricingImpact, "addCents");
        if (JSON.stringify(nextPricing) === JSON.stringify(choice.pricingImpact)) return choice;
        choicesChanged = true;
        changed = true;
        return { ...choice, pricingImpact: nextPricing };
      });
      if (choicesChanged) nextNode = { ...nextNode, choices: nextChoices };
    }

    return nextNode;
  };

  if (Array.isArray(rawNodes)) {
    const nextNodes = rawNodes.map(normalizeNode);
    return changed ? { tree: { ...tree, nodes: nextNodes }, changed } : { tree, changed };
  }

  if (rawNodes && typeof rawNodes === "object") {
    const nextNodes: Record<string, any> = { ...rawNodes };
    for (const [key, node] of nodeEntries) {
      nextNodes[String(key)] = normalizeNode(node);
    }
    return changed ? { tree: { ...tree, nodes: nextNodes }, changed } : { tree, changed };
  }

  return { tree, changed };
}

/**
 * Re-shape a pricing impact when its Type changes.
 *
 * Preserves compatible amounts, initializes required fields, and drops fields
 * that do not belong to the selected mode.
 */
export function normalizePricingImpactForMode(impact: any, newMode: string): any {
  const source = impact && typeof impact === "object" ? impact : {};
  const prevAmountCents = readAmountCents(source);
  const mode = normalizeMode(newMode);

  const next: any = { ...source, mode };
  delete next.cents;
  delete next.amountCents;
  delete next.centsPerUnit;
  delete next.percent;
  delete next.basis;
  delete next.unit;
  delete next.formula;

  if (mode === "addPerUnit") {
    next.centsPerUnit = prevAmountCents ?? 0;
    next.unit = safePerUnitUnit(source.unit);
  } else if (mode === "addPercent") {
    next.percent = safeNumber(source.percent);
    next.basis =
      typeof source.basis === "string" && source.basis.trim() !== "" ? source.basis : "base";
  } else if (mode === "addFlat" || mode === "addPerQty" || mode === "addPerSqft") {
    next.amountCents = prevAmountCents ?? 0;
  } else if (mode === "addFormula") {
    next.formula = typeof source.formula === "string" && source.formula.trim() ? source.formula : "";
  } else {
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
