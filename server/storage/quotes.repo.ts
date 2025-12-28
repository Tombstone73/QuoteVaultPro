import { db } from "../db";
import {
    quotes,
    quoteLineItems,
    quoteWorkflowStates,
    users,
    customers,
    products,
    productVariants,
    globalVariables,
    type Quote,
    type InsertQuote,
    type UpdateQuote,
    type QuoteLineItem,
    type InsertQuoteLineItem,
    type QuoteWithRelations,
    type QuoteWorkflowState,
    type InsertQuoteWorkflowState,
    type InsertGlobalVariable,
} from "@shared/schema";
import { and, eq, isNull, like, gte, lte, desc, asc, sql, inArray } from "drizzle-orm";

export class QuotesRepository {
    constructor(private readonly dbInstance = db) { }

    async createQuote(organizationId: string, data: {
        userId: string;
        customerId?: string | null;
        contactId?: string | null;
        customerName?: string;
        source?: string;
        status?: "draft" | "active" | "canceled";
        taxRate?: number | null;
        taxAmount?: number | null;
        taxableSubtotal?: number | null;
        shippingMethod?: string | null;
        shippingMode?: string | null;
        billToName?: string | null;
        billToCompany?: string | null;
        billToAddress1?: string | null;
        billToAddress2?: string | null;
        billToCity?: string | null;
        billToState?: string | null;
        billToPostalCode?: string | null;
        billToCountry?: string | null;
        billToPhone?: string | null;
        billToEmail?: string | null;
        shipToName?: string | null;
        shipToCompany?: string | null;
        shipToAddress1?: string | null;
        shipToAddress2?: string | null;
        shipToCity?: string | null;
        shipToState?: string | null;
        shipToPostalCode?: string | null;
        shipToCountry?: string | null;
        shipToPhone?: string | null;
        shipToEmail?: string | null;
        carrier?: string | null;
        carrierAccountNumber?: string | null;
        shippingInstructions?: string | null;
        requestedDueDate?: string | Date | null;
        validUntil?: string | Date | null;
        lineItems: Omit<InsertQuoteLineItem, 'quoteId'>[];
    }): Promise<QuoteWithRelations> {
        // Calculate totals from line items
        const lineItemsInput = data.lineItems ?? [];
        const subtotal = lineItemsInput.reduce((sum, item) => sum + parseFloat(item.linePrice.toString()), 0);
        const totalPrice = subtotal; // Will be updated if tax is applied

        // Create quote in a transaction to handle quote numbering
        const newQuote = await this.dbInstance.transaction(async (tx) => {
            // Get or create quote numbering variable
            let quoteNumberVar = await tx
                .select()
                .from(globalVariables)
                .where(and(
                    eq(globalVariables.name, 'next_quote_number'),
                    eq(globalVariables.organizationId, organizationId)
                ))
                .limit(1)
                .then(rows => rows[0]);

            // Auto-initialize quote numbering if not configured
            if (!quoteNumberVar) {
                console.log(`[NUMBERING] Auto-initialized quote numbering for org ${organizationId} with default sequence.`);

                // Create default quote numbering configuration
                const defaultConfig: InsertGlobalVariable = {
                    name: 'next_quote_number',
                    value: '1000', // Start at 1000
                    description: 'Next quote number sequence (auto-initialized)',
                    category: 'numbering',
                    isActive: true,
                };

                // Insert the new configuration
                const [newVar] = await tx
                    .insert(globalVariables)
                    .values({
                        ...defaultConfig,
                        organizationId,
                    })
                    .returning();

                quoteNumberVar = newVar;
            }

            const quoteNumber = Math.floor(Number(quoteNumberVar.value));

            // Create the parent quote with tax fields
            const quoteData = {
                userId: data.userId,
                quoteNumber,
                organizationId,
                customerId: data.customerId || null,
                contactId: data.contactId || null,
                customerName: data.customerName,
                source: data.source || 'internal',
                status: data.status || 'draft',
                subtotal: subtotal.toString(),
                taxRate: data.taxRate ?? null,
                taxAmount: data.taxAmount != null ? data.taxAmount.toString() : "0",
                taxableSubtotal: data.taxableSubtotal != null ? data.taxableSubtotal.toString() : "0",
                totalPrice: totalPrice.toString(),
                shippingMethod: data.shippingMethod ?? null,
                shippingMode: data.shippingMode ?? null,
                billToName: data.billToName ?? null,
                billToCompany: data.billToCompany ?? null,
                billToAddress1: data.billToAddress1 ?? null,
                billToAddress2: data.billToAddress2 ?? null,
                billToCity: data.billToCity ?? null,
                billToState: data.billToState ?? null,
                billToPostalCode: data.billToPostalCode ?? null,
                billToCountry: data.billToCountry ?? null,
                billToPhone: data.billToPhone ?? null,
                billToEmail: data.billToEmail ?? null,
                shipToName: data.shipToName ?? null,
                shipToCompany: data.shipToCompany ?? null,
                shipToAddress1: data.shipToAddress1 ?? null,
                shipToAddress2: data.shipToAddress2 ?? null,
                shipToCity: data.shipToCity ?? null,
                shipToState: data.shipToState ?? null,
                shipToPostalCode: data.shipToPostalCode ?? null,
                shipToCountry: data.shipToCountry ?? null,
                shipToPhone: data.shipToPhone ?? null,
                shipToEmail: data.shipToEmail ?? null,
                carrier: data.carrier ?? null,
                carrierAccountNumber: data.carrierAccountNumber ?? null,
                shippingInstructions: data.shippingInstructions ?? null,
                requestedDueDate: data.requestedDueDate ?? null,
                validUntil: data.validUntil ?? null,
            } as typeof quotes.$inferInsert;

            const [quote] = await tx.insert(quotes).values(quoteData).returning();

            // Increment the next quote number
            await tx
                .update(globalVariables)
                .set({
                    value: (quoteNumber + 1).toString(),
                    updatedAt: new Date(),
                })
                .where(eq(globalVariables.id, quoteNumberVar.id));

            return quote;
        });

        // Create line items
        // IMPORTANT: Only create NEW line items (those without an existing id).
        // Line items that already have an id were created via ensureLineItemId during
        // artwork upload and will be linked to this quote via finalizeTemporaryLineItemsForUser.
        // Creating duplicate line items would orphan the attachments keyed to the original IDs.
        const newLineItems = lineItemsInput.filter((item: any) => !item.id);
        const existingLineItemIds = lineItemsInput.filter((item: any) => item.id).map((item: any) => item.id);
        
        if (existingLineItemIds.length > 0) {
            console.log(`[createQuote] Skipping ${existingLineItemIds.length} line items that already exist (will be linked via finalizeTemporaryLineItemsForUser):`, existingLineItemIds);
        }
        
        const lineItemsData = newLineItems.map((item, index) => ({
            quoteId: newQuote.id,
            productId: item.productId,
            productName: item.productName,
            variantId: item.variantId,
            variantName: item.variantName,
            productType: (item as any).productType || 'wide_roll',
        status: (item as any).status || 'active',
            width: item.width.toString(),
            height: item.height.toString(),
            quantity: item.quantity,
            specsJson: (item as any).specsJson || null,
            selectedOptions: item.selectedOptions as Array<{
                optionId: string;
                optionName: string;
                value: string | number | boolean;
                setupCost: number;
                calculatedCost: number;
            }>,
            linePrice: item.linePrice.toString(),
            priceBreakdown: {
                ...item.priceBreakdown,
                variantInfo: item.priceBreakdown.variantInfo as string | undefined,
            },
            displayOrder: item.displayOrder || index,
            // Tax fields
            taxAmount: (item as any).taxAmount != null ? (item as any).taxAmount.toString() : null,
            isTaxableSnapshot: (item as any).isTaxableSnapshot ?? null,
        }));

        const createdLineItems = lineItemsData.length
            ? await this.dbInstance.insert(quoteLineItems).values(lineItemsData).returning()
            : [];
        
        // Link existing line items to this quote
        // These are line items that were persisted before quote creation (e.g., via ensureLineItemId during artwork upload)
        // SAFETY: Only link items that are truly unlinked (quoteId IS NULL, isTemporary = true)
        // This prevents accidentally stealing line items from other quotes.
        let linkedLineItems: QuoteLineItem[] = [];
        if (existingLineItemIds.length > 0) {
            linkedLineItems = await this.dbInstance
                .update(quoteLineItems)
                .set({ quoteId: newQuote.id, isTemporary: false })
                .where(
                    and(
                        inArray(quoteLineItems.id, existingLineItemIds),
                        isNull(quoteLineItems.quoteId),
                        eq(quoteLineItems.isTemporary, true)
                    )
                )
                .returning();
            console.log(`[createQuote] Linked ${linkedLineItems.length}/${existingLineItemIds.length} existing line items to quote ${newQuote.id}`);
            
            // Warn if any items were NOT linked (already had a quoteId or weren't temporary)
            if (linkedLineItems.length < existingLineItemIds.length) {
                const linkedIds = new Set(linkedLineItems.map(li => li.id));
                const notLinked = existingLineItemIds.filter(id => !linkedIds.has(id));
                console.warn(`[createQuote] Could not link ${notLinked.length} line items - they may already be linked to another quote:`, notLinked);
            }
        }

        // Combine created and linked line items
        const allLineItems = [...createdLineItems, ...linkedLineItems];

        // Fetch user and product details for line items
        const lineItemsWithRelations = await Promise.all(
            allLineItems.map(async (lineItem) => {
                const [product] = await this.dbInstance.select().from(products).where(eq(products.id, lineItem.productId));
                let variant = null;
                if (lineItem.variantId) {
                    [variant] = await this.dbInstance.select().from(productVariants).where(eq(productVariants.id, lineItem.variantId));
                }
                return {
                    ...lineItem,
                    product,
                    variant,
                };
            })
        );

        const [user] = await this.dbInstance.select().from(users).where(eq(users.id, newQuote.userId));

        return {
            ...newQuote,
            user,
            lineItems: lineItemsWithRelations,
        };
    }

