import { db } from "../db";
import {
    quotes,
    quoteLineItems,
    quoteAttachments,
    quoteWorkflowStates,
    orders,
    inboundOrderEvents,
    inboundOrderRecords,
    users,
    customers,
    customerContacts,
    organizations,
    products,
    productVariants,
    type Quote,
    type InsertQuote,
    type UpdateQuote,
    type QuoteLineItem,
    type InsertQuoteLineItem,
    type QuoteWithRelations,
    type QuoteWorkflowState,
    type InsertQuoteWorkflowState,
} from "@shared/schema";
import {
    resolveLineItemProofApprovalRequirement,
    resolveProofApprovalLockEnabledFromOrgPreferences,
    resolveProofingPolicyFromOrgPreferences,
} from "@shared/proofApprovalLock";
import { and, eq, isNull, like, gte, lte, desc, asc, sql, inArray, or } from "drizzle-orm";
import { DB_TO_WORKFLOW, getEffectiveWorkflowState, type QuoteWorkflowState as WorkflowState } from "@shared/quoteWorkflow";
import { resolveDerivativeFileAccess } from "../lib/supabaseObjectHelpers";
import { sanitizeJsonForPostgres } from "../lib/quoteCreateLineItemNormalizer";
import {
    buildQuoteLineItemPriceOverridePersistencePatch,
    coerceLineItemOverrideAt,
    enrichLineItemWithEffectivePricing,
} from "../lib/lineItemPricingPersistence";
import { materializeLineItemDesignSnapshot } from "../services/designLineItemSnapshot";
import { productDesignConfigRepository } from "./productDesignConfig.repo";
import {
    allocateJobNumber,
    isDocumentNumberUniqueViolation,
    toDocumentNumberConflictError,
} from "../services/documentNumberingService";

function hasExplicitPriceOverrideMetadata(value: any): boolean {
    const override = value?.priceOverride ?? value?.specsJson?.priceOverride;
    const overrideRecord = override && typeof override === "object" && !Array.isArray(override) ? override : null;
    const mode = overrideRecord?.mode ?? overrideRecord?.priceOverrideMode ?? value?.priceOverrideMode;
    const hasMode = typeof mode === "string" && mode.trim().length > 0;
    const hasValue =
        overrideRecord?.valueCents !== undefined ||
        overrideRecord?.priceOverrideValueCents !== undefined ||
        overrideRecord?.value !== undefined ||
        value?.priceOverrideValueCents !== undefined ||
        value?.priceOverrideValuePercent !== undefined;

    return hasMode && hasValue;
}

function getExplicitOverridePriceCents(value: any): number | null {
    if (!hasExplicitPriceOverrideMetadata(value)) return null;
    const cents = Number(value?.overridePriceCents);
    return Number.isFinite(cents) ? Math.round(cents) : null;
}

function buildExplicitPriceOverrideMetadata(value: any): any | null {
    if (!hasExplicitPriceOverrideMetadata(value)) return null;
    const override = value?.priceOverride ?? value?.specsJson?.priceOverride;
    const overrideRecord = override && typeof override === "object" && !Array.isArray(override) ? override : null;
    const mode = overrideRecord?.mode ?? overrideRecord?.priceOverrideMode ?? value?.priceOverrideMode;
    const valueCents = overrideRecord?.valueCents ?? overrideRecord?.priceOverrideValueCents ?? value?.priceOverrideValueCents;
    const valuePercent = overrideRecord?.valuePercent ?? overrideRecord?.priceOverrideValuePercent ?? value?.priceOverrideValuePercent ?? null;

    return {
        ...(overrideRecord ?? {}),
        mode,
        valueCents,
        valuePercent,
    };
}

function mergeExplicitPriceOverrideIntoSpecsJson(specsJson: unknown, value: any): Record<string, unknown> | null {
    const base = specsJson && typeof specsJson === "object" && !Array.isArray(specsJson)
        ? { ...(specsJson as Record<string, unknown>) }
        : {};
    const priceOverride = buildExplicitPriceOverrideMetadata(value);
    if (!priceOverride) {
        return Object.keys(base).length ? base : null;
    }
    return {
        ...base,
        priceOverride,
    };
}

