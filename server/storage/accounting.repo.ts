import { db } from "../db";
import {
    auditLogs, companySettings, orders, vendors, purchaseOrderRevisions, type PurchaseOrderSnapshot,
    purchaseOrders,
    purchaseOrderLineItems,
    materials,
    type Vendor,
    type InsertVendor,
    type PurchaseOrder,
    type PurchaseOrderLineItem,
    type InsertPurchaseOrder,
    type UpdatePurchaseOrder,
} from "@shared/schema";
import {
    editablePurchaseOrderStatuses, receivablePurchaseOrderStatuses, purchaseLineTotal, purchaseTotals,
    scaledDecimal, formatScaledDecimal, roundPurchaseDecimal, type ActualPurchaseCost, type ActualPurchaseCostInput,
} from "@shared/purchaseOrderWorkflow";
import type { InventoryRepository } from "./inventory.repo";
import { generatePurchaseOrderPdf } from "../lib/purchaseOrderPdf";
import { recoverPurchaseOrderIssuance } from "../lib/purchaseOrderLegacyBaseline";
import { formatNormalizedMaterialCost } from "@shared/materialVendorCost";
import { eq, and, or, gte, lte, ilike, desc, getTableColumns, sql } from "drizzle-orm";
import {
    allocateDocumentNumber,
    isDocumentNumberUniqueViolation,
    toDocumentNumberConflictError,
} from "../services/documentNumberingService";

type PurchaseOrderTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PurchaseOrderExecutor = typeof db | PurchaseOrderTransaction;

export type PurchaseOrderActor = { userId: string; userName?: string | null; ipAddress?: string; userAgent?: string };
function poError(message: string, statusCode = 400) {
    return Object.assign(new Error(message), { statusCode });
}

type PurchaseOrderRelatedOrderSummary = {
    id: string;
    orderNumber: string | null;
    displayNumber: string | null;
    jobNumber: string | null;
    customerName: string | null;
    status: string | null;
    state: string | null;
    primaryDescription: string | null;
    dueDate: string | Date | null;
    createdAt: string | Date | null;
    poNumber: string | null;
    label: string | null;
};

export class AccountingRepository {
    constructor(private readonly dbInstance = db) { }

