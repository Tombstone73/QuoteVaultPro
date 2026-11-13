import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { InventoryRepository } from "../storage/inventory.repo";
import { insertMaterialSchema, materials, vendors, type InsertMaterial, type UpdateMaterial } from "@shared/schema";

export class MaterialMutationError extends Error {
  constructor(readonly code: "MATERIAL_NOT_FOUND" | "MATERIAL_FAMILY_ASSIGNMENT_REQUIRED" | "MATERIAL_VENDOR_NOT_FOUND" | "MATERIAL_DUPLICATE" | "MATERIAL_DUPLICATE_SKU" | "MATERIAL_STALE" | "MATERIAL_STOCK_ADJUSTMENT_REQUIRED", message: string, readonly statusCode: number, readonly data?: unknown) { super(message); }
}

type MaterialExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
const operationalFields = ["materialForm", "type", "inventoryUnit", "consumptionUnit", "width", "rollLengthFt", "costPerRoll", "edgeWasteInPerSide", "leadWasteFt", "tailWasteFt"] as const;
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
  async update({ organizationId, materialId, material, expectedUpdatedAt }: {
    organizationId: string; materialId: string; material: UpdateMaterial; expectedUpdatedAt?: string;
  }) {
    const { linkedProductIds, vendorLastPriceCents: _lastPrice, vendorLastPriceUpdatedAt: _lastReceipt, stockQuantity, materialFamilyId, ...patch } = material;
    try {
      return await db.transaction(async (tx) => {
        const [current] = await tx.select().from(materials).where(and(eq(materials.id, materialId), eq(materials.organizationId, organizationId))).for("update");
        if (!current) throw new MaterialMutationError("MATERIAL_NOT_FOUND", "Material not found", 404);
        if (expectedUpdatedAt && Date.parse(expectedUpdatedAt) !== current.updatedAt.getTime()) {
          throw new MaterialMutationError("MATERIAL_STALE", "This material changed after you opened it. Copy any unsaved edits, then close and reopen the editor to use the latest values.", 409);
        }
        if (materialFamilyId !== undefined && materialFamilyId !== current.materialFamilyId) throw familyAssignmentRequired();
        if (stockQuantity !== undefined && Number(stockQuantity) !== Number(current.stockQuantity)) {
          throw new MaterialMutationError("MATERIAL_STOCK_ADJUSTMENT_REQUIRED", "Use Adjust Inventory to change stock quantity.", 400);
        }
        if (operationalFields.some((field) => patch[field] !== undefined && String(patch[field]) !== String(current[field]))) {
          const { unitOfMeasure: _unit, sellPriceUnit: _sell, wholesalePriceUnit: _wholesale, wholesaleBaseRate: _wholesaleRate,
            wholesaleMinCharge: _wholesaleMin, retailBaseRate: _retailRate, retailMinCharge: _retailMin, ...configuration } = current;
          insertMaterialSchema.parse({ ...configuration, ...patch, type: patch.materialForm ?? current.type });
        }
        if (typeof patch.name === "string" && patch.name !== current.name) {
          const existing = await this.findByName(tx, organizationId, patch.name, materialId);
          if (existing) throw new MaterialMutationError("MATERIAL_DUPLICATE", "Material name already exists in this organization", 409, existing);
        }
        if (typeof patch.sku === "string") await this.assertAvailableSku(tx, organizationId, patch.sku, materialId);
        if (patch.preferredVendorId && patch.preferredVendorId !== current.preferredVendorId) {
          const [vendor] = await tx.select({ id: vendors.id }).from(vendors)
            .where(and(eq(vendors.id, patch.preferredVendorId), eq(vendors.organizationId, organizationId), eq(vendors.isActive, true)));
          if (!vendor) throw new MaterialMutationError("MATERIAL_VENDOR_NOT_FOUND", "Select an active vendor from this organization or leave Vendor Record unchanged.", 400);
        }
        const inventory = new InventoryRepository(tx);
        const updated = await inventory.updateMaterial(organizationId, materialId, patch);
        const links = linkedProductIds === undefined
          ? { linkedProductIds: (await inventory.listProductsForMaterial(organizationId, materialId, { activeOnly: true })).map(({ id }) => id), ignoredProductIds: [] }
          : await inventory.replaceProductsForMaterial(organizationId, materialId, linkedProductIds);
        return { material: updated, ...links };
      });
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
