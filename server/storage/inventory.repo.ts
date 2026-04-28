import { db } from "../db";
import {
    materials,
    inventoryAdjustments,
    materialReorderRequests,
    orderMaterialUsage,
    orderLineItems,
    users,
    vendors,
    type Material,
    type InsertMaterial,
    type InventoryAdjustment,
    type MaterialReorderRequest,
    type InsertMaterialReorderRequest,
    type OrderMaterialUsage,
    type InsertOrderMaterialUsage,
} from "@shared/schema";
import type { InventoryMovementType, MaterialReorderRequestStatus } from "@shared/materialInventory";
import { eq, and, desc, sql, or } from "drizzle-orm";
import {
    assertNoOpenReorderRequest,
    buildInventoryMovementSnapshot,
    transitionMaterialReorderRequest,
    type InventoryAdjustmentDetailType,
} from "../services/materialInventoryLogic";

type InventoryMovementRecordInput = {
    organizationId: string;
    materialId: string;
    movementType: InventoryMovementType;
    detailType: InventoryAdjustmentDetailType;
    quantityDelta: number;
    userId: string;
    reason?: string | null;
    notes?: string | null;
    orderId?: string | null;
    reorderRequestId?: string | null;
};

export type MaterialReorderRequestListItem = MaterialReorderRequest & {
    materialName: string;
    materialSku: string | null;
    currentMaterialQuantity: string | null;
    vendorName: string | null;
    requestedByName: string | null;
    orderedByName: string | null;
    receivedByName: string | null;
    cancelledByName: string | null;
};

function formatUserDisplayName(user: { firstName: string | null; lastName: string | null; email: string | null } | null): string | null {
    if (!user) return null;
    const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim();
    return fullName || user.email || null;
}

function mapLegacyMovementType(type: InventoryAdjustmentDetailType): InventoryMovementType {
    if (type === "job_usage") return "usage";
    if (type === "purchase_receipt" || type === "reorder_receipt") return "receipt";
    return "adjustment";
}

export class InventoryRepository {
    constructor(private readonly dbInstance = db) { }

    private async getMaterialForUpdate(tx: any, organizationId: string, materialId: string): Promise<Material> {
        const [material] = await tx.select().from(materials).where(and(eq(materials.id, materialId), eq(materials.organizationId, organizationId)));
        if (!material) throw new Error("Material not found");
        return material;
    }

