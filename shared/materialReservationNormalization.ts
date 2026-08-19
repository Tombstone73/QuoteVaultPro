import { calculateSheetYield, parseFormulaBoolean } from "./pbv2/formulaHelpers";
import { normalizeMaterialUnit, roundMaterialQuantity } from "./materialUnits";
import {
  convertReservationInputToBaseQty,
  type MaterialUom,
  type UomConversionMaterial,
} from "./uomConversions";
import { calculateRollMediaLayout, deriveRollPrintableWidth, type RollMediaLayoutResult } from "./pbv2/rollMediaLayout";

export type ReservationMaterial = UomConversionMaterial & {
  id?: string | null;
  name?: string | null;
  height?: string | number | null;
  edgeWasteInPerSide?: string | number | null;
};

export type FlatSheetReservationContext = {
  pieceWidthIn?: string | number | null;
  pieceHeightIn?: string | number | null;
  allowRotation?: unknown;
};

export type RollMediaReservationContext = {
  finishedWidthIn?: string | number | null;
  finishedHeightIn?: string | number | null;
  quantity?: string | number | null;
  productionAllowanceXIn?: string | number | null;
  productionAllowanceYIn?: string | number | null;
  registrationWasteIn?: string | number | null;
  billingWidthIncrementIn?: string | number | null;
  billingLengthIncrementIn?: string | number | null;
  allowRotation?: unknown;
};

type MaterialReservationFailureCode =
  | "invalid_uom"
  | "invalid_quantity"
  | "missing_width"
  | "missing_sheet_dimensions"
  | "missing_piece_dimensions"
  | "invalid_sheet_layout"
  | "invalid_roll_layout"
  | "unsupported_conversion";

export type MaterialReservationNormalizationResult =
  | {
      ok: true;
      baseUom: MaterialUom;
      convertedQty: number;
      method: "configured_unit" | "roll_width" | "roll_layout" | "flat_sheet_yield";
      rollLayout?: RollMediaLayoutResult;
      layout?: {
        piecesPerSheet: number;
        sheetsRequired: number;
        equivalentPieceQuantity: number;
      };
    }
  | {
      ok: false;
      code: MaterialReservationFailureCode;
      requestedUom: string;
      inventoryUnit: string | null;
      consumptionUnit: string | null;
      message: string;
    };

export type MaterialReservationRequest = {
  materialId: string;
  uom: string;
  qty: number;
};

export type NormalizedMaterialReservation = {
  materialId: string;
  uom: MaterialUom;
  qty: number;
};

function positiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function unitLabel(value: unknown): string {
  return String(value ?? "not configured").trim() || "not configured";
}

function failure(args: {
  material: ReservationMaterial;
  requestedUom: unknown;
  code: MaterialReservationFailureCode;
  detail: string;
}): MaterialReservationNormalizationResult {
  const name = String(args.material.name ?? "").trim() || String(args.material.id ?? "").trim() || "Unnamed material";
  const requestedUom = unitLabel(args.requestedUom);
  const inventoryUnit = normalizeMaterialUnit(args.material.inventoryUnit) ?? null;
  const consumptionUnit = normalizeMaterialUnit(args.material.consumptionUnit) ?? null;
  return {
    ok: false,
    code: args.code,
    requestedUom,
    inventoryUnit,
    consumptionUnit,
    message: `Material "${name}" cannot be reserved: requested unit ${requestedUom}; configured inventory unit ${unitLabel(inventoryUnit)}; configured consumption unit ${unitLabel(consumptionUnit)}. ${args.detail}`,
  };
}

/**
 * Normalizes a PBV2 material-usage request into the unit held by inventory.
 *
 * Exact-unit and roll conversions remain delegated to the canonical converter.
 * Flat sheet area is converted to physical sheet count with the same PBV2 yield
 * calculation used by production; it is never converted through linear feet or
 * by naively dividing area by sheet area.
 */
