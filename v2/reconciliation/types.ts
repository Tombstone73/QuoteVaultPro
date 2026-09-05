/** Declarative contract for a forward-only, pre-Drizzle reconciliation stage. */
export type ReconciliationPostcondition = {
  kind: "table" | "column" | "constraint" | "index" | "function" | "trigger" | "query";
  name: string;
  table?: string;
  /** Required column name for a `column` catalog postcondition. */
  column?: string;
  /** Optional scalar assertion or catalog query used by the executor. */
  sql?: string;
  /** Human-readable expected catalog shape for audit reports. */
  expected?: string;
  /** Human-readable reason a postcondition matters. */
  description?: string;
  /** Alternate query spelling retained for declarative stage modules. */
  query?: string;
};

export type ReconciliationStageDefinition = {
  id: string;
  label: string;
  /**
   * Immutable historical source files whose physical objects are recreated
   * under the reconciliation executor. This never authorizes journal writes.
   */
  migrationFiles: readonly string[];
  postconditions: readonly ReconciliationPostcondition[];
  /** Explicit rule for legacy rows: never infer business facts from V1. */
  legacyDataPolicy: string;
};
