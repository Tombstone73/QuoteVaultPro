import { z } from "zod";
import type { PlannedMaterial } from "./prepressPlannedMaterials";

export const materialUomSchema = z.enum(["sqft", "ft", "each"]);
export const materialOverridePriceImpactSchema = z.enum(["none", "potential", "confirmed"]);

const baseOpInputSchema = z.object({
  reasonNote: z.string().trim().min(1, "reasonNote is required"),
  priceImpact: materialOverridePriceImpactSchema.optional(),
});

export const materialOverrideOpInputSchema = z.discriminatedUnion("op", [
  baseOpInputSchema.extend({
    op: z.literal("replace"),
    fromMaterialId: z.string().min(1),
    toMaterialId: z.string().min(1),
  }),
  baseOpInputSchema.extend({
    op: z.literal("add"),
    materialId: z.string().min(1),
    qty: z.number().positive(),
    uom: materialUomSchema,
  }),
  baseOpInputSchema.extend({
    op: z.literal("remove"),
    materialId: z.string().min(1),
  }),
  baseOpInputSchema.extend({
    op: z.literal("adjust_qty"),
    materialId: z.string().min(1),
    qty: z.number().positive(),
    uom: materialUomSchema,
  }),
]);

const baseOpPersistedSchema = z.object({
  reasonNote: z.string().trim().min(1),
  priceImpact: materialOverridePriceImpactSchema,
  createdAt: z.string().min(1),
  createdByUserId: z.string().optional(),
});

export const materialOverrideOpSchema = z.discriminatedUnion("op", [
  baseOpPersistedSchema.extend({
    op: z.literal("replace"),
    fromMaterialId: z.string().min(1),
    toMaterialId: z.string().min(1),
  }),
  baseOpPersistedSchema.extend({
    op: z.literal("add"),
    materialId: z.string().min(1),
    qty: z.number().positive(),
    uom: materialUomSchema,
  }),
  baseOpPersistedSchema.extend({
    op: z.literal("remove"),
    materialId: z.string().min(1),
  }),
  baseOpPersistedSchema.extend({
    op: z.literal("adjust_qty"),
    materialId: z.string().min(1),
    qty: z.number().positive(),
    uom: materialUomSchema,
  }),
]);

export type MaterialOverrideOpInput = z.infer<typeof materialOverrideOpInputSchema>;
export type MaterialOverrideOp = z.infer<typeof materialOverrideOpSchema>;

export type EffectiveMaterial = {
  materialId: string;
  materialName?: string;
  qty: number;
  uom: "sqft" | "ft" | "each";
  isOverridden?: boolean;
};

export type EffectiveMaterialsResult = {
  effectiveMaterials: EffectiveMaterial[];
  pricingReviewRequired: boolean;
  diffSummary: string;
};

function roundQty(qty: number, uom: "sqft" | "ft" | "each"): number {
  if (uom === "each") return Math.max(0, Math.round(qty));
  return Math.max(0, Math.round(qty * 100) / 100);
}

function keyFor(materialId: string, uom: "sqft" | "ft" | "each") {
  return `${materialId}::${uom}`;
}

function normalizeOverrides(raw: unknown): MaterialOverrideOp[] {
  if (!Array.isArray(raw)) return [];
  const parsed: MaterialOverrideOp[] = [];
  for (const item of raw) {
    const result = materialOverrideOpSchema.safeParse(item);
    if (result.success) parsed.push(result.data);
  }
  return parsed;
}

export function materialOverridesFromSpecsJson(specsJson: unknown): MaterialOverrideOp[] {
  const specs = specsJson && typeof specsJson === "object" ? (specsJson as any) : {};
  return normalizeOverrides(specs?.materialOverrides);
}

export function appendMaterialOverrideToSpecsJson(specsJson: unknown, op: MaterialOverrideOp): Record<string, any> {
  const specs = specsJson && typeof specsJson === "object" ? { ...(specsJson as any) } : {};
  const current = materialOverridesFromSpecsJson(specsJson);
  return {
    ...specs,
    materialOverrides: [...current, op],
  };
}

