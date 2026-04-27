/**
 * csvImportUtils.ts
 *
 * Shared CSV import helpers extracted from server/routes.ts (Import Job Helpers section).
 * Used by server/routes/customers.routes.ts and server/routes/importJobs.routes.ts.
 *
 * Placement: server/utils/csvImportUtils.ts
 */

import Papa from "papaparse";

// =============================
// Import Job Helpers
// =============================
export type ImportApplyMode = "MERGE_RESPECT_OVERRIDES" | "MERGE_AND_SET_OVERRIDES";

export const parseCsvOrThrow = (csvData: unknown) => {
  if (!csvData || typeof csvData !== "string") {
    throw Object.assign(new Error("CSV data is required"), { statusCode: 400 });
  }

  const parseResult = Papa.parse(csvData, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  });

  if (parseResult.errors.length > 0) {
    const err = Object.assign(new Error("CSV parsing failed"), { statusCode: 400, errors: parseResult.errors });
    throw err;
  }

  const rows = parseResult.data as Record<string, string>[];
  if (!rows || rows.length === 0) {
    throw Object.assign(new Error("CSV must contain at least one data row"), { statusCode: 400 });
  }

  return rows;
};

export const parseBool = (v: unknown) => {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "") return undefined;
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return undefined;
};

export const parseNum = (v: unknown) => {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export const parseTaxRateOverride = (v: unknown) => {
  const n = parseNum(v);
  if (n == null) return undefined;
  // Allow 8.25 to mean 8.25%
  if (n > 1) return n / 100;
  return n;
};

export const pickOverrideFiltered = (existing: any, patch: any) => {
  const overrides: Record<string, boolean> = (existing?.qbFieldOverrides as any) || {};
  const result: any = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) continue;
    if (overrides[k]) continue;
    result[k] = v;
  }
  return result;
};

export const buildOverridePatch = (incoming: any) => {
  const next: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(incoming || {})) {
    if (v === undefined || v === null) continue;
    // If caller sent empty strings for text fields, treat as not provided.
    if (typeof v === "string" && v.trim() === "") continue;
    next[k] = true;
  }
  return next;
};
