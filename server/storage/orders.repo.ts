import { db } from "../db";
import {
    orders,
    orderLineItems,
    shipments,
    orderAttachments,
    orderAuditLog,
    customers,
    customerContacts,
    users,
    products,
    productVariants,
    quotes,
    quoteLineItems,
    jobs,
    jobStatusLog,
    globalVariables,
    type Order,
    type InsertOrder,
    type OrderWithRelations,
    type OrderLineItem,
    type InsertOrderLineItem,
    type Shipment,
    type InsertShipment,
    type UpdateShipment,
    type OrderAttachment,
    type InsertOrderAttachment,
    type UpdateOrderAttachment,
    type OrderAuditLog,
    type InsertOrderAuditLog,
    type User,
    type CustomerContact,
    type InsertJobStatusLog,
} from "@shared/schema";
import { eq, and, or, ilike, gte, lte, desc, sql } from "drizzle-orm";

export class OrdersRepository {
    constructor(private readonly dbInstance = db) { }

    private async generateNextOrderNumber(organizationId: string, tx?: any): Promise<string> {
        // Try globalVariables first (pattern similar to quotes). If missing, fallback to MAX(order_number)+1
        const executor = tx || this.dbInstance;
        try {
            const result = await executor.execute(sql`
        SELECT * FROM ${globalVariables}
        WHERE ${globalVariables.name} = 'next_order_number'
        AND ${globalVariables.organizationId} = ${organizationId}
        FOR UPDATE
      `);
            const row = (result as any).rows?.[0];
            if (row) {
                const current = Math.floor(Number(row.value));
                // Increment for next
                await executor.update(globalVariables)
                    .set({ value: (current + 1).toString(), updatedAt: new Date() })
                    .where(and(eq(globalVariables.id, row.id), eq(globalVariables.organizationId, organizationId)));
                return current.toString();
            }
        } catch (e) {
            // Ignore and fallback
        }
        // Fallback: compute max existing numeric orderNumber within this organization
        const maxResult = await this.dbInstance.execute(sql`SELECT MAX(CAST(order_number AS INTEGER)) AS max_num FROM orders WHERE order_number ~ '^[0-9]+$' AND organization_id = ${organizationId}`);
        const maxNum = (maxResult as any).rows?.[0]?.max_num ? Number((maxResult as any).rows[0].max_num) : 999;
        return (maxNum + 1).toString();
    }

