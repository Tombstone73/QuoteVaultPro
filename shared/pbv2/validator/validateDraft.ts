import { validateTreeForPublish } from "./validatePublish";
import type { ProductOptionTreeV2Json, ValidateOpts, ValidationResult } from "./types";
import { errorFinding, warningFinding } from "../findings";

/**
 * Draft-friendly validation for PBV2 trees during editing.
 * 
 * This validator is LESS STRICT than validateTreeForPublish:
 * - Allows empty rootNodeIds (will be populated as options are added)
 * - Allows missing selectionKey (will be added on save)
 * - Allows DRAFT status errors (only for publish)
 * - Still validates structural integrity (cycles, missing nodes, etc.)
 * 
 * Use this during editing, switch to validateTreeForPublish only on publish attempt.
 */
export function validateTreeForDraft(tree: ProductOptionTreeV2Json, opts: ValidateOpts): ValidationResult {
  // Run full publish validation first
  const fullResult = validateTreeForPublish(tree, opts);

  // Filter out draft-acceptable errors
  const draftAcceptableErrors = new Set([
    "PBV2_E_TREE_NO_ROOTS",           // OK during draft - roots added as options are added
    "PBV2_E_TREE_STATUS_INVALID",     // OK during draft - status check is publish-only
    "PBV2_E_INPUT_MISSING_SELECTION_KEY",  // OK during draft - added on save
  ]);

  // Convert some errors to warnings for draft mode
  const adjustedFindings = fullResult.findings.map(f => {
    if (f.severity === "ERROR" && draftAcceptableErrors.has(f.code)) {
      // Downgrade to info - these will be fixed automatically or checked at publish time
      return {
        ...f,
        severity: "INFO" as const,
        message: `[Draft Mode] ${f.message}`,
      };
    }
    return f;
  });

  // Re-categorize
  const sorted = [...adjustedFindings].sort((a, b) => {
    if (a.severity !== b.severity) {
      const order = { ERROR: 0, WARNING: 1, INFO: 2 };
      return order[a.severity] - order[b.severity];
    }
    return a.code.localeCompare(b.code);
  });

  const errors = sorted.filter(f => f.severity === "ERROR");
  const warnings = sorted.filter(f => f.severity === "WARNING");
  const info = sorted.filter(f => f.severity === "INFO");

  return {
    ok: errors.length === 0,
    findings: sorted,
    errors,
    warnings,
    info,
  };
}
