import { db } from "../db";
import { materialFamilies } from "@shared/schema";
import { materialMutationService } from "./materialMutation.service";
import { materialFamilyAssignmentService, type MaterialFamilyAssignmentValue } from "./materialFamilyAssignment.service";
import { materialFamilyLifecycleService } from "./materialFamilyLifecycle.service";

export type MaterialFamilyInitialDimension = { key: string; displayName: string };

/**
 * Canonical organizational Family creation plus atomic single-variant
 * orchestration. Families never receive a Material row or inventory identity.
 */
export class MaterialFamilyCreationService {
  async createFamily(input: { organizationId: string; name: string; description?: string | null; dimensions: readonly MaterialFamilyInitialDimension[] }) {
    return db.transaction(async (tx) => {
      const [family] = await tx.insert(materialFamilies).values({
        organizationId: input.organizationId,
        name: input.name,
        description: input.description ?? null,
      }).returning();
      const dimensions = [] as any[];
      for (const [sortOrder, dimension] of input.dimensions.entries()) {
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
      const materialInput = { ...(input.material as Record<string, unknown>), materialFamilyId: null };
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
      return { material: assignment.material, variantValues: assignment.variantValues };
    });
  }
}

export const materialFamilyCreationService = new MaterialFamilyCreationService();