    async getAllOrders(organizationId: string, filters?: {
        search?: string;
        status?: string;
        priority?: string;
        customerId?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<Order[]> {
        const conditions = [eq(orders.organizationId, organizationId)] as any[];
        if (filters?.search) {
            const pattern = `%${filters.search}%`;
            conditions.push(or(
                ilike(orders.orderNumber, pattern),
                ilike(orders.poNumber, pattern),
                ilike(orders.label, pattern),
                ilike(orders.notesInternal, pattern)
            ));
        }
        if (filters?.status) conditions.push(eq(orders.status, filters.status));
        if (filters?.priority) conditions.push(eq(orders.priority, filters.priority));
        if (filters?.customerId) conditions.push(eq(orders.customerId, filters.customerId));
        if (filters?.startDate) conditions.push(gte(orders.createdAt, filters.startDate));
        if (filters?.endDate) conditions.push(lte(orders.createdAt, filters.endDate));

        let query = this.dbInstance.select().from(orders) as any;
        query = query.where(and(...conditions));
        query = query.orderBy(desc(orders.createdAt));
        const rows = await query;

        // Enrich orders with customer and contact data
        const enrichedOrders = await Promise.all(rows.map(async (order: Order) => {
            const [customer] = order.customerId
                ? await this.dbInstance.select().from(customers).where(eq(customers.id, order.customerId))
                : [undefined];

            const [contact] = order.contactId
                ? await this.dbInstance.select().from(customerContacts).where(eq(customerContacts.id, order.contactId))
                : [undefined];

            return { ...order, customer, contact };
        }));

        return enrichedOrders;
    }

    async getOrderById(organizationId: string, id: string): Promise<OrderWithRelations | undefined> {
        const [order] = await this.dbInstance.select().from(orders).where(and(eq(orders.id, id), eq(orders.organizationId, organizationId)));
        if (!order) return undefined;
        const rawLineItems = await this.dbInstance.select().from(orderLineItems).where(eq(orderLineItems.orderId, id));
        const enrichedLineItems = await Promise.all(
            rawLineItems.map(async (li) => {
                const [product] = await this.dbInstance.select().from(products).where(eq(products.id, li.productId));
                let productVariant = null as any;
                if (li.productVariantId) {
                    [productVariant] = await this.dbInstance.select().from(productVariants).where(eq(productVariants.id, li.productVariantId));
                }
                return { ...li, product, productVariant } as any;
            })
        );
        const [customer] = await this.dbInstance.select().from(customers).where(eq(customers.id, order.customerId)).catch(() => []);
        let contact: CustomerContact | null = null;
        if (order.contactId) {
            const contactRows = await this.dbInstance.select().from(customerContacts).where(eq(customerContacts.id, order.contactId));
            contact = contactRows[0] || null;
        }
        const [createdByUser] = await this.dbInstance.select().from(users).where(eq(users.id, order.createdByUserId));
        return {
            ...order,
            lineItems: enrichedLineItems,
            customer,
            contact,
            createdByUser,
        } as OrderWithRelations;
    }

    async createOrder(organizationId: string, data: {
        customerId: string;
        contactId?: string | null;
        quoteId?: string | null;
        status?: string;
        priority?: string;
        dueDate?: Date | string | null;
        promisedDate?: Date | string | null;
        discount?: number;
        notesInternal?: string | null;
        createdByUserId: string;
        lineItems: Omit<InsertOrderLineItem, 'orderId'>[];
        taxRate?: number;
        taxAmount?: number;
        taxableSubtotal?: number;
    }): Promise<OrderWithRelations> {
        if (!data.customerId) throw new Error('customerId required');
        if (!data.lineItems || data.lineItems.length === 0) throw new Error('At least one line item required');
        const subtotal = data.lineItems.reduce((sum, li: any) => sum + Number(li.totalPrice || li.linePrice || 0), 0);
        const discount = data.discount || 0;
        const taxAmount = data.taxAmount ?? 0;
        const total = subtotal - discount + taxAmount;

        // Sanitize date fields: convert Date objects to ISO strings, keep strings as-is, convert undefined/invalid to null
        const sanitizeDateField = (value: any): string | null => {
            if (!value) return null;
            if (value instanceof Date) return value.toISOString();
            if (typeof value === 'string') return value;
            return null;
        };

        const created = await this.dbInstance.transaction(async (tx) => {
            const orderNumber = await this.generateNextOrderNumber(organizationId, tx);
            const orderInsert: typeof orders.$inferInsert = {
                organizationId,
                orderNumber,
                quoteId: data.quoteId || null,
                customerId: data.customerId,
                contactId: data.contactId || null,
                status: data.status || 'new',
                priority: data.priority || 'normal',
                dueDate: sanitizeDateField(data.dueDate),
                promisedDate: sanitizeDateField(data.promisedDate),
                subtotal: subtotal.toString(),
                tax: taxAmount.toString(),
                taxRate: data.taxRate ?? null,
                taxAmount: data.taxAmount != null ? data.taxAmount.toString() : undefined,
                taxableSubtotal: data.taxableSubtotal != null ? data.taxableSubtotal.toString() : undefined,
                total: total.toString(),
                discount: discount.toString(),
                notesInternal: data.notesInternal || null,
                createdByUserId: data.createdByUserId,
            };
            const [order] = await tx.insert(orders).values(orderInsert).returning();
            const lineItemsData = data.lineItems.map((li) => {
                const unit = li.unitPrice;
                return {
                    orderId: order.id,
                    quoteLineItemId: (li as any).quoteLineItemId || null,
                    productId: li.productId,
                    productVariantId: (li as any).productVariantId || (li as any).variantId || null,
                    productType: (li as any).productType || 'wide_roll',
                    description: (li as any).description || (li as any).productName || 'Item',
                    width: li.width ? li.width.toString() : null,
                    height: li.height ? li.height.toString() : null,
                    quantity: li.quantity,
                    sqft: (li as any).sqft ? (li as any).sqft.toString() : null,
                    unitPrice: unit.toString(),
                    totalPrice: li.totalPrice.toString(),
                    status: 'queued',
                    specsJson: (li as any).specsJson || null,
                    selectedOptions: (li as any).selectedOptions || [],
                    nestingConfigSnapshot: (li as any).nestingConfigSnapshot || null,
                    // Tax fields
                    taxAmount: (li as any).taxAmount != null ? (li as any).taxAmount.toString() : null,
                    isTaxableSnapshot: (li as any).isTaxableSnapshot ?? null,
                } as typeof orderLineItems.$inferInsert;
            });
            const createdLineItems = lineItemsData.length ? await tx.insert(orderLineItems).values(lineItemsData).returning() : [];
            return { order, lineItems: createdLineItems };
        });

        // Auto-create jobs for each line item (if missing)
        await Promise.all(created.lineItems.map(async (li) => {
            const [existing] = await this.dbInstance.select().from(jobs).where(eq(jobs.orderLineItemId as any, li.id));
            if (!existing) {
                // Fetch product with productType relation
                const productWithType = await this.dbInstance.query.products.findFirst({
                    where: eq(products.id, li.productId),
                    with: { productType: true },
                });
                const productTypeName = (productWithType?.productType as any)?.name || 'Unknown';

                const jobInsert: typeof jobs.$inferInsert = {
                    orderId: created.order.id,
                    orderLineItemId: li.id,
                    productType: productTypeName,
                    statusKey: 'new',
                    priority: 'normal',
                    specsJson: (li as any).specsJson || null,
                    assignedToUserId: null,
                    notesInternal: null,
                } as any;
                const [newJob] = await this.dbInstance.insert(jobs).values(jobInsert).returning();
                await this.dbInstance.insert(jobStatusLog).values({
                    jobId: newJob.id,
                    oldStatusKey: null,
                    newStatusKey: 'new',
                    userId: data.createdByUserId,
                } as InsertJobStatusLog).returning();
            }
        }));

        const [customer] = await this.dbInstance.select().from(customers).where(eq(customers.id, data.customerId));
        let contact: CustomerContact | null = null;
        if (data.contactId) {
            const contactRows = await this.dbInstance.select().from(customerContacts).where(eq(customerContacts.id, data.contactId));
            contact = contactRows[0] || null;
        }
        const [createdByUser] = await this.dbInstance.select().from(users).where(eq(users.id, data.createdByUserId));
        const enrichedLineItems = await Promise.all(
            created.lineItems.map(async (li) => {
                const [product] = await this.dbInstance.select().from(products).where(eq(products.id, li.productId));
                let productVariant = null as any;
                if (li.productVariantId) {
                    [productVariant] = await this.dbInstance.select().from(productVariants).where(eq(productVariants.id, li.productVariantId));
                }
                return { ...li, product, productVariant } as any;
            })
        );
        return {
            ...created.order,
            lineItems: enrichedLineItems,
            customer,
            contact,
            createdByUser,
        } as OrderWithRelations;
    }

    async updateOrder(organizationId: string, id: string, orderData: Partial<InsertOrder>): Promise<Order> {
        const updateData: any = { ...orderData, updatedAt: new Date() };
        const [updated] = await this.dbInstance
            .update(orders)
            .set(updateData)
            .where(and(eq(orders.id, id), eq(orders.organizationId, organizationId)))
            .returning();
        if (!updated) throw new Error('Order not found');
        return updated;
    }

    async deleteOrder(organizationId: string, id: string): Promise<void> {
        await this.dbInstance.delete(orders).where(and(eq(orders.id, id), eq(orders.organizationId, organizationId)));
    }

    async convertQuoteToOrder(organizationId: string, quoteId: string, createdByUserId: string, options?: {
        dueDate?: Date;
        promisedDate?: Date;
        priority?: string;
        notesInternal?: Date;
    }): Promise<OrderWithRelations> {
        // Fetch the quote with line items
        const [quote] = await this.dbInstance.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)));
        if (!quote) throw new Error('Quote not found');
        const quoteLines = await this.dbInstance.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
        if (quoteLines.length === 0) throw new Error('Quote has no line items');

