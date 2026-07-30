import { normalizeMaterialUnit, roundMaterialQuantity } from "../materialUnits";
import {
  calculateRollMediaLayout,
  deriveRollPrintableWidth,
} from "./rollMediaLayout";

export type RollMaterialEffect = {
  skuRef: string;
  uom: string;
  qty: unknown;
  sourceNodeId?: string;
  [key: string]: unknown;
};

export type RollMaterialRecord = {
  id?: string | null;
  name?: string | null;
  materialForm?: string | null;
  inventoryUnit?: string | null;
  consumptionUnit?: string | null;
  width?: string | number | null;
  edgeWasteInPerSide?: string | number | null;
};

export type RollMaterialEffectEnrichmentWarning = {
  code: string;
  message: string;
  materialId?: string;
};

const toPositiveNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toNonNegativeNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const getVariable = (variables: Record<string, unknown>, keys: string[], fallback?: number): number | null => {
  for (const key of keys) {
    const value = Number(variables[key]);
    if (Number.isFinite(value)) return value;
  }
  return fallback ?? null;
};

export function enrichRollLinearFootMaterialEffects(input: {
  effects: RollMaterialEffect[];
  materials: RollMaterialRecord[];
  env: Record<string, unknown>;
  formulaVariables?: Record<string, unknown>;
  allowRotation?: unknown;
}): { effects: RollMaterialEffect[]; warnings: RollMaterialEffectEnrichmentWarning[] } {
  const warnings: RollMaterialEffectEnrichmentWarning[] = [];
  const materialById = new Map(
    input.materials
      .map((material) => [String(material.id ?? "").trim(), material] as const)
      .filter(([id]) => Boolean(id)),
  );
  const vars = input.formulaVariables ?? {};
  const finishedWidthIn = toPositiveNumber(input.env.widthIn ?? input.env.w);
  const finishedHeightIn = toPositiveNumber(input.env.heightIn ?? input.env.h);
  const quantity = toPositiveNumber(input.env.quantity ?? input.env.q);

  const effects = input.effects.map((effect) => {
    const materialId = String(effect.skuRef ?? "").trim();
    const material = materialById.get(materialId);
    const inventoryUnit = normalizeMaterialUnit(material?.inventoryUnit);
    const consumptionUnit = normalizeMaterialUnit(material?.consumptionUnit);
    const uom = normalizeMaterialUnit(effect.uom);
    const isLinearRoll =
      material?.materialForm === "roll" &&
      inventoryUnit === "linear_foot" &&
      consumptionUnit === "linear_foot";

    if (!isLinearRoll) return effect;

    if (!finishedWidthIn || !finishedHeightIn || !quantity) {
      warnings.push({
        code: "ROLL_LAYOUT_MISSING_DIMENSIONS",
        message: "Roll linear-foot material usage requires width, height, and quantity.",
        materialId,
      });
      return effect;
    }

    const physicalRollWidthIn = toPositiveNumber(material?.width);
    const edgeWasteInPerSide = toNonNegativeNumber(material?.edgeWasteInPerSide);
    const printableWidthIn = deriveRollPrintableWidth({
      physicalRollWidthIn,
      edgeWasteInPerSide,
    });
    if (!printableWidthIn) {
      warnings.push({
        code: "ROLL_LAYOUT_MISSING_PRINTABLE_WIDTH",
        message: "Roll material geometry leaves no usable printable width.",
        materialId,
      });
      return effect;
    }

    try {
      const layout = calculateRollMediaLayout({
        finishedWidthIn,
        finishedHeightIn,
        quantity,
        physicalRollWidthIn,
        printableWidthIn,
        edgeWasteInPerSide,
        productionAllowanceXIn: getVariable(vars, ["piece_allowance_x", "production_allowance_x", "productionAllowanceX"], 0),
        productionAllowanceYIn: getVariable(vars, ["piece_allowance_y", "production_allowance_y", "productionAllowanceY"], 0),
        registrationWasteIn: getVariable(vars, ["registration_waste", "registrationWasteIn"], 0),
        billingWidthIncrementIn: getVariable(vars, ["billing_width_increment", "billingWidthIncrement"], 12) ?? 12,
        billingLengthIncrementIn: getVariable(vars, ["billing_length_increment", "billingLengthIncrement"], 12) ?? 12,
        allowRotation: input.allowRotation ?? vars.allow_rotation,
        materialId,
        materialName: material?.name ?? null,
      });

      return {
        ...effect,
        uom: "linear_foot",
        qty: roundMaterialQuantity(layout.actualConsumedLinearFeet),
        rollLayout: layout,
        originalMaterialEffect: {
          uom: effect.uom,
          qty: effect.qty,
          qtyMeaning: uom === "linear_foot" ? "tree_linear_foot" : "tree_material_effect",
        },
      };
    } catch (error: any) {
      warnings.push({
        code: error?.code || "ROLL_LAYOUT_FAILED",
        message: error?.message || "Roll material layout could not be calculated.",
        materialId,
      });
      return effect;
    }
  });

  return { effects, warnings };
}
