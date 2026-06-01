import { db } from "../db";
import {
    materials,
    materialProductLinks,
    products,
    inventoryAdjustments,
    materialReorderRequests,
    orderMaterialUsage,
    orderLineItems,
    users,
    vendors,
    type Material,
    type Product,
    type InsertMaterial,
    type InventoryAdjustment,
    type MaterialReorderRequest,
    type InsertMaterialReorderRequest,
    type OrderMaterialUsage,
    type InsertOrderMaterialUsage,
} from "@shared/schema";
import type { InventoryMovementType, MaterialReorderRequestStatus } from "@shared/materialInventory";
import { normalizeLinkedProductIds, planMaterialProductLinkReplacement } from "@shared/materialProductLinks";
import { eq, and, desc, sql, or, inArray, isNull, notInArray } from "drizzle-orm";
import {
    assertNoOpenReorderRequest,
    buildInventoryMovementSnapshot,
    transitionMaterialReorderRequest,
    type InventoryAdjustmentDetailType,
} from "../services/materialInventoryLogic";
import { canAutoDeductMaterialStock } from "../lib/materialStockDeductionGuard";
import { normalizeMaterialWeightMetadata } from "../../shared/materialWeight";

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

function withMaterialUnitFallbacks<T extends { unitOfMeasure?: string | null }>(material: T): T {
    const unitOfMeasure = material.unitOfMeasure;
    if (!unitOfMeasure) return material;
    const sellPriceUnit = (material as any).sellPriceUnit || unitOfMeasure;
    return {
        ...material,
        inventoryUnit: (material as any).inventoryUnit || unitOfMeasure,
        sellPriceUnit,
        wholesalePriceUnit: (material as any).wholesalePriceUnit || sellPriceUnit || unitOfMeasure,
        vendorCostUnit: (material as any).vendorCostUnit || unitOfMeasure,
        // TODO(material-units): consumptionUnit remains informational until conversion factors
        // exist for roll sqft conversion, sheet yield conversion, and partial depletion tracking.
        consumptionUnit: (material as any).consumptionUnit || sellPriceUnit || unitOfMeasure,
    };
}