    private async createInventoryMovement(tx: any, input: InventoryMovementRecordInput): Promise<InventoryAdjustment> {
        const material = await this.getMaterialForUpdate(tx, input.organizationId, input.materialId);
        const movement = buildInventoryMovementSnapshot({
            movementType: input.movementType,
            detailType: input.detailType,
            currentQuantity: Number(material.stockQuantity || 0),
            quantityDelta: input.quantityDelta,
            reason: input.reason || undefined,
            notes: input.notes || undefined,
        });

        const [adjustment] = await tx.insert(inventoryAdjustments).values({
            organizationId: input.organizationId,
            materialId: input.materialId,
            movementType: movement.movementType,
            type: movement.detailType,
            quantityChange: quantityDeltaToString(movement.quantityDelta),
            quantityBefore: quantityDeltaToString(movement.quantityBefore),
            quantityAfter: quantityDeltaToString(movement.quantityAfter),
            reason: movement.reason || null,
            notes: movement.notes || null,
            orderId: input.orderId || null,
            reorderRequestId: input.reorderRequestId || null,
            userId: input.userId,
        } as any).returning();

        await tx.update(materials)
            .set({
                stockQuantity: quantityDeltaToString(movement.quantityAfter),
                updatedAt: new Date(),
            } as any)
            .where(and(eq(materials.id, input.materialId), eq(materials.organizationId, input.organizationId)));

        return adjustment;
    }

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
        type: InventoryAdjustmentDetailType,
        quantityChange: number,
        userId: string,
        reason?: string,
        orderId?: string,
        options?: { notes?: string; reorderRequestId?: string | null; movementType?: InventoryMovementType }
    ): Promise<InventoryAdjustment> {
        return await this.dbInstance.transaction(async (tx) => {
            return this.createInventoryMovement(tx, {
                organizationId,
                materialId,
                movementType: options?.movementType || mapLegacyMovementType(type),
                detailType: type,
                quantityDelta: quantityChange,
                userId,
                reason,
                notes: options?.notes || null,
                orderId: orderId || null,
                reorderRequestId: options?.reorderRequestId || null,
            });
        });
    }

    async getInventoryAdjustments(organizationId: string, materialId: string): Promise<InventoryAdjustment[]> {
        return this.dbInstance.select()
            .from(inventoryAdjustments)
            .where(and(eq(inventoryAdjustments.organizationId, organizationId), eq(inventoryAdjustments.materialId, materialId)))
            .orderBy(desc(inventoryAdjustments.createdAt));
    }

    async getOpenReorderRequestForMaterial(organizationId: string, materialId: string): Promise<MaterialReorderRequest | undefined> {
        const [request] = await this.dbInstance.select()
            .from(materialReorderRequests)
            .where(and(
                eq(materialReorderRequests.organizationId, organizationId),
                eq(materialReorderRequests.materialId, materialId),
                or(eq(materialReorderRequests.status, "requested"), eq(materialReorderRequests.status, "ordered")),
            ))
            .orderBy(desc(materialReorderRequests.requestedAt));
        return request;
    }

    async listMaterialReorderRequests(organizationId: string): Promise<MaterialReorderRequestListItem[]> {
        const rows = await this.dbInstance
            .select({
                reorderRequest: materialReorderRequests,
                materialName: materials.name,
                materialSku: materials.sku,
                currentMaterialQuantity: materials.stockQuantity,
                vendorName: vendors.name,
                requestedByFirstName: users.firstName,
                requestedByLastName: users.lastName,
                requestedByEmail: users.email,
            })
            .from(materialReorderRequests)
            .innerJoin(materials, and(eq(materials.id, materialReorderRequests.materialId), eq(materials.organizationId, organizationId)))
            .leftJoin(vendors, eq(vendors.id, materialReorderRequests.vendorId))
            .leftJoin(users, eq(users.id, materialReorderRequests.requestedByUserId))
            .where(eq(materialReorderRequests.organizationId, organizationId))
            .orderBy(desc(materialReorderRequests.requestedAt));

        return rows.map((row) => ({
            ...row.reorderRequest,
            materialName: row.materialName,
            materialSku: row.materialSku,
            currentMaterialQuantity: row.currentMaterialQuantity,
            vendorName: row.vendorName || null,
            requestedByName: formatUserDisplayName({
                firstName: row.requestedByFirstName,
                lastName: row.requestedByLastName,
                email: row.requestedByEmail,
            }),
            orderedByName: null,
            receivedByName: null,
            cancelledByName: null,
        }));
    }

    async createMaterialReorderRequest(
        organizationId: string,
        input: Omit<InsertMaterialReorderRequest, "organizationId"> & { requestedByUserId?: string | null },
    ): Promise<MaterialReorderRequest> {
        const material = await this.getMaterialById(organizationId, input.materialId);
        if (!material) throw new Error("Material not found");

        const existingOpen = await this.getOpenReorderRequestForMaterial(organizationId, input.materialId);
        assertNoOpenReorderRequest((existingOpen?.status as MaterialReorderRequestStatus | undefined) ?? undefined);

        const [created] = await this.dbInstance.insert(materialReorderRequests).values({
            organizationId,
            materialId: input.materialId,
            vendorId: input.vendorId || null,
            status: "requested",
            requestedQuantity: quantityDeltaToString(Number(input.requestedQuantity)),
            currentStockQuantity: input.currentStockQuantity == null ? null : quantityDeltaToString(Number(input.currentStockQuantity)),
            minStockAlert: input.minStockAlert == null ? null : quantityDeltaToString(Number(input.minStockAlert)),
            notes: input.notes || null,
            requestedByUserId: input.requestedByUserId || null,
        } as any).returning();

        return created;
    }

    async getMaterialReorderRequestById(organizationId: string, reorderRequestId: string): Promise<MaterialReorderRequest | undefined> {
        const [request] = await this.dbInstance.select()
            .from(materialReorderRequests)
            .where(and(eq(materialReorderRequests.id, reorderRequestId), eq(materialReorderRequests.organizationId, organizationId)));
        return request;
    }

    async markMaterialReorderRequestOrdered(organizationId: string, reorderRequestId: string, userId: string): Promise<MaterialReorderRequest> {
        const existing = await this.getMaterialReorderRequestById(organizationId, reorderRequestId);
        if (!existing) throw new Error("Reorder request not found");
        transitionMaterialReorderRequest({ currentStatus: existing.status as any, action: "mark_ordered" });

        const [updated] = await this.dbInstance.update(materialReorderRequests)
            .set({
                status: "ordered",
                orderedByUserId: userId,
                orderedAt: new Date(),
                updatedAt: new Date(),
            } as any)
            .where(and(eq(materialReorderRequests.id, reorderRequestId), eq(materialReorderRequests.organizationId, organizationId)))
            .returning();
        if (!updated) throw new Error("Reorder request not found");
        return updated;
    }

    async cancelMaterialReorderRequest(organizationId: string, reorderRequestId: string, userId: string): Promise<MaterialReorderRequest> {
        const existing = await this.getMaterialReorderRequestById(organizationId, reorderRequestId);
        if (!existing) throw new Error("Reorder request not found");
        transitionMaterialReorderRequest({ currentStatus: existing.status as any, action: "cancel" });

        const [updated] = await this.dbInstance.update(materialReorderRequests)
            .set({
                status: "cancelled",
                cancelledByUserId: userId,
                cancelledAt: new Date(),
                updatedAt: new Date(),
            } as any)
            .where(and(eq(materialReorderRequests.id, reorderRequestId), eq(materialReorderRequests.organizationId, organizationId)))
            .returning();
        if (!updated) throw new Error("Reorder request not found");
        return updated;
    }

    async receiveMaterialReorderRequest(
        organizationId: string,
        reorderRequestId: string,
        receivedQuantity: number,
        userId: string,
        notes?: string,
    ): Promise<{ reorderRequest: MaterialReorderRequest; adjustment: InventoryAdjustment }> {
        return this.dbInstance.transaction(async (tx) => {
            const [existing] = await tx.select()
                .from(materialReorderRequests)
                .where(and(eq(materialReorderRequests.id, reorderRequestId), eq(materialReorderRequests.organizationId, organizationId)));

            if (!existing) throw new Error("Reorder request not found");
            transitionMaterialReorderRequest({ currentStatus: existing.status as any, action: "receive" });

            const adjustment = await this.createInventoryMovement(tx, {
                organizationId,
                materialId: existing.materialId,
                movementType: "receipt",
                detailType: "reorder_receipt",
                quantityDelta: receivedQuantity,
                userId,
                reason: "reorder_received",
                notes: notes || null,
                reorderRequestId,
            });

            const [updated] = await tx.update(materialReorderRequests)
                .set({
                    status: "received",
                    receivedQuantity: quantityDeltaToString(receivedQuantity),
                    receivedByUserId: userId,
                    receivedAt: new Date(),
                    notes: notes || existing.notes || null,
                    updatedAt: new Date(),
                } as any)
                .where(and(eq(materialReorderRequests.id, reorderRequestId), eq(materialReorderRequests.organizationId, organizationId)))
                .returning();

            if (!updated) throw new Error("Reorder request not found");

            return { reorderRequest: updated, adjustment };
        });
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

function quantityDeltaToString(value: number): string {
    return value.toFixed(2);
}