    async getQuoteById(organizationId: string, id: string, userId?: string): Promise<QuoteWithRelations | undefined> {
        const [quoteRow] = await this.dbInstance
            .select()
            .from(quotes)
            .where(
                and(
                    eq(quotes.organizationId, organizationId),
                    eq(quotes.id, id)
                )
            )
            .limit(1);

        if (!quoteRow) {
            return undefined;
        }

        // Fetch line items for this quote (no status filters)
        // Order by displayOrder (primary) and id (tiebreaker) for stable ordering
        const lineItems = await this.dbInstance
            .select()
            .from(quoteLineItems)
            .where(eq(quoteLineItems.quoteId, id))
            .orderBy(asc(quoteLineItems.displayOrder), asc(quoteLineItems.id));

        // Enrich line items with product/variant data
        const lineItemsWithRelations = await Promise.all(
            lineItems.map(async (lineItem) => {
                const [product] = await this.dbInstance.select().from(products).where(eq(products.id, lineItem.productId));
                let variant = null;
                if (lineItem.variantId) {
                    [variant] = await this.dbInstance.select().from(productVariants).where(eq(productVariants.id, lineItem.variantId));
                }
                return {
                    ...lineItem,
                    product,
                    variant,
                };
            })
        );

        const [user] = await this.dbInstance.select().from(users).where(eq(users.id, quoteRow.userId));

        return {
            ...quoteRow,
            user,
            lineItems: lineItemsWithRelations,
        };
    }

