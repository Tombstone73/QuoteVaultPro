import { db } from "../db";
import {
    vendors,
    purchaseOrders,
    purchaseOrderLineItems,
    globalVariables,
    materials,
    type Vendor,
    type InsertVendor,
    type PurchaseOrder,
    type PurchaseOrderLineItem,
    type InsertPurchaseOrder,
    type UpdatePurchaseOrder,
} from "@shared/schema";
import { eq, and, or, gte, lte, ilike, desc, sql } from "drizzle-orm";

export class AccountingRepository {
    constructor(private readonly dbInstance = db) { }

    // Vendor Operations
    async getVendors(organizationId: string, filters?: { search?: string; isActive?: boolean; page?: number; pageSize?: number }): Promise<Vendor[]> {
        const conditions: any[] = [eq(vendors.organizationId, organizationId)];
        if (filters?.search) {
            const s = `%${filters.search}%`;
            conditions.push(or(ilike(vendors.name, s), ilike(vendors.email, s), ilike(vendors.phone, s)));
        }
        if (typeof filters?.isActive === 'boolean') {
            conditions.push(eq(vendors.isActive, filters.isActive));
        }
        const page = filters?.page && filters.page > 0 ? filters.page : 1;
        const pageSize = filters?.pageSize && filters.pageSize > 0 ? filters.pageSize : 50;
        const offset = (page - 1) * pageSize;
        return await this.dbInstance.select().from(vendors).where(and(...conditions)).orderBy(vendors.name).limit(pageSize).offset(offset);
    }

    async getVendorById(organizationId: string, id: string): Promise<Vendor | undefined> {
        const [v] = await this.dbInstance.select().from(vendors).where(and(eq(vendors.id, id), eq(vendors.organizationId, organizationId)));
        return v;
    }

    async createVendor(organizationId: string, data: Omit<InsertVendor, 'organizationId'>): Promise<Vendor> {
        const [created] = await this.dbInstance.insert(vendors).values({ ...data, organizationId } as any).returning();
        return created;
    }

    async updateVendor(organizationId: string, id: string, data: Partial<Omit<InsertVendor, 'organizationId'>>): Promise<Vendor> {
        const [updated] = await this.dbInstance.update(vendors).set({ ...data, updatedAt: new Date() } as any).where(and(eq(vendors.id, id), eq(vendors.organizationId, organizationId))).returning();
        if (!updated) throw new Error('Vendor not found');
        return updated;
    }

    async deleteVendor(organizationId: string, id: string): Promise<void> {
        // Soft delete if vendor has purchase orders; hard delete otherwise
        const existingPO = await this.dbInstance.select({ id: purchaseOrders.id }).from(purchaseOrders).where(and(eq(purchaseOrders.vendorId, id), eq(purchaseOrders.organizationId, organizationId))).limit(1);
        if (existingPO.length) {
            await this.dbInstance.update(vendors).set({ isActive: false, updatedAt: new Date() } as any).where(and(eq(vendors.id, id), eq(vendors.organizationId, organizationId)));
        } else {
            await this.dbInstance.delete(vendors).where(and(eq(vendors.id, id), eq(vendors.organizationId, organizationId)));
        }
    }

    // Purchase Order Operations
    private async generateNextPoNumber(organizationId: string, tx?: any): Promise<string> {
        const executor = tx || this.dbInstance;
        try {
            const result = await executor.execute(sql`SELECT * FROM ${globalVariables} WHERE ${globalVariables.name} = 'next_po_number' AND ${globalVariables.organizationId} = ${organizationId} FOR UPDATE`);
            const row = (result as any).rows?.[0];
            if (row) {
                const current = Math.floor(Number(row.value));
                await executor.update(globalVariables).set({ value: (current + 1).toString(), updatedAt: new Date() }).where(and(eq(globalVariables.id, row.id), eq(globalVariables.organizationId, organizationId)));
                return `PO-${current}`;
            }
        } catch { }
        const maxRes = await this.dbInstance.execute(sql`SELECT MAX(CAST(SUBSTRING(po_number FROM 4) AS INTEGER)) AS max_num FROM purchase_orders WHERE po_number ~ '^PO-[0-9]+$' AND organization_id = ${organizationId}`);
        const maxNum = (maxRes as any).rows?.[0]?.max_num ? Number((maxRes as any).rows[0].max_num) : 1000;
        return `PO-${maxNum + 1}`;
    }

