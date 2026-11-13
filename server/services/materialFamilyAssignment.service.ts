import { and, eq, ne } from "drizzle-orm";
import { db } from "../db";
import { materialFamilies, materialFamilyVariantDimensions, materials, materialVariantValues } from "@shared/schema";

export type MaterialFamilyAssignmentValue = { dimensionId: string; value: string };
type MaterialTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class MaterialFamilyAssignmentError extends Error {
  constructor(readonly code: "MATERIAL_NOT_FOUND" | "FAMILY_NOT_FOUND" | "FAMILY_INACTIVE" | "INVALID_DIMENSION" | "MISSING_DIMENSION_VALUE" | "DUPLICATE_VARIANT", message: string, readonly statusCode: number) { super(message); }
}

/** Atomic organizational assignment only. Concrete materials remain the sole
 * inventory identity; this service never creates, deletes, or replaces one. */
export class MaterialFamilyAssignmentService {
  async assign(input: { organizationId: string; materialId: string; familyId: string | null; values: readonly MaterialFamilyAssignmentValue[]; executor?: MaterialTransaction }) {
    const assign = async (tx: MaterialTransaction) => {
      const [material] = await tx.select().from(materials).where(and(eq(materials.id, input.materialId), eq(materials.organizationId, input.organizationId))).for("update");
      if (!material) throw new MaterialFamilyAssignmentError("MATERIAL_NOT_FOUND", "Material not found", 404);
      if (!input.familyId) {
        await tx.delete(materialVariantValues).where(and(eq(materialVariantValues.materialId, material.id), eq(materialVariantValues.organizationId, input.organizationId)));
        const [updated] = await tx.update(materials).set({ materialFamilyId: null, updatedAt: new Date() }).where(eq(materials.id, material.id)).returning();
        return { material: updated, variantValues: [] };
      }
      // Serialize writes to a family's dimension combinations, including assignments of existing Materials.
      const [family] = await tx.select({ id: materialFamilies.id, isActive: materialFamilies.isActive }).from(materialFamilies).where(and(eq(materialFamilies.id, input.familyId), eq(materialFamilies.organizationId, input.organizationId))).for("update");
      if (!family) throw new MaterialFamilyAssignmentError("FAMILY_NOT_FOUND", "Material family not found", 400);
      if (!family.isActive) throw new MaterialFamilyAssignmentError("FAMILY_INACTIVE", "Cannot assign a Material to an inactive Material Family", 409);
      const dimensions = await tx.select({ id: materialFamilyVariantDimensions.id }).from(materialFamilyVariantDimensions).where(and(eq(materialFamilyVariantDimensions.organizationId, input.organizationId), eq(materialFamilyVariantDimensions.materialFamilyId, family.id)));
      const dimensionIds = new Set(dimensions.map(dimension => dimension.id));
      const values = input.values.map(({ dimensionId, value }) => ({ dimensionId, value: value.trim() }));
      const normalized = new Map(values.map(({ dimensionId, value }) => [dimensionId, value.toLowerCase()]));
      if (normalized.size !== values.length || values.some(({ dimensionId }) => !dimensionIds.has(dimensionId))) {
        throw new MaterialFamilyAssignmentError("INVALID_DIMENSION", "Use each dimension belonging to this family once", 400);
      }
      if (dimensionIds.size !== values.length || values.some(({ value }) => !value || value.length > 255)) {
        throw new MaterialFamilyAssignmentError("MISSING_DIMENSION_VALUE", "Provide a value of 1–255 characters for every material family dimension", 400);
      }
      if (dimensionIds.size) {
        const siblings = await tx.select({ materialId: materials.id, dimensionId: materialVariantValues.dimensionId, value: materialVariantValues.value })
          .from(materials)
          .innerJoin(materialVariantValues, and(eq(materialVariantValues.materialId, materials.id), eq(materialVariantValues.organizationId, input.organizationId)))
          .where(and(eq(materials.organizationId, input.organizationId), eq(materials.materialFamilyId, family.id), ne(materials.id, material.id)));
        const matchCounts = new Map<string, number>();
        for (const sibling of siblings) {
          if (normalized.get(sibling.dimensionId) !== sibling.value.trim().toLowerCase()) continue;
          const count = (matchCounts.get(sibling.materialId) ?? 0) + 1;
          if (count === normalized.size) {
            throw new MaterialFamilyAssignmentError("DUPLICATE_VARIANT", "A variant with this combination already exists in the family. Edit that variant or choose different values.", 409);
          }
          matchCounts.set(sibling.materialId, count);
        }
      }
      await tx.delete(materialVariantValues).where(and(eq(materialVariantValues.materialId, material.id), eq(materialVariantValues.organizationId, input.organizationId)));
      const variantValues = values.length ? await tx.insert(materialVariantValues).values(values.map((value) => ({ organizationId: input.organizationId, materialId: material.id, ...value }))).returning() : [];
      const [updated] = await tx.update(materials).set({ materialFamilyId: family.id, updatedAt: new Date() }).where(eq(materials.id, material.id)).returning();
      return { material: updated, variantValues };
    };
    return input.executor ? assign(input.executor) : db.transaction(assign);
  }
}
export const materialFamilyAssignmentService = new MaterialFamilyAssignmentService();
