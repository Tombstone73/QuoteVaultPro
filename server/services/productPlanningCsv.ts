import Papa from "papaparse";

import {
  productPlanningBusinessValueValues,
  productPlanningComplexityValues,
  productPlanningPhaseValues,
  productPlanningPriorityValues,
  productPlanningStatusValues,
  productPlanningWorkItemTypeValues,
} from "@shared/schema";

type WorkItemType = typeof productPlanningWorkItemTypeValues[number];
type PlanningStatus = typeof productPlanningStatusValues[number];
type Priority = typeof productPlanningPriorityValues[number];
type BusinessValue = typeof productPlanningBusinessValueValues[number];
type Complexity = typeof productPlanningComplexityValues[number];
type Phase = typeof productPlanningPhaseValues[number];

export type ProductPlanningImportMappedRow = {
  rowNumber: number;
  title: string;
  description: string | null;
  workItemType: WorkItemType;
  planningStatus: PlanningStatus;
  priority: Priority;
  businessValue: BusinessValue | null;
  complexity: Complexity | null;
  phase: Phase | null;
  module: string | null;
  submodule: string | null;
  tags: string[];
  sourceReference: string | null;
  requestedBy: string | null;
  releaseTarget: string | null;
  notes: string | null;
  raw: Record<string, string>;
  warnings: string[];
  errors: string[];
};

export type ProductPlanningImportPreview = {
  parsedRows: Array<Record<string, string>>;
  mappedRows: ProductPlanningImportMappedRow[];
  validRows: ProductPlanningImportMappedRow[];
  invalidRows: ProductPlanningImportMappedRow[];
  warnings: Array<{ rowNumber: number; field?: string; message: string }>;
  counts: {
    parsed: number;
    valid: number;
    invalid: number;
    warnings: number;
  };
};

const TYPE_ALIASES: Record<string, WorkItemType> = {
  bug: "bug",
  feature: "feature",
  enhancement: "enhancement",
  epic: "epic",
  task: "task",
  "technical debt": "technical_debt",
  technical_debt: "technical_debt",
  tech_debt: "technical_debt",
  research: "research",
};

const STATUS_ALIASES: Record<string, PlanningStatus> = {
  idea: "idea",
  backlog: "backlog",
  planned: "planned",
  ready: "ready",
  "in progress": "in_progress",
  in_progress: "in_progress",
  testing: "testing",
  "dev validation": "dev_validation",
  dev_validation: "dev_validation",
  "main validation": "main_validation",
  main_validation: "main_validation",
  released: "released",
  archived: "archived",
};

const PRIORITY_ALIASES: Record<string, Priority> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

const BUSINESS_VALUE_ALIASES: Record<string, BusinessValue> = {
  "very high": "very_high",
  very_high: "very_high",
  high: "high",
  medium: "medium",
  low: "low",
};

const COMPLEXITY_ALIASES: Record<string, Complexity> = {
  small: "small",
  medium: "medium",
  large: "large",
  massive: "massive",
};