    async getMaxQuoteNumber(organizationId: string): Promise<number | null> {
        const result = await this.dbInstance
            .select({ maxNumber: sql<number>`MAX(${quotes.quoteNumber})` })
            .from(quotes)
            .where(eq(quotes.organizationId, organizationId));

        return result[0]?.maxNumber ?? null;
    }

    async updateQuote(organizationId: string, id: string, data: {
        customerId?: string | null;
        contactId?: string | null;
        customerName?: string | null;
        status?: "draft" | "active" | "canceled";
        subtotal?: number | null;
        taxRate?: number | null;
        taxAmount?: number | null;
        marginPercentage?: number | null;
        discountAmount?: number | null;
        totalPrice?: number | null;
        requestedDueDate?: string | Date | null;
        validUntil?: string | Date | null;
        carrier?: string | null;
        carrierAccountNumber?: string | null;
        shippingInstructions?: string | null;
        label?: string | null;
        shippingMethod?: string | null;
        shippingMode?: string | null;
    }): Promise<QuoteWithRelations> {
        const updateData: any = {
            customerId: data.customerId ?? null,
            contactId: data.contactId ?? null,
            customerName: data.customerName ?? null,
            status: data.status ?? sql`status`,
            subtotal: data.subtotal != null ? data.subtotal.toString() : sql`subtotal`,
            taxRate: data.taxRate != null ? data.taxRate.toString() : sql`tax_rate`,
            taxAmount: data.taxAmount != null ? data.taxAmount.toString() : sql`tax_amount`,
            totalPrice: data.totalPrice != null ? data.totalPrice.toString() : sql`total_price`,
            updatedAt: new Date(),
        };

        if (data.marginPercentage != null) updateData.marginPercentage = data.marginPercentage.toString();
        if (data.discountAmount != null) updateData.discountAmount = data.discountAmount.toString();
        if (data.requestedDueDate !== undefined) updateData.requestedDueDate = data.requestedDueDate;
        if (data.validUntil !== undefined) updateData.validUntil = data.validUntil;
        if (data.carrier !== undefined) updateData.carrier = data.carrier;
        if (data.carrierAccountNumber !== undefined) updateData.carrierAccountNumber = data.carrierAccountNumber;
        if (data.shippingInstructions !== undefined) updateData.shippingInstructions = data.shippingInstructions;
        if (data.label !== undefined) updateData.label = data.label;
        if (data.shippingMethod !== undefined) updateData.shippingMethod = data.shippingMethod;
        if (data.shippingMode !== undefined) updateData.shippingMode = data.shippingMode;

        console.log(`[updateQuote] ID: ${id}, updateData:`, updateData);

        const [updated] = await this.dbInstance
            .update(quotes)
            .set(updateData)
            .where(and(eq(quotes.id, id), eq(quotes.organizationId, organizationId)))
            .returning();

        console.log(`[updateQuote] Updated row:`, updated);

        if (!updated) {
            throw new Error(`Quote ${id} not found`);
        }

        // Fetch the complete quote with relations
        const result = await this.getQuoteById(organizationId, id);
        console.log(`[updateQuote] Fetched result customerName:`, result?.customerName);
        if (!result) {
            throw new Error(`Quote ${id} not found after update`);
        }
        return result;
    }