        // Convert quote line items to order line items
        const orderLineItemsData: Omit<InsertOrderLineItem, 'orderId'>[] = quoteLines.map((ql) => ({
            quoteLineItemId: ql.id,
            productId: ql.productId,
            productVariantId: ql.variantId,
            productType: ql.productType,
            description: ql.productName,
            width: ql.width,
            height: ql.height,
            quantity: ql.quantity,
            sqft: null,
            unitPrice: parseFloat(ql.linePrice) / ql.quantity,
            totalPrice: parseFloat(ql.linePrice),
            status: 'queued',
            specsJson: ql.specsJson,
            selectedOptions: ql.selectedOptions,
            nestingConfigSnapshot: null,
            requiresInventory: false,
            materialId: null,
            taxAmount: ql.taxAmount ? parseFloat(ql.taxAmount) : null,
            isTaxableSnapshot: ql.isTaxableSnapshot,
        }));

        // Create the order
        const orderData = {
            customerId: quote.customerId!,
            contactId: quote.contactId,
            quoteId: quote.id,
            status: 'new',
            priority: options?.priority || 'normal',
            dueDate: options?.dueDate || null,
            promisedDate: options?.promisedDate || null,
            discount: 0,
            notesInternal: options?.notesInternal ? String(options.notesInternal) : null,
            createdByUserId,
            lineItems: orderLineItemsData,
            taxRate: quote.taxRate ? parseFloat(quote.taxRate.toString()) : undefined,
            taxAmount: quote.taxAmount ? parseFloat(quote.taxAmount) : undefined,
            taxableSubtotal: quote.taxableSubtotal ? parseFloat(quote.taxableSubtotal) : undefined,
        };