const PHASE_ALIASES: Record<string, Phase> = {
  "go live": "go_live",
  go_live: "go_live",
  "phase 1": "v1_1",
  "v1.1": "v1_1",
  v1_1: "v1_1",
  "version 1.1": "v1_1",
  "phase 2": "v1_5",
  "v1.5": "v1_5",
  v1_5: "v1_5",
  "version 1.5": "v1_5",
  "phase 3": "v2_0",
  "v2.0": "v2_0",
  v2_0: "v2_0",
  "version 2.0": "v2_0",
  future: "future",
  "r&d": "research",
  research: "research",
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function firstValue(row: Record<string, string>, headers: string[]): string {
  for (const header of headers) {
    const target = normalizeHeader(header);
    const entry = Object.entries(row).find(([key]) => normalizeHeader(key) === target);
    const value = clean(entry?.[1]);
    if (value) return value;
  }
  return "";
}

function normalizeEnum<T extends string>(
  raw: string,
  aliases: Record<string, T>,
  fallback: T | null,
  field: string,
  warnings: string[],
): T | null {
  const value = clean(raw);
  if (!value) return fallback;

  const normalized = value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const direct = aliases[normalized] ?? aliases[value.toLowerCase()] ?? aliases[value.toLowerCase().replace(/\s+/g, "_")];
  if (direct) return direct;

  warnings.push(`Unknown ${field} "${value}" was ignored.`);
  return fallback;
}

function parseTags(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function mapProductPlanningCsvRow(
  rawRow: Record<string, string>,
  rowNumber: number,
): ProductPlanningImportMappedRow {
  const warnings: string[] = [];
  const errors: string[] = [];

  const title = firstValue(rawRow, ["Feature", "Feature Name", "Title"]);
  if (!title) {
    errors.push("Title is required.");
  }

  const dependencies = firstValue(rawRow, ["Dependencies"]);
  const suggestedEpic = firstValue(rawRow, ["Suggested Epic", "Epic"]);
  const notes = firstValue(rawRow, ["Rich Notes", "Notes"]);
  const combinedNotes = [
    notes,
    dependencies ? `Dependencies: ${dependencies}` : "",
    suggestedEpic ? `Suggested Epic: ${suggestedEpic}` : "",
  ].filter(Boolean).join("\n\n") || null;
  const categoryOrModule = firstValue(rawRow, ["Module", "Category"]);

  return {
    rowNumber,
    title,
    description: firstValue(rawRow, ["Rich Description", "Description"]) || null,
    workItemType: normalizeEnum(firstValue(rawRow, ["Type", "Work Item Type"]), TYPE_ALIASES, "feature", "work item type", warnings) ?? "feature",
    planningStatus: normalizeEnum(firstValue(rawRow, ["Planning Status", "Status"]), STATUS_ALIASES, "backlog", "status", warnings) ?? "backlog",
    priority: normalizeEnum(firstValue(rawRow, ["Priority"]), PRIORITY_ALIASES, "medium", "priority", warnings) ?? "medium",
    businessValue: normalizeEnum(firstValue(rawRow, ["Business Value"]), BUSINESS_VALUE_ALIASES, null, "business value", warnings),
    complexity: normalizeEnum(firstValue(rawRow, ["Complexity"]), COMPLEXITY_ALIASES, null, "complexity", warnings),
    phase: normalizeEnum(firstValue(rawRow, ["Phase"]), PHASE_ALIASES, null, "phase", warnings),
    module: categoryOrModule || null,
    submodule: firstValue(rawRow, ["Submodule"]) || null,
    tags: parseTags(firstValue(rawRow, ["Tags"])),
    sourceReference: firstValue(rawRow, ["External ID", "Feature ID", "ID", "Reference"]) || null,
    requestedBy: firstValue(rawRow, ["Requested By"]) || null,
    releaseTarget: firstValue(rawRow, ["Release Target"]) || null,
    notes: combinedNotes,
    raw: rawRow,
    warnings,
    errors,
  };
}

export function parseProductPlanningCsv(csvText: string): ProductPlanningImportPreview {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  const parseErrors = result.errors.map((error) => ({
    rowNumber: (error.row ?? 0) + 2,
    message: error.message,
  }));

  const parsedRows = (result.data ?? []).filter((row) =>
    Object.values(row).some((value) => clean(value)),
  );
  const mappedRows = parsedRows.map((row, index) => mapProductPlanningCsvRow(row, index + 2));

  for (const error of parseErrors) {
    const row = mappedRows.find((candidate) => candidate.rowNumber === error.rowNumber);
    if (row) {
      row.errors.push(error.message);
    }
  }

  const warnings = mappedRows.flatMap((row) =>
    row.warnings.map((message) => ({ rowNumber: row.rowNumber, message })),
  );
  const validRows = mappedRows.filter((row) => row.errors.length === 0);
  const invalidRows = mappedRows.filter((row) => row.errors.length > 0);

  return {
    parsedRows,
    mappedRows,
    validRows,
    invalidRows,
    warnings,
    counts: {
      parsed: mappedRows.length,
      valid: validRows.length,
      invalid: invalidRows.length,
      warnings: warnings.length,
    },
  };
}