    async deleteQuote(organizationId: string, id: string): Promise<void> {
        await this.dbInstance.delete(quotes).where(and(eq(quotes.id, id), eq(quotes.organizationId, organizationId)));
    }

    async addLineItem(quoteId: string, lineItem: Omit<InsertQuoteLineItem, 'quoteId'>): Promise<QuoteLineItem> {
        const lineItemData = {
            quoteId,
            productId: lineItem.productId,
            productName: lineItem.productName,
            variantId: lineItem.variantId,
            variantName: lineItem.variantName,
            productType: (lineItem as any).productType || 'wide_roll',
        status: (lineItem as any).status || 'active',
            width: lineItem.width.toString(),
            height: lineItem.height.toString(),
            quantity: lineItem.quantity,
            specsJson: (lineItem as any).specsJson || null,
            selectedOptions: lineItem.selectedOptions as Array<{
                optionId: string;
                optionName: string;
                value: string | number | boolean;
                setupCost: number;
                calculatedCost: number;
            }>,
            linePrice: lineItem.linePrice.toString(),
            priceBreakdown: {
                ...lineItem.priceBreakdown,
                variantInfo: lineItem.priceBreakdown.variantInfo as string | undefined,
            },
            displayOrder: lineItem.displayOrder || 0,
        };

        const [created] = await this.dbInstance.insert(quoteLineItems).values(lineItemData).returning();
        return created;
    }