    // Vendor Operations
    async getVendors(organizationId: string, filters?: { search?: string; isActive?: boolean; page?: number; pageSize?: number }): Promise<Vendor[]> {
        const conditions: any[] = [eq(vendors.organizationId, organizationId)];
        if (filters?.search) {
            const s = `%${filters.search}%`;
            conditions.push(or(
                ilike(vendors.name, s),
                ilike(vendors.email, s),
                ilike(vendors.phone, s),
                ilike(vendors.salesRepName, s),
                ilike(vendors.salesRepEmail, s),
                ilike(vendors.salesRepPhone, s),
                ilike(vendors.leadTimeText, s),
            ));
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
        const { displayNumber } = await allocateDocumentNumber(organizationId, "purchase_order", executor);
        return displayNumber;
    }

    async getMaxPurchaseOrderNumber(organizationId: string): Promise<number | null> {
        const result = await this.dbInstance.execute(
            sql`SELECT MAX(NULLIF(regexp_replace(po_number, '\\D', '', 'g'), '')::integer) AS max_num FROM purchase_orders WHERE organization_id = ${organizationId}`
        );
        const val = (result as any).rows?.[0]?.max_num;
        return val != null ? Number(val) : null;
    }

    private async getRelatedOrderSummary(organizationId: string, orderId: string, executor: any = this.dbInstance): Promise<PurchaseOrderRelatedOrderSummary | null> {
        const result = await executor.execute(sql`
            SELECT
                o.id,
                o.order_number AS "orderNumber",
                o.display_number AS "displayNumber",
                o.order_number AS "jobNumber",
                c.company_name AS "customerName",
                o.status,
                o.state,
                o.due_date AS "dueDate",
                o.created_at AS "createdAt",
                o.po_number AS "poNumber",
                o.label,
                (
                    SELECT oli.description
                    FROM order_line_items oli
                    WHERE oli.order_id = o.id
                    ORDER BY oli.sort_order ASC, oli.created_at ASC
                    LIMIT 1
                ) AS "primaryDescription"
            FROM orders o
            LEFT JOIN customers c
              ON c.id = o.customer_id
             AND c.organization_id = ${organizationId}
            WHERE o.organization_id = ${organizationId}
              AND o.id = ${orderId}
            LIMIT 1
        `);
        const rows = Array.isArray(result) ? result : ((result as any)?.rows ?? []);
        return rows[0] ?? null;
    }

    async getPurchaseOrderRelatedOrder(organizationId: string, orderId: string): Promise<PurchaseOrderRelatedOrderSummary | null> {
        return this.getRelatedOrderSummary(organizationId, orderId);
    }

    private async assertRelatedOrderIsLinkable(organizationId: string, orderId: string | null | undefined, executor: any = this.dbInstance): Promise<string | null> {
        if (!orderId) return null;
        const relatedOrder = await this.getRelatedOrderSummary(organizationId, orderId, executor);
        if (!relatedOrder) {
            const error = new Error("Related Job / Order was not found for this organization.");
            (error as any).statusCode = 400;
            (error as any).code = "RELATED_ORDER_NOT_FOUND";
            throw error;
        }
        if (/^TEMP[-_]/i.test(String(relatedOrder.orderNumber ?? relatedOrder.displayNumber ?? ""))) {
            const error = new Error("Related Job / Order must be a permanent order.");
            (error as any).statusCode = 400;
            (error as any).code = "RELATED_ORDER_TEMP";
            throw error;
        }
        return relatedOrder.id;
    }

    async searchPurchaseOrderRelatedOrders(organizationId: string, options: { query?: string; limit?: number; recent?: boolean } = {}): Promise<PurchaseOrderRelatedOrderSummary[]> {
        const query = String(options.query ?? "").trim();
        const limit = Math.min(25, Math.max(1, Number(options.limit) || 10));
        const recent = Boolean(options.recent);

        if (!recent && query.length < 2) return [];

        const pattern = `%${query}%`;
        const searchFilter = recent && query.length < 2
            ? sql`o.state <> 'canceled' AND o.status <> 'canceled'`
            : sql`(
                o.order_number ILIKE ${pattern}
                OR o.display_number ILIKE ${pattern}
                OR o.po_number ILIKE ${pattern}
                OR o.label ILIKE ${pattern}
                OR c.company_name ILIKE ${pattern}
                OR EXISTS (
                    SELECT 1
                    FROM order_line_items oli_search
                    WHERE oli_search.order_id = o.id
                      AND oli_search.description ILIKE ${pattern}
                )
            )`;

        const result = await this.dbInstance.execute(sql`
            SELECT
                o.id,
                o.order_number AS "orderNumber",
                o.display_number AS "displayNumber",
                o.order_number AS "jobNumber",
                c.company_name AS "customerName",
                o.status,
                o.state,
                o.due_date AS "dueDate",
                o.created_at AS "createdAt",
                o.po_number AS "poNumber",
                o.label,
                (
                    SELECT oli.description
                    FROM order_line_items oli
                    WHERE oli.order_id = o.id
                    ORDER BY oli.sort_order ASC, oli.created_at ASC
                    LIMIT 1
                ) AS "primaryDescription"
            FROM orders o
            LEFT JOIN customers c
              ON c.id = o.customer_id
             AND c.organization_id = ${organizationId}
            WHERE o.organization_id = ${organizationId}
              AND ${searchFilter}
            ORDER BY o.created_at DESC
            LIMIT ${limit}
        `);
        return Array.isArray(result) ? result as PurchaseOrderRelatedOrderSummary[] : (((result as any)?.rows ?? []) as PurchaseOrderRelatedOrderSummary[]);
    }

    async getPurchaseOrders(organizationId: string, filters?: { vendorId?: string; status?: string; search?: string; startDate?: string; endDate?: string }) {
        const conditions = [eq(purchaseOrders.organizationId, organizationId)];
        if (filters?.vendorId) conditions.push(eq(purchaseOrders.vendorId, filters.vendorId));
        if (filters?.status) conditions.push(eq(purchaseOrders.status, filters.status));
        if (filters?.search) {
            const s = "%" + filters.search + "%";
            conditions.push(or(ilike(purchaseOrders.poNumber, s), ilike(purchaseOrders.notes, s))!);
        }
        if (filters?.startDate) conditions.push(gte(purchaseOrders.issueDate, new Date(filters.startDate)));
        if (filters?.endDate) conditions.push(lte(purchaseOrders.issueDate, new Date(filters.endDate)));
        const { actualCosts, ...summaryColumns } = getTableColumns(purchaseOrders);
        const rows = await this.dbInstance.select({
            po: summaryColumns,
            vendor: { id: vendors.id, name: vendors.name },
            relatedOrder: { id: orders.id, orderNumber: orders.orderNumber, displayNumber: orders.displayNumber },
            itemSummary: sql<string | null>`(
                SELECT string_agg(summary.description, ', ') FROM (
                    SELECT description FROM purchase_order_line_items
                    WHERE purchase_order_id = ${purchaseOrders.id}
                    ORDER BY position, created_at, id LIMIT 2
                ) summary
            )`,
        }).from(purchaseOrders)
            .leftJoin(vendors, and(eq(vendors.id, purchaseOrders.vendorId), eq(vendors.organizationId, organizationId)))
            .leftJoin(orders, and(eq(orders.id, purchaseOrders.relatedOrderId), eq(orders.organizationId, organizationId)))
            .where(and(...conditions)).orderBy(desc(purchaseOrders.createdAt));
        return rows.map(({ po, ...details }) => ({ ...po, ...details }));
    }

    private poScope(organizationId: string, id: string) {
        return and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId));
    }

    private async lockPurchaseOrder(tx: PurchaseOrderTransaction, organizationId: string, id: string, expectedVersion?: number) {
        const [po] = await tx.select().from(purchaseOrders).where(this.poScope(organizationId, id)).for('update');
        if (!po) throw poError('Purchase order not found.', 404);
        if (expectedVersion !== undefined && po.version !== expectedVersion) {
            throw poError('This purchase order changed. Reload the saved version before retrying; keep a copy of your edits.', 409);
        }
        return po;
    }

    private readLines(executor: PurchaseOrderExecutor, id: string) {
        return executor.select().from(purchaseOrderLineItems)
            .where(eq(purchaseOrderLineItems.purchaseOrderId, id))
            .orderBy(purchaseOrderLineItems.position, purchaseOrderLineItems.createdAt, purchaseOrderLineItems.id);
    }

    private readPurchaseOrderActivity(executor: PurchaseOrderExecutor, organizationId: string, id: string, action?: string) {
        return executor.select().from(auditLogs).where(and(eq(auditLogs.organizationId, organizationId),
            eq(auditLogs.entityType, 'purchase_order'), eq(auditLogs.entityId, id), action ? eq(auditLogs.actionType, action) : undefined))
            .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id));
    }

    private async hydratePurchaseOrder(executor: PurchaseOrderExecutor, po: PurchaseOrder, lines?: PurchaseOrderLineItem[]) {
        const [vendor] = await executor.select().from(vendors).where(and(eq(vendors.id, po.vendorId), eq(vendors.organizationId, po.organizationId)));
        const relatedOrder = po.relatedOrderId ? await this.getRelatedOrderSummary(po.organizationId, po.relatedOrderId, executor) : null;
        return { ...po, vendor: vendor ?? null, relatedOrder, lineItems: lines ?? await this.readLines(executor, po.id) };
    }

    async getPurchaseOrderWithLines(organizationId: string, id: string) {
        return this.dbInstance.transaction(async tx => {
            const [po] = await tx.select().from(purchaseOrders).where(this.poScope(organizationId, id)).for('share');
            if (!po) return undefined;
            const hydrated = await this.hydratePurchaseOrder(tx, po);
            const revisions = await tx.select({
                revision: purchaseOrderRevisions.revision,
                source: purchaseOrderRevisions.source,
                reason: purchaseOrderRevisions.reason,
                actorId: purchaseOrderRevisions.actorId,
                createdAt: purchaseOrderRevisions.createdAt,
                snapshot: purchaseOrderRevisions.snapshot,
            }).from(purchaseOrderRevisions).where(eq(purchaseOrderRevisions.purchaseOrderId, id)).orderBy(purchaseOrderRevisions.revision);
            const timeline = await this.readPurchaseOrderActivity(tx, organizationId, id);
            const legacy = !revisions.length ? recoverPurchaseOrderIssuance(timeline, organizationId, id) : null;
            return {
                ...hydrated,
                originalTotal: hydrated.originalTotal ?? legacy?.snapshot.grandTotal ?? null,
                originalLines: revisions[0]?.source === 'issued' ? revisions[0].snapshot.lines : legacy?.snapshot.lines ?? null,
                revisions: revisions.map(({ snapshot, ...revision }) => ({ ...revision, total: snapshot.grandTotal })),
                timeline: timeline.map(({ ipAddress, userAgent, organizationId, ...event }) => event),
            };
        });
    }

    private async auditPurchaseOrder(
        executor: PurchaseOrderExecutor, po: PurchaseOrder, actor: PurchaseOrderActor,
        actionType: string, description: string, oldValues: unknown = null, newValues: unknown = null,
    ) {
        await executor.insert(auditLogs).values({
            organizationId: po.organizationId, entityType: 'purchase_order', entityId: po.id, entityName: po.poNumber,
            userId: actor.userId, userName: actor.userName, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
            actionType, description, oldValues, newValues,
        });
    }

    private async requireVendor(tx: PurchaseOrderTransaction, organizationId: string, vendorId: string) {
        const [vendor] = await tx.select().from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId)));
        if (!vendor) throw poError('Select a vendor from this organization.');
        return vendor;
    }

    private async prepareLine(tx: PurchaseOrderTransaction, organizationId: string, input: InsertPurchaseOrder['lineItems'][number], position: number, prior?: PurchaseOrderLineItem) {
        const materialId = input.materialId ?? null;
        let conversion = '1.000000';
        if (prior && (prior.materialId ?? null) === materialId) {
            conversion = prior.inventoryUnitsPerPurchaseUnit;
        }
        if (materialId && (!prior || materialId !== prior.materialId || scaledDecimal(input.quantityOrdered, 2) !== scaledDecimal(prior.quantityOrdered, 2))) {
            const [material] = await tx.select().from(materials).where(and(eq(materials.id, materialId), eq(materials.organizationId, organizationId)));
            if (!material) throw poError('A selected material was not found in this organization.');
            if (!prior || materialId !== prior.materialId) conversion = material.inventoryUnitsPerPurchaseUnit ?? '1';
            const minimum = material.minimumPurchaseQuantity ?? '1';
            if (scaledDecimal(input.quantityOrdered, 6) < scaledDecimal(minimum, 6)) throw poError(material.name + ' requires a minimum purchase quantity of ' + minimum + '.');
        }
        if (scaledDecimal(conversion, 6) <= BigInt(0)) throw poError('Material has an invalid purchase-unit conversion.');
        if (prior && scaledDecimal(prior.quantityReceived, 2) > BigInt(0) &&
            (prior.materialId !== materialId || scaledDecimal(input.quantityOrdered, 2) < scaledDecimal(prior.quantityReceived, 2))) {
            throw poError('A received line must keep its material and at least its received quantity.');
        }
        const lineTotal = purchaseLineTotal(input.quantityOrdered, input.unitCost);
        if (scaledDecimal(lineTotal, 4) > BigInt('9999999999')) throw poError('Line total exceeds the purchase order limit.');
        return {
            materialId, description: input.description, vendorSku: input.vendorSku ?? null,
            quantityOrdered: input.quantityOrdered, unitCost: input.unitCost, lineTotal,
            inventoryUnitsPerPurchaseUnit: conversion, position, notes: input.notes ?? null,
        };
    }

    private checkedTotals(lines: { lineTotal: string }[], tax?: string, shipping?: string) {
        const totals = purchaseTotals(lines, tax, shipping);
        if (scaledDecimal(totals.grandTotal, 2) > BigInt('9999999999')) throw poError('Purchase order total exceeds the supported limit.');
        return totals;
    }

    async createPurchaseOrder(organizationId: string, data: InsertPurchaseOrder & { createdByUserId: string }, actor: PurchaseOrderActor = { userId: data.createdByUserId }) {
        try {
            return await this.dbInstance.transaction(async (tx) => {
                const vendor = await this.requireVendor(tx, organizationId, data.vendorId);
                const relatedOrderId = await this.assertRelatedOrderIsLinkable(organizationId, data.relatedOrderId, tx);
                const poNumber = await this.generateNextPoNumber(organizationId, tx);
                const lineValues = [];
                for (const [position, input] of data.lineItems.entries()) {
                    if (input.id) throw poError('New purchase order lines cannot use an existing line ID.');
                    lineValues.push(await this.prepareLine(tx, organizationId, input, position));
                }
                const [created] = await tx.insert(purchaseOrders).values({
                    organizationId, poNumber, relatedOrderId, vendorId: data.vendorId, issueDate: data.issueDate,
                    expectedDate: data.expectedDate, notes: data.notes, createdByUserId: data.createdByUserId,
                    paymentTerms: data.paymentTerms === undefined ? vendor.paymentTerms : data.paymentTerms,
                    paymentMethod: data.paymentMethod, paymentInstructions: data.paymentInstructions,
                    ...this.checkedTotals(lineValues),
                }).returning();
                const lines = await tx.insert(purchaseOrderLineItems).values(lineValues.map(line => ({ ...line, purchaseOrderId: created.id }))).returning();
                await this.auditPurchaseOrder(tx, created, actor, 'CREATE', 'Created purchase order', null, { lineCount: lines.length, total: created.grandTotal });
                return this.hydratePurchaseOrder(tx, created, lines);
            });
        } catch (error) {
            if (isDocumentNumberUniqueViolation(error)) throw toDocumentNumberConflictError(error);
            throw error;
        }
    }

    private async saveSnapshot(
        tx: PurchaseOrderTransaction, po: PurchaseOrder, lines: PurchaseOrderLineItem[], revision: number,
        source: 'issued' | 'revision' | 'legacy_capture', actor: PurchaseOrderActor, reason?: string,
    ) {
        const { vendor, relatedOrder } = await this.hydratePurchaseOrder(tx, po, lines);
        const [settings] = await tx.select({
            name: companySettings.companyName, address: companySettings.address, physicalAddress: companySettings.physicalAddress,
        }).from(companySettings).where(eq(companySettings.organizationId, po.organizationId));
        const physical = settings?.physicalAddress;
        const address = physical ? [physical.line1, physical.line2, physical.city, physical.state, physical.postalCode, physical.country].filter(Boolean).join(', ') : settings?.address;
        const snapshot: PurchaseOrderSnapshot = {
            poNumber: po.poNumber, issueDate: po.issueDate.toISOString(), expectedDate: po.expectedDate?.toISOString() ?? null,
            vendor: vendor ? { name: vendor.name, email: vendor.email, phone: vendor.phone } : null,
            orderNumber: relatedOrder?.displayNumber ?? relatedOrder?.orderNumber ?? null,
            shipTo: [settings?.name, address].filter(Boolean).join(' - ') || null,
            subtotal: po.subtotal, taxTotal: po.taxTotal, shippingTotal: po.shippingTotal, grandTotal: po.grandTotal,
            paymentTerms: po.paymentTerms, paymentMethod: po.paymentMethod, paymentInstructions: po.paymentInstructions, notes: po.notes,
            lines: lines.map(({ id, description, vendorSku, quantityOrdered, unitCost, lineTotal }) =>
                ({ id, description, vendorSku, quantityOrdered, unitCost, lineTotal })),
        };
        await this.archiveSnapshot(tx, po, actor, snapshot, revision, source, reason);
    }

    private async archiveSnapshot(
        tx: PurchaseOrderTransaction, po: PurchaseOrder, actor: PurchaseOrderActor, snapshot: PurchaseOrderSnapshot, revision: number,
        source: 'issued' | 'revision' | 'legacy_capture', reason?: string, originalEvent?: { userId: string | null; createdAt: Date },
    ) {
        const pdfBytes = await generatePurchaseOrderPdf(snapshot, revision, new Date());
        await tx.insert(purchaseOrderRevisions).values({ purchaseOrderId: po.id, revision, source, reason, snapshot, pdfBytes,
            actorId: originalEvent ? originalEvent.userId : actor.userId, createdAt: originalEvent?.createdAt ?? new Date() });
        await this.auditPurchaseOrder(tx, po, actor, 'PDF_GENERATED', 'Generated the PDF for revision ' + revision, null, { revision, source });
    }

    private async archiveLegacyOriginal(tx: PurchaseOrderTransaction, po: PurchaseOrder, actor: PurchaseOrderActor) {
        const audit = await this.readPurchaseOrderActivity(tx, po.organizationId, po.id, 'ISSUE');
        const original = recoverPurchaseOrderIssuance(audit, po.organizationId, po.id);
        if (!original) return null;
        await this.archiveSnapshot(tx, po, actor, original.snapshot, 0, 'issued', 'Reconstructed from the recorded issuance.', original.event);
        return original.snapshot.grandTotal;
    }

    async updatePurchaseOrder(organizationId: string, id: string, data: UpdatePurchaseOrder, actor: PurchaseOrderActor) {
        return this.dbInstance.transaction(async tx => {
            const po = await this.lockPurchaseOrder(tx, organizationId, id, data.expectedVersion);
            const existing = await this.readLines(tx, id);
            const { status, expectedVersion, revisionReason, lineItems, relatedOrderId, ...input } = data;
            if (status) {
                if (lineItems || relatedOrderId !== undefined || Object.keys(input).length) throw poError('Save changes before changing the purchase order status.');
                const canClose = status === 'closed' && po.status === 'received';
                const canCancel = status === 'cancelled' && ['draft', 'issued', 'sent'].includes(po.status)
                    && existing.every(line => scaledDecimal(line.quantityReceived, 2) === BigInt(0));
                if (!canClose && !canCancel) throw poError('The current purchase order status does not allow this transition.', 409);
                const [updated] = await tx.update(purchaseOrders).set({ status, version: po.version + 1, updatedAt: new Date() })
                    .where(this.poScope(organizationId, id)).returning();
                await this.auditPurchaseOrder(tx, updated, actor, status === 'closed' ? 'CLOSE' : 'CANCEL',
                    status === 'closed' ? 'Closed purchase order' : 'Cancelled purchase order', { status: po.status }, { status, reason: revisionReason });
                return this.hydratePurchaseOrder(tx, updated, existing);
            }
            if (!editablePurchaseOrderStatuses.includes(po.status)) throw poError('This purchase order cannot be edited in its current status.', 409);
            const isRevision = po.status !== 'draft';
            if (isRevision && !revisionReason) throw poError('Enter a reason for revising this issued purchase order.');
            if (input.vendorId && input.vendorId !== po.vendorId) {
                if (existing.some(line => scaledDecimal(line.quantityReceived, 2) > BigInt(0))) throw poError('The vendor cannot change after receipt.');
                await this.requireVendor(tx, organizationId, input.vendorId);
            }
            const headerUpdates = { ...input, relatedOrderId: po.relatedOrderId };
            if (relatedOrderId !== undefined && relatedOrderId !== po.relatedOrderId) {
                headerUpdates.relatedOrderId = await this.assertRelatedOrderIsLinkable(organizationId, relatedOrderId, tx);
            }
            let originalTotal = po.originalTotal;
            if (isRevision && po.revision === null) {
                originalTotal = await this.archiveLegacyOriginal(tx, po, actor);
                if (originalTotal === null) await this.saveSnapshot(tx, po, existing, 0, 'legacy_capture', actor);
            }
            if (lineItems) {
                const incomingIds = new Set<string>();
                for (const item of lineItems) {
                    if (!item.id) continue;
                    if (incomingIds.has(item.id) || !existing.some(line => line.id === item.id)) throw poError('An edited line is duplicated or no longer belongs to this purchase order.', 409);
                    incomingIds.add(item.id);
                }
                for (const line of existing) {
                    if (incomingIds.has(line.id)) continue;
                    if (scaledDecimal(line.quantityReceived, 2) > BigInt(0) || po.actualCosts[line.id]) throw poError('A line with receipts or actual costs cannot be removed.');
                    await tx.delete(purchaseOrderLineItems).where(and(eq(purchaseOrderLineItems.id, line.id), eq(purchaseOrderLineItems.purchaseOrderId, id)));
                    await this.auditPurchaseOrder(tx, po, actor, 'LINE_REMOVE', 'Removed ' + line.description, line);
                }
                for (const [position, item] of lineItems.entries()) {
                    const prior = existing.find(line => line.id === item.id);
                    const values = await this.prepareLine(tx, organizationId, item, position, prior);
                    if (prior) {
                        const normalized = { ...values, quantityOrdered: formatScaledDecimal(scaledDecimal(values.quantityOrdered, 2), 2),
                            unitCost: formatScaledDecimal(scaledDecimal(values.unitCost, 4), 4),
                            inventoryUnitsPerPurchaseUnit: formatScaledDecimal(scaledDecimal(values.inventoryUnitsPerPurchaseUnit, 6), 6) };
                        if (Object.entries(normalized).every(([key, value]) => prior[key as keyof PurchaseOrderLineItem] === value)) continue;
                        if (po.actualCosts[prior.id] && prior.materialId !== values.materialId) throw poError('A line with actual costs cannot change its material.');
                        await tx.update(purchaseOrderLineItems).set({ ...values, updatedAt: new Date() }).where(and(eq(purchaseOrderLineItems.id, prior.id), eq(purchaseOrderLineItems.purchaseOrderId, id)));
                        await this.auditPurchaseOrder(tx, po, actor, 'LINE_EDIT', 'Edited ' + values.description, prior, { id: prior.id, ...normalized });
                    } else {
                        const [added] = await tx.insert(purchaseOrderLineItems).values({ ...values, purchaseOrderId: id }).returning();
                        await this.auditPurchaseOrder(tx, po, actor, 'LINE_ADD', 'Added ' + added.description, null, added);
                    }
                }
            }
            const lines = lineItems ? await this.readLines(tx, id) : existing;
            const revision = isRevision ? (po.revision ?? 0) + 1 : null;
            const totals = this.checkedTotals(lines, po.taxTotal, po.shippingTotal);
            const nextStatus = po.status === 'partially_received' && lines.every(line =>
                scaledDecimal(line.quantityOrdered, 2) === scaledDecimal(line.quantityReceived, 2)) ? 'received' : po.status;
            const [updated] = await tx.update(purchaseOrders).set({
                ...headerUpdates, ...totals, ...this.summarizeActualCosts(po, lines),
                status: nextStatus,
                originalTotal, revision, version: po.version + 1, updatedAt: new Date(),
            }).where(this.poScope(organizationId, id)).returning();
            if (revision !== null) await this.saveSnapshot(tx, updated, lines, revision, 'revision', actor, revisionReason);
            if (po.expectedDate?.getTime() !== updated.expectedDate?.getTime()) {
                await this.auditPurchaseOrder(tx, updated, actor, 'EXPECTED_DELIVERY', 'Changed expected delivery', po.expectedDate, updated.expectedDate);
            }
            await this.auditPurchaseOrder(tx, updated, actor, isRevision ? 'REVISE' : 'DRAFT_SAVE',
                isRevision ? 'Saved revision ' + revision : 'Saved draft', { total: po.grandTotal, status: po.status }, { total: updated.grandTotal, revision, reason: revisionReason, status: updated.status });
            return this.hydratePurchaseOrder(tx, updated, lines);
        });
    }

    async deletePurchaseOrder(organizationId: string, id: string, actor: PurchaseOrderActor) {
        await this.dbInstance.transaction(async tx => {
            const po = await this.lockPurchaseOrder(tx, organizationId, id);
            if (po.status !== 'draft') throw poError('Only draft purchase orders can be deleted.');
            const lines = await this.readLines(tx, id);
            if (lines.some(line => scaledDecimal(line.quantityReceived, 2) > BigInt(0))) throw poError('Cannot delete a purchase order with receipts.');
            await tx.delete(purchaseOrders).where(this.poScope(organizationId, id));
            await this.auditPurchaseOrder(tx, po, actor, 'DELETE', 'Deleted draft purchase order', { ...po, lineItems: lines });
        });
    }

    async sendPurchaseOrder(organizationId: string, id: string, expectedVersion: number, actor: PurchaseOrderActor) {
        return this.dbInstance.transaction(async tx => {
            const po = await this.lockPurchaseOrder(tx, organizationId, id, expectedVersion);
            if (po.status !== 'draft') throw poError('Only draft purchase orders can be issued.', 409);
            await this.requireVendor(tx, organizationId, po.vendorId);
            const lines = await this.readLines(tx, id);
            if (!lines.length) throw poError('Add at least one line before issuing.');
            const [issued] = await tx.update(purchaseOrders).set({
                status: 'issued', revision: 0, originalTotal: po.grandTotal, version: po.version + 1, updatedAt: new Date(),
            }).where(this.poScope(organizationId, id)).returning();
            await this.saveSnapshot(tx, issued, lines, 0, 'issued', actor);
            await this.auditPurchaseOrder(tx, issued, actor, 'ISSUE', 'Issued purchase order', { status: po.status }, { revision: 0, total: issued.grandTotal });
            return issued;
        });
    }

    async archiveCurrentPurchaseOrder(organizationId: string, id: string, expectedVersion: number, actor: PurchaseOrderActor) {
        return this.dbInstance.transaction(async tx => {
            const po = await this.lockPurchaseOrder(tx, organizationId, id, expectedVersion);
            if (po.revision !== null || !['issued', 'sent', 'partially_received', 'received', 'closed'].includes(po.status)) {
                throw poError('This purchase order is not an issued agreement awaiting its first PDF.', 409);
            }
            await this.requireVendor(tx, organizationId, po.vendorId);
            const lines = await this.readLines(tx, id);
            if (!lines.length) throw poError('There are no saved lines to include in the purchase order PDF.');
            const originalTotal = await this.archiveLegacyOriginal(tx, po, actor);
            const revision = originalTotal === null ? 0 : 1;
            await this.saveSnapshot(tx, po, lines, revision, 'legacy_capture', actor, 'Captured the current saved agreement.');
            const [updated] = await tx.update(purchaseOrders).set({
                revision, originalTotal, version: po.version + 1, updatedAt: new Date(),
            }).where(this.poScope(organizationId, id)).returning();
            await this.auditPurchaseOrder(tx, updated, actor, 'ARCHIVE_AGREEMENT', 'Archived the current saved agreement', null, { revision });
            return updated;
        });
    }

    private summarizeActualCosts(po: PurchaseOrder, lines: PurchaseOrderLineItem[]) {
        const keys = lines.map(line => line.id);
        if (scaledDecimal(po.shippingTotal, 2) > BigInt(0)) keys.push('freight');
        if (scaledDecimal(po.taxTotal, 2) > BigInt(0)) keys.push('tax');
        const entries = keys.map(key => po.actualCosts[key]);
        const known = entries.filter(Boolean);
        const total = known.reduce((sum, cost) => sum + scaledDecimal(cost.total, 2), BigInt(0));
        if (total > BigInt('9999999999')) throw poError('Actual cost exceeds the purchase order limit.');
        return {
            actualTotal: known.length ? formatScaledDecimal(total, 2) : null,
            actualProvisional: entries.some(cost => !cost?.final),
        };
    }

    async recordPurchaseOrderActualCost(organizationId: string, id: string, data: ActualPurchaseCostInput, actor: PurchaseOrderActor) {
        return this.dbInstance.transaction(async tx => {
            const po = await this.lockPurchaseOrder(tx, organizationId, id, data.expectedVersion);
            if (!['issued', 'sent', 'partially_received', 'received', 'closed'].includes(po.status)) throw poError('Actual costs require an issued purchase order.', 409);
            const lines = await this.readLines(tx, id);
            const line = lines.find(item => item.id === data.lineId);
            if (data.lineId && !line) throw poError('The selected line does not belong to this purchase order.', 404);
            const key = line?.id ?? data.charge ?? 'freight';
            if (!line && scaledDecimal(key === 'tax' ? po.taxTotal : po.shippingTotal, 2) <= BigInt(0)) {
                throw poError('Record delivery on its existing line or add a delivery line through a revision. A separate charge requires a matching header charge.');
            }
            if (!line && (data.quantity !== undefined || data.unitCost !== undefined)) throw poError('Enter the total for a header charge.');
            if (line?.materialId && data.final && data.quantity !== undefined &&
                scaledDecimal(data.quantity, 2) !== scaledDecimal(line.quantityReceived, 2)) {
                throw poError('Final actual quantities for material must match receiving in purchase units. Record the cost as provisional while quantities are reconciled.');
            }
            const calculated = data.quantity && data.unitCost !== undefined
                ? formatScaledDecimal(roundPurchaseDecimal(scaledDecimal(data.quantity, 2) * scaledDecimal(data.unitCost, 4), BigInt(10000)), 2) : null;
            if (data.total && calculated && scaledDecimal(data.total, 2) !== scaledDecimal(calculated, 2)) {
                throw poError('Actual total must match the entered quantity and unit cost.');
            }
            const total = data.total ?? calculated;
            if (total === null) throw poError('Enter an actual total or quantity and unit cost.');
            const actual: ActualPurchaseCost = {
                quantity: data.quantity ?? null, unitCost: data.unitCost ?? null, total,
                final: data.final, reason: data.reason, reference: data.reference || null, date: data.date,
            };
            const actualCosts = { ...po.actualCosts, [key]: actual };
            const summary = this.summarizeActualCosts({ ...po, actualCosts }, lines);
            const legacy = po.revision === null && po.originalTotal === null
                ? recoverPurchaseOrderIssuance(await this.readPurchaseOrderActivity(tx, organizationId, id, 'ISSUE'), organizationId, id) : null;
            const originalTotal = po.originalTotal ?? legacy?.snapshot.grandTotal ?? null;
            const [updated] = await tx.update(purchaseOrders).set({ actualCosts, ...summary, originalTotal, version: po.version + 1, updatedAt: new Date() })
                .where(this.poScope(organizationId, id)).returning();
            await this.auditPurchaseOrder(tx, updated, actor, 'ACTUAL_COST', 'Adjusted actual cost for ' + (line?.description ?? key),
                po.actualCosts[key] ?? null, { ...actual, lineId: line?.id ?? null, scope: key });
            return this.hydratePurchaseOrder(tx, updated, lines);
        });
    }

    async getPurchaseOrderRevision(organizationId: string, id: string, revision: number, currentOnly = false) {
        const [row] = await this.dbInstance.select({ revision: purchaseOrderRevisions, po: purchaseOrders })
            .from(purchaseOrderRevisions).innerJoin(purchaseOrders, eq(purchaseOrderRevisions.purchaseOrderId, purchaseOrders.id))
            .where(and(this.poScope(organizationId, id), eq(purchaseOrderRevisions.revision, revision),
                currentOnly ? eq(purchaseOrders.revision, revision) : undefined));
        if (!row) throw poError('The saved purchase order revision is unavailable. Reload the purchase order.', currentOnly ? 409 : 404);
        if (currentOnly && !['issued', 'sent', 'partially_received', 'received', 'closed'].includes(row.po.status)) {
            throw poError('This purchase order cannot be sent in its current status.', 409);
        }
        return row;
    }

    async recordPurchaseOrderActivity(po: PurchaseOrder, actor: PurchaseOrderActor, action: string, description: string, values: unknown) {
        await this.auditPurchaseOrder(this.dbInstance, po, actor, action, description, null, values);
    }

    async claimPurchaseOrderEmail(
        organizationId: string, id: string, actor: PurchaseOrderActor,
        request: { key: string; fingerprint: string; revision: number; recipients: unknown },
    ) {
        return this.dbInstance.transaction(async tx => {
            const po = await this.lockPurchaseOrder(tx, organizationId, id);
            const events = await tx.select({ action: auditLogs.actionType, data: auditLogs.newValues }).from(auditLogs)
                .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityType, 'purchase_order'), eq(auditLogs.entityId, id),
                    sql`${auditLogs.newValues}->>'key' = ${request.key}`));
            if (events.length) {
                const data = events[0].data as { fingerprint: string };
                if (data.fingerprint !== request.fingerprint) throw poError('The send key already belongs to a different email draft.', 409);
                const accepted = events.find(event => event.action === 'EMAIL_ACCEPTED');
                if (accepted) return { po, providerMessageId: (accepted.data as { providerMessageId: string }).providerMessageId };
                const failed = events.find(event => event.action === 'EMAIL_FAILED');
                if (failed) throw poError('Gmail did not accept this attempt. Retry from the composer.', 422);
                throw poError('This email is in progress or its outcome is unknown. Check the timeline and Gmail Sent before retrying.', 409);
            }
            if (po.revision !== request.revision || !['issued', 'sent', 'partially_received', 'received', 'closed'].includes(po.status)) {
                throw poError('The current saved revision changed. Reload before sending.', 409);
            }
            const [unconfirmed] = await tx.select({ id: auditLogs.id }).from(auditLogs)
                .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityType, 'purchase_order'), eq(auditLogs.entityId, id),
                    eq(auditLogs.actionType, 'EMAIL_SUBMIT'), sql`${auditLogs.newValues}->>'fingerprint' = ${request.fingerprint}`,
                    sql`NOT EXISTS (
                        SELECT 1 FROM audit_logs AS result WHERE result.organization_id = ${organizationId}
                            AND result.entity_type = 'purchase_order' AND result.entity_id = ${id}
                            AND result.new_values->>'key' = ${auditLogs.newValues}->>'key'
                            AND result.action_type IN ('EMAIL_ACCEPTED', 'EMAIL_FAILED')
                    )`)).limit(1);
            if (unconfirmed) throw poError('A matching email is in progress or unconfirmed. Check the timeline and Gmail Sent.', 409);
            await this.auditPurchaseOrder(tx, po, actor, 'EMAIL_SUBMIT', 'Submitted revision ' + request.revision + ' for email', null, request);
            return { po, providerMessageId: null };
        });
    }

    async receivePurchaseOrderLines(
        organizationId: string, id: string, items: { lineItemId: string; quantityToReceive: string; receivedDate?: Date }[],
        actor: PurchaseOrderActor, expectedVersion: number, inventoryRepo: InventoryRepository,
    ) {
        return this.dbInstance.transaction(async tx => {
            const po = await this.lockPurchaseOrder(tx, organizationId, id, expectedVersion);
            if (!receivablePurchaseOrderStatuses.includes(po.status)) throw poError('Only issued purchase orders can receive items.', 409);
            const lines = await this.readLines(tx, id);
            const received = new Set<string>();
            for (const item of items) {
                const line = lines.find(row => row.id === item.lineItemId);
                if (!line || received.has(item.lineItemId)) throw poError('Receipt contains a duplicate or unknown line.');
                received.add(line.id);
                const previous = scaledDecimal(line.quantityReceived, 2);
                const next = previous + scaledDecimal(item.quantityToReceive, 2);
                if (next > scaledDecimal(line.quantityOrdered, 2)) throw poError('Cannot receive more than ordered for ' + line.description + '.');
                const conversion = Number(line.inventoryUnitsPerPurchaseUnit);
                if (line.materialId) {
                    if (!Number.isFinite(conversion) || conversion <= 0) throw poError('Purchase order line has an invalid inventory-unit conversion.');
                    await inventoryRepo.recordPurchaseReceipt(tx, organizationId, line.materialId, Number(item.quantityToReceive) * conversion, actor.userId, 'PO receipt ' + po.poNumber);
                    await tx.update(materials).set({
                        vendorCostPerUnit: line.unitCost,
                        costPerUnit: formatNormalizedMaterialCost(Number(line.unitCost) / conversion),
                        vendorLastPriceCents: Number(roundPurchaseDecimal(scaledDecimal(line.unitCost, 4), BigInt(100))),
                        vendorLastPriceUpdatedAt: item.receivedDate ?? new Date(), updatedAt: new Date(),
                    }).where(and(eq(materials.id, line.materialId), eq(materials.organizationId, organizationId)));
                }
                line.quantityReceived = formatScaledDecimal(next, 2);
                await tx.update(purchaseOrderLineItems).set({ quantityReceived: line.quantityReceived, updatedAt: new Date() })
                    .where(and(eq(purchaseOrderLineItems.id, line.id), eq(purchaseOrderLineItems.purchaseOrderId, id)));
                await this.auditPurchaseOrder(tx, po, actor, 'RECEIVE', 'Received ' + line.description,
                    { quantityReceived: formatScaledDecimal(previous, 2) }, { quantityReceived: line.quantityReceived, receivedDate: item.receivedDate ?? new Date() });
            }
            const allReceived = lines.every(line => scaledDecimal(line.quantityReceived, 2) >= scaledDecimal(line.quantityOrdered, 2));
            const [updated] = await tx.update(purchaseOrders).set({
                status: allReceived ? 'received' : 'partially_received', updatedAt: new Date(),
                receivedDate: allReceived ? items[0]?.receivedDate ?? new Date() : po.receivedDate, version: po.version + 1,
            }).where(this.poScope(organizationId, id)).returning();
            return this.hydratePurchaseOrder(tx, updated, lines);
        });
    }
}