function inboundSourceString(source: unknown, path: string): string | null {
    const value = path.split(".").reduce<unknown>((current, key) => {
        if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
        return (current as Record<string, unknown>)[key];
    }, source);
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

export class QuotesRepository {
    constructor(private readonly dbInstance = db) { }

    private async getInboundReviewLinksForQuoteIds(organizationId: string, quoteIds: string[]) {
        const links = new Map<string, {
            inboundRecordId: string;
            status: string;
            reviewOutcome: string | null;
            isActive: boolean;
            convertedLineItemCount: number | null;
            skippedLineItemCount: number | null;
            sourceType: string;
            sourceLabel: string | null;
            subject: string | null;
            senderName: string | null;
            senderEmail: string | null;
            receivedAt: Date;
        }>();

        if (quoteIds.length === 0) return links;

        const records = await this.dbInstance
            .select({
                id: inboundOrderRecords.id,
                createdQuoteId: inboundOrderRecords.createdQuoteId,
                status: inboundOrderRecords.status,
                reviewOutcome: inboundOrderRecords.reviewOutcome,
                sourceType: inboundOrderRecords.sourceType,
                sourceLabel: inboundOrderRecords.sourceLabel,
                rawPayloadJson: inboundOrderRecords.rawPayloadJson,
                normalizedPayloadJson: inboundOrderRecords.normalizedPayloadJson,
                receivedAt: inboundOrderRecords.receivedAt,
            })
            .from(inboundOrderRecords)
            .where(and(
                eq(inboundOrderRecords.organizationId, organizationId),
                inArray(inboundOrderRecords.createdQuoteId, quoteIds as [string, ...string[]]),
            ));

        const inboundRecordIds = records.map((record) => record.id);
        const events = inboundRecordIds.length > 0
            ? await this.dbInstance
                .select({
                    inboundRecordId: inboundOrderEvents.inboundRecordId,
                    metadataJson: inboundOrderEvents.metadataJson,
                    createdAt: inboundOrderEvents.createdAt,
                })
                .from(inboundOrderEvents)
                .where(and(
                    eq(inboundOrderEvents.organizationId, organizationId),
                    eq(inboundOrderEvents.eventType, "review.quote_created"),
                    inArray(inboundOrderEvents.inboundRecordId, inboundRecordIds as [string, ...string[]]),
                ))
                .orderBy(desc(inboundOrderEvents.createdAt))
            : [];

        const eventsByInboundRecordId = new Map(events.map((event) => [event.inboundRecordId, event]));

        for (const record of records) {
            if (!record.createdQuoteId) continue;
            const event = eventsByInboundRecordId.get(record.id);
            const metadata = event?.metadataJson && typeof event.metadataJson === "object" && !Array.isArray(event.metadataJson)
                ? event.metadataJson as Record<string, unknown>
                : {};
            const convertedLineItemCount = Number(metadata.convertedLineItemCount);
            const skippedLineItemCount = Number(metadata.skippedLineItemCount);
            const subject = inboundSourceString(record.rawPayloadJson, "subject")
                ?? inboundSourceString(record.normalizedPayloadJson, "subject");
            const senderName = inboundSourceString(record.rawPayloadJson, "sender.name")
                ?? inboundSourceString(record.normalizedPayloadJson, "sender.name");
            const senderEmail = inboundSourceString(record.rawPayloadJson, "sender.email")
                ?? inboundSourceString(record.normalizedPayloadJson, "sender.email");

            links.set(record.createdQuoteId, {
                inboundRecordId: record.id,
                status: record.status,
                reviewOutcome: record.reviewOutcome,
                isActive: record.status !== "approved" && record.status !== "terminal",
                convertedLineItemCount: Number.isFinite(convertedLineItemCount) ? convertedLineItemCount : null,
                skippedLineItemCount: Number.isFinite(skippedLineItemCount) ? skippedLineItemCount : null,
                sourceType: record.sourceType,
                sourceLabel: record.sourceLabel,
                subject,
                senderName,
                senderEmail,
                receivedAt: record.receivedAt,
            });
        }

        return links;
    }

    private async getDesignConfigMap(organizationId: string, productIds: string[], executor: any = this.dbInstance) {
        const configs = await productDesignConfigRepository.listByProductIds(organizationId, Array.from(new Set(productIds)), executor);
        return new Map(configs.map((config) => [config.productId, config]));
    }

    private async resolvePreviewThumbnailUrl(att: { fileRecordId?: string | null; thumbKey?: string | null; previewKey?: string | null }) {
        const previewAccess = await resolveDerivativeFileAccess(att, "preview");
        if (previewAccess.url) return previewAccess.url;

        const thumbAccess = await resolveDerivativeFileAccess(att, "thumbnail");
        return thumbAccess.url ?? null;
    }

    private buildUserQuotesConditions(
        organizationId: string,
        userId: string,
        filters?: {
            searchCustomer?: string;
            searchProduct?: string;
            startDate?: string;
            endDate?: string;
            minPrice?: string;
            maxPrice?: string;
            userRole?: string;
            source?: string;
            status?: WorkflowState;
            portalVisibility?: "visible" | "hidden";
        }
    ) {
        // Include both active and draft quotes (don't filter out drafts)
        const conditions = [eq(quotes.organizationId, organizationId)];

        // Role-based filtering:
        // - owner/admin: can see all quotes (no userId filter)
        // - manager/employee: see only internal quotes they created
        // - customer: see only their own customer_quick_quote quotes
        const isStaff = filters?.userRole && ['owner', 'admin', 'manager', 'employee'].includes(filters.userRole);
        const isAdminOrOwner = filters?.userRole && ['owner', 'admin'].includes(filters.userRole);

        if (!isAdminOrOwner) {
            conditions.push(eq(quotes.userId, userId));
        }

        // Source filtering
        if (filters?.source) {
            conditions.push(eq(quotes.source, filters.source));
        } else if (isStaff && !isAdminOrOwner) {
            conditions.push(eq(quotes.source, 'internal'));
        }

        if (filters?.searchCustomer) {
            const term = `%${filters.searchCustomer}%`;
            // Use a single SQL condition here to avoid `or()` returning `SQL | undefined` in drizzle's types.
            conditions.push(sql`(
                ${quotes.customerName} like ${term}
                OR ${customers.companyName} like ${term}
                OR exists (
                    select 1 from ${customerContacts}
                    where ${customerContacts.id} = ${quotes.contactId}
                      and ${customerContacts.organizationId} = ${organizationId}
                      and (
                        ${customerContacts.firstName} ilike ${term}
                        OR ${customerContacts.lastName} ilike ${term}
                        OR ${customerContacts.email} ilike ${term}
                        OR concat_ws(' ', ${customerContacts.firstName}, ${customerContacts.lastName}) ilike ${term}
                      )
                )
            )`);
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

        if (filters?.searchProduct) {
            // Product filter: keep this as an EXISTS subquery to avoid multiplying rows.
            conditions.push(
                sql`exists (
                    select 1 from ${quoteLineItems}
                    where ${quoteLineItems.quoteId} = ${quotes.id}
                      and ${quoteLineItems.productId} = ${filters.searchProduct}
                )`
            );
        }

        if (filters?.status) {
            // Workflow state filter (includes derived states)
            const convertedExpr = sql`(${quotes.convertedToOrderId} is not null OR exists (
                select 1 from ${orders}
                where ${orders.quoteId} = ${quotes.id}
                  and ${orders.organizationId} = ${organizationId}
            ))`;

            if (filters.status === 'converted') {
                conditions.push(convertedExpr);
            } else if (filters.status === 'expired') {
                conditions.push(
                    sql`(
                        ${quotes.status} = 'pending'
                        AND ${quotes.validUntil} is not null
                        AND ${quotes.validUntil} < now()
                        AND NOT ${convertedExpr}
                    )`
                );
            } else {
                // Non-derived states map to DB enum.
                const dbStatus = {
                    draft: 'draft',
                    pending_approval: 'pending_approval',
                    sent: 'pending',
                    approved: 'active',
                    rejected: 'canceled',
                } as const;
                const mapped = (dbStatus as any)[filters.status] as string | undefined;
                if (mapped) {
                    conditions.push(eq(quotes.status, mapped as any));
                }
            }
        }

        if (filters?.portalVisibility === "visible") {
            conditions.push(eq(quotes.visibleInCustomerPortal, true));
        } else if (filters?.portalVisibility === "hidden") {
            conditions.push(eq(quotes.visibleInCustomerPortal, false));
        }

        return { conditions };
    }

    private getUserQuotesOrderBy(sortBy: string | undefined, sortDir: string | undefined) {
        const dir = (sortDir === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';
        const order = (expr: any) => (dir === 'asc' ? asc(expr) : desc(expr));

        // Stable secondary sort to prevent shuffle between pages.
        const stableSecondary = asc(quotes.id);

        switch (sortBy) {
            case 'quoteNumber':
                return [order(sql`coalesce(${quotes.numberCore}, ${quotes.quoteNumber})`), stableSecondary];
            case 'label':
                return [order(quotes.label), stableSecondary];
            case 'customer':
                return [order(sql`coalesce(${customers.companyName}, ${quotes.customerName})`), stableSecondary];
            case 'total':
                return [order(sql`${quotes.totalPrice}::numeric`), stableSecondary];
            case 'items':
                return [
                    order(sql`(
                        select count(*)::int from ${quoteLineItems}
                        where ${quoteLineItems.quoteId} = ${quotes.id}
                    )`),
                    stableSecondary,
                ];
            case 'source':
                return [order(quotes.source), stableSecondary];
            case 'createdBy':
                return [order(sql`coalesce(${users.lastName}, '')`), order(sql`coalesce(${users.firstName}, '')`), order(sql`coalesce(${users.email}, '')`), stableSecondary];
            case 'date':
            default:
                return [order(quotes.createdAt), stableSecondary];
        }
    }

    private async getPreviewThumbnailsForQuoteIds(organizationId: string, quoteIds: string[]) {
        const previewData: Map<string, { thumbnails: string[]; totalCount: number }> = new Map();
        if (!quoteIds.length) return previewData;

        const attachmentsQuery = await this.dbInstance
            .select({
                id: quoteAttachments.id,
                quoteId: quoteAttachments.quoteId,
                fileRecordId: quoteAttachments.fileRecordId,
            })
            .from(quoteAttachments)
            .where(
                and(
                    inArray(quoteAttachments.quoteId, quoteIds),
                    eq(quoteAttachments.organizationId, organizationId)
                )
            )
            .orderBy(quoteAttachments.createdAt);

        const groupedAttachments = new Map<string, string[]>();
        const countMap = new Map<string, number>();

        const resolvedRows = await Promise.all(attachmentsQuery.map(async (att) => {
            return {
                quoteId: att.quoteId,
                thumbnailUrl: await this.resolvePreviewThumbnailUrl(att),
            };
        }));

        for (const att of resolvedRows) {
            if (!att.thumbnailUrl) continue;

            countMap.set(att.quoteId, (countMap.get(att.quoteId) || 0) + 1);
            if (!groupedAttachments.has(att.quoteId)) {
                groupedAttachments.set(att.quoteId, []);
            }
            const group = groupedAttachments.get(att.quoteId)!;
            if (group.length < 3) {
                group.push(att.thumbnailUrl);
            }
        }

        for (const quoteIdKey of Array.from(groupedAttachments.keys())) {
            const thumbnails = groupedAttachments.get(quoteIdKey)!;
            previewData.set(quoteIdKey, {
                thumbnails,
                totalCount: countMap.get(quoteIdKey) || 0,
            });
        }

        return previewData;
    }

    async getUserQuotesPaginated(
        organizationId: string,
        userId: string,
        opts: {
            searchCustomer?: string;
            searchProduct?: string;
            startDate?: string;
            endDate?: string;
            minPrice?: string;
            maxPrice?: string;
            userRole?: string;
            source?: string;
            status?: WorkflowState;
            portalVisibility?: "visible" | "hidden";
            sortBy?: string;
            sortDir?: 'asc' | 'desc';
            page: number;
            pageSize: number;
            includeThumbnails: boolean;
        }
    ): Promise<{
        items: Array<
            Omit<QuoteWithRelations, 'user' | 'lineItems'> & {
                user: QuoteWithRelations['user'] | null;
                lineItems: QuoteWithRelations['lineItems'];
                lineItemsCount: number;
                previewThumbnails?: string[];
                thumbsCount?: number;
                workflowState?: WorkflowState;
                inboundReview?: {
                    inboundRecordId: string;
                    status: string;
                    reviewOutcome: string | null;
                    isActive: boolean;
                    convertedLineItemCount: number | null;
                    skippedLineItemCount: number | null;
                } | null;
            }
        >
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

        const { conditions } = this.buildUserQuotesConditions(organizationId, userId, opts);
        const whereClause = and(...conditions);
        const orderBy = this.getUserQuotesOrderBy(opts.sortBy, opts.sortDir);

        const [{ totalCount }] = await this.dbInstance
            .select({ totalCount: sql<number>`count(*)::int` })
            .from(quotes)
            .leftJoin(
                customers,
                and(eq(customers.id, quotes.customerId), eq(customers.organizationId, organizationId))
            )
            .where(whereClause);

        const rows = await this.dbInstance
            .select({
                quote: quotes,
                customerCompanyName: customers.companyName,
                contact: customerContacts,
                contactDisplayName: sql<string | null>`nullif(trim(concat_ws(' ', ${customerContacts.firstName}, ${customerContacts.lastName})), '')`,
                user: users,
                lineItemsCount: sql<number>`(
                    select count(*)::int from ${quoteLineItems}
                    where ${quoteLineItems.quoteId} = ${quotes.id}
                )`,
                hasOrder: sql<boolean>`(
                    ${quotes.convertedToOrderId} is not null OR exists (
                        select 1 from ${orders}
                        where ${orders.quoteId} = ${quotes.id}
                          and ${orders.organizationId} = ${organizationId}
                    )
                )`,
            })
            .from(quotes)
            .leftJoin(
                customers,
                and(eq(customers.id, quotes.customerId), eq(customers.organizationId, organizationId))
            )
            .leftJoin(
                customerContacts,
                and(eq(customerContacts.id, quotes.contactId), eq(customerContacts.organizationId, organizationId))
            )
            .leftJoin(users, eq(users.id, quotes.userId))
            .where(whereClause)
            .orderBy(...orderBy)
            .limit(pageSize)
            .offset(offset);

        const quoteIds = rows.map((r) => r.quote.id);
        const isInternalUser = ["owner", "admin", "manager", "employee"].includes(opts.userRole ?? "");
        const inboundLinks = isInternalUser
            ? await this.getInboundReviewLinksForQuoteIds(organizationId, quoteIds)
            : new Map();
        const previewData = opts.includeThumbnails
            ? await this.getPreviewThumbnailsForQuoteIds(organizationId, quoteIds)
            : new Map<string, { thumbnails: string[]; totalCount: number }>();

        // Fetch list notes for all quotes in this page
        const { quoteListNotes } = await import("@shared/schema");
        const listNotesResult = await this.dbInstance
            .select({
                quoteId: quoteListNotes.quoteId,
                listLabel: quoteListNotes.listLabel,
            })
            .from(quoteListNotes)
            .where(
                and(
                    eq(quoteListNotes.organizationId, organizationId),
                    inArray(quoteListNotes.quoteId, quoteIds)
                )
            );
        
        const listNotesMap = new Map<string, string | null>();
        for (const note of listNotesResult) {
            listNotesMap.set(note.quoteId, note.listLabel);
        }

        const items = rows.map(({ quote, customerCompanyName, contact, contactDisplayName, user, lineItemsCount, hasOrder }) => {
            const workflowState = getEffectiveWorkflowState(
                quote.status as any,
                quote.validUntil ?? null,
                !!hasOrder
            );

            return {
                ...quote,
                customerName: customerCompanyName ?? quote.customerName ?? contactDisplayName ?? contact?.email ?? null,
                contact,
                user,
                lineItems: [],
                lineItemsCount,
                workflowState,
                previewThumbnails: opts.includeThumbnails ? (previewData.get(quote.id)?.thumbnails || []) : [],
                thumbsCount: opts.includeThumbnails ? (previewData.get(quote.id)?.totalCount || 0) : 0,
                listLabel: listNotesMap.get(quote.id) || null,
                inboundReview: inboundLinks.get(quote.id) ?? null,
            };
        });

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

    async createQuote(organizationId: string, data: {
        userId: string;
        customerId?: string | null;
        contactId?: string | null;
        customerName?: string;
        source?: string;
        visibleInCustomerPortal?: boolean;
        status?: "draft" | "active" | "canceled";
        label?: string | null;
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
        const lineItemsInput = (data.lineItems ?? []).map((item) => {
            const preparedItem = {
                ...item,
                specsJson: mergeExplicitPriceOverrideIntoSpecsJson((item as any).specsJson ?? null, item),
            };
            return enrichLineItemWithEffectivePricing(preparedItem);
        });
        const subtotal = lineItemsInput.reduce((sum, item) => sum + parseFloat(item.linePrice.toString()), 0);
        const totalPrice = subtotal; // Will be updated if tax is applied

        // Create quote in a transaction to handle quote numbering
        const newQuote = await this.dbInstance.transaction(async (tx) => {
            const jobNumber = await allocateJobNumber(organizationId, tx);
            const quoteNumber = jobNumber;
            const displayNumber = String(jobNumber);
            const numberCore = jobNumber;

            // Create the parent quote with tax fields
            const quoteData = {
                userId: data.userId,
                quoteNumber,
                jobNumber,
                displayNumber,
                numberCore,
                organizationId,
                customerId: data.customerId || null,
                contactId: data.contactId || null,
                customerName: data.customerName,
                source: data.source || 'internal',
                visibleInCustomerPortal: data.visibleInCustomerPortal ?? false,
                status: data.status || 'draft',
                label: data.label ?? null,
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

            return quote;
        }).catch((error) => {
            if (isDocumentNumberUniqueViolation(error)) throw toDocumentNumberConflictError(error);
            throw error;
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

        const designConfigMap = await this.getDesignConfigMap(
            organizationId,
            Array.from(new Set(newLineItems.map((item) => item.productId).filter(Boolean))),
        );
        const [orgForProofPolicy] = await this.dbInstance
            .select({ settings: organizations.settings })
            .from(organizations)
            .where(eq(organizations.id, organizationId))
            .limit(1);
        const proofApprovalLockEnabled = resolveProofApprovalLockEnabledFromOrgPreferences((orgForProofPolicy?.settings as any)?.preferences);

        // Snapshot requiresProofApproval from product so conversion is not sensitive to later product edits.
        const newLineItemProductIds = Array.from(new Set(newLineItems.map((item) => item.productId).filter(Boolean)));
        const proofApprovalRows = newLineItemProductIds.length > 0
            ? await this.dbInstance
                .select({ id: products.id, requiresProofApproval: products.requiresProofApproval })
                .from(products)
                .where(inArray(products.id, newLineItemProductIds as [string, ...string[]]))
            : [];
        const proofApprovalMap = new Map(proofApprovalRows.map((p) => [p.id, Boolean(p.requiresProofApproval)]));

        const lineItemsData = newLineItems.map((item, index) => {
            const proofApproval = resolveLineItemProofApprovalRequirement({
                productRequiresProofApproval: proofApprovalMap.get(item.productId) ?? false,
                requestedRequiresProofApproval: typeof (item as any).requiresProofApproval === "boolean" ? (item as any).requiresProofApproval : undefined,
                proofApprovalLockEnabled,
                proofingPolicy: resolveProofingPolicyFromOrgPreferences((orgForProofPolicy?.settings as any)?.preferences),
            });
            return {
            ...materializeLineItemDesignSnapshot({
                config: designConfigMap.get(item.productId) ?? null,
                requestedNeedsDesignOverride: (item as any).needsDesignOverride,
                requestedEffectiveRequiresDesign: typeof (item as any).requiresDesign === 'boolean' ? (item as any).requiresDesign : null,
            }),
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
            specsJson: sanitizeJsonForPostgres(
                mergeExplicitPriceOverrideIntoSpecsJson((item as any).specsJson || null, item),
            ).value as any,
            optionSelectionsJson: sanitizeJsonForPostgres((item as any).optionSelectionsJson ?? null).value as any,
            selectedOptions: sanitizeJsonForPostgres(item.selectedOptions || []).value as Array<{
                optionId: string;
                optionName: string;
                value: string | number | boolean;
                setupCost: number;
                calculatedCost: number;
            }>,
            linePrice: item.linePrice.toString(),
            priceOverride: null,
            priceBreakdown: sanitizeJsonForPostgres({
                ...item.priceBreakdown,
                variantInfo: item.priceBreakdown.variantInfo as string | undefined,
            }).value as any,
            materialUsages: sanitizeJsonForPostgres((item as any).materialUsages ?? []).value as any,
            displayOrder: item.displayOrder || index,
            // Tax fields
            taxAmount: (item as any).taxAmount != null ? (item as any).taxAmount.toString() : null,
            isTaxableSnapshot: (item as any).isTaxableSnapshot ?? null,
            // PBV2 server-authoritative fields (migration 0036, pbv2TreeVersionId nullable as of 0041)
            pbv2TreeVersionId: (item as any).pbv2TreeVersionId || null,
            pbv2SnapshotJson: sanitizeJsonForPostgres((item as any).pbv2SnapshotJson || {}).value as any,
            pricedAt: (item as any).pricedAt || new Date(),
            overridePriceCents: getExplicitOverridePriceCents(item),
            overrideReason: (item as any).overrideReason ?? null,
            // Canonical routing intent (migration 0015)
            requiresDesign: materializeLineItemDesignSnapshot({
                config: designConfigMap.get(item.productId) ?? null,
                requestedNeedsDesignOverride: (item as any).needsDesignOverride,
                requestedEffectiveRequiresDesign: typeof (item as any).requiresDesign === 'boolean' ? (item as any).requiresDesign : null,
            }).effectiveRequiresDesign,
            requiresPrepress: typeof (item as any).requiresPrepress === 'boolean' ? (item as any).requiresPrepress : null,
            // Proof-approval snapshot (migration 0032): captured from product now so conversion is immune to later changes.
            requiresProofApproval: proofApproval.requiresProofApproval,
            };
        });

        const createdLineItems = lineItemsData.length
            ? await this.dbInstance.insert(quoteLineItems).values(lineItemsData).returning()
            : [];
        
        // Link existing line items to this quote
        // These are line items that were persisted before quote creation (e.g., via ensureLineItemId during artwork upload)
        // SAFETY: Only link items that are truly unlinked (quoteId IS NULL, isTemporary = true)
        // This prevents accidentally stealing line items from other quotes.
        let linkedLineItems: QuoteLineItem[] = [];
        if (existingLineItemIds.length > 0) {
            const existingLineItems = await this.dbInstance
                .select()
                .from(quoteLineItems)
                .where(
                    and(
                        inArray(quoteLineItems.id, existingLineItemIds as [string, ...string[]]),
                        isNull(quoteLineItems.quoteId),
                        eq(quoteLineItems.isTemporary, true)
                    )
                );

            if (existingLineItems.length > 0) {
                const existingConfigMap = await this.getDesignConfigMap(
                    organizationId,
                    Array.from(new Set(existingLineItems.map((item) => item.productId).filter(Boolean))),
                );

                // Snapshot requiresProofApproval for the temp items being linked.
                const existingProductIds = Array.from(new Set(existingLineItems.map((item) => item.productId).filter(Boolean)));
                const existingProofApprovalRows = existingProductIds.length > 0
                    ? await this.dbInstance
                        .select({ id: products.id, requiresProofApproval: products.requiresProofApproval })
                        .from(products)
                        .where(inArray(products.id, existingProductIds as [string, ...string[]]))
                    : [];
                const existingProofApprovalMap = new Map(existingProofApprovalRows.map((p) => [p.id, Boolean(p.requiresProofApproval)]));

                linkedLineItems = [];
                for (const existingLineItem of existingLineItems) {
                    const designSnapshot = materializeLineItemDesignSnapshot({
                        config: existingConfigMap.get(existingLineItem.productId) ?? null,
                        existingEffectiveRequiresDesign: existingLineItem.requiresDesign,
                    });
                    const proofApproval = resolveLineItemProofApprovalRequirement({
                        productRequiresProofApproval: existingProofApprovalMap.get(existingLineItem.productId) ?? false,
                        requestedRequiresProofApproval: typeof existingLineItem.requiresProofApproval === "boolean" ? existingLineItem.requiresProofApproval : undefined,
                        proofApprovalLockEnabled,
                        proofingPolicy: resolveProofingPolicyFromOrgPreferences((orgForProofPolicy?.settings as any)?.preferences),
                    });

                    const [updatedExistingLineItem] = await this.dbInstance
                        .update(quoteLineItems)
                        .set({
                            quoteId: newQuote.id,
                            isTemporary: false,
                            requiresDesign: designSnapshot.effectiveRequiresDesign,
                            requiresDesignSnapshot: designSnapshot.requiresDesignSnapshot,
                            designBriefRequiredSnapshot: designSnapshot.designBriefRequiredSnapshot,
                            estimatedDesignMinutesSnapshot: designSnapshot.estimatedDesignMinutesSnapshot,
                            includedDesignMinutesSnapshot: designSnapshot.includedDesignMinutesSnapshot,
                            designPricingModeSnapshot: designSnapshot.designPricingModeSnapshot,
                            flatFeeAmountSnapshot: designSnapshot.flatFeeAmountSnapshot,
                            hourlyRateSnapshot: designSnapshot.hourlyRateSnapshot,
                            overageRateSnapshot: designSnapshot.overageRateSnapshot,
                            internalLaborRateSnapshot: designSnapshot.internalLaborRateSnapshot,
                            needsDesignOverride: designSnapshot.needsDesignOverride,
                            // Proof-approval snapshot (migration 0032)
                            requiresProofApproval: proofApproval.requiresProofApproval,
                        })
                        .where(eq(quoteLineItems.id, existingLineItem.id))
                        .returning();

                    if (updatedExistingLineItem) {
                        linkedLineItems.push(updatedExistingLineItem);
                    }
                }
            }
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
                    ...enrichLineItemWithEffectivePricing(lineItem as any),
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

    async getQuoteById(
        organizationId: string,
        id: string,
        userId?: string
    ): Promise<(QuoteWithRelations & {
        customer?: typeof customers.$inferSelect;
        contact?: typeof customerContacts.$inferSelect;
        inboundReview?: {
            inboundRecordId: string;
            status: string;
            reviewOutcome: string | null;
            isActive: boolean;
            convertedLineItemCount: number | null;
            skippedLineItemCount: number | null;
        } | null;
    }) | undefined> {
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
                    ...enrichLineItemWithEffectivePricing(lineItem as any),
                    product,
                    variant,
                };
            })
        );

        const [user] = await this.dbInstance.select().from(users).where(eq(users.id, quoteRow.userId));
        const [customer] = quoteRow.customerId
            ? await this.dbInstance
                .select()
                .from(customers)
                .where(and(eq(customers.id, quoteRow.customerId), eq(customers.organizationId, organizationId)))
                .limit(1)
            : [];
        const [contact] = quoteRow.contactId
            ? await this.dbInstance
                .select()
                .from(customerContacts)
                .where(and(eq(customerContacts.id, quoteRow.contactId), eq(customerContacts.organizationId, organizationId)))
                .limit(1)
            : [];
        const contactDisplayName = [
            contact?.firstName,
            contact?.lastName,
        ].map((part) => part?.trim()).filter(Boolean).join(" ");
        // A userId is supplied for customer-owned reads. Inbound source
        // metadata is internal-only and must never cross that boundary.
        const inboundLinks = userId
            ? new Map()
            : await this.getInboundReviewLinksForQuoteIds(organizationId, [quoteRow.id]);

        // Fetch list note (flags) for this quote
        const { quoteListNotes } = await import("@shared/schema");
        const [listNote] = await this.dbInstance
            .select()
            .from(quoteListNotes)
            .where(
                and(
                    eq(quoteListNotes.organizationId, organizationId),
                    eq(quoteListNotes.quoteId, id)
                )
            )
            .limit(1);

        return {
            ...quoteRow,
            customer,
            contact,
            customerName: (customer?.companyName ?? quoteRow.customerName ?? contactDisplayName) || contact?.email || null,
            user,
            lineItems: lineItemsWithRelations,
            inboundReview: inboundLinks.get(quoteRow.id) ?? null,
        };
    }

    /** Authoritative quote-to-order linkage.  A conversion pointer is
     * preferred, with the canonical order.quoteId relationship retained for
     * older conversions.  This is deliberately separate from presentation so
     * internal readers can distinguish no order from an unavailable lookup. */
    async getRelatedOrderForQuote(organizationId: string, quoteId: string): Promise<{ id: string; displayNumber: string | null; orderNumber: string } | null> {
        const [quote] = await this.dbInstance
            .select({ convertedToOrderId: quotes.convertedToOrderId })
            .from(quotes)
            .where(and(eq(quotes.organizationId, organizationId), eq(quotes.id, quoteId)))
            .limit(1);
        if (!quote) return null;
        const relation = quote.convertedToOrderId
            ? and(eq(orders.organizationId, organizationId), or(eq(orders.id, quote.convertedToOrderId), eq(orders.quoteId, quoteId)))
            : and(eq(orders.organizationId, organizationId), eq(orders.quoteId, quoteId));
        const [order] = await this.dbInstance
            .select({ id: orders.id, displayNumber: orders.displayNumber, orderNumber: orders.orderNumber })
            .from(orders)
            .where(relation)
            .orderBy(desc(orders.createdAt))
            .limit(1);
        return order ?? null;
    }

    async getMaxQuoteNumber(organizationId: string): Promise<number | null> {
        const result = await this.dbInstance
            .select({ maxNumber: sql<number>`MAX(COALESCE(${quotes.numberCore}, ${quotes.quoteNumber}))` })
            .from(quotes)
            .where(eq(quotes.organizationId, organizationId));

        return result[0]?.maxNumber ?? null;
    }

    async updateQuote(organizationId: string, id: string, data: {
        customerId?: string | null;
        contactId?: string | null;
        customerName?: string | null;
        status?: "draft" | "active" | "canceled";
        visibleInCustomerPortal?: boolean;
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
        shippingCents?: number | null;
        shippingInstructions?: string | null;
        label?: string | null;
        shippingMethod?: string | null;
        shippingMode?: string | null;
    }): Promise<QuoteWithRelations> {
        const updateData: any = {
            customerId: data.customerId !== undefined ? data.customerId ?? null : sql`customer_id`,
            contactId: data.contactId !== undefined ? data.contactId ?? null : sql`contact_id`,
            customerName: data.customerName !== undefined ? data.customerName ?? null : sql`customer_name`,
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
        if (data.shippingCents !== undefined) updateData.shippingCents = data.shippingCents;
        if (data.shippingInstructions !== undefined) updateData.shippingInstructions = data.shippingInstructions;
        if (data.label !== undefined) updateData.label = data.label;
        if (data.shippingMethod !== undefined) updateData.shippingMethod = data.shippingMethod;
        if (data.shippingMode !== undefined) updateData.shippingMode = data.shippingMode;
        if (data.visibleInCustomerPortal !== undefined) updateData.visibleInCustomerPortal = data.visibleInCustomerPortal;

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
        const [quoteRow] = await this.dbInstance
            .select({ organizationId: quotes.organizationId })
            .from(quotes)
            .where(eq(quotes.id, quoteId))
            .limit(1);

        if (!quoteRow) {
            throw new Error(`Quote ${quoteId} not found`);
        }

        const designSnapshot = materializeLineItemDesignSnapshot({
            config: await productDesignConfigRepository.getByProductId(quoteRow.organizationId, lineItem.productId),
            requestedNeedsDesignOverride: (lineItem as any).needsDesignOverride,
            requestedEffectiveRequiresDesign: typeof (lineItem as any).requiresDesign === 'boolean' ? (lineItem as any).requiresDesign : null,
        });

        // Snapshot requiresProofApproval from the live product so future product edits cannot mutate this line item.
        const [proofProductRow] = await this.dbInstance
            .select({ requiresProofApproval: products.requiresProofApproval })
            .from(products)
            .where(eq(products.id, lineItem.productId))
            .limit(1);
        const [orgForProofPolicy] = await this.dbInstance
            .select({ settings: organizations.settings })
            .from(organizations)
            .where(eq(organizations.id, quoteRow.organizationId))
            .limit(1);
        const proofApproval = resolveLineItemProofApprovalRequirement({
            productRequiresProofApproval: Boolean(proofProductRow?.requiresProofApproval),
            requestedRequiresProofApproval: typeof (lineItem as any).requiresProofApproval === "boolean" ? (lineItem as any).requiresProofApproval : undefined,
            proofApprovalLockEnabled: resolveProofApprovalLockEnabledFromOrgPreferences((orgForProofPolicy?.settings as any)?.preferences),
            proofingPolicy: resolveProofingPolicyFromOrgPreferences((orgForProofPolicy?.settings as any)?.preferences),
        });
        const lineItemRequiresProofApproval = proofApproval.requiresProofApproval;

        const lineItemData = {
            ...designSnapshot,
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
            specsJson: mergeExplicitPriceOverrideIntoSpecsJson((lineItem as any).specsJson || null, lineItem),
            optionSelectionsJson: (lineItem as any).optionSelectionsJson ?? null,
            selectedOptions: lineItem.selectedOptions as Array<{
                optionId: string;
                optionName: string;
                value: string | number | boolean;
                setupCost: number;
                calculatedCost: number;
            }>,
            linePrice: lineItem.linePrice.toString(),
            priceOverride: null,
            priceBreakdown: {
                ...lineItem.priceBreakdown,
                variantInfo: lineItem.priceBreakdown.variantInfo as string | undefined,
            },
            displayOrder: lineItem.displayOrder || 0,
            // PBV2 server-authoritative fields (migration 0036, pbv2TreeVersionId nullable as of 0041)
            pbv2TreeVersionId: (lineItem as any).pbv2TreeVersionId || null,
            pbv2SnapshotJson: (lineItem as any).pbv2SnapshotJson || {},
            pricedAt: (lineItem as any).pricedAt || new Date(),
            overridePriceCents: getExplicitOverridePriceCents(lineItem),
            overrideReason: (lineItem as any).overrideReason ?? null,
            // Canonical routing intent (migration 0015)
            requiresDesign: designSnapshot.effectiveRequiresDesign,
            requiresPrepress: typeof (lineItem as any).requiresPrepress === 'boolean' ? (lineItem as any).requiresPrepress : null,
            // Proof-approval snapshot (migration 0032)
            requiresProofApproval: lineItemRequiresProofApproval,
        };

        const [created] = await this.dbInstance.insert(quoteLineItems).values(lineItemData).returning();
        return enrichLineItemWithEffectivePricing(created as any);
    }

    async updateLineItem(id: string, lineItem: Partial<InsertQuoteLineItem>): Promise<QuoteLineItem> {
        const [currentLineItem] = await this.dbInstance
            .select({
                id: quoteLineItems.id,
                productId: quoteLineItems.productId,
                requiresDesign: quoteLineItems.requiresDesign,
                requiresProofApproval: quoteLineItems.requiresProofApproval,
                quoteId: quoteLineItems.quoteId,
                quantity: quoteLineItems.quantity,
                linePrice: quoteLineItems.linePrice,
                specsJson: quoteLineItems.specsJson,
                pbv2SnapshotJson: quoteLineItems.pbv2SnapshotJson,
                priceBreakdown: quoteLineItems.priceBreakdown,
                overridePriceCents: quoteLineItems.overridePriceCents,
            })
            .from(quoteLineItems)
            .where(eq(quoteLineItems.id, id))
            .limit(1);

        if (!currentLineItem) {
            throw new Error(`Line item ${id} not found`);
        }

        const [quoteRow] = currentLineItem.quoteId
            ? await this.dbInstance
                .select({ organizationId: quotes.organizationId })
                .from(quotes)
                .where(eq(quotes.id, currentLineItem.quoteId))
                .limit(1)
            : [];

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
        if ((lineItem as any).specsJson !== undefined) updateData.specsJson = (lineItem as any).specsJson;
        if ((lineItem as any).pbv2TreeVersionId !== undefined) updateData.pbv2TreeVersionId = (lineItem as any).pbv2TreeVersionId;
        if ((lineItem as any).pbv2SnapshotJson !== undefined) updateData.pbv2SnapshotJson = (lineItem as any).pbv2SnapshotJson;
        if ((lineItem as any).pricedAt !== undefined) updateData.pricedAt = (lineItem as any).pricedAt;
        if ((lineItem as any).optionSelectionsJson !== undefined) updateData.optionSelectionsJson = (lineItem as any).optionSelectionsJson;
        if (lineItem.selectedOptions !== undefined) updateData.selectedOptions = lineItem.selectedOptions;
        if (lineItem.linePrice !== undefined) updateData.linePrice = lineItem.linePrice.toString();
        if ((lineItem as any).formulaLinePrice !== undefined) {
            updateData.formulaLinePrice = (lineItem as any).formulaLinePrice === null
                ? null
                : (lineItem as any).formulaLinePrice.toString();
        }
        if ((lineItem as any).overridePriceCents !== undefined) updateData.overridePriceCents = (lineItem as any).overridePriceCents;
        const clearsPriceOverride =
            (lineItem as any).priceOverride === null ||
            (lineItem as any).priceOverrideMode === null ||
            (lineItem as any).overridePriceCents === null;
        const hasExplicitPriceOverride = hasExplicitPriceOverrideMetadata(lineItem);
        const hasPreparedPricingPatch =
            (lineItem as any).specsJson !== undefined ||
            lineItem.linePrice !== undefined ||
            lineItem.priceBreakdown !== undefined ||
            (lineItem as any).formulaLinePrice !== undefined;
        if (clearsPriceOverride) {
            if (!hasPreparedPricingPatch) {
                const overridePatch = buildQuoteLineItemPriceOverridePersistencePatch({
                    existingLineItem: currentLineItem as any,
                    incomingUpdate: lineItem as any,
                });
                updateData.specsJson = overridePatch.specsJson;
                updateData.linePrice = overridePatch.linePrice.toFixed(2);
                updateData.formulaLinePrice = null;
                updateData.priceBreakdown = overridePatch.priceBreakdown;
            }
            updateData.priceOverride = null;
            updateData.overridePriceCents = null;
        } else if (hasExplicitPriceOverride) {
            const overridePatch = buildQuoteLineItemPriceOverridePersistencePatch({
                existingLineItem: currentLineItem as any,
                incomingUpdate: lineItem as any,
            });
            updateData.specsJson = overridePatch.specsJson;
            updateData.linePrice = overridePatch.linePrice.toFixed(2);
            updateData.formulaLinePrice = overridePatch.formulaLinePrice?.toFixed(2) ?? null;
            updateData.priceBreakdown = overridePatch.priceBreakdown;
            updateData.overridePriceCents = overridePatch.overridePriceCents;
        }
        if (lineItem.priceBreakdown !== undefined && !clearsPriceOverride && !hasExplicitPriceOverride) updateData.priceBreakdown = lineItem.priceBreakdown;
        if (lineItem.displayOrder !== undefined) updateData.displayOrder = lineItem.displayOrder;
        if ((lineItem as any).overrideReason !== undefined) updateData.overrideReason = (lineItem as any).overrideReason;
        if ((lineItem as any).overrideAt !== undefined) updateData.overrideAt = coerceLineItemOverrideAt((lineItem as any).overrideAt);
        if ((lineItem as any).overrideByUserId !== undefined) updateData.overrideByUserId = (lineItem as any).overrideByUserId;
        // Canonical routing intent (migration 0015)
        if ((lineItem as any).requiresDesign !== undefined) updateData.requiresDesign = (lineItem as any).requiresDesign === true;
        if ((lineItem as any).requiresPrepress !== undefined) updateData.requiresPrepress = typeof (lineItem as any).requiresPrepress === 'boolean' ? (lineItem as any).requiresPrepress : null;

        if (quoteRow) {
            const designSnapshot = materializeLineItemDesignSnapshot({
                config: await productDesignConfigRepository.getByProductId(
                    quoteRow.organizationId,
                    lineItem.productId ?? currentLineItem.productId,
                ),
                requestedNeedsDesignOverride: Object.prototype.hasOwnProperty.call(lineItem, 'needsDesignOverride')
                    ? ((lineItem as any).needsDesignOverride ?? null)
                    : undefined,
                requestedEffectiveRequiresDesign: typeof (lineItem as any).requiresDesign === 'boolean' ? (lineItem as any).requiresDesign : null,
                existingEffectiveRequiresDesign: currentLineItem.requiresDesign,
            });

            updateData.requiresDesignSnapshot = designSnapshot.requiresDesignSnapshot;
            updateData.designBriefRequiredSnapshot = designSnapshot.designBriefRequiredSnapshot;
            updateData.estimatedDesignMinutesSnapshot = designSnapshot.estimatedDesignMinutesSnapshot;
            updateData.includedDesignMinutesSnapshot = designSnapshot.includedDesignMinutesSnapshot;
            updateData.designPricingModeSnapshot = designSnapshot.designPricingModeSnapshot;
            updateData.flatFeeAmountSnapshot = designSnapshot.flatFeeAmountSnapshot;
            updateData.hourlyRateSnapshot = designSnapshot.hourlyRateSnapshot;
            updateData.overageRateSnapshot = designSnapshot.overageRateSnapshot;
            updateData.internalLaborRateSnapshot = designSnapshot.internalLaborRateSnapshot;
            updateData.needsDesignOverride = designSnapshot.needsDesignOverride;
            updateData.requiresDesign = designSnapshot.effectiveRequiresDesign;

            if ((lineItem as any).requiresProofApproval !== undefined || lineItem.productId !== undefined) {
                const [proofProductRow] = await this.dbInstance
                    .select({ requiresProofApproval: products.requiresProofApproval })
                    .from(products)
                    .where(eq(products.id, lineItem.productId ?? currentLineItem.productId))
                    .limit(1);
                const [orgForProofPolicy] = await this.dbInstance
                    .select({ settings: organizations.settings })
                    .from(organizations)
                    .where(eq(organizations.id, quoteRow.organizationId))
                    .limit(1);
                const proofApproval = resolveLineItemProofApprovalRequirement({
                    productRequiresProofApproval: Boolean(proofProductRow?.requiresProofApproval),
                    requestedRequiresProofApproval: typeof (lineItem as any).requiresProofApproval === "boolean" ? (lineItem as any).requiresProofApproval : undefined,
                    proofApprovalLockEnabled: resolveProofApprovalLockEnabledFromOrgPreferences((orgForProofPolicy?.settings as any)?.preferences),
                    proofingPolicy: resolveProofingPolicyFromOrgPreferences((orgForProofPolicy?.settings as any)?.preferences),
                });
                updateData.requiresProofApproval = proofApproval.requiresProofApproval;
            }
        }

        const [updated] = await this.dbInstance
            .update(quoteLineItems)
            .set(updateData)
            .where(eq(quoteLineItems.id, id))
            .returning();

        if (!updated) {
            throw new Error(`Line item ${id} not found`);
        }

        return enrichLineItemWithEffectivePricing(updated as any);
    }

    async createTemporaryLineItem(
        organizationId: string,
        createdByUserId: string,
        lineItem: Omit<InsertQuoteLineItem, "quoteId">
    ): Promise<QuoteLineItem> {
        if (!lineItem.productId) {
            throw new Error("createTemporaryLineItem called without productId");
        }

        const designSnapshot = materializeLineItemDesignSnapshot({
            config: await productDesignConfigRepository.getByProductId(organizationId, lineItem.productId),
            requestedNeedsDesignOverride: (lineItem as any).needsDesignOverride,
            requestedEffectiveRequiresDesign: typeof (lineItem as any).requiresDesign === 'boolean' ? (lineItem as any).requiresDesign : null,
        });

        const lineItemData: typeof quoteLineItems.$inferInsert = {
            ...designSnapshot,
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
            specsJson: mergeExplicitPriceOverrideIntoSpecsJson((lineItem as any).specsJson ?? null, lineItem),
            optionSelectionsJson: (lineItem as any).optionSelectionsJson ?? null,
            selectedOptions: lineItem.selectedOptions ?? [],
            linePrice: lineItem.linePrice.toString(),
            priceOverride: null,
            priceBreakdown: lineItem.priceBreakdown as any,
            materialUsages: (lineItem as any).materialUsages ?? [],
            displayOrder: lineItem.displayOrder ?? 0,
            overridePriceCents: getExplicitOverridePriceCents(lineItem),
            overrideReason: (lineItem as any).overrideReason ?? null,
            requiresDesign: designSnapshot.effectiveRequiresDesign,
        } as any;

        const [created] = await this.dbInstance
            .insert(quoteLineItems)
            .values(lineItemData)
            .returning();

        return enrichLineItemWithEffectivePricing(created as any);
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
        const designConfigMap = await this.getDesignConfigMap(
            organizationId,
            Array.from(new Set(tempItems.map((item) => item.productId).filter(Boolean))),
        );

        const updated: QuoteLineItem[] = [];
        for (const tempItem of tempItems) {
            const designSnapshot = materializeLineItemDesignSnapshot({
                config: designConfigMap.get(tempItem.productId) ?? null,
                existingEffectiveRequiresDesign: tempItem.requiresDesign,
            });

            const [updatedItem] = await this.dbInstance
                .update(quoteLineItems)
                .set({
                    quoteId,
                    isTemporary: false,
                    requiresDesign: designSnapshot.effectiveRequiresDesign,
                    requiresDesignSnapshot: designSnapshot.requiresDesignSnapshot,
                    designBriefRequiredSnapshot: designSnapshot.designBriefRequiredSnapshot,
                    estimatedDesignMinutesSnapshot: designSnapshot.estimatedDesignMinutesSnapshot,
                    includedDesignMinutesSnapshot: designSnapshot.includedDesignMinutesSnapshot,
                    designPricingModeSnapshot: designSnapshot.designPricingModeSnapshot,
                    flatFeeAmountSnapshot: designSnapshot.flatFeeAmountSnapshot,
                    hourlyRateSnapshot: designSnapshot.hourlyRateSnapshot,
                    overageRateSnapshot: designSnapshot.overageRateSnapshot,
                    internalLaborRateSnapshot: designSnapshot.internalLaborRateSnapshot,
                    needsDesignOverride: designSnapshot.needsDesignOverride,
                })
                .where(eq(quoteLineItems.id, tempItem.id))
                .returning();

            if (updatedItem) {
                updated.push(updatedItem);
            }
        }

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
        status?: WorkflowState;
        portalVisibility?: "visible" | "hidden";
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
            conditions.push(sql`(
                ${quotes.customerName} like ${term}
                OR ${customers.companyName} like ${term}
                OR exists (
                    select 1 from ${customerContacts}
                    where ${customerContacts.id} = ${quotes.contactId}
                      and ${customerContacts.organizationId} = ${organizationId}
                      and (
                        ${customerContacts.firstName} ilike ${term}
                        OR ${customerContacts.lastName} ilike ${term}
                        OR ${customerContacts.email} ilike ${term}
                        OR concat_ws(' ', ${customerContacts.firstName}, ${customerContacts.lastName}) ilike ${term}
                      )
                )
            )`);
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

        if (filters?.portalVisibility === "visible") {
            conditions.push(eq(quotes.visibleInCustomerPortal, true));
        } else if (filters?.portalVisibility === "hidden") {
            conditions.push(eq(quotes.visibleInCustomerPortal, false));
        }

            const userQuotes = await this.dbInstance
                .select({
                    quote: quotes,
                    customerCompanyName: customers.companyName,
                    contact: customerContacts,
                    contactDisplayName: sql<string | null>`nullif(trim(concat_ws(' ', ${customerContacts.firstName}, ${customerContacts.lastName})), '')`,
                })
                .from(quotes)
                .leftJoin(
                    customers,
                    and(eq(customers.id, quotes.customerId), eq(customers.organizationId, organizationId))
                )
                .leftJoin(
                    customerContacts,
                    and(eq(customerContacts.id, quotes.contactId), eq(customerContacts.organizationId, organizationId))
                )
                .where(and(...conditions))
                .orderBy(desc(quotes.createdAt));

            // Fetch user and line items for each quote
            const quotesWithRelations = await Promise.all(
                userQuotes.map(async ({ quote, customerCompanyName, contact, contactDisplayName }) => {
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
                        customerName: (customerCompanyName ?? quote.customerName ?? contactDisplayName) || contact?.email || null,
                        contact,
                        user,
                        lineItems: lineItemsWithRelations,
                    };
                })
            );
            
            // Filter out null results from product filtering
            const validQuotes = quotesWithRelations.filter(r => r !== null) as QuoteWithRelations[];
            
            // Fetch preview thumbnails for all quotes in a single query (avoid N+1)
            const quoteIds = validQuotes.map(q => q.id);
            let previewData: Map<string, { thumbnails: string[]; totalCount: number }> = new Map();
            
            // Defense-in-depth: only query attachments if we have valid quoteIds
            // This prevents empty IN() clauses which could bypass orgId filters
            if (quoteIds.length > 0) {
                // Query for up to 3 thumbnails per quote
                const attachmentsQuery = await this.dbInstance
                    .select({
                        id: quoteAttachments.id,
                        quoteId: quoteAttachments.quoteId,
                        fileRecordId: quoteAttachments.fileRecordId,
                    })
                    .from(quoteAttachments)
                    .where(
                        and(
                            inArray(quoteAttachments.quoteId, quoteIds),
                            eq(quoteAttachments.organizationId, organizationId)
                        )
                    )
                    .orderBy(quoteAttachments.createdAt);

                const groupedAttachments = new Map<string, string[]>();
                const countMap = new Map<string, number>();
                const resolvedRows = await Promise.all(attachmentsQuery.map(async (att) => {
                    const [previewAccess, thumbAccess] = await Promise.all([
                        resolveDerivativeFileAccess(att, "preview"),
                        resolveDerivativeFileAccess(att, "thumbnail"),
                    ]);

                    return {
                        quoteId: att.quoteId,
                        thumbnailUrl: previewAccess.url ?? thumbAccess.url ?? null,
                    };
                }));

                for (const att of resolvedRows) {
                    if (!att.thumbnailUrl) continue;
                    countMap.set(att.quoteId, (countMap.get(att.quoteId) || 0) + 1);
                    if (!groupedAttachments.has(att.quoteId)) {
                        groupedAttachments.set(att.quoteId, []);
                    }
                    const group = groupedAttachments.get(att.quoteId)!;
                    if (group.length < 3) {
                        group.push(att.thumbnailUrl);
                    }
                }

                for (const quoteIdKey of Array.from(groupedAttachments.keys())) {
                    const thumbnails = groupedAttachments.get(quoteIdKey)!;
                    previewData.set(quoteIdKey, {
                        thumbnails,
                        totalCount: countMap.get(quoteIdKey) || 0,
                    });
                }
            }
            
            // Enrich quotes with preview data
            return validQuotes.map(quote => ({
                ...quote,
                previewThumbnails: previewData.get(quote.id)?.thumbnails || [],
                thumbsCount: previewData.get(quote.id)?.totalCount || 0,
            }));
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