    async updateLineItem(id: string, lineItem: Partial<InsertQuoteLineItem>): Promise<QuoteLineItem> {
        const updateData: any = {};
        const allowedStatus = ["draft", "active", "canceled"];
        if (lineItem.productId !== undefined) updateData.productId = lineItem.productId;
        if (lineItem.productName !== undefined) updateData.productName = lineItem.productName;
        if (lineItem.variantId !== undefined) updateData.variantId = lineItem.variantId;
        if (lineItem.variantName !== undefined) updateData.variantName = lineItem.variantName;
        if (lineItem.status !== undefined && allowedStatus.includes(lineItem.status as any)) updateData.status = lineItem.status;
        if (lineItem.width !== undefined) updateData.width = lineItem.width.toString();
        if (lineItem.height !== undefined) updateData.height = lineItem.height.toString();
        if (lineItem.quantity !== undefined) updateData.quantity = lineItem.quantity;
        if (lineItem.selectedOptions !== undefined) updateData.selectedOptions = lineItem.selectedOptions;
        if (lineItem.linePrice !== undefined) updateData.linePrice = lineItem.linePrice.toString();
        if (lineItem.priceBreakdown !== undefined) updateData.priceBreakdown = lineItem.priceBreakdown;
        if (lineItem.displayOrder !== undefined) updateData.displayOrder = lineItem.displayOrder;

        const [updated] = await this.dbInstance
            .update(quoteLineItems)
            .set(updateData)
            .where(eq(quoteLineItems.id, id))
            .returning();

        if (!updated) {
            throw new Error(`Line item ${id} not found`);
        }

        return updated;
    }

    async createTemporaryLineItem(
        organizationId: string,
        createdByUserId: string,
        lineItem: Omit<InsertQuoteLineItem, "quoteId">
    ): Promise<QuoteLineItem> {
        if (!lineItem.productId) {
            throw new Error("createTemporaryLineItem called without productId");
        }

        const lineItemData: typeof quoteLineItems.$inferInsert = {
            createdByUserId,
            quoteId: null,
            isTemporary: true,
            productId: lineItem.productId,
            productName: lineItem.productName,
            variantId: lineItem.variantId ?? null,
            variantName: lineItem.variantName ?? null,
            productType: (lineItem as any).productType ?? "wide_roll",
        status: (lineItem as any).status ?? "active",
            width: lineItem.width.toString(),
            height: lineItem.height.toString(),
            quantity: lineItem.quantity,
            specsJson: (lineItem as any).specsJson ?? null,
            selectedOptions: lineItem.selectedOptions ?? [],
            linePrice: lineItem.linePrice.toString(),
            priceBreakdown: lineItem.priceBreakdown as any,
            materialUsages: (lineItem as any).materialUsages ?? [],
            displayOrder: lineItem.displayOrder ?? 0,
        } as any;

        const [created] = await this.dbInstance
            .insert(quoteLineItems)
            .values(lineItemData)
            .returning();

        return created;
    }

