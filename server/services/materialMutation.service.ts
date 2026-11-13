import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { InventoryRepository } from "../storage/inventory.repo";
import { insertMaterialSchema, materials, type InsertMaterial } from "@shared/schema";

export class MaterialMutationError extends Error {
  constructor(readonly code: "MATERIAL_NOT_FOUND" | "MATERIAL_FAMILY_ASSIGNMENT_REQUIRED" | "MATERIAL_VENDOR_NOT_FOUND" | "MATERIAL_DUPLICATE" | "MATERIAL_DUPLICATE_SKU", message: string, readonly statusCode: number, readonly data?: unknown) { super(message); }
}

type MaterialExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
const skuConflict = () => new MaterialMutationError("MATERIAL_DUPLICATE_SKU", "This internal SKU is already used in this organization. Enter a different SKU.", 409);
const familyAssignmentRequired = () => new MaterialMutationError("MATERIAL_FAMILY_ASSIGNMENT_REQUIRED", "Use the Material Family controls to change family membership and dimension values.", 400);

function rethrowMaterialWriteError(error: unknown): never {
  const failure = error as { constraint?: string; cause?: { constraint?: string } } | null;
  if ((failure?.cause?.constraint ?? failure?.constraint) === "materials_org_normalized_sku_uidx") throw skuConflict();
  throw error;
}

/** Canonical simple Material create/update boundary. Inventory-repository
 * normalization remains the sole owner of cost/unit persistence rules. */
export class MaterialMutationService {
  async findByExactName(organizationId: string, name: string) {
    return this.findByName(db, organizationId, name);
  }
  async create(input: { organizationId: string; material: unknown; executor?: MaterialExecutor; allowDuplicateName?: boolean }) {
    const material = insertMaterialSchema.parse(input.material) as InsertMaterial;
    const executor = input.executor ?? db;
    if (material.materialFamilyId) throw familyAssignmentRequired();
    const existing = await this.findByName(executor, input.organizationId, material.name);
    if (existing && !input.allowDuplicateName) return { material: existing, created: false, duplicate: true };
    await this.assertAvailableSku(executor, input.organizationId, material.sku);
    try {
      const created = input.executor
        ? await new InventoryRepository(input.executor).createMaterial(input.organizationId, material)
        : await storage.createMaterial(input.organizationId, material);
      return { material: created, created: true, duplicate: false };
    } catch (error) {
      rethrowMaterialWriteError(error);
    }
  }
  async update(input: { organizationId: string; materialId: string; material: unknown; current: Record<string, unknown> }) {
    const patch = input.material as Partial<InsertMaterial>;
    if (patch.materialFamilyId !== undefined && patch.materialFamilyId !== input.current.materialFamilyId) throw familyAssignmentRequired();
    insertMaterialSchema.parse({ ...input.current, ...patch, type: (patch as any).materialForm ?? (input.current as any).type });
    if (typeof patch.name === "string") {
      const existing = await this.findByName(db, input.organizationId, patch.name, input.materialId);
      if (existing) throw new MaterialMutationError("MATERIAL_DUPLICATE", "Material name already exists in this organization", 409, existing);
    }
    if (typeof patch.sku === "string") await this.assertAvailableSku(db, input.organizationId, patch.sku, input.materialId);
    try {
      return await storage.updateMaterial(input.organizationId, input.materialId, patch);
    } catch (error) {
      rethrowMaterialWriteError(error);
    }
  }
  private async assertAvailableSku(executor: MaterialExecutor, organizationId: string, sku: string, excludingId?: string) {
    const [existing] = await executor.select({ id: materials.id }).from(materials).where(and(
      eq(materials.organizationId, organizationId),
      sql`lower(trim(${materials.sku})) = lower(trim(${sku}))`,
      excludingId ? ne(materials.id, excludingId) : undefined,
    )).limit(1);
    if (existing) throw skuConflict();
  }
  private async findByName(executor: MaterialExecutor, organizationId: string, name: string, excludingId?: string) {
    const clauses = [eq(materials.organizationId, organizationId), sql`lower(trim(${materials.name})) = ${name.trim().toLowerCase()}`];
    if (excludingId) clauses.push(sql`${materials.id} <> ${excludingId}`);
    const [material] = await executor.select().from(materials).where(and(...clauses)).limit(1);
    return material ?? null;
  }
}
export const materialMutationService = new MaterialMutationService();
