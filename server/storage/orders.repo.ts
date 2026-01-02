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
    quoteAttachments,
    quoteLineItems,
    jobs,
    jobStatusLog,
    globalVariables,
    auditLogs,
    type Order,
    type InsertOrder,
    type OrderWithRelations,
    type OrderLineItem,
    type InsertOrderLineItem,
    type LineItemMaterialUsage,
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
import { eq, and, or, ilike, gte, lte, desc, sql, isNull, inArray } from "drizzle-orm";

const ORDER_ATTACHMENT_SAFE_SELECT = {
    id: orderAttachments.id,
    orderId: orderAttachments.orderId,
    orderLineItemId: orderAttachments.orderLineItemId,
    quoteId: orderAttachments.quoteId,
    uploadedByUserId: orderAttachments.uploadedByUserId,
    uploadedByName: orderAttachments.uploadedByName,
    fileName: orderAttachments.fileName,
    fileUrl: orderAttachments.fileUrl,
    fileSize: orderAttachments.fileSize,
    mimeType: orderAttachments.mimeType,
    description: orderAttachments.description,
    originalFilename: orderAttachments.originalFilename,
    storedFilename: orderAttachments.storedFilename,
    relativePath: orderAttachments.relativePath,
    storageProvider: orderAttachments.storageProvider,
    extension: orderAttachments.extension,
    sizeBytes: orderAttachments.sizeBytes,
    checksum: orderAttachments.checksum,
    thumbnailRelativePath: orderAttachments.thumbnailRelativePath,
    thumbnailGeneratedAt: orderAttachments.thumbnailGeneratedAt,
    role: orderAttachments.role,
    side: orderAttachments.side,
    isPrimary: orderAttachments.isPrimary,
    thumbnailUrl: orderAttachments.thumbnailUrl,
    createdAt: orderAttachments.createdAt,
    updatedAt: orderAttachments.updatedAt,
} as const;

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
                    .set({ value: (current + 1).toString(), updatedAt: new Date().toISOString() })
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

    private async getPreviewThumbnailsForOrderIds(organizationId: string, orderIds: string[]) {
        const previewData: Map<string, { thumbnails: string[]; totalCount: number }> = new Map();
        if (!orderIds.length) return previewData;

        // Query orderAttachments with thumb_ready status (matches Quotes pattern exactly)
        // Join with orders for organizationId filtering since order_attachments doesn't have org column
        const attachmentsQuery = await this.dbInstance
            .select({
                orderId: orderAttachments.orderId,
                thumbKey: orderAttachments.thumbKey,
                previewKey: orderAttachments.previewKey,
                fileName: orderAttachments.fileName,
            })
            .from(orderAttachments)
            .innerJoin(orders, eq(orders.id, orderAttachments.orderId))
            .where(
                and(
                    inArray(orderAttachments.orderId, orderIds),
                    eq(orders.organizationId, organizationId),
                    sql`${orderAttachments.thumbStatus} = 'thumb_ready'`
                )
            )
            .orderBy(orderAttachments.createdAt);

        const groupedAttachments = new Map<string, Array<{ thumbKey: string | null; previewKey: string | null; fileName: string }>>();
        for (const att of attachmentsQuery) {
            if (!groupedAttachments.has(att.orderId)) {
                groupedAttachments.set(att.orderId, []);
            }
            const group = groupedAttachments.get(att.orderId)!;
            if (group.length < 3) {
                group.push({ thumbKey: att.thumbKey, previewKey: att.previewKey, fileName: att.fileName });
            }
        }

        const countQuery = await this.dbInstance
            .select({
                orderId: orderAttachments.orderId,
                count: sql<number>`count(*)::int`,
            })
            .from(orderAttachments)
            .innerJoin(orders, eq(orders.id, orderAttachments.orderId))
            .where(
                and(
                    inArray(orderAttachments.orderId, orderIds),
                    eq(orders.organizationId, organizationId),
                    sql`${orderAttachments.thumbStatus} = 'thumb_ready'`
                )
            )
            .groupBy(orderAttachments.orderId);

        const countMap = new Map<string, number>();
        for (const row of countQuery) {
            countMap.set(row.orderId, row.count);
        }

        for (const orderIdKey of Array.from(groupedAttachments.keys())) {
            const attachments = groupedAttachments.get(orderIdKey)!;
            const thumbnails = attachments
                .map((att) => att.previewKey || att.thumbKey)
                .filter((key: string | null): key is string => !!key);
            previewData.set(orderIdKey, {
                thumbnails,
                totalCount: countMap.get(orderIdKey) || 0,
            });
        }

        return previewData;
    }

    async getAllOrdersPaginated(organizationId: string, opts: {
        search?: string;
        status?: string;
        priority?: string;
        customerId?: string;
        startDate?: string;
        endDate?: string;
        sortBy?: string;
        sortDir?: 'asc' | 'desc';
        page: number;
        pageSize: number;
        includeThumbnails: boolean;
    }): Promise<{
        items: Array<Order & {
            customer: any;
            contact: any;
            lineItemsCount: number;
            previewThumbnails?: string[];
            thumbsCount?: number;
            listLabel?: string | null;
        }>;
        page: number;
        pageSize: number;
        totalCount: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
    }> {
        const page = Math.max(1, opts.page);
        const pageSize = Math.min(200, Math.max(1, opts.pageSize));
        const offset = (page - 1) * pageSize;

        const conditions = [eq(orders.organizationId, organizationId)] as any[];
        if (opts.search) {
            const pattern = `%${opts.search}%`;
            conditions.push(or(
                ilike(orders.orderNumber, pattern),
                ilike(orders.poNumber, pattern),
                ilike(orders.label, pattern),
                ilike(orders.notesInternal, pattern)
            ));
        }
        if (opts.status) conditions.push(eq(orders.status, opts.status));
        if (opts.priority) conditions.push(eq(orders.priority, opts.priority));
        if (opts.customerId) conditions.push(eq(orders.customerId, opts.customerId));
        if (opts.startDate) conditions.push(gte(orders.createdAt, opts.startDate));
        if (opts.endDate) conditions.push(lte(orders.createdAt, opts.endDate));

        const whereClause = and(...conditions);

        // Determine order by
        let orderByClause = desc(orders.createdAt);
        if (opts.sortBy) {
            const dir = opts.sortDir === 'asc' ? 'asc' : 'desc';
            switch (opts.sortBy) {
                case 'orderNumber':
                    orderByClause = dir === 'asc' ? sql`${orders.orderNumber} ASC` : sql`${orders.orderNumber} DESC`;
                    break;
                case 'customer':
                    orderByClause = dir === 'asc' ? sql`${customers.companyName} ASC` : sql`${customers.companyName} DESC`;
                    break;
                case 'total':
                    orderByClause = dir === 'asc' ? sql`${orders.total}::numeric ASC` : sql`${orders.total}::numeric DESC`;
                    break;
                case 'dueDate':
                    orderByClause = dir === 'asc' ? sql`${orders.dueDate} ASC NULLS LAST` : sql`${orders.dueDate} DESC NULLS LAST`;
                    break;
                case 'status':
                    orderByClause = dir === 'asc' ? sql`${orders.status} ASC` : sql`${orders.status} DESC`;
                    break;
                case 'priority':
                    orderByClause = dir === 'asc' ? sql`${orders.priority} ASC` : sql`${orders.priority} DESC`;
                    break;
                case 'label':
                    orderByClause = dir === 'asc' ? sql`${orders.label} ASC NULLS LAST` : sql`${orders.label} DESC NULLS LAST`;
                    break;
                default:
                    orderByClause = desc(orders.createdAt);
            }
        }

        const [{ totalCount }] = await this.dbInstance
            .select({ totalCount: sql<number>`count(*)::int` })
            .from(orders)
            .where(whereClause);

        const rows = await this.dbInstance
            .select({
                order: orders,
                customerCompanyName: customers.companyName,
                customer: customers,
                contact: customerContacts,
                lineItemsCount: sql<number>`(
                    select count(*)::int from ${orderLineItems}
                    where ${orderLineItems.orderId} = ${orders.id}
                )`,
            })
            .from(orders)
            .leftJoin(
                customers,
                and(eq(customers.id, orders.customerId), eq(customers.organizationId, organizationId))
            )
            .leftJoin(
                customerContacts,
                eq(customerContacts.id, orders.contactId)
            )
            .where(whereClause)
            .orderBy(orderByClause)
            .limit(pageSize)
            .offset(offset);

        const orderIds = rows.map((r) => r.order.id);
        let previewData = new Map<string, { thumbnails: string[]; totalCount: number }>();
        
        if (opts.includeThumbnails) {
            try {
                previewData = await this.getPreviewThumbnailsForOrderIds(organizationId, orderIds);
            } catch (error: any) {
                console.error('[orders] thumbnails disabled/fallback due to error:', error.message);
                // Fail-soft: return empty thumbnails instead of crashing
                previewData = new Map();
            }
        }

        // Fetch list notes for all orders in this page
        const { orderListNotes } = await import("@shared/schema");
        const listNotesResult = await this.dbInstance
            .select({
                orderId: orderListNotes.orderId,
                listLabel: orderListNotes.listLabel,
            })
            .from(orderListNotes)
            .where(
                and(
                    eq(orderListNotes.organizationId, organizationId),
                    inArray(orderListNotes.orderId, orderIds)
                )
            );

        const listNotesMap = new Map<string, string | null>();
        for (const note of listNotesResult) {
            listNotesMap.set(note.orderId, note.listLabel);
        }

        const items = rows.map(({ order, customer, contact, lineItemsCount }) => ({
            ...order,
            customer,
            contact,
            lineItemsCount,
            previewThumbnails: previewData.get(order.id)?.thumbnails || [],
            thumbsCount: previewData.get(order.id)?.totalCount || 0,
            listLabel: listNotesMap.get(order.id) || null,
        }));

        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        return {
            items,
            page,
            pageSize,
            totalCount,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
        };
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
        if (filters?.startDate) conditions.push(gte(orders.createdAt, filters.startDate.toISOString()));
        if (filters?.endDate) conditions.push(lte(orders.createdAt, filters.endDate.toISOString()));

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
        
        // Contact resolution with fallback logic
        let contact: CustomerContact | null = null;
        if (order.contactId) {
            // If order has a contact_id, fetch that specific contact
            const contactRows = await this.dbInstance.select().from(customerContacts).where(eq(customerContacts.id, order.contactId));
            contact = contactRows[0] || null;
        }
        
        // Fallback: If no contact_id or contact not found, get best contact for the customer
        if (!contact && order.customerId) {
            const contactsForCustomer = await this.dbInstance
                .select()
                .from(customerContacts)
                .where(eq(customerContacts.customerId, order.customerId))
                .orderBy(
                    sql`CASE WHEN ${customerContacts.isPrimary} = true THEN 0 ELSE 1 END`,
                    sql`${customerContacts.createdAt} DESC`
                );
            contact = contactsForCustomer[0] || null;
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
                taxRate: data.taxRate != null ? data.taxRate.toString() : null,
                taxAmount: data.taxAmount != null ? data.taxAmount.toString() : undefined,
                taxableSubtotal: data.taxableSubtotal != null ? data.taxableSubtotal.toString() : undefined,
                total: total.toString(),
                discount: discount.toString(),
                notesInternal: data.notesInternal || null,
                createdByUserId: data.createdByUserId,
            };
            const [order] = await tx.insert(orders).values(orderInsert).returning();

            // If this order is being created from a quote, carry forward quote-level (non-line-item) attachments.
            // This is done inside the same transaction so conversion is atomic.
            let inheritedFromQuoteNumber: string | null = null;
            let inheritedQuoteAttachmentIds: string[] = [];
            let createdOrderAttachmentIds: string[] = [];

            if (data.quoteId) {
                const [quoteRow] = await tx
                    .select({ quoteNumber: quotes.quoteNumber })
                    .from(quotes)
                    .where(and(eq(quotes.id, data.quoteId), eq(quotes.organizationId, organizationId)));
                inheritedFromQuoteNumber = quoteRow?.quoteNumber != null ? String(quoteRow.quoteNumber) : null;

                const quoteLevelAttachments = await tx
                    .select()
                    .from(quoteAttachments)
                    .where(
                        and(
                            eq(quoteAttachments.quoteId, data.quoteId),
                            eq(quoteAttachments.organizationId, organizationId),
                            isNull(quoteAttachments.quoteLineItemId)
                        )
                    );

                if (quoteLevelAttachments.length > 0) {
                    inheritedQuoteAttachmentIds = quoteLevelAttachments.map((a) => a.id);
                    const orderAttachmentInserts: typeof orderAttachments.$inferInsert[] = quoteLevelAttachments.map((a) => ({
                        orderId: order.id,
                        orderLineItemId: null,
                        quoteId: data.quoteId,
                        uploadedByUserId: a.uploadedByUserId ?? null,
                        uploadedByName: a.uploadedByName ?? null,
                        fileName: a.fileName,
                        fileUrl: a.fileUrl,
                        fileSize: a.fileSize ?? null,
                        mimeType: a.mimeType ?? null,
                        description: a.description ?? null,
                        originalFilename: a.originalFilename ?? null,
                        storedFilename: a.storedFilename ?? null,
                        relativePath: a.relativePath ?? null,
                        storageProvider: (a.storageProvider as any) ?? undefined,
                        extension: a.extension ?? null,
                        sizeBytes: a.sizeBytes ?? null,
                        checksum: a.checksum ?? null,
                        thumbnailRelativePath: a.thumbnailRelativePath ?? null,
                        thumbnailGeneratedAt: a.thumbnailGeneratedAt ?? null,
                        // role/side/isPrimary use defaults on order_attachments
                    }));

                    const inserted = await tx.insert(orderAttachments).values(orderAttachmentInserts).returning({ id: orderAttachments.id });
                    createdOrderAttachmentIds = inserted.map((r) => r.id);

                    // Add provenance entry so it's clear these files were inherited from the quote.
                    const [userRow] = await tx
                        .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
                        .from(users)
                        .where(eq(users.id, data.createdByUserId));
                    const userName = userRow
                        ? `${userRow.firstName || ''} ${userRow.lastName || ''}`.trim() || userRow.email
                        : null;

                    await tx.insert(orderAuditLog).values({
                        orderId: order.id,
                        userId: data.createdByUserId,
                        userName,
                        actionType: 'file_inherited',
                        fromStatus: null,
                        toStatus: null,
                        note: `Inherited ${quoteLevelAttachments.length} attachment(s) from quote ${inheritedFromQuoteNumber || data.quoteId}`,
                        metadata: {
                            inheritedFromQuoteId: data.quoteId,
                            inheritedFromQuoteNumber,
                            quoteAttachmentIds: inheritedQuoteAttachmentIds,
                            orderAttachmentIds: createdOrderAttachmentIds,
                        },
                    } as any);
                }
            }

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
        
        // Prevent double conversion
        if (quote.convertedToOrderId) {
            throw new Error('Quote is already converted to an order');
        }
        
        const quoteLines = await this.dbInstance.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
        if (quoteLines.length === 0) throw new Error('Quote has no line items');

        // Convert quote line items to order line items
        const orderLineItemsData: Omit<InsertOrderLineItem, 'orderId'>[] = quoteLines.map((ql) => ({
            quoteLineItemId: ql.id,
            productId: ql.productId,
            productVariantId: ql.variantId,
            productType: ql.productType,
            description: ql.productName,
            width: ql.width ? Number(ql.width) : 0,
            height: ql.height ? Number(ql.height) : 0,
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
            taxAmount: ql.taxAmount || '0',
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

        const createdOrder = await this.createOrder(organizationId, orderData);

        // Update quote to link to the created order (marks it as converted)
        await this.dbInstance
            .update(quotes)
            .set({ 
                convertedToOrderId: createdOrder.id
            })
            .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)));

        // Create timeline entry for the conversion (fail-soft)
        try {
            const [user] = await this.dbInstance
                .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
                .from(users)
                .where(eq(users.id, createdByUserId));
            
            const userName = user
                ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email
                : 'System';

            await this.dbInstance.insert(auditLogs).values({
                organizationId,
                userId: createdByUserId,
                userName,
                actionType: 'CONVERSION',
                entityType: 'quote',
                entityId: quoteId,
                entityName: quote.quoteNumber?.toString() || quoteId,
                description: `Converted to Order #${createdOrder.orderNumber}`,
                oldValues: { converted: false },
                newValues: { converted: true, orderId: createdOrder.id, orderNumber: createdOrder.orderNumber },
            });
        } catch (timelineError) {
            console.error('[CONVERT QUOTE] Failed to create timeline entry:', timelineError);
            // Continue - don't fail conversion if timeline creation fails
        }

        return createdOrder;
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
        type SelectedOptionsInsert = typeof orderLineItems.$inferInsert["selectedOptions"];
        type SelectedOptionInsert = SelectedOptionsInsert extends Array<infer T> ? T : never;
        type NestingConfigInsert = typeof orderLineItems.$inferInsert["nestingConfigSnapshot"];
        type NestingConfigNonNull = Exclude<NestingConfigInsert, null | undefined>;
        type MaterialUsageJsonInsert = typeof orderLineItems.$inferInsert["materialUsageJson"];
        type MaterialUsageJsonNonNull = Exclude<MaterialUsageJsonInsert, null | undefined>;
        type MaterialUsageJsonRow = MaterialUsageJsonNonNull extends Array<infer T> ? T : never;
        type MaterialUsagesInsert = typeof orderLineItems.$inferInsert["materialUsages"];

        const asArrayOrUndefined = <T>(value: unknown): T[] | undefined => {
            return Array.isArray(value) ? (value as T[]) : undefined;
        };

        const asObjectOrNull = <T>(value: unknown): T | null | undefined => {
            if (value === undefined) return undefined;
            if (value === null) return null;
            return typeof value === "object" ? (value as T) : undefined;
        };

        // JSON/array fields often come from Zod/JSON sources as unknown; narrow them to the Drizzle column types.
        const selectedOptions = asArrayOrUndefined<SelectedOptionInsert>(lineItem.selectedOptions) as SelectedOptionsInsert | undefined;
        const nestingConfigSnapshot = asObjectOrNull<NestingConfigNonNull>(lineItem.nestingConfigSnapshot) as NestingConfigInsert;
        const materialUsageJson = asArrayOrUndefined<MaterialUsageJsonRow>(lineItem.materialUsageJson) as MaterialUsageJsonInsert | undefined;
        const materialUsages = asArrayOrUndefined<LineItemMaterialUsage>(lineItem.materialUsages) as MaterialUsagesInsert | undefined;

        // Drizzle table expects string-valued money/dimension columns; API/DTO may provide numbers.
        const lineItemInsert: typeof orderLineItems.$inferInsert = {
            orderId: lineItem.orderId,
            quoteLineItemId: lineItem.quoteLineItemId ?? null,
            productId: lineItem.productId,
            productVariantId: lineItem.productVariantId ?? null,
            productType: lineItem.productType ?? "wide_roll",
            description: lineItem.description,
            width: lineItem.width == null ? null : lineItem.width.toString(),
            height: lineItem.height == null ? null : lineItem.height.toString(),
            quantity: lineItem.quantity,
            sqft: lineItem.sqft == null ? null : lineItem.sqft.toString(),
            unitPrice: lineItem.unitPrice.toString(),
            totalPrice: lineItem.totalPrice.toString(),
            status: lineItem.status,
            specsJson: lineItem.specsJson ?? undefined,
            selectedOptions,
            nestingConfigSnapshot,
            materialId: lineItem.materialId ?? null,
            materialUsageJson,
            materialUsages,
            requiresInventory: lineItem.requiresInventory ?? undefined,
            // In schema this is optional (defaultable) but not nullable: use undefined (omit) rather than null.
            taxAmount: lineItem.taxAmount == null ? undefined : String(lineItem.taxAmount),
            isTaxableSnapshot: lineItem.isTaxableSnapshot ?? undefined,
        };
        const [created] = await this.dbInstance.insert(orderLineItems).values(lineItemInsert).returning();
        return created;
    }

    async updateOrderLineItem(id: string, lineItem: Partial<InsertOrderLineItem>): Promise<OrderLineItem> {
        const updateData: any = { ...lineItem, updatedAt: new Date().toISOString() };
        const [updated] = await this.dbInstance
            .update(orderLineItems)
            .set(updateData)
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
        const rows = await this.dbInstance
            .select(ORDER_ATTACHMENT_SAFE_SELECT)
            .from(orderAttachments)
            .where(eq(orderAttachments.orderId, orderId))
            .orderBy(desc(orderAttachments.createdAt));

        // Keep response shape stable even when derivative columns are not in DB.
        return rows.map((r) => ({
            ...(r as any),
            thumbKey: null,
            previewKey: null,
        })) as any;
    }

    async createOrderAttachment(attachment: InsertOrderAttachment): Promise<OrderAttachment> {
        const { thumbKey: _thumbKey, previewKey: _previewKey, ...safeInsert } = attachment as any;
        const [newAttachment] = await this.dbInstance
            .insert(orderAttachments)
            .values(safeInsert)
            .returning(ORDER_ATTACHMENT_SAFE_SELECT);

        return ({
            ...(newAttachment as any),
            thumbKey: null,
            previewKey: null,
        }) as any;
    }

    async updateOrderAttachment(id: string, updates: UpdateOrderAttachment): Promise<OrderAttachment> {
        const { thumbKey: _thumbKey, previewKey: _previewKey, ...safeUpdates } = updates as any;
        const [updated] = await this.dbInstance
            .update(orderAttachments)
            .set(safeUpdates)
            .where(eq(orderAttachments.id, id))
            .returning(ORDER_ATTACHMENT_SAFE_SELECT);

        if (!updated) {
            throw new Error(`Order attachment ${id} not found`);
        }

        return ({
            ...(updated as any),
            thumbKey: null,
            previewKey: null,
        }) as any;
    }

    async deleteOrderAttachment(id: string): Promise<void> {
        await this.dbInstance.delete(orderAttachments).where(eq(orderAttachments.id, id));
    }

    // Artwork & file handling operations
    async listOrderFiles(orderId: string): Promise<(OrderAttachment & { uploadedByUser?: User | null })[]> {
        const files = await this.dbInstance
            .select({
                file: ORDER_ATTACHMENT_SAFE_SELECT,
                user: users,
            })
            .from(orderAttachments)
            .leftJoin(users, eq(orderAttachments.uploadedByUserId, users.id))
            .where(eq(orderAttachments.orderId, orderId))
            .orderBy(desc(orderAttachments.createdAt));

        return files.map(f => ({
            ...(f.file as any),
            thumbKey: null,
            previewKey: null,
            uploadedByUser: f.user || null,
        })) as any;
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

        const { thumbKey: _thumbKey, previewKey: _previewKey, ...safeInsert } = data as any;
        const [newAttachment] = await this.dbInstance
            .insert(orderAttachments)
            .values(safeInsert)
            .returning(ORDER_ATTACHMENT_SAFE_SELECT);

        return ({
            ...(newAttachment as any),
            thumbKey: null,
            previewKey: null,
        }) as any;
    }

    async updateOrderFileMeta(id: string, updates: UpdateOrderAttachment): Promise<OrderAttachment> {
        // If setting isPrimary=true, need to unset others for same role+side
        if (updates.isPrimary) {
            // Get the current file to know its orderId, role, side
            const [currentFile] = await this.dbInstance
                .select(ORDER_ATTACHMENT_SAFE_SELECT)
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

        const { thumbKey: _thumbKey, previewKey: _previewKey, ...safeUpdates } = updates as any;
        const [updated] = await this.dbInstance
            .update(orderAttachments)
            .set(safeUpdates)
            .where(eq(orderAttachments.id, id))
            .returning(ORDER_ATTACHMENT_SAFE_SELECT);

        if (!updated) {
            throw new Error(`Order file ${id} not found`);
        }

        return ({
            ...(updated as any),
            thumbKey: null,
            previewKey: null,
        }) as any;
    }

    async detachOrderFile(id: string): Promise<void> {
        await this.dbInstance.delete(orderAttachments).where(eq(orderAttachments.id, id));
    }

    async getOrderArtworkSummary(orderId: string): Promise<{
        front?: OrderAttachment | null;
        back?: OrderAttachment | null;
        other: OrderAttachment[];
    }> {
        const rows = await this.dbInstance
            .select(ORDER_ATTACHMENT_SAFE_SELECT)
            .from(orderAttachments)
            .where(
                and(
                    eq(orderAttachments.orderId, orderId),
                    eq(orderAttachments.role, 'artwork')
                )
            )
            .orderBy(desc(orderAttachments.isPrimary), desc(orderAttachments.createdAt));

        const files = rows.map((r) => ({
            ...(r as any),
            thumbKey: null,
            previewKey: null,
        })) as any as OrderAttachment[];

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