    async finalizeTemporaryLineItemsForUser(
        organizationId: string,
        userId: string,
        quoteId: string
    ): Promise<QuoteLineItem[]> {
        // Migrate any temporary line items (created by this user) onto the saved quote.
        // Temporary line items are stored in the same table with isTemporary=true and quoteId=null.
        // Note: We filter by userId and isTemporary only, as organizationId is not stored in quote_line_items.
        // The organization context is validated through the quote's organizationId.
        // IMPORTANT: Line items do NOT have a status column - do not reference it.
        
        if (process.env.NODE_ENV === 'development') {
            console.log('[QuotesRepository.finalizeTemporaryLineItemsForUser] Query params:', { organizationId, userId, quoteId });
        }

        const tempItems = await this.dbInstance
            .select()
            .from(quoteLineItems)
            .where(
                and(
                    eq(quoteLineItems.createdByUserId, userId),
                    eq(quoteLineItems.isTemporary, true),
                    isNull(quoteLineItems.quoteId)
                )
            );

        if (!tempItems.length) {
            console.log("[QuotesRepository] finalizeTemporaryLineItemsForUser: no temp items", {
                organizationId,
                userId,
                quoteId,
            });
            return [];
        }

        // Attach temp items to the new quote and mark as finalized
        // Note: We only update quoteId and isTemporary. Line items do NOT have a status column.
        const updated = await this.dbInstance
            .update(quoteLineItems)
            .set({
                quoteId,
                isTemporary: false,
            })
            .where(
                and(
                    eq(quoteLineItems.createdByUserId, userId),
                    eq(quoteLineItems.isTemporary, true),
                    isNull(quoteLineItems.quoteId)
                )
            )
            .returning();

        return updated;
    }

    async deleteLineItem(id: string): Promise<void> {
        await this.dbInstance.delete(quoteLineItems).where(eq(quoteLineItems.id, id));
    }

    async getUserQuotes(organizationId: string, userId: string, filters?: {
        searchCustomer?: string;
        searchProduct?: string;
        startDate?: string;
        endDate?: string;
        minPrice?: string;
        maxPrice?: string;
        userRole?: string;
        source?: string;
    }): Promise<QuoteWithRelations[]> {
        try {
            // Include both active and draft quotes (don't filter out drafts)
            const conditions = [eq(quotes.organizationId, organizationId)];

        // Role-based filtering:
        // - owner/admin: can see all quotes (no userId filter)
        // - manager/employee: see only internal quotes they created
        // - customer: see only their own customer_quick_quote quotes
        const isStaff = filters?.userRole && ['owner', 'admin', 'manager', 'employee'].includes(filters.userRole);
        const isAdminOrOwner = filters?.userRole && ['owner', 'admin'].includes(filters.userRole);

        if (!isAdminOrOwner) {
            // Non-admin staff and customers are restricted to their own quotes
            conditions.push(eq(quotes.userId, userId));
        }

        // Source filtering based on role
        if (filters?.source) {
            // Explicit source filter from query params
            conditions.push(eq(quotes.source, filters.source));
        } else if (isStaff && !isAdminOrOwner) {
            // Regular staff (manager/employee) see only internal quotes
            conditions.push(eq(quotes.source, 'internal'));
        }
        // Admin/Owner with no explicit source filter see all
        // Customers with no explicit source filter see all their quotes (both types)

        if (filters?.searchCustomer) {
            const term = `%${filters.searchCustomer}%`;
            // Use a single SQL condition here to avoid `or()` returning `SQL | undefined` in drizzle's types.
            conditions.push(sql`(${quotes.customerName} like ${term} OR ${customers.companyName} like ${term})`);
        }

        if (filters?.startDate) {
            conditions.push(gte(quotes.createdAt, new Date(filters.startDate)));
        }

        if (filters?.endDate) {
            const endDate = new Date(filters.endDate);
            endDate.setHours(23, 59, 59, 999);
            conditions.push(lte(quotes.createdAt, endDate));
        }

        if (filters?.minPrice) {
            conditions.push(sql`${quotes.totalPrice}::numeric >= ${filters.minPrice}::numeric`);
        }

        if (filters?.maxPrice) {
            conditions.push(sql`${quotes.totalPrice}::numeric <= ${filters.maxPrice}::numeric`);
        }

            const userQuotes = await this.dbInstance
                .select({
                    quote: quotes,
                    customerCompanyName: customers.companyName,
                })
                .from(quotes)
                .leftJoin(
                    customers,
                    and(eq(customers.id, quotes.customerId), eq(customers.organizationId, organizationId))
                )
                .where(and(...conditions))
                .orderBy(desc(quotes.createdAt));

            // Fetch user and line items for each quote
            return await Promise.all(
                userQuotes.map(async ({ quote, customerCompanyName }) => {
                    const [user] = await this.dbInstance.select().from(users).where(eq(users.id, quote.userId));

                    // Fetch line items (no status column on line items)
                    const lineItems = await this.dbInstance
                        .select()
                        .from(quoteLineItems)
                        .where(eq(quoteLineItems.quoteId, quote.id));

                    // Apply product filter if specified
                    let filteredLineItems = lineItems;
                    if (filters?.searchProduct) {
                        filteredLineItems = lineItems.filter(item => item.productId === filters.searchProduct);
                        // If no line items match the product filter, skip this quote
                        if (filteredLineItems.length === 0) {
                            return null;
                        }
                    }

                    // Fetch product and variant details for line items
                    const lineItemsWithRelations = await Promise.all(
                        lineItems.map(async (lineItem) => {
                            const [product] = await this.dbInstance.select().from(products).where(eq(products.id, lineItem.productId));
                            let variant = null;
                            if (lineItem.variantId) {
                                [variant] = await this.dbInstance.select().from(productVariants).where(eq(productVariants.id, lineItem.variantId));
                            }
                            return {
                                ...lineItem,
                                product,
                                variant,
                            };
                        })
                    );

                    return {
                        ...quote,
                        customerName: customerCompanyName ?? quote.customerName,
                        user,
                        lineItems: lineItemsWithRelations,
                    };
                })
            ).then(results => results.filter(r => r !== null) as QuoteWithRelations[]);
        } catch (error: any) {
            console.error("[getUserQuotes] PG error message:", error?.message);
            console.error("[getUserQuotes] PG full error:", error);
            throw error;
        }
    }