export function normalizeMaterialReservation(args: {
  material: ReservationMaterial;
  requestedUom: string;
  requestedQty: number;
  flatSheet?: FlatSheetReservationContext;
  rollMedia?: RollMediaReservationContext;
}): MaterialReservationNormalizationResult {
  const requestedUom = normalizeMaterialUnit(args.requestedUom);
  const inventoryUnit = normalizeMaterialUnit(args.material.inventoryUnit);
  const consumptionUnit = normalizeMaterialUnit(args.material.consumptionUnit);

  if (
    args.material.materialForm === "roll" &&
    inventoryUnit === "linear_foot" &&
    consumptionUnit === "linear_foot" &&
    requestedUom === "linear_foot" &&
    args.rollMedia
  ) {
    try {
      const physicalRollWidthIn = positiveNumber(args.material.width);
      const edgeWasteInPerSide = Number(args.material.edgeWasteInPerSide ?? 0);
      const printableWidthIn = deriveRollPrintableWidth({ physicalRollWidthIn, edgeWasteInPerSide });
      const layout = calculateRollMediaLayout({
        finishedWidthIn: Number(args.rollMedia.finishedWidthIn),
        finishedHeightIn: Number(args.rollMedia.finishedHeightIn),
        quantity: Number(args.rollMedia.quantity),
        physicalRollWidthIn,
        printableWidthIn,
        edgeWasteInPerSide,
        productionAllowanceXIn: Number(args.rollMedia.productionAllowanceXIn ?? 0),
        productionAllowanceYIn: Number(args.rollMedia.productionAllowanceYIn ?? 0),
        registrationWasteIn: Number(args.rollMedia.registrationWasteIn ?? 0),
        billingWidthIncrementIn: Number(args.rollMedia.billingWidthIncrementIn ?? 12),
        billingLengthIncrementIn: Number(args.rollMedia.billingLengthIncrementIn ?? 12),
        allowRotation: args.rollMedia.allowRotation as string | number | boolean | null | undefined,
        materialId: args.material.id ?? null,
        materialName: args.material.name ?? null,
      });
      return {
        ok: true,
        baseUom: inventoryUnit,
        convertedQty: roundMaterialQuantity(layout.actualConsumedLinearFeet),
        method: "roll_layout",
        rollLayout: layout,
      };
    } catch (error: any) {
      return failure({
        material: args.material,
        requestedUom: args.requestedUom,
        code: "invalid_roll_layout",
        detail: error?.message || "Roll layout could not be calculated for linear-foot reservation.",
      });
    }
  }

  const direct = convertReservationInputToBaseQty({
    material: args.material,
    inputUom: args.requestedUom,
    inputQuantity: args.requestedQty,
  });
  if (direct.ok) {
    return {
      ok: true,
      baseUom: direct.baseUom,
      convertedQty: direct.convertedQty,
      method: direct.inputUom === direct.baseUom ? "configured_unit" : "roll_width",
    };
  }

  const inventoryCountsSheets = inventoryUnit === "sheet"
    || (inventoryUnit === "each" && consumptionUnit === "sheet");

  if (
    direct.code !== "unsupported_conversion"
    || args.material.materialForm !== "sheet"
    || requestedUom !== "square_foot"
    || !inventoryCountsSheets
  ) {
    return failure({
      material: args.material,
      requestedUom: args.requestedUom,
      code: direct.code,
      detail: direct.message,
    });
  }

  const sheetWidthIn = positiveNumber(args.material.width);
  const sheetHeightIn = positiveNumber(args.material.height);
  if (!sheetWidthIn || !sheetHeightIn) {
    return failure({
      material: args.material,
      requestedUom: args.requestedUom,
      code: "missing_sheet_dimensions",
      detail: "Sheet width and height must be configured before square-foot usage can be converted to sheet inventory.",
    });
  }

  const pieceWidthIn = positiveNumber(args.flatSheet?.pieceWidthIn);
  const pieceHeightIn = positiveNumber(args.flatSheet?.pieceHeightIn);
  if (!pieceWidthIn || !pieceHeightIn) {
    return failure({
      material: args.material,
      requestedUom: args.requestedUom,
      code: "missing_piece_dimensions",
      detail: "Finished piece width and height are required to calculate flat-sheet yield.",
    });
  }

  const pieceSqft = (pieceWidthIn * pieceHeightIn) / 144;
  const equivalentPieceQuantity = args.requestedQty / pieceSqft;
  if (!Number.isFinite(equivalentPieceQuantity) || equivalentPieceQuantity <= 0) {
    return failure({
      material: args.material,
      requestedUom: args.requestedUom,
      code: "invalid_quantity",
      detail: "The requested material usage does not produce a positive flat-sheet piece quantity.",
    });
  }

  try {
    const layout = calculateSheetYield(
      pieceWidthIn,
      pieceHeightIn,
      equivalentPieceQuantity,
      sheetWidthIn,
      sheetHeightIn,
      0,
      1,
      0,
      parseFormulaBoolean(args.flatSheet?.allowRotation) ?? false,
      "material reservation",
    );
    return {
      ok: true,
      baseUom: inventoryUnit as MaterialUom,
      convertedQty: roundMaterialQuantity(layout.totalSheetCount),
      method: "flat_sheet_yield",
      layout: {
        piecesPerSheet: layout.piecesPerSheet,
        sheetsRequired: layout.totalSheetCount,
        equivalentPieceQuantity: Math.ceil(equivalentPieceQuantity),
      },
    };
  } catch (error: any) {
    return failure({
      material: args.material,
      requestedUom: args.requestedUom,
      code: "invalid_sheet_layout",
      detail: error?.message || "The finished piece cannot be laid out on the configured sheet.",
    });
  }
}

/**
 * Produces one deterministic reservation per material/inventory-unit pair.
 * Re-running the same inputs yields the same keys and quantities, which lets the
 * database reconciliation update/reuse existing reservations instead of adding
 * duplicate rows.
 */
export function buildNormalizedMaterialReservationPlan(args: {
  requests: MaterialReservationRequest[];
  materials: ReservationMaterial[];
  flatSheet?: FlatSheetReservationContext;
  rollMedia?: RollMediaReservationContext;
}):
  | { ok: true; reservations: NormalizedMaterialReservation[] }
  | { ok: false; error: Extract<MaterialReservationNormalizationResult, { ok: false }> } {
  const materialById = new Map(
    args.materials
      .map((material) => [String(material.id ?? "").trim(), material] as const)
      .filter(([id]) => Boolean(id)),
  );
  const byKey = new Map<string, NormalizedMaterialReservation>();

  for (const request of args.requests ?? []) {
    const materialId = String(request.materialId ?? "").trim();
    if (!materialId || !request.uom || !Number.isFinite(request.qty) || request.qty <= 0) continue;
    const material = materialById.get(materialId) ?? { id: materialId, name: materialId };
    const normalized = normalizeMaterialReservation({
      material,
      requestedUom: request.uom,
      requestedQty: request.qty,
      flatSheet: args.flatSheet,
      rollMedia: args.rollMedia,
    });
    if (!normalized.ok) return { ok: false, error: normalized };

    const key = `${materialId}::${normalized.baseUom}`;
    const existing = byKey.get(key);
    byKey.set(key, {
      materialId,
      uom: normalized.baseUom,
      qty: roundMaterialQuantity((existing?.qty ?? 0) + normalized.convertedQty),
    });
  }

  return {
    ok: true,
    reservations: Array.from(byKey.values()).sort((a, b) =>
      `${a.materialId}:${a.uom}`.localeCompare(`${b.materialId}:${b.uom}`),
    ),
  };
}
