/**
 * Pure planning for the one-time legacy Formula freeze.  Persistence callers
 * supply all candidate evidence; this module deliberately has no database or
 * resolver dependency and never performs a binding or a Formula write.
 */
export type LegacyFormulaSource =
  | "formula_revision_binding"
  | "legacy_formula_library"
  | "embedded_product_version"
  | "legacy_product_formula";

export type LegacyFormulaEvidence = Readonly<{
  source: LegacyFormulaSource;
  expression?: string | null;
  formulaId?: string | null;
  formulaRevisionId?: string | null;
  declaredInputs?: unknown;
  inputValues?: unknown;
}>;

export type LegacyFormulaFreezeCandidate = Readonly<{
  organizationId: string;
  productId: string;
  productVersionId: string;
  lifecycle: "ACTIVE" | "DEPRECATED" | "DRAFT";
  evidence: readonly LegacyFormulaEvidence[];
}>;

export type LegacyFormulaFreezePlan = Readonly<{
  organizationId: string;
  productId: string;
  productVersionId: string;
  lifecycle: LegacyFormulaFreezeCandidate["lifecycle"];
  disposition: "already_frozen" | "bind_existing_revision" | "create_revision_and_bind" | "ambiguous" | "not_formula_backed";
  currentSource?: LegacyFormulaSource;
  expression?: string;
  candidateFormulaId?: string;
  candidateFormulaRevisionId?: string;
  declaredInputEvidence?: unknown;
  inputValueEvidence?: unknown;
  compatibilityBindingRequired: boolean;
  conflicts: readonly string[];
}>;

const precedence: readonly LegacyFormulaSource[] = [
  "formula_revision_binding",
  "legacy_formula_library",
  "embedded_product_version",
  "legacy_product_formula",
];

const cleanExpression = (value: string | null | undefined): string | undefined => {
  const expression = value?.trim();
  return expression ? expression : undefined;
};

const sourceEvidence = (candidate: LegacyFormulaFreezeCandidate, source: LegacyFormulaSource): LegacyFormulaEvidence[] =>
  candidate.evidence.filter((item) => item.source === source);

/**
 * Selects only established compatibility precedence.  If a source is
 * internally contradictory or lacks an exact expression, the caller receives
 * an ambiguity instead of an inferred backfill target.
 */
export const planLegacyFormulaFreeze = (candidate: LegacyFormulaFreezeCandidate): LegacyFormulaFreezePlan => {
  const conflicts: string[] = [];
  for (const source of precedence) {
    const entries = sourceEvidence(candidate, source);
    if (!entries.length) continue;

    const expressions = [...new Set(entries.map((entry) => cleanExpression(entry.expression)).filter((value): value is string => Boolean(value)))];
    if (expressions.length !== 1) {
      conflicts.push(`${source} has ${expressions.length === 0 ? "no usable" : "conflicting"} Formula expression evidence.`);
      return {
        organizationId: candidate.organizationId,
        productId: candidate.productId,
        productVersionId: candidate.productVersionId,
        lifecycle: candidate.lifecycle,
        disposition: "ambiguous",
        compatibilityBindingRequired: false,
        conflicts,
      };
    }

    const formulaIds = [...new Set(entries.map((entry) => entry.formulaId?.trim()).filter((value): value is string => Boolean(value)))];
    const revisionIds = [...new Set(entries.map((entry) => entry.formulaRevisionId?.trim()).filter((value): value is string => Boolean(value)))];
    if (formulaIds.length > 1 || revisionIds.length > 1) {
      conflicts.push(`${source} has conflicting Formula identity or revision evidence.`);
      return {
        organizationId: candidate.organizationId,
        productId: candidate.productId,
        productVersionId: candidate.productVersionId,
        lifecycle: candidate.lifecycle,
        disposition: "ambiguous",
        compatibilityBindingRequired: false,
        conflicts,
      };
    }

    const selected = entries[0]!;
    const common = {
      organizationId: candidate.organizationId,
      productId: candidate.productId,
      productVersionId: candidate.productVersionId,
      lifecycle: candidate.lifecycle,
      currentSource: source,
      expression: expressions[0]!,
      ...(formulaIds[0] ? { candidateFormulaId: formulaIds[0] } : {}),
      ...(revisionIds[0] ? { candidateFormulaRevisionId: revisionIds[0] } : {}),
      ...(selected.declaredInputs === undefined ? {} : { declaredInputEvidence: selected.declaredInputs }),
      ...(selected.inputValues === undefined ? {} : { inputValueEvidence: selected.inputValues }),
      conflicts,
    } as const;

    if (source === "formula_revision_binding") {
      if (!revisionIds[0] || !formulaIds[0]) {
        return { ...common, disposition: "ambiguous", compatibilityBindingRequired: false, conflicts: [...conflicts, "Canonical binding is missing Formula identity or revision."] };
      }
      return { ...common, disposition: "already_frozen", compatibilityBindingRequired: false };
    }

    if (source === "legacy_formula_library" && formulaIds[0]) {
      return { ...common, disposition: revisionIds[0] ? "bind_existing_revision" : "create_revision_and_bind", compatibilityBindingRequired: true };
    }

    return { ...common, disposition: "create_revision_and_bind", compatibilityBindingRequired: true };
  }

  return {
    organizationId: candidate.organizationId,
    productId: candidate.productId,
    productVersionId: candidate.productVersionId,
    lifecycle: candidate.lifecycle,
    disposition: "not_formula_backed",
    compatibilityBindingRequired: false,
    conflicts,
  };
};

export const planLegacyFormulaFreezeInventory = (candidates: readonly LegacyFormulaFreezeCandidate[]): readonly LegacyFormulaFreezePlan[] =>
  candidates.map(planLegacyFormulaFreeze);
