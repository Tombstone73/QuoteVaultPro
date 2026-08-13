export const PRODUCTION_RUN_SHEET_PROGRESS_VERSION = "production-run-sheet-progress-v1";

export type ProductionRunSheetProgressSheet = {
  id: string;
  label: string;
  fileId?: string | null;
  fileName?: string | null;
  /** One finished output may require multiple file/layer sheets. */
  productionGroupId?: string | null;
  requiredImpressions: number;
  goodImpressions: number;
  damagedImpressions: number;
  recoveryImpressions?: number;
  operatorNote?: string | null;
};

export type ProductionRunSheetProgressSnapshot = {
  version: typeof PRODUCTION_RUN_SHEET_PROGRESS_VERSION;
  source: "operator" | "legacy_plan" | "run_files";
  sheets: ProductionRunSheetProgressSheet[];
  updatedAt?: string | null;
};

export type ProductionRunSheetProgressSummary = {
  sheetCount: number;
  requiredImpressions: number;
  goodImpressions: number;
  damagedImpressions: number;
  remainingGoodImpressions: number;
  complete: boolean;
  /** Finished pieces, counted once per output group rather than once per layer. */
  outputGroupCount: number;
  layeredOutputGroupCount: number;
  requiredFinishedPieces: number;
  goodFinishedPieces: number;
  remainingFinishedPieces: number;
};

type SheetSourceFile = {
  id: string;
  fileName: string;
  productionQuantity?: number | null;
  productionGroupId?: string | null;
  status?: string | null;
};

const positiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const nonNegativeInteger = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
};

function normalizeSheet(sheet: Partial<ProductionRunSheetProgressSheet>, index: number): ProductionRunSheetProgressSheet | null {
  const requiredImpressions = positiveInteger(sheet.requiredImpressions);
  if (!requiredImpressions) return null;
  const id = String(sheet.id || sheet.fileId || `sheet-${index + 1}`).trim();
  return {
    id,
    label: String(sheet.label || `Sheet ${index + 1}`).trim(),
    fileId: sheet.fileId ?? null,
    fileName: sheet.fileName ?? null,
    productionGroupId: sheet.productionGroupId?.trim() || null,
    requiredImpressions,
    goodImpressions: Math.min(nonNegativeInteger(sheet.goodImpressions), requiredImpressions),
    damagedImpressions: nonNegativeInteger(sheet.damagedImpressions),
    recoveryImpressions: nonNegativeInteger(sheet.recoveryImpressions),
    operatorNote: sheet.operatorNote?.trim() || null,
  };
}

export function normalizeProductionRunSheetProgressSnapshot(value: unknown): ProductionRunSheetProgressSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { version?: unknown; source?: unknown; sheets?: unknown; updatedAt?: unknown };
  if (!Array.isArray(record.sheets)) return null;
  const sheets = record.sheets
    .map((sheet, index) => normalizeSheet(sheet as Partial<ProductionRunSheetProgressSheet>, index))
    .filter((sheet): sheet is ProductionRunSheetProgressSheet => Boolean(sheet));
  if (!sheets.length) return null;
  const source = record.source === "operator" || record.source === "run_files" || record.source === "legacy_plan"
    ? record.source
    : "legacy_plan";
  return {
    version: PRODUCTION_RUN_SHEET_PROGRESS_VERSION,
    source,
    sheets,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}

