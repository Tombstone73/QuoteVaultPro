import { db } from "../db";
import { and, eq } from "drizzle-orm";
import { insertMaterialSchema, materialFamilies, materialFamilyVariantDimensions, materialVariantValues, materials, vendors } from "@shared/schema";
import { MaterialMutationError, materialMutationService } from "./materialMutation.service";
import { materialFamilyAssignmentService, type MaterialFamilyAssignmentValue } from "./materialFamilyAssignment.service";
import { materialFamilyLifecycleService } from "./materialFamilyLifecycle.service";
import { InventoryRepository } from "../storage/inventory.repo";

export type MaterialFamilyInitialDimension = { key: string; displayName: string };

/**
 * Canonical organizational Family creation plus atomic single-variant
 * orchestration. Families never receive a Material row or inventory identity.
 */
export class MaterialFamilyCreationService {
  async findFamilyByExactName(organizationId: string, name: string) {
    const [family] = await db.select().from(materialFamilies).where(and(
      eq(materialFamilies.organizationId, organizationId),
      eq(materialFamilies.name, name.trim()),
    )).limit(1);
    return family ?? null;
  }

  async getFamilyContext(organizationId: string, familyId: string) {
    const [family] = await db.select().from(materialFamilies).where(and(
      eq(materialFamilies.organizationId, organizationId), eq(materialFamilies.id, familyId),
    )).limit(1);
    if (!family) return null;
    const [dimensions, variants] = await Promise.all([
      db.select().from(materialFamilyVariantDimensions).where(and(eq(materialFamilyVariantDimensions.organizationId, organizationId), eq(materialFamilyVariantDimensions.materialFamilyId, family.id))).orderBy(materialFamilyVariantDimensions.sortOrder),
      db.select().from(materials).where(and(eq(materials.organizationId, organizationId), eq(materials.materialFamilyId, family.id))),
    ]);
    return { family, dimensions, variants };
  }

  async getVariantValues(organizationId: string, materialId: string) {
    return db.select().from(materialVariantValues).where(and(
      eq(materialVariantValues.organizationId, organizationId),
      eq(materialVariantValues.materialId, materialId),
    ));
  }
  async createFamily(input: { organizationId: string; name: string; description?: string | null; dimensions: readonly MaterialFamilyInitialDimension[] }) {
    return db.transaction(async (tx) => {
      const [family] = await tx.insert(materialFamilies).values({
        organizationId: input.organizationId,
        name: input.name,
        description: input.description ?? null,
      }).returning();
      const dimensions = [] as any[];
      for (const [sortOrder, dimension] of Array.from(input.dimensions.entries())) {
        dimensions.push(await materialFamilyLifecycleService.createDimension({
          organizationId: input.organizationId,
          familyId: family.id,
          ...dimension,
          sortOrder,
          executor: tx,
        }));
      }
      return { ...family, dimensions, variants: [] };
    });
  }

  /** One concrete variant is atomic: the Material insert and its Family
   * assignment/values share a transaction. Multi-variant callers deliberately
   * invoke this once per variant so completed siblings remain recoverable. */
  async createVariant(input: { organizationId: string; familyId: string; material: unknown; values: readonly MaterialFamilyAssignmentValue[] }) {
    return db.transaction(async (tx) => {
      const materialInput = insertMaterialSchema.parse({ ...(input.material as Record<string, unknown>), materialFamilyId: null });
      if (materialInput.preferredVendorId) {
        const [vendor] = await tx.select({ id: vendors.id }).from(vendors).where(and(
          eq(vendors.id, materialInput.preferredVendorId), eq(vendors.organizationId, input.organizationId),
        )).limit(1);
        if (!vendor) throw new MaterialMutationError("MATERIAL_VENDOR_NOT_FOUND", "Select a preferred vendor from this organization.", 400);
      }
      const creation = await materialMutationService.create({
        organizationId: input.organizationId,
        material: materialInput,
        executor: tx,
        // The existing variants endpoint did not impose name uniqueness.
        allowDuplicateName: true,
      });
      const assignment = await materialFamilyAssignmentService.assign({
        organizationId: input.organizationId,
        materialId: creation.material.id,
        familyId: input.familyId,
        values: input.values,
        executor: tx,
      });
      const { linkedProductIds } = materialInput;
      const productLinks = linkedProductIds?.length
        ? await new InventoryRepository(tx).replaceProductsForMaterial(input.organizationId, creation.material.id, linkedProductIds)
        : { linkedProductIds: [], ignoredProductIds: [] };
      return { material: assignment.material, variantValues: assignment.variantValues, ...productLinks };
    });
  }
}

export const materialFamilyCreationService = new MaterialFamilyCreationService();