        return await this.createOrder(organizationId, orderData);
    }

    // Order line item operations
    async getOrderLineItems(orderId: string): Promise<OrderLineItem[]> {
        return await this.dbInstance.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
    }

    async getOrderLineItemById(id: string): Promise<OrderLineItem | undefined> {
        const [item] = await this.dbInstance.select().from(orderLineItems).where(eq(orderLineItems.id, id));
        return item;
    }

    async createOrderLineItem(lineItem: InsertOrderLineItem): Promise<OrderLineItem> {
        const [created] = await this.dbInstance.insert(orderLineItems).values(lineItem).returning();
        return created;
    }

    async updateOrderLineItem(id: string, lineItem: Partial<InsertOrderLineItem>): Promise<OrderLineItem> {
        const [updated] = await this.dbInstance
            .update(orderLineItems)
            .set({ ...lineItem, updatedAt: new Date() })
            .where(eq(orderLineItems.id, id))
            .returning();
        if (!updated) throw new Error('Order line item not found');
        return updated;
    }

    async deleteOrderLineItem(id: string): Promise<void> {
        await this.dbInstance.delete(orderLineItems).where(eq(orderLineItems.id, id));
    }

    // Shipment operations
    async getShipmentsByOrder(orderId: string): Promise<Shipment[]> {
        return await this.dbInstance.select().from(shipments).where(eq(shipments.orderId, orderId)).orderBy(desc(shipments.createdAt));
    }

    async getShipmentById(id: string): Promise<Shipment | undefined> {
        const [shipment] = await this.dbInstance.select().from(shipments).where(eq(shipments.id, id));
        return shipment;
    }

    async createShipment(shipment: InsertShipment): Promise<Shipment> {
        const [created] = await this.dbInstance.insert(shipments).values(shipment).returning();
        return created;
    }

    async updateShipment(id: string, shipmentData: Partial<InsertShipment>): Promise<Shipment> {
        const [updated] = await this.dbInstance
            .update(shipments)
            .set({ ...shipmentData, updatedAt: new Date() })
            .where(eq(shipments.id, id))
            .returning();
        if (!updated) throw new Error('Shipment not found');
        return updated;
    }

    async deleteShipment(id: string): Promise<void> {
        await this.dbInstance.delete(shipments).where(eq(shipments.id, id));
    }

    // Order attachments operations
    async getOrderAttachments(orderId: string): Promise<OrderAttachment[]> {
        return await this.dbInstance
            .select()
            .from(orderAttachments)
            .where(eq(orderAttachments.orderId, orderId))
            .orderBy(desc(orderAttachments.createdAt));
    }

    async createOrderAttachment(attachment: InsertOrderAttachment): Promise<OrderAttachment> {
        const [newAttachment] = await this.dbInstance.insert(orderAttachments).values(attachment).returning();
        return newAttachment;
    }

    async updateOrderAttachment(id: string, updates: UpdateOrderAttachment): Promise<OrderAttachment> {
        const [updated] = await this.dbInstance
            .update(orderAttachments)
            .set(updates)
            .where(eq(orderAttachments.id, id))
            .returning();

        if (!updated) {
            throw new Error(`Order attachment ${id} not found`);
        }

        return updated;
    }

    async deleteOrderAttachment(id: string): Promise<void> {
        await this.dbInstance.delete(orderAttachments).where(eq(orderAttachments.id, id));
    }

    // Artwork & file handling operations
    async listOrderFiles(orderId: string): Promise<(OrderAttachment & { uploadedByUser?: User | null })[]> {
        const files = await this.dbInstance
            .select({
                file: orderAttachments,
                user: users,
            })
            .from(orderAttachments)
            .leftJoin(users, eq(orderAttachments.uploadedByUserId, users.id))
            .where(eq(orderAttachments.orderId, orderId))
            .orderBy(desc(orderAttachments.createdAt));

        return files.map(f => ({
            ...f.file,
            uploadedByUser: f.user || null,
        }));
    }

    async attachFileToOrder(data: InsertOrderAttachment): Promise<OrderAttachment> {
        // Validate isPrimary constraint: only one primary per role+side combination
        if (data.isPrimary && data.role && data.side) {
            // Unset any existing primary for this role+side
            await this.dbInstance
                .update(orderAttachments)
                .set({ isPrimary: false })
                .where(
                    and(
                        eq(orderAttachments.orderId, data.orderId),
                        eq(orderAttachments.role, data.role as any),
                        eq(orderAttachments.side, data.side as any)
                    )
                );
        }

        const [newAttachment] = await this.dbInstance.insert(orderAttachments).values(data).returning();
        return newAttachment;
    }

    async updateOrderFileMeta(id: string, updates: UpdateOrderAttachment): Promise<OrderAttachment> {
        // If setting isPrimary=true, need to unset others for same role+side
        if (updates.isPrimary) {
            // Get the current file to know its orderId, role, side
            const [currentFile] = await this.dbInstance
                .select()
                .from(orderAttachments)
                .where(eq(orderAttachments.id, id));

            if (currentFile) {
                const role = updates.role || currentFile.role;
                const side = updates.side || currentFile.side;

                // Unset other primaries for this role+side
                await this.dbInstance
                    .update(orderAttachments)
                    .set({ isPrimary: false })
                    .where(
                        and(
                            eq(orderAttachments.orderId, currentFile.orderId),
                            eq(orderAttachments.role, role as any),
                            eq(orderAttachments.side, side as any),
                            sql`${orderAttachments.id} != ${id}` // Exclude current file
                        )
                    );
            }
        }

        const [updated] = await this.dbInstance
            .update(orderAttachments)
            .set(updates)
            .where(eq(orderAttachments.id, id))
            .returning();

        if (!updated) {
            throw new Error(`Order file ${id} not found`);
        }

        return updated;
    }

    async detachOrderFile(id: string): Promise<void> {
        await this.dbInstance.delete(orderAttachments).where(eq(orderAttachments.id, id));
    }

    async getOrderArtworkSummary(orderId: string): Promise<{
        front?: OrderAttachment | null;
        back?: OrderAttachment | null;
        other: OrderAttachment[];
    }> {
        const files = await this.dbInstance
            .select()
            .from(orderAttachments)
            .where(
                and(
                    eq(orderAttachments.orderId, orderId),
                    eq(orderAttachments.role, 'artwork')
                )
            )
            .orderBy(desc(orderAttachments.isPrimary), desc(orderAttachments.createdAt));

        const front = files.find(f => f.side === 'front' && f.isPrimary) || files.find(f => f.side === 'front') || null;
        const back = files.find(f => f.side === 'back' && f.isPrimary) || files.find(f => f.side === 'back') || null;
        const other = files.filter(f => f.side === 'na' || (!f.isPrimary && (f.side === 'front' || f.side === 'back')));

        return { front, back, other };
    }

    // Order audit log operations
    async getOrderAuditLog(orderId: string): Promise<OrderAuditLog[]> {
        return await this.dbInstance
            .select()
            .from(orderAuditLog)
            .where(eq(orderAuditLog.orderId, orderId))
            .orderBy(desc(orderAuditLog.createdAt));
    }

    async createOrderAuditLog(log: InsertOrderAuditLog): Promise<OrderAuditLog> {
        const [auditLogEntry] = await this.dbInstance.insert(orderAuditLog).values(log).returning();
        return auditLogEntry;
    }
}