export function buildInitialProductionRunSheetProgressSnapshot(input: {
  existing?: unknown;
  files?: SheetSourceFile[] | null;
  plannedSheetCount?: number | null;
  defaultRequiredImpressions?: number | null;
}): ProductionRunSheetProgressSnapshot | null {
  const existing = normalizeProductionRunSheetProgressSnapshot(input.existing);
  if (existing) return existing;

  const activeFiles = (input.files ?? []).filter((file) => !file.status || file.status === "active");
  if (activeFiles.length) {
    return {
      version: PRODUCTION_RUN_SHEET_PROGRESS_VERSION,
      source: "run_files",
      sheets: activeFiles.map((file, index) => ({
        id: file.id,
        label: activeFiles.length === 1 ? "Sheet 1" : `Sheet ${index + 1}`,
        fileId: file.id,
        fileName: file.fileName,
        productionGroupId: file.productionGroupId?.trim() || null,
        requiredImpressions: positiveInteger(file.productionQuantity) ?? positiveInteger(input.defaultRequiredImpressions) ?? 1,
        goodImpressions: 0,
        damagedImpressions: 0,
        recoveryImpressions: 0,
        operatorNote: null,
      })),
      updatedAt: null,
    };
  }

  const plannedSheetCount = positiveInteger(input.plannedSheetCount);
  if (!plannedSheetCount) return null;
  return {
    version: PRODUCTION_RUN_SHEET_PROGRESS_VERSION,
    source: "legacy_plan",
    sheets: Array.from({ length: plannedSheetCount }, (_, index) => ({
      id: `sheet-${index + 1}`,
      label: `Sheet ${index + 1}`,
      fileId: null,
      fileName: null,
      requiredImpressions: positiveInteger(input.defaultRequiredImpressions) && plannedSheetCount === 1 ? positiveInteger(input.defaultRequiredImpressions)! : 1,
      goodImpressions: 0,
      damagedImpressions: 0,
      recoveryImpressions: 0,
      operatorNote: null,
    })),
    updatedAt: null,
  };
}

export function summarizeProductionRunSheetProgress(snapshot: ProductionRunSheetProgressSnapshot | null | undefined): ProductionRunSheetProgressSummary {
  const sheets = snapshot?.sheets ?? [];
  const requiredImpressions = sheets.reduce((sum, sheet) => sum + sheet.requiredImpressions, 0);
  const goodImpressions = sheets.reduce((sum, sheet) => sum + Math.min(sheet.goodImpressions, sheet.requiredImpressions), 0);
  const damagedImpressions = sheets.reduce((sum, sheet) => sum + sheet.damagedImpressions, 0);
  const outputGroups = new Map<string, ProductionRunSheetProgressSheet[]>();
  for (const sheet of sheets) {
    const groupId = sheet.productionGroupId?.trim() || sheet.id;
    outputGroups.set(groupId, [...(outputGroups.get(groupId) ?? []), sheet]);
  }
  const groupValues = Array.from(outputGroups.values());
  const requiredFinishedPieces = groupValues.reduce((sum, group) => sum + Math.max(...group.map((sheet) => sheet.requiredImpressions)), 0);
  // A multilayer output is finished only when every required layer reaches its
  // shared group quantity. Keep the per-sheet impression totals above intact.
  const goodFinishedPieces = groupValues.reduce((sum, group) => sum + Math.min(...group.map((sheet) => Math.min(sheet.goodImpressions, sheet.requiredImpressions))), 0);
  return {
    sheetCount: sheets.length,
    requiredImpressions,
    goodImpressions,
    damagedImpressions,
    remainingGoodImpressions: Math.max(0, requiredImpressions - goodImpressions),
    complete: requiredImpressions > 0 && goodImpressions >= requiredImpressions,
    outputGroupCount: groupValues.length,
    layeredOutputGroupCount: groupValues.filter((group) => group.length > 1).length,
    requiredFinishedPieces,
    goodFinishedPieces,
    remainingFinishedPieces: Math.max(0, requiredFinishedPieces - goodFinishedPieces),
  };
}

export function distributeProducedPiecesAcrossMembers(input: {
  memberAllocatedQuantities: Array<{ memberId: string; allocatedQuantity: number }>;
  usablePieces: number;
}) {
  let remaining = Math.max(0, Math.floor(input.usablePieces));
  return input.memberAllocatedQuantities.map((member) => {
    const allocatedQuantity = positiveInteger(member.allocatedQuantity) ?? 0;
    const successfulQuantity = Math.min(allocatedQuantity, remaining);
    remaining -= successfulQuantity;
    return {
      memberId: member.memberId,
      successfulQuantity,
      remainingQuantity: Math.max(0, allocatedQuantity - successfulQuantity),
    };
  });
}