    async getAllQuotes(organizationId: string, filters?: {
        searchUser?: string;
        searchCustomer?: string;
        searchProduct?: string;
        startDate?: string;
        endDate?: string;
        minQuantity?: string;
        maxQuantity?: string;
    }): Promise<QuoteWithRelations[]> {
        const conditions = [eq(quotes.organizationId, organizationId), eq(quotes.status, "active")];

        if (filters?.searchCustomer) {
            conditions.push(like(quotes.customerName, `%${filters.searchCustomer}%`));
        }

        if (filters?.startDate) {
            conditions.push(gte(quotes.createdAt, new Date(filters.startDate)));
        }

        if (filters?.endDate) {
            const endDate = new Date(filters.endDate);
            endDate.setHours(23, 59, 59, 999);
            conditions.push(lte(quotes.createdAt, endDate));
        }

        const whereClause = and(...conditions);

        const allQuotes = await this.dbInstance
            .select()
            .from(quotes)
            .where(whereClause)
            .orderBy(desc(quotes.createdAt));

        // Fetch user and line items for each quote
        return await Promise.all(
            allQuotes.map(async (quote) => {
                const [user] = await this.dbInstance.select().from(users).where(eq(users.id, quote.userId));

                // Apply user filter if specified
                if (filters?.searchUser && !user.email?.includes(filters.searchUser)) {
                    return null;
                }

                // Fetch line items (no status column on line items)
                const lineItems = await this.dbInstance
                    .select()
                    .from(quoteLineItems)
                    .where(eq(quoteLineItems.quoteId, quote.id));

                // Apply product filter if specified
                if (filters?.searchProduct) {
                    const hasProduct = lineItems.some(item => item.productId === filters.searchProduct);
                    if (!hasProduct) {
                        return null;
                    }
                }

                // Apply quantity filters if specified (check if any line item matches)
                if (filters?.minQuantity) {
                    const hasMinQuantity = lineItems.some(item => item.quantity >= parseInt(filters.minQuantity!));
                    if (!hasMinQuantity) return null;
                }

                if (filters?.maxQuantity) {
                    const hasMaxQuantity = lineItems.some(item => item.quantity <= parseInt(filters.maxQuantity!));
                    if (!hasMaxQuantity) return null;
                }

                // Fetch product and variant details for line items
                const lineItemsWithRelations = await Promise.all(
                    lineItems.map(async (lineItem) => {
                        const [product] = await this.dbInstance.select().from(products).where(eq(products.id, lineItem.productId));
                        let variant = null;
                        if (lineItem.variantId) {
                            [variant] = await this.dbInstance.select().from(productVariants).where(eq(productVariants.id, lineItem.variantId));
                        }
                        return {
                            ...lineItem,
                            product,
                            variant,
                        };
                    })
                );

                return {
                    ...quote,
                    user,
                    lineItems: lineItemsWithRelations,
                };
            })
        ).then(results => results.filter(r => r !== null) as QuoteWithRelations[]);
    }

