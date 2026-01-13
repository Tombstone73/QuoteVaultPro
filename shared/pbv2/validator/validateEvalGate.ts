import { errorFinding, warningFinding, type Finding } from "../findings";
import type { ValidationResult } from "./types";

function sortFindings(findings: Finding[]): Finding[] {
  const sevRank = (s: string): number => (s === "ERROR" ? 0 : s === "WARNING" ? 1 : 2);
  return findings
    .slice()
    .sort((a, b) => {
      const sa = sevRank(a.severity);
      const sb = sevRank(b.severity);
      if (sa !== sb) return sa - sb;
      if (a.code !== b.code) return a.code.localeCompare(b.code);
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      const ea = a.entityId ?? "";
      const eb = b.entityId ?? "";
      if (ea !== eb) return ea.localeCompare(eb);
      return a.message.localeCompare(b.message);
    });
}

function toResult(findings: Finding[]): ValidationResult {
  const sorted = sortFindings(findings);
  const errors = sorted.filter((f) => f.severity === "ERROR");
  const warnings = sorted.filter((f) => f.severity === "WARNING");
  const info = sorted.filter((f) => f.severity === "INFO");
  return { ok: errors.length === 0, findings: sorted, errors, warnings, info };
}

export function validateEvaluationGate(
  treeVersionMeta: { status: string },
  mode: "preview" | "persist"
): ValidationResult {
  const findings: Finding[] = [];

  const statusRaw = treeVersionMeta?.status;
  const status = typeof statusRaw === "string" ? statusRaw.toUpperCase() : "";

  const allowedPersist = new Set(["ACTIVE", "DEPRECATED", "ARCHIVED"]);

  if (mode === "persist") {
    if (!allowedPersist.has(status)) {
      findings.push(
        errorFinding({
          code: "PBV2_E_EVAL_TREE_VERSION_STATUS_INVALID",
          message: "Persisted evaluation requires ACTIVE|DEPRECATED|ARCHIVED tree status",
          path: "treeVersionMeta.status",
          context: { status: statusRaw, mode },
        })
      );
    }
    return toResult(findings);
  }

  // preview
  if (status === "DRAFT") {
    findings.push(
      warningFinding({
        code: "PBV2_E_EVAL_TREE_VERSION_STATUS_INVALID",
        message: "Preview evaluation against DRAFT is allowed but must never be persisted",
        path: "treeVersionMeta.status",
        context: { status: statusRaw, mode },
      })
    );
  }

  return toResult(findings);
}