export function withServerDefaultsForOverride(input: MaterialOverrideOpInput, createdByUserId?: string): MaterialOverrideOp {
  const createdAt = new Date().toISOString();

  if (input.op === "replace") {
    return {
      ...input,
      priceImpact: "potential",
      createdAt,
      ...(createdByUserId ? { createdByUserId } : {}),
    };
  }

  return {
    ...input,
    priceImpact: input.priceImpact ?? "none",
    createdAt,
    ...(createdByUserId ? { createdByUserId } : {}),
  };
}

export function computeEffectiveMaterials(args: {
  plannedMaterials: PlannedMaterial[];
  overrides: MaterialOverrideOp[];
}): EffectiveMaterialsResult {
  const materialMap = new Map<string, EffectiveMaterial>();

  for (const planned of args.plannedMaterials || []) {
    const key = keyFor(planned.materialId, planned.uom);
    const existing = materialMap.get(key);
    if (!existing) {
      materialMap.set(key, {
        materialId: planned.materialId,
        materialName: planned.materialName,
        qty: planned.qty,
        uom: planned.uom,
        isOverridden: false,
      });
      continue;
    }

    existing.qty += planned.qty;
  }

  const ops = normalizeOverrides(args.overrides);
  let pricingReviewRequired = false;

  for (const op of ops) {
    if (op.op === "replace") {
      pricingReviewRequired = true;

      const fromKeys = Array.from(materialMap.keys()).filter((k) => k.startsWith(`${op.fromMaterialId}::`));
      for (const fromKey of fromKeys) {
        const fromItem = materialMap.get(fromKey);
        if (!fromItem) continue;

        materialMap.delete(fromKey);
        const toKey = keyFor(op.toMaterialId, fromItem.uom);
        const existingTo = materialMap.get(toKey);
        if (!existingTo) {
          materialMap.set(toKey, {
            materialId: op.toMaterialId,
            qty: fromItem.qty,
            uom: fromItem.uom,
            isOverridden: true,
          });
        } else {
          existingTo.qty += fromItem.qty;
          existingTo.isOverridden = true;
        }
      }
      continue;
    }

    if (op.priceImpact === "potential" || op.priceImpact === "confirmed") {
      pricingReviewRequired = true;
    }

    if (op.op === "add") {
      const targetKey = keyFor(op.materialId, op.uom);
      const existing = materialMap.get(targetKey);
      if (!existing) {
        materialMap.set(targetKey, {
          materialId: op.materialId,
          qty: op.qty,
          uom: op.uom,
          isOverridden: true,
        });
      } else {
        existing.qty += op.qty;
        existing.isOverridden = true;
      }
      continue;
    }

    if (op.op === "remove") {
      const removeKeys = Array.from(materialMap.keys()).filter((k) => k.startsWith(`${op.materialId}::`));
      for (const removeKey of removeKeys) {
        materialMap.delete(removeKey);
      }
      continue;
    }

    if (op.op === "adjust_qty") {
      const targetKey = keyFor(op.materialId, op.uom);
      const existing = materialMap.get(targetKey);
      if (!existing) {
        materialMap.set(targetKey, {
          materialId: op.materialId,
          qty: op.qty,
          uom: op.uom,
          isOverridden: true,
        });
      } else {
        existing.qty = op.qty;
        existing.isOverridden = true;
      }
    }
  }

  const effectiveMaterials = Array.from(materialMap.values())
    .map((item) => ({
      ...item,
      qty: roundQty(item.qty, item.uom),
    }))
    .filter((item) => item.qty > 0)
    .sort((a, b) => `${a.materialId}:${a.uom}`.localeCompare(`${b.materialId}:${b.uom}`));

  const diffSummary = `${ops.length} override${ops.length === 1 ? "" : "s"}; ${effectiveMaterials.length} effective material${effectiveMaterials.length === 1 ? "" : "s"}`;

  return {
    effectiveMaterials,
    pricingReviewRequired,
    diffSummary,
  };
}
