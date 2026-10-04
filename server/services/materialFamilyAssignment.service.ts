import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { materialFamilies, materialFamilyVariantDimensions, materials, materialVariantValues } from "@shared/schema";

export type MaterialFamilyAssignmentValue = { dimensionId: string; value: string };
export class MaterialFamilyAssignmentError extends Error {
  constructor(readonly code: "MATERIAL_NOT_FOUND" | "FAMILY_NOT_FOUND" | "FAMILY_INACTIVE" | "INVALID_DIMENSION" | "MISSING_DIMENSION_VALUE", message: string, readonly statusCode: number) { super(message); }
}

/** Atomic organizational assignment only. Concrete materials remain the sole
 * inventory identity; this service never creates, deletes, or replaces one. */
export class MaterialFamilyAssignmentService {
  async assign(input: { organizationId: string; materialId: string; familyId: string | null; values: readonly MaterialFamilyAssignmentValue[]; executor?: any }) {
    const assign = async (tx: any) => {
      const [material] = await tx.select().from(materials).where(and(eq(materials.id, input.materialId), eq(materials.organizationId, input.organizationId))).limit(1);
      if (!material) throw new MaterialFamilyAssignmentError("MATERIAL_NOT_FOUND", "Material not found", 404);
      if (!input.familyId) {
        await tx.delete(materialVariantValues).where(and(eq(materialVariantValues.materialId, material.id), eq(materialVariantValues.organizationId, input.organizationId)));
        const [updated] = await tx.update(materials).set({ materialFamilyId: null, updatedAt: new Date() }).where(eq(materials.id, material.id)).returning();
        return { material: updated, variantValues: [] };
      }
      const [family] = await tx.select({ id: materialFamilies.id, isActive: materialFamilies.isActive }).from(materialFamilies).where(and(eq(materialFamilies.id, input.familyId), eq(materialFamilies.organizationId, input.organizationId))).limit(1);
      if (!family) throw new MaterialFamilyAssignmentError("FAMILY_NOT_FOUND", "Material family not found", 400);
      if (!family.isActive) throw new MaterialFamilyAssignmentError("FAMILY_INACTIVE", "Cannot assign a Material to an inactive Material Family", 409);
      const ids = input.values.map((value) => value.dimensionId);
      if (new Set(ids).size !== ids.length) throw new MaterialFamilyAssignmentError("INVALID_DIMENSION", "A variant dimension was submitted more than once", 400);
      const dimensions = await tx.select({ id: materialFamilyVariantDimensions.id }).from(materialFamilyVariantDimensions).where(and(eq(materialFamilyVariantDimensions.organizationId, input.organizationId), eq(materialFamilyVariantDimensions.materialFamilyId, family.id), ...(ids.length ? [inArray(materialFamilyVariantDimensions.id, ids)] : [])));
      if (dimensions.length !== ids.length) throw new MaterialFamilyAssignmentError("INVALID_DIMENSION", "A variant value does not belong to this material family", 400);
      const required = await tx.select({ id: materialFamilyVariantDimensions.id }).from(materialFamilyVariantDimensions).where(and(eq(materialFamilyVariantDimensions.organizationId, input.organizationId), eq(materialFamilyVariantDimensions.materialFamilyId, family.id)));
      if (required.length !== ids.length) throw new MaterialFamilyAssignmentError("MISSING_DIMENSION_VALUE", "Provide a value for every material family dimension", 400);
      await tx.delete(materialVariantValues).where(and(eq(materialVariantValues.materialId, material.id), eq(materialVariantValues.organizationId, input.organizationId)));
      const variantValues = input.values.length ? await tx.insert(materialVariantValues).values(input.values.map((value) => ({ organizationId: input.organizationId, materialId: material.id, ...value }))).returning() : [];
      const [updated] = await tx.update(materials).set({ materialFamilyId: family.id, updatedAt: new Date() }).where(eq(materials.id, material.id)).returning();
      return { material: updated, variantValues };
    };
    return input.executor ? assign(input.executor) : db.transaction(assign);
  }
}
export const materialFamilyAssignmentService = new MaterialFamilyAssignmentService();