function hasOwn(object: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function hasMaterialWeightFields(material: object): boolean {
    return (
        hasOwn(material, "weightValue") ||
        hasOwn(material, "weightUnit") ||
        hasOwn(material, "weightBasis") ||
        hasOwn(material, "weightOzPerBasis")
    );
}

function normalizeMaterialWeightFields<T extends Record<string, any>>(material: T, opts?: { preserveWhenAbsent?: boolean }): T {
    if (opts?.preserveWhenAbsent && !hasMaterialWeightFields(material)) {
        return material;
    }

    const weightValue = material.weightValue;
    const valueMissing = weightValue === null || weightValue === undefined || weightValue === "";
    if (valueMissing) {
        return {
            ...material,
            weightValue: null,
            weightUnit: null,
            weightBasis: null,
            weightOzPerBasis: null,
        };
    }

    const result = normalizeMaterialWeightMetadata({
        weightValue,
        weightUnit: material.weightUnit,
        weightBasis: material.weightBasis,
    });

    if (!result.success || result.weightOzPerBasis === undefined) {
        const error = new Error(result.message || "Invalid material weight metadata");
        (error as any).code = result.errorCode || "MATERIAL_WEIGHT_INVALID";
        throw error;
    }

    return {
        ...material,
        weightOzPerBasis: result.weightOzPerBasis.toFixed(6),
    };
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
        const { linkedProductIds: _linkedProductIds, ...materialFields } = material as any;
        const materialWithUnitFallbacks = withMaterialUnitFallbacks(materialFields);
        const materialWithWeight = normalizeMaterialWeightFields(materialWithUnitFallbacks as any);
        const [created] = await this.dbInstance.insert(materials).values({ ...materialWithWeight, organizationId } as any).returning();
        return created;
    }

    async updateMaterial(organizationId: string, id: string, materialData: Partial<InsertMaterial>): Promise<Material> {
        const { linkedProductIds: _linkedProductIds, ...materialFields } = materialData as any;
        const materialWithWeight = normalizeMaterialWeightFields(materialFields as any, { preserveWhenAbsent: true });
        const [updated] = await this.dbInstance.update(materials)
            .set({ ...materialWithWeight, updatedAt: new Date() } as any)
            .where(and(eq(materials.id, id), eq(materials.organizationId, organizationId)))
            .returning();
        if (!updated) throw new Error('Material not found');
        return updated;
    }

    async deleteMaterial(organizationId: string, id: string): Promise<void> {
        await this.dbInstance.delete(materials).where(and(eq(materials.id, id), eq(materials.organizationId, organizationId)));
    }

    async listProductsForMaterial(
        organizationId: string,
        materialId: string,
        options?: { activeOnly?: boolean }
    ): Promise<Product[]> {
        const where = [
            eq(materialProductLinks.organizationId, organizationId),
            eq(materialProductLinks.materialId, materialId),
            isNull(materialProductLinks.removedAt),
            eq(products.organizationId, organizationId),
        ];
        if (options?.activeOnly) where.push(eq(products.isActive, true));

        const rows = await this.dbInstance
            .select({ product: products })
            .from(materialProductLinks)
            .innerJoin(products, eq(products.id, materialProductLinks.productId))
            .where(and(...where))
            .orderBy(products.name);

        return rows.map((row: any) => row.product);
    }

    async replaceProductsForMaterial(
        organizationId: string,
        materialId: string,
        productIds: string[]
    ): Promise<{ linkedProductIds: string[]; ignoredProductIds: string[] }> {
        const material = await this.getMaterialById(organizationId, materialId);
        if (!material) throw new Error("Material not found");

        const requestedProductIds = normalizeLinkedProductIds(productIds);

        const validProducts = requestedProductIds.length > 0
            ? await this.dbInstance
                .select({ id: products.id, isActive: products.isActive })
                .from(products)
                .where(and(
                    eq(products.organizationId, organizationId),
                    inArray(products.id, requestedProductIds)
                ))
            : [];

        const existingLinks = await this.dbInstance
            .select({
                productId: materialProductLinks.productId,
                removedAt: materialProductLinks.removedAt,
            })
            .from(materialProductLinks)
            .where(and(
                eq(materialProductLinks.organizationId, organizationId),
                eq(materialProductLinks.materialId, materialId)
            ));

        const plan = planMaterialProductLinkReplacement(requestedProductIds, validProducts, existingLinks);
        const validProductIds = plan.linkedProductIds;

        await this.dbInstance.transaction(async (tx) => {
            const now = new Date();

            if (validProductIds.length > 0) {
                await tx.insert(materialProductLinks)
                    .values(validProductIds.map((productId) => ({
                        organizationId,
                        materialId,
                        productId,
                        updatedAt: now,
                        removedAt: null,
                    })))
                    .onConflictDoUpdate({
                        target: [
                            materialProductLinks.organizationId,
                            materialProductLinks.materialId,
                            materialProductLinks.productId,
                        ],
                        set: {
                            removedAt: null,
                            updatedAt: now,
                        },
                    });

                await tx.update(materialProductLinks)
                    .set({ removedAt: now, updatedAt: now })
                    .where(and(
                        eq(materialProductLinks.organizationId, organizationId),
                        eq(materialProductLinks.materialId, materialId),
                        isNull(materialProductLinks.removedAt),
                        notInArray(materialProductLinks.productId, validProductIds)
                    ));
            } else {
                await tx.update(materialProductLinks)
                    .set({ removedAt: now, updatedAt: now })
                    .where(and(
                        eq(materialProductLinks.organizationId, organizationId),
                        eq(materialProductLinks.materialId, materialId),
                        isNull(materialProductLinks.removedAt)
                    ));
            }
        });

        return { linkedProductIds: validProductIds, ignoredProductIds: plan.ignoredProductIds };
    }

    async listMaterialsForProduct(
        organizationId: string,
        productId: string,
        options?: { activeOnly?: boolean }
    ): Promise<Material[]> {
        const where = [
            eq(materialProductLinks.organizationId, organizationId),
            eq(materialProductLinks.productId, productId),
            isNull(materialProductLinks.removedAt),
            eq(materials.organizationId, organizationId),
        ];
        if (options?.activeOnly) where.push(eq(materials.isActive, true));

        const rows = await this.dbInstance
            .select({ material: materials })
            .from(materialProductLinks)
            .innerJoin(materials, eq(materials.id, materialProductLinks.materialId))
            .where(and(...where))
            .orderBy(materials.name);

        return rows.map((row: any) => row.material);
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
    async autoDeductInventoryWhenOrderMovesToProduction(organizationId: string, orderId: string, userId: string): Promise<{
        deductedCount: number;
        skippedStockDeductionCount: number;
        warnings: Array<{
            lineItemId: string;
            materialId: string;
            materialUom: string | null;
            usageUom: string | null;
            reason: string;
        }>;
    }> {
        const lineItems = await this.dbInstance.select()
            .from(orderLineItems)
            .where(eq(orderLineItems.orderId, orderId));

        let deductedCount = 0;
        let skippedStockDeductionCount = 0;
        const warnings: Array<{
            lineItemId: string;
            materialId: string;
            materialUom: string | null;
            usageUom: string | null;
            reason: string;
        }> = [];

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
            let usageUom = material.unitOfMeasure;
            if (material.type === 'sheet') {
                quantityNeeded = lineItem.nestingConfigSnapshot?.totalSheets || lineItem.quantity;
                usageUom = "sheet";
            } else if (material.type === 'roll' && material.unitOfMeasure === 'sqft') {
                quantityNeeded = parseFloat(lineItem.sqft?.toString() || '0');
                usageUom = "sqft";
            } else {
                quantityNeeded = lineItem.quantity;
            }
            if (quantityNeeded <= 0) continue;

            // TODO(material-units): consumptionUnit is informational until explicit roll/sheet
            // conversion factors and partial depletion tracking exist.
            const deductionDecision = canAutoDeductMaterialStock(material, usageUom);

            await this.dbInstance.insert(orderMaterialUsage).values({
                orderId,
                orderLineItemId: lineItem.id,
                materialId: lineItem.materialId,
                quantityUsed: `${quantityNeeded}`,
                unitOfMeasure: usageUom,
                calculatedBy: 'auto',
            } as any);

            if (!deductionDecision.allowed) {
                skippedStockDeductionCount += 1;
                warnings.push({
                    lineItemId: lineItem.id,
                    materialId: lineItem.materialId,
                    materialUom: deductionDecision.materialUom,
                    usageUom: deductionDecision.usageUom,
                    reason: deductionDecision.reason,
                });
                console.warn("[InventoryDeductionGuard] Skipped automatic stock deduction", {
                    organizationId,
                    orderId,
                    lineItemId: lineItem.id,
                    materialId: lineItem.materialId,
                    materialUom: deductionDecision.materialUom,
                    usageUom: deductionDecision.usageUom,
                    reason: deductionDecision.reason,
                });
                continue;
            }

            await this.adjustInventory(
                organizationId,
                lineItem.materialId,
                'job_usage',
                -quantityNeeded,
                userId,
                `Auto-deducted for order ${orderId}, line item: ${lineItem.description}`,
                orderId
            );
            deductedCount += 1;
        }

        return { deductedCount, skippedStockDeductionCount, warnings };
    }
}

function quantityDeltaToString(value: number): string {
    return value.toFixed(2);
}
