import { db } from "../db";
import {
    materials,
    inventoryAdjustments,
    orderMaterialUsage,
    orderLineItems,
    type Material,
    type InsertMaterial,
    type InventoryAdjustment,
    type InsertInventoryAdjustment,
    type OrderMaterialUsage,
    type InsertOrderMaterialUsage,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export class InventoryRepository {
    constructor(private readonly dbInstance = db) { }

    // Material Operations
    async getAllMaterials(organizationId: string): Promise<Material[]> {
        return this.dbInstance.select().from(materials).where(eq(materials.organizationId, organizationId)).orderBy(materials.name);
    }

    async getMaterialById(organizationId: string, id: string): Promise<Material | undefined> {
        const [material] = await this.dbInstance.select().from(materials).where(and(eq(materials.id, id), eq(materials.organizationId, organizationId)));
        return material;
    }

    async getMaterialBySku(organizationId: string, sku: string): Promise<Material | undefined> {
        const [material] = await this.dbInstance.select().from(materials).where(and(eq(materials.sku, sku), eq(materials.organizationId, organizationId)));
        return material;
    }

    async createMaterial(organizationId: string, material: Omit<InsertMaterial, 'organizationId'>): Promise<Material> {
        const [created] = await this.dbInstance.insert(materials).values({ ...material, organizationId } as any).returning();
        return created;
    }

    async updateMaterial(organizationId: string, id: string, materialData: Partial<InsertMaterial>): Promise<Material> {
        const [updated] = await this.dbInstance.update(materials)
            .set({ ...materialData, updatedAt: new Date() } as any)
            .where(and(eq(materials.id, id), eq(materials.organizationId, organizationId)))
            .returning();
        if (!updated) throw new Error('Material not found');
        return updated;
    }

    async deleteMaterial(organizationId: string, id: string): Promise<void> {
        await this.dbInstance.delete(materials).where(and(eq(materials.id, id), eq(materials.organizationId, organizationId)));
    }

    async getMaterialLowStockAlerts(organizationId: string): Promise<Material[]> {
        return this.dbInstance.select()
            .from(materials)
            .where(and(
                eq(materials.organizationId, organizationId),
                sql`${materials.stockQuantity} < ${materials.minStockAlert}`
            ))
            .orderBy(materials.name);
    }

    // Inventory Adjustment Operations
    async adjustInventory(
        organizationId: string,
        materialId: string,
        type: "manual_increase" | "manual_decrease" | "waste" | "shrinkage" | "job_usage" | "purchase_receipt",
        quantityChange: number,
        userId: string,
        reason?: string,
        orderId?: string
    ): Promise<InventoryAdjustment> {
        return await this.dbInstance.transaction(async (tx) => {
            const [adjustment] = await tx.insert(inventoryAdjustments).values({
                materialId,
                type,
                quantityChange: `${quantityChange}`,
                reason: reason || null,
                orderId: orderId || null,
                userId,
            } as any).returning();

            await tx.update(materials)
                .set({
                    stockQuantity: sql`${materials.stockQuantity} + ${quantityChange}`,
                    updatedAt: new Date(),
                } as any)
                .where(and(eq(materials.id, materialId), eq(materials.organizationId, organizationId)));

            return adjustment;
        });
    }

    async getInventoryAdjustments(materialId: string): Promise<InventoryAdjustment[]> {
        return this.dbInstance.select()
            .from(inventoryAdjustments)
            .where(eq(inventoryAdjustments.materialId, materialId))
            .orderBy(desc(inventoryAdjustments.createdAt));
    }

    // Material Usage Operations
    async recordMaterialUsage(usage: InsertOrderMaterialUsage): Promise<OrderMaterialUsage> {
        const [created] = await this.dbInstance.insert(orderMaterialUsage).values(usage as any).returning();
        return created;
    }

    async getMaterialUsageByOrder(orderId: string): Promise<OrderMaterialUsage[]> {
        return this.dbInstance.select()
            .from(orderMaterialUsage)
            .where(eq(orderMaterialUsage.orderId, orderId))
            .orderBy(orderMaterialUsage.createdAt);
    }

    async getMaterialUsageByLineItem(lineItemId: string): Promise<OrderMaterialUsage[]> {
        return this.dbInstance.select()
            .from(orderMaterialUsage)
            .where(eq(orderMaterialUsage.orderLineItemId, lineItemId))
            .orderBy(orderMaterialUsage.createdAt);
    }

    async getMaterialUsageByMaterial(materialId: string): Promise<OrderMaterialUsage[]> {
        return this.dbInstance.select()
            .from(orderMaterialUsage)
            .where(eq(orderMaterialUsage.materialId, materialId))
            .orderBy(orderMaterialUsage.createdAt);
    }

    // Auto-deduction for production
    async autoDeductInventoryWhenOrderMovesToProduction(organizationId: string, orderId: string, userId: string): Promise<void> {
        const lineItems = await this.dbInstance.select()
            .from(orderLineItems)
            .where(eq(orderLineItems.orderId, orderId));

        for (const lineItem of lineItems) {
            if (!lineItem.requiresInventory || !lineItem.materialId) continue;

            const existingUsage = await this.dbInstance.select()
                .from(orderMaterialUsage)
                .where(and(
                    eq(orderMaterialUsage.orderId, orderId),
                    eq(orderMaterialUsage.orderLineItemId, lineItem.id)
                ));
            if (existingUsage.length > 0) continue;

            const [material] = await this.dbInstance.select()
                .from(materials)
                .where(and(eq(materials.id, lineItem.materialId), eq(materials.organizationId, organizationId)));
            if (!material) continue;

            let quantityNeeded = 0;
            if (material.type === 'sheet') {
                quantityNeeded = lineItem.nestingConfigSnapshot?.totalSheets || lineItem.quantity;
            } else if (material.type === 'roll' && material.unitOfMeasure === 'sqft') {
                quantityNeeded = parseFloat(lineItem.sqft?.toString() || '0');
            } else {
                quantityNeeded = lineItem.quantity;
            }
            if (quantityNeeded <= 0) continue;

            await this.dbInstance.insert(orderMaterialUsage).values({
                orderId,
                orderLineItemId: lineItem.id,
                materialId: lineItem.materialId,
                quantityUsed: `${quantityNeeded}`,
                unitOfMeasure: material.unitOfMeasure,
                calculatedBy: 'auto',
            } as any);

            await this.adjustInventory(
                organizationId,
                lineItem.materialId,
                'job_usage',
                -quantityNeeded,
                userId,
                `Auto-deducted for order ${orderId}, line item: ${lineItem.description}`,
                orderId
            );
        }
    }
}