    async getPurchaseOrders(organizationId: string, filters?: { vendorId?: string; status?: string; search?: string; startDate?: string; endDate?: string }): Promise<PurchaseOrder[]> {
        const conditions: any[] = [eq(purchaseOrders.organizationId, organizationId)];
        if (filters?.vendorId) conditions.push(eq(purchaseOrders.vendorId, filters.vendorId));
        if (filters?.status) conditions.push(eq(purchaseOrders.status, filters.status));
        if (filters?.search) {
            const s = `%${filters.search}%`;
            conditions.push(or(ilike(purchaseOrders.poNumber, s), ilike(purchaseOrders.notes, s)));
        }
        if (filters?.startDate) conditions.push(gte(purchaseOrders.issueDate, new Date(filters.startDate)));
        if (filters?.endDate) conditions.push(lte(purchaseOrders.issueDate, new Date(filters.endDate)));
        return await this.dbInstance.select().from(purchaseOrders).where(and(...conditions)).orderBy(desc(purchaseOrders.createdAt));
    }

    async getPurchaseOrderWithLines(organizationId: string, id: string): Promise<(PurchaseOrder & { vendor?: Vendor | null; lineItems: PurchaseOrderLineItem[] }) | undefined> {
        const [po] = await this.dbInstance.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId)));
        if (!po) return undefined;
        const vendorRecord = await this.getVendorById(organizationId, po.vendorId);
        const lines = await this.dbInstance.select().from(purchaseOrderLineItems).where(eq(purchaseOrderLineItems.purchaseOrderId, id)).orderBy(purchaseOrderLineItems.createdAt as any);
        return { ...po, vendor: vendorRecord || null, lineItems: lines } as any;
    }

    async createPurchaseOrder(organizationId: string, data: Omit<InsertPurchaseOrder, 'organizationId'> & { createdByUserId: string }): Promise<PurchaseOrder & { lineItems: PurchaseOrderLineItem[] }> {
        return await this.dbInstance.transaction(async (tx) => {
            const poNumber = await this.generateNextPoNumber(organizationId, tx);
            const lineValues = data.lineItems.map(li => {
                const lineTotal = Number(li.quantityOrdered) * Number(li.unitCost);
                return { ...li, lineTotal: lineTotal.toFixed(4) } as any;
            });
            const subtotal = lineValues.reduce((sum, li) => sum + Number(li.lineTotal), 0);
            const taxTotal = 0;
            const shippingTotal = 0;
            const grandTotal = subtotal + taxTotal + shippingTotal;
            const insertPO: any = {
                organizationId,
                poNumber,
                vendorId: data.vendorId,
                status: 'draft',
                issueDate: typeof data.issueDate === 'string' ? new Date(data.issueDate) : data.issueDate,
                expectedDate: data.expectedDate ? (typeof data.expectedDate === 'string' ? new Date(data.expectedDate) : data.expectedDate) : null,
                notes: (data as any).notes || null,
                subtotal: subtotal.toFixed(2),
                taxTotal: taxTotal.toFixed(2),
                shippingTotal: shippingTotal.toFixed(2),
                grandTotal: grandTotal.toFixed(2),
                createdByUserId: data.createdByUserId,
            };
            const [created] = await tx.insert(purchaseOrders).values(insertPO).returning();
            for (const lv of lineValues) {
                await tx.insert(purchaseOrderLineItems).values({ ...lv, purchaseOrderId: created.id } as any);
            }
            const lines = await tx.select().from(purchaseOrderLineItems).where(eq(purchaseOrderLineItems.purchaseOrderId, created.id));
            return { ...created, lineItems: lines } as any;
        });
    }

    async updatePurchaseOrder(organizationId: string, id: string, data: UpdatePurchaseOrder): Promise<PurchaseOrder & { lineItems: PurchaseOrderLineItem[] }> {
        return await this.dbInstance.transaction(async (tx) => {
            const existing = await this.getPurchaseOrderWithLines(organizationId, id);
            if (!existing) throw new Error('Purchase order not found');
            if (['received', 'cancelled'].includes(existing.status)) throw new Error('Cannot modify a finalized purchase order');
            const headerUpdates: any = {};
            if (data.expectedDate !== undefined) headerUpdates.expectedDate = data.expectedDate || null;
            if (data.notes !== undefined) headerUpdates.notes = (data as any).notes || null;
            if (data.status) headerUpdates.status = data.status;
            if (Object.keys(headerUpdates).length) headerUpdates.updatedAt = new Date();
            if (Object.keys(headerUpdates).length) await tx.update(purchaseOrders).set(headerUpdates).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId)));
            if (Array.isArray((data as any).lineItems)) {
                await tx.delete(purchaseOrderLineItems).where(eq(purchaseOrderLineItems.purchaseOrderId, id));
                const newLines: any[] = (data as any).lineItems.map((li: any) => {
                    const lineTotal = Number(li.quantityOrdered) * Number(li.unitCost);
                    return { ...li, purchaseOrderId: id, lineTotal: lineTotal.toFixed(4) };
                });
                for (const nl of newLines) await tx.insert(purchaseOrderLineItems).values(nl);
                const subtotal = newLines.reduce((sum, li) => sum + Number(li.lineTotal), 0);
                const grandTotal = subtotal;
                await tx.update(purchaseOrders).set({ subtotal: subtotal.toFixed(2), grandTotal: grandTotal.toFixed(2), updatedAt: new Date() }).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId)));
            }
            const updated = await this.getPurchaseOrderWithLines(organizationId, id);
            return updated as any;
        });
    }

    async deletePurchaseOrder(organizationId: string, id: string): Promise<void> {
        const existing = await this.getPurchaseOrderWithLines(organizationId, id);
        if (!existing) return;
        if (existing.status !== 'draft') throw new Error('Only draft purchase orders can be deleted');
        if (existing.lineItems.some((li: any) => Number(li.quantityReceived) > 0)) throw new Error('Cannot delete PO with received items');
        await this.dbInstance.delete(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId)));
    }

    async sendPurchaseOrder(organizationId: string, id: string): Promise<PurchaseOrder> {
        const [updated] = await this.dbInstance.update(purchaseOrders).set({ status: 'sent', updatedAt: new Date() } as any).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId))).returning();
        if (!updated) throw new Error('Purchase order not found');
        return updated;
    }

    async receivePurchaseOrderLines(organizationId: string, purchaseOrderId: string, items: { lineItemId: string; quantityToReceive: number; receivedDate?: Date }[], userId: string, adjustInventoryFn: (organizationId: string, materialId: string, type: "manual_increase" | "manual_decrease" | "waste" | "shrinkage" | "job_usage" | "purchase_receipt", quantityChange: number, userId: string, reason?: string, orderId?: string) => Promise<any>): Promise<PurchaseOrder & { lineItems: PurchaseOrderLineItem[] }> {
        return await this.dbInstance.transaction(async (tx) => {
            const existing = await this.getPurchaseOrderWithLines(organizationId, purchaseOrderId);
            if (!existing) throw new Error('Purchase order not found');
            if (['cancelled', 'received'].includes(existing.status)) throw new Error('Cannot receive a finalized purchase order');
            const receivedDate = items.some(i => i.receivedDate) ? items[0].receivedDate : new Date();
            for (const item of items) {
                if (item.quantityToReceive <= 0) continue;
                const line = existing.lineItems.find(li => li.id === item.lineItemId);
                if (!line) throw new Error('Line item not found');
                const remaining = Number(line.quantityOrdered) - Number(line.quantityReceived);
                if (item.quantityToReceive > remaining) throw new Error('Cannot receive more than ordered');
                const newReceived = Number(line.quantityReceived) + item.quantityToReceive;
                await tx.update(purchaseOrderLineItems).set({ quantityReceived: newReceived.toFixed(2), updatedAt: new Date() } as any).where(eq(purchaseOrderLineItems.id, (line as any).id));
                if ((line as any).materialId) {
                    await adjustInventoryFn(organizationId, (line as any).materialId, 'purchase_receipt', item.quantityToReceive, userId, `PO receipt ${existing.poNumber}`);
                    await tx.update(materials).set({ vendorCostPerUnit: (line as any).unitCost, updatedAt: new Date() } as any).where(and(eq(materials.id, (line as any).materialId), eq(materials.organizationId, organizationId)));
                }
            }
            const updated = await this.getPurchaseOrderWithLines(organizationId, purchaseOrderId);
            if (!updated) throw new Error('PO disappeared');
            const allReceived = updated.lineItems.every(li => Number(li.quantityReceived) >= Number(li.quantityOrdered));
            const anyReceived = updated.lineItems.some(li => Number(li.quantityReceived) > 0);
            let newStatus = updated.status;
            if (allReceived) newStatus = 'received'; else if (anyReceived && updated.status !== 'sent') newStatus = 'partially_received';
            const headerUpdate: any = { status: newStatus, updatedAt: new Date() };
            if (newStatus === 'received') headerUpdate.receivedDate = receivedDate;
            await tx.update(purchaseOrders).set(headerUpdate).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, organizationId)));
            const finalPO = await this.getPurchaseOrderWithLines(organizationId, purchaseOrderId);
            return finalPO as any;
        });
    }
}
