import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { insertMaterialSchema, materialFamilies, materials, type InsertMaterial } from "@shared/schema";

export class MaterialMutationError extends Error {
  constructor(readonly code: "MATERIAL_NOT_FOUND" | "MATERIAL_FAMILY_NOT_FOUND" | "MATERIAL_FAMILY_INACTIVE" | "MATERIAL_DUPLICATE", message: string, readonly statusCode: number, readonly data?: unknown) { super(message); }
}

/** Canonical simple Material create/update boundary. Inventory-repository
 * normalization remains the sole owner of cost/unit persistence rules. */
export class MaterialMutationService {
  async create(input: { organizationId: string; material: unknown }) {
    const material = insertMaterialSchema.parse(input.material) as InsertMaterial;
    await this.assertAssignableFamily(input.organizationId, (material as any).materialFamilyId);
    const existing = await this.findByName(input.organizationId, material.name);
    if (existing) return { material: existing, created: false, duplicate: true };
    const created = await storage.createMaterial(input.organizationId, material);
    return { material: created, created: true, duplicate: false };
  }
  async update(input: { organizationId: string; materialId: string; material: unknown; current: Record<string, unknown> }) {
    const patch = input.material as Partial<InsertMaterial>;
    if ((patch as any).materialFamilyId) await this.assertAssignableFamily(input.organizationId, (patch as any).materialFamilyId);
    insertMaterialSchema.parse({ ...input.current, ...patch, type: (patch as any).materialForm ?? (input.current as any).type });
    if (typeof patch.name === "string") {
      const existing = await this.findByName(input.organizationId, patch.name, input.materialId);
      if (existing) throw new MaterialMutationError("MATERIAL_DUPLICATE", "Material name already exists in this organization", 409, existing);
    }
    const updated = await storage.updateMaterial(input.organizationId, input.materialId, patch);
    return updated;
  }
  private async assertAssignableFamily(organizationId: string, familyId: unknown) {
    if (!familyId) return;
    const [family] = await db.select({ id: materialFamilies.id, isActive: materialFamilies.isActive }).from(materialFamilies).where(and(eq(materialFamilies.id, String(familyId)), eq(materialFamilies.organizationId, organizationId))).limit(1);
    if (!family) throw new MaterialMutationError("MATERIAL_FAMILY_NOT_FOUND", "Material family was not found in this organization", 400);
    if (!family.isActive) throw new MaterialMutationError("MATERIAL_FAMILY_INACTIVE", "Cannot assign a Material to an inactive Material Family", 409);
  }
  private async findByName(organizationId: string, name: string, excludingId?: string) {
    const clauses = [eq(materials.organizationId, organizationId), sql`lower(trim(${materials.name})) = ${name.trim().toLowerCase()}`];
    if (excludingId) clauses.push(sql`${materials.id} <> ${excludingId}`);
    const [material] = await db.select().from(materials).where(and(...clauses)).limit(1);
    return material ?? null;
  }
}
export const materialMutationService = new MaterialMutationService();
