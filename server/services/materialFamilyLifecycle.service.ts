import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { materialFamilies, materialFamilyVariantDimensions, materialVariantValues } from "@shared/schema";

export class MaterialFamilyLifecycleError extends Error {
  constructor(readonly code: "FAMILY_NOT_FOUND" | "DIMENSION_NOT_FOUND" | "DIMENSION_IN_USE", message: string, readonly statusCode: number) { super(message); }
}

/** Tenant-scoped organizational Family lifecycle and dimension mutations. It
 * intentionally never touches child Materials or inventory-bearing fields. */
export class MaterialFamilyLifecycleService {
  async updateLifecycle(input: { organizationId: string; familyId: string; isActive: boolean }) {
    const [family] = await db.update(materialFamilies).set({ isActive: input.isActive, updatedAt: new Date() }).where(and(eq(materialFamilies.id, input.familyId), eq(materialFamilies.organizationId, input.organizationId))).returning();
    if (!family) throw new MaterialFamilyLifecycleError("FAMILY_NOT_FOUND", "Material family not found", 404);
    return family;
  }
  async createDimension(input: { organizationId: string; familyId: string; key: string; displayName: string; sortOrder?: number; executor?: any }) {
    const executor = input.executor ?? db;
    await this.requireFamily(executor, input.organizationId, input.familyId);
    const [dimension] = await executor.insert(materialFamilyVariantDimensions).values({ organizationId: input.organizationId, materialFamilyId: input.familyId, key: input.key, displayName: input.displayName, sortOrder: input.sortOrder ?? 0 }).returning();
    return dimension;
  }
  async updateDimension(input: { organizationId: string; familyId: string; dimensionId: string; displayName?: string; sortOrder?: number }) {
    const [dimension] = await db.update(materialFamilyVariantDimensions).set({ ...(input.displayName !== undefined ? { displayName: input.displayName } : {}), ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}) }).where(and(eq(materialFamilyVariantDimensions.id, input.dimensionId), eq(materialFamilyVariantDimensions.materialFamilyId, input.familyId), eq(materialFamilyVariantDimensions.organizationId, input.organizationId))).returning();
    if (!dimension) throw new MaterialFamilyLifecycleError("DIMENSION_NOT_FOUND", "Variant dimension not found", 404);
    return dimension;
  }
  async removeDimension(input: { organizationId: string; familyId: string; dimensionId: string }) {
    const [dimension] = await db.select({ id: materialFamilyVariantDimensions.id }).from(materialFamilyVariantDimensions).where(and(eq(materialFamilyVariantDimensions.id, input.dimensionId), eq(materialFamilyVariantDimensions.materialFamilyId, input.familyId), eq(materialFamilyVariantDimensions.organizationId, input.organizationId))).limit(1);
    if (!dimension) throw new MaterialFamilyLifecycleError("DIMENSION_NOT_FOUND", "Variant dimension not found", 404);
    const [value] = await db.select({ id: materialVariantValues.id }).from(materialVariantValues).where(and(eq(materialVariantValues.dimensionId, dimension.id), eq(materialVariantValues.organizationId, input.organizationId))).limit(1);
    if (value) throw new MaterialFamilyLifecycleError("DIMENSION_IN_USE", "A dimension with persisted variant values cannot be removed", 409);
    await db.delete(materialFamilyVariantDimensions).where(eq(materialFamilyVariantDimensions.id, dimension.id));
  }
  private async requireFamily(executor: any, organizationId: string, familyId: string) {
    const [family] = await executor.select({ id: materialFamilies.id }).from(materialFamilies).where(and(eq(materialFamilies.id, familyId), eq(materialFamilies.organizationId, organizationId))).limit(1);
    if (!family) throw new MaterialFamilyLifecycleError("FAMILY_NOT_FOUND", "Material family not found", 404);
    return family;
  }
}
export const materialFamilyLifecycleService = new MaterialFamilyLifecycleService();