    // Portal: Get quotes for a specific customer
    async getQuotesForCustomer(organizationId: string, customerId: string, filters?: {
        source?: string;
    }): Promise<QuoteWithRelations[]> {
            const conditions = [
            eq(quotes.organizationId, organizationId),
            eq(quotes.customerId, customerId),
            eq(quotes.status, "active"),
        ];

        // Filter by source if specified (e.g., 'customer_quick_quote' for portal)
        if (filters?.source) {
            conditions.push(eq(quotes.source, filters.source));
        }

        const customerQuotes = await this.dbInstance
            .select()
            .from(quotes)
            .where(and(...conditions))
            .orderBy(desc(quotes.createdAt));

        // Fetch user and line items for each quote
        return await Promise.all(
            customerQuotes.map(async (quote) => {
                const [user] = await this.dbInstance.select().from(users).where(eq(users.id, quote.userId));
                // Fetch line items (no status column on line items)
                const lineItems = await this.dbInstance
                    .select()
                    .from(quoteLineItems)
                    .where(eq(quoteLineItems.quoteId, quote.id));

                // Fetch product and variant details for line items
                const lineItemsWithRelations = await Promise.all(
                    lineItems.map(async (lineItem) => {
                        const [product] = await this.dbInstance.select().from(products).where(eq(products.id, lineItem.productId));
                        let variant = null;
                        if (lineItem.variantId) {
                            [variant] = await this.dbInstance.select().from(productVariants).where(eq(productVariants.id, lineItem.variantId));
                        }
                        return {
                            ...lineItem,
                            product,
                            variant,
                        };
                    })
                );

                return {
                    ...quote,
                    user,
                    lineItems: lineItemsWithRelations,
                };
            })
        );
    }

    // Quote workflow operations
    async getQuoteWorkflowState(quoteId: string): Promise<QuoteWorkflowState | undefined> {
        const [state] = await this.dbInstance
            .select()
            .from(quoteWorkflowStates)
            .where(eq(quoteWorkflowStates.quoteId, quoteId));
        return state;
    }

    async createQuoteWorkflowState(state: InsertQuoteWorkflowState): Promise<QuoteWorkflowState> {
        const [newState] = await this.dbInstance.insert(quoteWorkflowStates).values(state).returning();
        return newState;
    }

    async updateQuoteWorkflowState(quoteId: string, updates: Partial<InsertQuoteWorkflowState>): Promise<QuoteWorkflowState> {
        const [updated] = await this.dbInstance
            .update(quoteWorkflowStates)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(quoteWorkflowStates.quoteId, quoteId))
            .returning();

        if (!updated) {
            throw new Error(`Quote workflow state for quote ${quoteId} not found`);
        }

        return updated;
    }
}
