import { db } from "../db";
import {
    customers,
    customerContacts,
    customerContactLinks,
    customerNotes,
    customerCreditTransactions,
    customerProductionFolderReferences,
    users,
    quotes,
    orders,
    type Customer,
    type InsertCustomer,
    type CustomerWithRelations,
    type CustomerContact,
    type CustomerContactLink,
    type InsertCustomerContact,
    type InsertCustomerContactLink,
    type CustomerNote,
    type InsertCustomerNote,
    type CustomerCreditTransaction,
    type InsertCustomerCreditTransaction,
    type User,
} from "@shared/schema";
import { eq, and, or, ilike, desc, asc, sql, inArray } from "drizzle-orm";

type CustomerSortBy =
    | "name"
    | "companyName"
    | "primaryContact"
    | "email"
    | "phone"
    | "status"
    | "customerType"
    | "type"
    | "createdAt"
    | "updatedAt"
    | "lastUpdated";

type CustomerSortDir = "asc" | "desc";
type ContactSortBy =
    | "name"
    | "lastName"
    | "firstName"
    | "email"
    | "phone"
    | "company"
    | "companyName"
    | "createdAt"
    | "updatedAt"
    | "orders"
    | "quotes"
    | "lastActivity"
    | "lastActivityAt";

const customerSortExpressions: Record<CustomerSortBy, any> = {
    name: sql`lower(coalesce(${customers.companyName}, ''))`,
    companyName: sql`lower(coalesce(${customers.companyName}, ''))`,
    primaryContact: sql`lower(coalesce((
        select concat_ws(' ', cc.first_name, cc.last_name)
        from customer_contacts cc
        where cc.customer_id = ${customers.id}
        order by cc.is_primary desc, cc.created_at asc, cc.id asc
        limit 1
    ), ''))`,
    email: sql`lower(coalesce(${customers.email}, ''))`,
    phone: sql`lower(coalesce(${customers.phone}, ''))`,
    status: sql`lower(coalesce(${customers.status}, ''))`,
    customerType: sql`lower(coalesce(${customers.customerType}, ''))`,
    type: sql`lower(coalesce(${customers.customerType}, ''))`,
    createdAt: customers.createdAt,
    updatedAt: customers.updatedAt,
    lastUpdated: customers.updatedAt,
};

function normalizeCustomerSort(sortBy?: string, sortDir?: string): {
    sortBy: CustomerSortBy;
    sortDir: CustomerSortDir;
} {
    const allowedSortBy = Object.keys(customerSortExpressions) as CustomerSortBy[];
    const normalizedSortBy = allowedSortBy.includes(sortBy as CustomerSortBy)
        ? (sortBy as CustomerSortBy)
        : "name";
    const normalizedSortDir = sortDir === "desc" ? "desc" : "asc";
    return { sortBy: normalizedSortBy, sortDir: normalizedSortDir };
}

function buildCustomerOrderBy(sortBy?: string, sortDir?: string) {
    const normalized = normalizeCustomerSort(sortBy, sortDir);
    const direction = normalized.sortDir === "desc" ? desc : asc;
    return [
        direction(customerSortExpressions[normalized.sortBy]),
        asc(customers.id),
    ];
}

const contactSortExpressions: Record<ContactSortBy, any> = {
    name: sql`lower(coalesce(${customerContacts.lastName}, '') || ' ' || coalesce(${customerContacts.firstName}, ''))`,
    lastName: sql`lower(coalesce(${customerContacts.lastName}, ''))`,
    firstName: sql`lower(coalesce(${customerContacts.firstName}, ''))`,
    email: sql`lower(coalesce(${customerContacts.email}, ''))`,
    phone: sql`lower(coalesce(${customerContacts.phone}, ''))`,
    company: sql`lower(coalesce((
        select string_agg(c.company_name, ', ' order by c.company_name)
        from customer_contact_links ccl
        join customers c on c.id = ccl.customer_id
        where ccl.contact_id = ${customerContacts.id}
          and ccl.status <> 'removed'
    ), ''))`,
    companyName: sql`lower(coalesce((
        select string_agg(c.company_name, ', ' order by c.company_name)
        from customer_contact_links ccl
        join customers c on c.id = ccl.customer_id
        where ccl.contact_id = ${customerContacts.id}
          and ccl.status <> 'removed'
    ), ''))`,
    createdAt: customerContacts.createdAt,
    updatedAt: customerContacts.updatedAt,
    orders: sql`(select count(*) from orders o where o.contact_id = ${customerContacts.id})`,
    quotes: sql`(select count(*) from quotes q where q.contact_id = ${customerContacts.id})`,
    lastActivity: sql`greatest(
        coalesce((select max(o.created_at) from orders o where o.contact_id = ${customerContacts.id}), 'epoch'::timestamp),
        coalesce((select max(q.created_at) from quotes q where q.contact_id = ${customerContacts.id}), 'epoch'::timestamp)
    )`,
    lastActivityAt: sql`greatest(
        coalesce((select max(o.created_at) from orders o where o.contact_id = ${customerContacts.id}), 'epoch'::timestamp),
        coalesce((select max(q.created_at) from quotes q where q.contact_id = ${customerContacts.id}), 'epoch'::timestamp)
    )`,
};

function normalizeContactSort(sortBy?: string, sortDir?: string): {
    sortBy: ContactSortBy;
    sortDir: CustomerSortDir;
} {
    const allowedSortBy = Object.keys(contactSortExpressions) as ContactSortBy[];
    const normalizedSortBy = allowedSortBy.includes(sortBy as ContactSortBy)
        ? (sortBy as ContactSortBy)
        : "lastName";
    const normalizedSortDir = sortDir === "desc" ? "desc" : "asc";
    return { sortBy: normalizedSortBy, sortDir: normalizedSortDir };
}

function buildContactOrderBy(sortBy?: string, sortDir?: string) {
    const normalized = normalizeContactSort(sortBy, sortDir);
    const direction = normalized.sortDir === "desc" ? desc : asc;
    return [
        direction(contactSortExpressions[normalized.sortBy]),
        asc(sql`lower(coalesce(${customerContacts.lastName}, ''))`),
        asc(sql`lower(coalesce(${customerContacts.firstName}, ''))`),
        asc(customerContacts.id),
    ];
}

export class CustomersRepository {
    constructor(private readonly dbInstance = db) { }

    // Customer operations (tenant-scoped)
    async getAllCustomers(organizationId: string, filters?: {
        search?: string;
        status?: string;
        customerType?: string;
        assignedTo?: string;
    }): Promise<(Customer & { contacts?: CustomerContact[] })[]> {
        console.log("[CUSTOMERS REPO] getAllCustomers called with:", { organizationId, filters });
        
        // If search is provided, we need to search across customers AND contacts
        if (filters?.search) {
            const searchPattern = `%${filters.search}%`;
            console.log("[CUSTOMERS REPO] Search pattern:", searchPattern);

            // Get all customers that match the search
            const customerConditions = [
                eq(customers.organizationId, organizationId),
                or(
                    ilike(customers.companyName, searchPattern),
                    ilike(customers.email, searchPattern)
                )
            ];

            if (filters.status) {
                customerConditions.push(eq(customers.status, filters.status));
            }
            if (filters.customerType) {
                customerConditions.push(eq(customers.customerType, filters.customerType as any));
            }
            if (filters.assignedTo) {
                customerConditions.push(eq(customers.assignedTo, filters.assignedTo));
            }

            const matchedCustomers = await this.dbInstance
                .select()
                .from(customers)
                .where(and(...customerConditions))
                .orderBy(customers.companyName);
                
            console.log("[CUSTOMERS REPO] Matched customers count:", matchedCustomers?.length || 0);
            if (matchedCustomers && matchedCustomers.length > 0) {
                console.log("[CUSTOMERS REPO] First matched customer:", matchedCustomers[0]);
            }

            // Also search for customers by contact name/email
            const matchedContacts = await this.dbInstance
                .select()
                .from(customerContacts)
                .where(
                    or(
                        ilike(customerContacts.firstName, searchPattern),
                        ilike(customerContacts.lastName, searchPattern),
                        ilike(customerContacts.email, searchPattern)
                    )
                );

            // Get unique customer IDs from contact matches
            const contactCustomerIds = Array.from(new Set(matchedContacts.map(c => c.customerId).filter((id): id is string => Boolean(id))));

            // Fetch customers from contact matches that aren't already in matchedCustomers
            const existingCustomerIds = new Set(matchedCustomers.map(c => c.id));
            const additionalCustomerIds = contactCustomerIds.filter(id => !existingCustomerIds.has(id));

            let additionalCustomers: Customer[] = [];
            if (additionalCustomerIds.length > 0) {
                const additionalConditions = [
                    sql`${customers.id} IN (${sql.raw(additionalCustomerIds.map(id => `'${id}'`).join(','))})`
                ];

                if (filters.status) {
                    additionalConditions.push(eq(customers.status, filters.status));
                }
                if (filters.customerType) {
                    additionalConditions.push(eq(customers.customerType, filters.customerType as any));
                }
                if (filters.assignedTo) {
                    additionalConditions.push(eq(customers.assignedTo, filters.assignedTo));
                }

                additionalCustomers = await this.dbInstance
                    .select()
                    .from(customers)
                    .where(and(...additionalConditions))
                    .orderBy(customers.companyName);
            }

            // Combine and deduplicate
            const allCustomers = [...matchedCustomers, ...additionalCustomers];

            // Fetch contacts for all matched customers
            const allCustomerIds = allCustomers.map(c => c.id);
            const allContacts = allCustomerIds.length > 0
                ? await this.dbInstance
                    .select()
                    .from(customerContacts)
                    .where(sql`${customerContacts.customerId} IN (${sql.raw(allCustomerIds.map(id => `'${id}'`).join(','))})`)
                : [];

            // Attach contacts to customers
            return allCustomers.map(customer => ({
                ...customer,
                contacts: allContacts.filter(c => c.customerId === customer.id),
            }));
        }

        // No search - simple query
        const conditions = [eq(customers.organizationId, organizationId)];

        if (filters?.status) {
            conditions.push(eq(customers.status, filters.status));
        }
        if (filters?.customerType) {
            conditions.push(eq(customers.customerType, filters.customerType as any));
        }
        if (filters?.assignedTo) {
            conditions.push(eq(customers.assignedTo, filters.assignedTo));
        }

        let query = this.dbInstance.select().from(customers);
        query = query.where(and(...conditions)) as any;

        const allCustomers = await query.orderBy(customers.companyName);

        // Fetch contacts for all customers
        const allCustomerIds = allCustomers.map(c => c.id);
        const allContacts = allCustomerIds.length > 0
            ? await this.dbInstance
                .select()
                .from(customerContacts)
                .where(sql`${customerContacts.customerId} IN (${sql.raw(allCustomerIds.map(id => `'${id}'`).join(','))})`)
            : [];

        // Attach contacts to customers
        return allCustomers.map(customer => ({
            ...customer,
            contacts: allContacts.filter(c => c.customerId === customer.id),
        }));
    }

    async getCustomerById(organizationId: string, id: string): Promise<CustomerWithRelations | undefined> {
        const [customer] = await this.dbInstance.select().from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, id)));

        if (!customer) {
            return undefined;
        }

        // Fetch related data with user relations
        const contacts = await this.dbInstance.select().from(customerContacts).where(eq(customerContacts.customerId, id)).catch(() => []);

        const notesWithUsers = await this.dbInstance
            .select()
            .from(customerNotes)
            .leftJoin(users, eq(customerNotes.userId, users.id))
            .where(eq(customerNotes.customerId, id))
            .orderBy(desc(customerNotes.createdAt))
            .catch(() => []);
        const notes = notesWithUsers.map(row => ({
            ...row.customer_notes,
            user: row.users || { id: '', email: null, firstName: null, lastName: null, profileImageUrl: null, isAdmin: false, role: 'employee', createdAt: new Date(), updatedAt: new Date() }
        })) as (CustomerNote & { user: User })[];

        const transactionsWithUsers = await this.dbInstance
            .select()
            .from(customerCreditTransactions)
            .leftJoin(users, eq(customerCreditTransactions.userId, users.id))
            .where(eq(customerCreditTransactions.customerId, id))
            .orderBy(desc(customerCreditTransactions.createdAt))
            .catch(() => []);
        const creditTransactions = transactionsWithUsers.map(row => ({
            ...row.customer_credit_transactions,
            user: row.users || { id: '', email: null, firstName: null, lastName: null, profileImageUrl: null, isAdmin: false, role: 'employee', createdAt: new Date(), updatedAt: new Date() }
        })) as (CustomerCreditTransaction & { user: User })[];

        const customerQuotes = await this.dbInstance.select().from(quotes).where(eq(quotes.customerId, id)).orderBy(desc(quotes.createdAt)).catch(() => []);
        const [productionFolderReference] = await this.dbInstance
            .select()
            .from(customerProductionFolderReferences)
            .where(
                and(
                    eq(customerProductionFolderReferences.organizationId, organizationId),
                    eq(customerProductionFolderReferences.customerId, id),
                )
            )
            .orderBy(desc(customerProductionFolderReferences.updatedAt))
            .limit(1)
            .catch(() => [] as any[]);

        return {
            ...customer,
            contacts,
            notes: notes as any, // Type cast needed due to notes field conflict (text field vs array relation)
            creditTransactions: creditTransactions as any,
            quotes: customerQuotes,
            customerProductionFolderReference: productionFolderReference ?? null,
            localCompanyFolderPath:
                productionFolderReference && productionFolderReference.status !== "disabled"
                    ? productionFolderReference.pathOrUri
                    : null,
        };
    }

    async createCustomer(organizationId: string, customerData: Omit<InsertCustomer, 'organizationId'>): Promise<Customer> {
        const customerInsert: typeof customers.$inferInsert = {
            ...customerData,
            organizationId,
            defaultDiscountPercent: customerData.defaultDiscountPercent != null ? customerData.defaultDiscountPercent.toString() : null,
            defaultMarkupPercent: customerData.defaultMarkupPercent != null ? customerData.defaultMarkupPercent.toString() : null,
            defaultMarginPercent: customerData.defaultMarginPercent != null ? customerData.defaultMarginPercent.toString() : null,
            // Schema expects string|null (numeric stored as string)
            taxRateOverride: customerData.taxRateOverride != null ? customerData.taxRateOverride.toString() : null,
        };
        const [customer] = await this.dbInstance.insert(customers).values(customerInsert).returning();
        if (!customer) {
            throw new Error("Failed to create customer");
        }
        return customer;
    }

    async createCustomerWithPrimaryContact(
        organizationId: string,
        data: {
            customer: Omit<InsertCustomer, 'organizationId'>;
            primaryContact?: {
                firstName: string;
                lastName: string;
                email: string;
                phone?: string;
                title?: string;
                isPrimary?: boolean;
            } | null;
        }
    ): Promise<{ customer: Customer; contact?: CustomerContact | null }> {
        return await this.dbInstance.transaction(async (tx) => {
            const customerInsert: typeof customers.$inferInsert = {
                ...data.customer,
                organizationId,
                defaultDiscountPercent: data.customer.defaultDiscountPercent != null ? data.customer.defaultDiscountPercent.toString() : null,
                defaultMarkupPercent: data.customer.defaultMarkupPercent != null ? data.customer.defaultMarkupPercent.toString() : null,
                defaultMarginPercent: data.customer.defaultMarginPercent != null ? data.customer.defaultMarginPercent.toString() : null,
                // Schema expects string|null (numeric stored as string)
                taxRateOverride: data.customer.taxRateOverride != null ? data.customer.taxRateOverride.toString() : null,
            };
            const [customer] = await tx
                .insert(customers)
                .values(customerInsert)
                .returning();

            if (!customer) {
                throw new Error("Failed to create customer");
            }

            let contact: CustomerContact | null = null;

            if (data.primaryContact) {
                const [createdContact] = await tx
                    .insert(customerContacts)
                    .values({
                        organizationId,
                        customerId: customer.id,
                        firstName: data.primaryContact.firstName,
                        lastName: data.primaryContact.lastName,
                        email: data.primaryContact.email,
                        phone: data.primaryContact.phone,
                        title: data.primaryContact.title,
                        isPrimary: data.primaryContact.isPrimary ?? true,
                    })
                    .returning();

                if (!createdContact) {
                    throw new Error("Failed to create primary contact");
                }

                contact = createdContact;
                await tx.insert(customerContactLinks).values({
                    organizationId,
                    customerId: customer.id,
                    contactId: contact.id,
                    status: "active",
                    isPrimary: data.primaryContact.isPrimary ?? true,
                });
            }

            return { customer, contact };
        });
    }

    async updateCustomer(organizationId: string, id: string, customerData: Partial<Omit<InsertCustomer, 'organizationId'>>): Promise<Customer> {
        const updateData: any = {
            ...customerData,
            updatedAt: new Date(),
        };

        const [customer] = await this.dbInstance
            .update(customers)
            .set(updateData)
            .where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)))
            .returning();

        if (!customer) {
            throw new Error("Customer not found");
        }

        return customer;
    }

    async deleteCustomer(organizationId: string, id: string): Promise<void> {
        await this.dbInstance.delete(customers).where(and(eq(customers.id, id), eq(customers.organizationId, organizationId)));
    }

    // Customer contacts operations
    async getCustomerContacts(customerId: string): Promise<Array<CustomerContact & { linkId?: string; linkStatus?: string; isBilling?: boolean; isPortal?: boolean }>> {
        const rows = await this.dbInstance
            .select({ contact: customerContacts, link: customerContactLinks })
            .from(customerContactLinks)
            .innerJoin(customerContacts, eq(customerContactLinks.contactId, customerContacts.id))
            .where(and(
                eq(customerContactLinks.customerId, customerId),
                sql`${customerContactLinks.status} <> 'removed'`,
            ))
            .orderBy(desc(customerContactLinks.isPrimary), customerContacts.firstName);

        return rows.map(({ contact, link }) => ({
            ...contact,
            customerId: link.customerId,
            isPrimary: link.isPrimary,
            linkId: link.id,
            linkStatus: link.status,
            isBilling: link.isBilling,
            isPortal: link.isPortal,
        }));
    }

    async getCustomerContactById(id: string): Promise<CustomerContact | undefined> {
        const [contact] = await this.dbInstance.select().from(customerContacts).where(eq(customerContacts.id, id));
        return contact;
    }

    async createCustomerContact(contactData: InsertCustomerContact): Promise<CustomerContact> {
        const [contact] = await this.dbInstance.insert(customerContacts).values(contactData as any).returning();
        if (!contact) {
            throw new Error("Failed to create customer contact");
        }
        return contact;
    }

    async createContactForOrganization(
        organizationId: string,
        contactData: Omit<InsertCustomerContact, "organizationId" | "customerId"> & { customerId?: string | null },
    ): Promise<CustomerContact> {
        const [contact] = await this.dbInstance
            .insert(customerContacts)
            .values({
                ...contactData,
                organizationId,
                customerId: contactData.customerId ?? null,
                isPrimary: false,
                status: "active" as const,
            })
            .returning();

        if (!contact) {
            throw new Error("Failed to create customer contact");
        }

        return contact;
    }

    async createCustomerContactLinkForOrganization(
        organizationId: string,
        customerId: string,
        contactId: string,
        linkData: Partial<Omit<InsertCustomerContactLink, "organizationId" | "customerId" | "contactId">> = {},
    ): Promise<CustomerContact & { link: CustomerContactLink; customer?: Customer }> {
        return await this.dbInstance.transaction(async (tx: any) => {
            const [customer] = await tx
                .select()
                .from(customers)
                .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId)))
                .limit(1);

            if (!customer) {
                throw new Error("Customer not found");
            }

            const [contact] = await tx
                .select()
                .from(customerContacts)
                .where(and(eq(customerContacts.id, contactId), eq(customerContacts.organizationId, organizationId)))
                .limit(1);

            if (!contact) {
                throw new Error("Customer contact not found");
            }

            const linkStatus = linkData.status ?? "active";
            const isPrimary = linkData.isPrimary === true && linkStatus === "active";

            if (isPrimary) {
                await tx
                    .update(customerContactLinks)
                    .set({ isPrimary: false, updatedAt: new Date() })
                    .where(and(eq(customerContactLinks.customerId, customerId), eq(customerContactLinks.status, "active")));
            }

            const [existingLink] = await tx
                .select()
                .from(customerContactLinks)
                .where(and(
                    eq(customerContactLinks.customerId, customerId),
                    eq(customerContactLinks.contactId, contactId),
                    sql`${customerContactLinks.status} <> 'removed'`,
                ))
                .limit(1);

            const linkValues = {
                organizationId,
                customerId,
                contactId,
                status: linkStatus,
                isPrimary,
                isBilling: linkData.isBilling === true,
                isPortal: linkData.isPortal === true,
                updatedAt: new Date(),
            };

            const [link] = existingLink
                ? await tx
                    .update(customerContactLinks)
                    .set(linkValues)
                    .where(eq(customerContactLinks.id, existingLink.id))
                    .returning()
                : await tx
                    .insert(customerContactLinks)
                    .values(linkValues)
                    .returning();

            if (!contact.customerId) {
                await tx
                    .update(customerContacts)
                    .set({ customerId, updatedAt: new Date() })
                    .where(eq(customerContacts.id, contactId));
            }

            return {
                ...contact,
                customerId,
                isPrimary: link.isPrimary,
                link,
                customer,
            };
        });
    }

    async createCustomerContactForOrganization(
        organizationId: string,
        customerId: string,
        contactData: Omit<InsertCustomerContact, "customerId">,
    ): Promise<CustomerContact> {
        return await this.dbInstance.transaction(async (tx: any) => {
            const [customer] = await tx
                .select({ id: customers.id })
                .from(customers)
                .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId)))
                .limit(1);

            if (!customer) {
                throw new Error("Customer not found");
            }

            if (contactData.isPrimary) {
                await tx
                    .update(customerContactLinks)
                    .set({ isPrimary: false, updatedAt: new Date() })
                    .where(and(eq(customerContactLinks.customerId, customerId), eq(customerContactLinks.status, "active")));
            }

            const [contact] = await tx
                .insert(customerContacts)
                .values({
                    ...contactData,
                    organizationId,
                    customerId,
                    status: "active" as const,
                })
                .returning();

            if (!contact) {
                throw new Error("Failed to create customer contact");
            }

            const [link] = await tx
                .insert(customerContactLinks)
                .values({
                    organizationId,
                    customerId,
                    contactId: contact.id,
                    status: "active",
                    isPrimary: contactData.isPrimary === true,
                    isBilling: Array.isArray(contactData.flags) && contactData.flags.includes("billing_contact"),
                })
                .returning();

            return {
                ...contact,
                customerId: link.customerId,
                isPrimary: link.isPrimary,
            };
        });
    }

    async updateCustomerContact(id: string, contactData: Partial<InsertCustomerContact>): Promise<CustomerContact> {
        const updateData: any = {
            ...contactData,
            updatedAt: new Date(),
        };

        const [contact] = await this.dbInstance
            .update(customerContacts)
            .set(updateData)
            .where(eq(customerContacts.id, id))
            .returning();

        if (!contact) {
            throw new Error("Customer contact not found");
        }

        return contact;
    }

    async updateCustomerContactForOrganization(
        organizationId: string,
        id: string,
        contactData: Partial<InsertCustomerContact>,
    ): Promise<CustomerContact> {
        return await this.dbInstance.transaction(async (tx: any) => {
            const [current] = await tx
                .select()
                .from(customerContacts)
                .where(and(eq(customerContacts.id, id), eq(customerContacts.organizationId, organizationId)))
                .limit(1);

            if (!current) {
                throw new Error("Customer contact not found");
            }

            const nextCustomerId = contactData.customerId ?? current.customerId;

            if (nextCustomerId) {
                const [targetCustomer] = await tx
                    .select({ id: customers.id })
                    .from(customers)
                    .where(and(eq(customers.id, nextCustomerId), eq(customers.organizationId, organizationId)))
                    .limit(1);

                if (!targetCustomer) {
                    throw new Error("Customer not found");
                }
            }

            const { isPrimary, customerId, ...personFields } = contactData;
            const updateData: any = {
                ...personFields,
                updatedAt: new Date(),
            };
            if (nextCustomerId !== undefined) updateData.customerId = nextCustomerId ?? null;

            if (nextCustomerId && isPrimary === true) {
                await tx
                    .update(customerContactLinks)
                    .set({ isPrimary: false, updatedAt: new Date() })
                    .where(and(
                        eq(customerContactLinks.customerId, nextCustomerId),
                        eq(customerContactLinks.status, "active"),
                        sql`${customerContactLinks.contactId} <> ${id}`,
                    ));
            }

            const [contact] = await tx
                .update(customerContacts)
                .set(updateData)
                .where(eq(customerContacts.id, id))
                .returning();

            if (!contact) {
                throw new Error("Customer contact not found");
            }

            if (nextCustomerId) {
                const [existingLink] = await tx
                    .select()
                    .from(customerContactLinks)
                    .where(and(
                        eq(customerContactLinks.customerId, nextCustomerId),
                        eq(customerContactLinks.contactId, id),
                        sql`${customerContactLinks.status} <> 'removed'`,
                    ))
                    .limit(1);

                if (existingLink) {
                    const [updatedLink] = await tx
                        .update(customerContactLinks)
                        .set({
                            isPrimary: isPrimary ?? existingLink.isPrimary,
                            status: existingLink.status === "removed" ? "active" : existingLink.status,
                            updatedAt: new Date(),
                        })
                        .where(eq(customerContactLinks.id, existingLink.id))
                        .returning();
                    return { ...contact, customerId: updatedLink.customerId, isPrimary: updatedLink.isPrimary };
                }

                const [newLink] = await tx
                    .insert(customerContactLinks)
                    .values({
                        organizationId,
                        customerId: nextCustomerId,
                        contactId: id,
                        status: "active",
                        isPrimary: isPrimary === true,
                    })
                    .returning();

                return { ...contact, customerId: newLink.customerId, isPrimary: newLink.isPrimary };
            }

            return contact;
        });
    }

    async deleteCustomerContact(id: string): Promise<void> {
        await this.dbInstance
            .update(customerContacts)
            .set({ status: "archived", updatedAt: new Date() })
            .where(eq(customerContacts.id, id));
    }

    async unlinkCustomerContactForOrganization(organizationId: string, customerId: string, contactId: string): Promise<void> {
        await this.dbInstance
            .update(customerContactLinks)
            .set({ status: "removed", isPrimary: false, updatedAt: new Date() })
            .where(and(
                eq(customerContactLinks.organizationId, organizationId),
                eq(customerContactLinks.customerId, customerId),
                eq(customerContactLinks.contactId, contactId),
                sql`${customerContactLinks.status} <> 'removed'`,
            ));
    }

    async setCustomerContactLinkStatusForOrganization(
        organizationId: string,
        customerId: string,
        contactId: string,
        status: "active" | "former" | "removed",
    ): Promise<CustomerContactLink> {
        const updateData: any = { status, updatedAt: new Date() };
        if (status !== "active") updateData.isPrimary = false;

        const [link] = await this.dbInstance
            .update(customerContactLinks)
            .set(updateData)
            .where(and(
                eq(customerContactLinks.organizationId, organizationId),
                eq(customerContactLinks.customerId, customerId),
                eq(customerContactLinks.contactId, contactId),
            ))
            .returning();

        if (!link) throw new Error("Customer contact link not found");
        return link;
    }

    // Customer notes operations
    async getCustomerNotes(customerId: string, filters?: {
        noteType?: string;
        assignedTo?: string;
    }): Promise<CustomerNote[]> {
        // Simplified query - removed non-existent fields (noteType, assignedTo, isPinned)
        return await this.dbInstance
            .select()
            .from(customerNotes)
            .where(eq(customerNotes.customerId, customerId))
            .orderBy(desc(customerNotes.createdAt));
    }

    async getCustomerNotesForOrganization(organizationId: string, customerId: string, filters?: {
        noteType?: string;
        assignedTo?: string;
    }): Promise<CustomerNote[] | undefined> {
        // Notes have no organization_id column; enforce tenancy through the parent customer.
        const rows = await this.dbInstance
            .select({ customerId: customers.id, note: customerNotes })
            .from(customers)
            .leftJoin(customerNotes, eq(customerNotes.customerId, customers.id))
            .where(and(eq(customers.organizationId, organizationId), eq(customers.id, customerId)))
            .orderBy(desc(customerNotes.createdAt));
        if (rows.length === 0) return undefined;
        return rows
            .map((row: { note: CustomerNote | null }) => row.note)
            .filter((note: CustomerNote | null): note is CustomerNote => Boolean(note));
    }

    async createCustomerNote(noteData: InsertCustomerNote): Promise<CustomerNote> {
        const [note] = await this.dbInstance.insert(customerNotes).values(noteData).returning();
        if (!note) {
            throw new Error("Failed to create customer note");
        }
        return note;
    }

    async createCustomerNoteForOrganization(
        organizationId: string,
        customerId: string,
        noteData: InsertCustomerNote,
    ): Promise<CustomerNote | undefined> {
        const [customer] = await this.dbInstance
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.organizationId, organizationId), eq(customers.id, customerId)))
            .limit(1);
        if (!customer) return undefined;

        return this.createCustomerNote({ ...noteData, customerId });
    }

    async updateCustomerNote(id: string, noteData: Partial<InsertCustomerNote>): Promise<CustomerNote> {
        const updateData: any = {
            ...noteData,
            updatedAt: new Date(),
        };

        const [note] = await this.dbInstance
            .update(customerNotes)
            .set(updateData)
            .where(eq(customerNotes.id, id))
            .returning();

        if (!note) {
            throw new Error("Customer note not found");
        }

        return note;
    }

    async updateCustomerNoteForOrganization(
        organizationId: string,
        id: string,
        noteData: Partial<InsertCustomerNote>,
    ): Promise<CustomerNote | undefined> {
        const [existing] = await this.dbInstance
            .select({ note: customerNotes })
            .from(customerNotes)
            .innerJoin(customers, eq(customerNotes.customerId, customers.id))
            .where(and(eq(customerNotes.id, id), eq(customers.organizationId, organizationId)))
            .limit(1);
        if (!existing) return undefined;

        const { customerId: _ignoredCustomerId, ...safeNoteData } = noteData as Partial<InsertCustomerNote>;
        const [note] = await this.dbInstance
            .update(customerNotes)
            .set({
                ...safeNoteData,
                updatedAt: new Date(),
            } as any)
            .where(eq(customerNotes.id, id))
            .returning();

        return note;
    }

    async deleteCustomerNote(id: string): Promise<void> {
        await this.dbInstance.delete(customerNotes).where(eq(customerNotes.id, id));
    }

    async deleteCustomerNoteForOrganization(organizationId: string, id: string): Promise<boolean> {
        const [existing] = await this.dbInstance
            .select({ id: customerNotes.id })
            .from(customerNotes)
            .innerJoin(customers, eq(customerNotes.customerId, customers.id))
            .where(and(eq(customerNotes.id, id), eq(customers.organizationId, organizationId)))
            .limit(1);
        if (!existing) return false;

        await this.dbInstance.delete(customerNotes).where(eq(customerNotes.id, id));
        return true;
    }

    // Customer credit transactions operations
    async getCustomerCreditTransactions(customerId: string): Promise<CustomerCreditTransaction[]> {
        return await this.dbInstance
            .select()
            .from(customerCreditTransactions)
            .where(eq(customerCreditTransactions.customerId, customerId))
            .orderBy(desc(customerCreditTransactions.createdAt));
    }

    async getCustomerCreditTransactionsForOrganization(
        organizationId: string,
        customerId: string,
    ): Promise<CustomerCreditTransaction[] | undefined> {
        // Credit rows have no organization_id column; enforce tenancy through the parent customer.
        const rows = await this.dbInstance
            .select({ customerId: customers.id, transaction: customerCreditTransactions })
            .from(customers)
            .leftJoin(customerCreditTransactions, eq(customerCreditTransactions.customerId, customers.id))
            .where(and(eq(customers.organizationId, organizationId), eq(customers.id, customerId)))
            .orderBy(desc(customerCreditTransactions.createdAt));
        if (rows.length === 0) return undefined;
        return rows
            .map((row: { transaction: CustomerCreditTransaction | null }) => row.transaction)
            .filter((transaction: CustomerCreditTransaction | null): transaction is CustomerCreditTransaction => Boolean(transaction));
    }

    async createCustomerCreditTransaction(transactionData: InsertCustomerCreditTransaction): Promise<CustomerCreditTransaction> {
        const [transaction] = await this.dbInstance.insert(customerCreditTransactions).values(transactionData).returning();
        if (!transaction) {
            throw new Error("Failed to create customer credit transaction");
        }
        return transaction;
    }

    async createCustomerCreditTransactionForOrganization(
        organizationId: string,
        customerId: string,
        transactionData: InsertCustomerCreditTransaction,
    ): Promise<CustomerCreditTransaction | undefined> {
        const [customer] = await this.dbInstance
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.organizationId, organizationId), eq(customers.id, customerId)))
            .limit(1);
        if (!customer) return undefined;

        return this.createCustomerCreditTransaction({ ...transactionData, customerId });
    }

    async updateCustomerCreditTransaction(id: string, transactionData: Partial<InsertCustomerCreditTransaction>): Promise<CustomerCreditTransaction> {
        const updateData: any = {
            ...transactionData,
            updatedAt: new Date(),
        };

        const [transaction] = await this.dbInstance
            .update(customerCreditTransactions)
            .set(updateData)
            .where(eq(customerCreditTransactions.id, id))
            .returning();

        if (!transaction) {
            throw new Error("Customer credit transaction not found");
        }

        return transaction;
    }

    async updateCustomerCreditTransactionForOrganization(
        organizationId: string,
        id: string,
        transactionData: Partial<InsertCustomerCreditTransaction>,
    ): Promise<CustomerCreditTransaction | undefined> {
        const [existing] = await this.dbInstance
            .select({ transaction: customerCreditTransactions })
            .from(customerCreditTransactions)
            .innerJoin(customers, eq(customerCreditTransactions.customerId, customers.id))
            .where(and(eq(customerCreditTransactions.id, id), eq(customers.organizationId, organizationId)))
            .limit(1);
        if (!existing) return undefined;

        const { customerId: _ignoredCustomerId, ...safeTransactionData } = transactionData as Partial<InsertCustomerCreditTransaction>;
        const [transaction] = await this.dbInstance
            .update(customerCreditTransactions)
            .set(safeTransactionData)
            .where(eq(customerCreditTransactions.id, id))
            .returning();

        return transaction;
    }

    async updateCustomerBalance(organizationId: string, customerId: string, amount: number, type: 'credit' | 'debit', reason: string, createdBy: string): Promise<Customer> {
        return await this.dbInstance.transaction(async (tx) => {
            // Create the transaction record
            await tx.insert(customerCreditTransactions).values({
                customerId,
                amount: amount.toString(),
                type,
                reason,
                userId: createdBy,
            } as any);

            // Update customer balance
            const balanceChange = type === 'credit' ? amount : -amount;
            const [updatedCustomer] = await tx
                .update(customers)
                .set({
                    currentBalance: sql`${customers.currentBalance} + ${balanceChange}`,
                    updatedAt: new Date().toISOString(),
                } as any)
                .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId)))
                .returning();

            if (!updatedCustomer) {
                throw new Error("Customer not found");
            }

            return updatedCustomer;
        });
    }

    // Contacts (required by routes) - tenant-scoped
    async getAllContacts(organizationId: string, params: { search?: string; page?: number; pageSize?: number; sortBy?: string; sortDir?: string }): Promise<Array<CustomerContact & { companyName: string; ordersCount: number; quotesCount: number; lastActivityAt: string | null }>> {
        const result = await this.getContactsPaged(organizationId, {
            search: params.search,
            page: params.page,
            pageSize: params.pageSize,
            sortBy: params.sortBy,
            sortDir: params.sortDir,
        });
        return result.items;
    }

    async getContactWithRelations(id: string, organizationId?: string): Promise<(CustomerContact & { customer?: Customer }) | undefined> {
        const rows = await this.dbInstance
            .select({ contact: customerContacts, link: customerContactLinks, customer: customers })
            .from(customerContacts)
            .leftJoin(customerContactLinks, and(
                eq(customerContactLinks.contactId, customerContacts.id),
                eq(customerContactLinks.status, "active"),
            ))
            .leftJoin(customers, eq(customerContactLinks.customerId, customers.id))
            .where(
                organizationId
                    ? and(eq(customerContacts.id, id), eq(customerContacts.organizationId, organizationId))
                    : eq(customerContacts.id, id),
            )
            .orderBy(desc(customerContactLinks.isPrimary), asc(customerContactLinks.createdAt))
            .limit(1);

        const row = rows[0];
        if (!row?.contact) return undefined;
        return {
            ...row.contact,
            customerId: row.link?.customerId ?? row.contact.customerId ?? null,
            isPrimary: row.link?.isPrimary ?? false,
            customer: row.customer ?? undefined,
        };
    }

    // --------------------------------------------------------
    // Paginated customers list
    // --------------------------------------------------------
    async getCustomersPaged(
        organizationId: string,
        opts: {
            search?: string;
            status?: string;
            customerType?: string;
            assignedTo?: string;
            page?: number;
            pageSize?: number;
            sortBy?: string;
            sortDir?: string;
        },
    ): Promise<{
        items: (Customer & { contacts?: CustomerContact[] })[];
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
    }> {
        const page = Math.max(1, opts.page ?? 1);
        const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));

        // Helper: collect IDs matching non-search filters
        const buildFilterConditions = () => {
            const conds: any[] = [eq(customers.organizationId, organizationId)];
            if (opts.status) conds.push(eq(customers.status, opts.status));
            if (opts.customerType) conds.push(eq(customers.customerType, opts.customerType as any));
            if (opts.assignedTo) conds.push(eq(customers.assignedTo, opts.assignedTo));
            return conds;
        };

        let matchingIds: string[];

        if (opts.search) {
            const pattern = `%${opts.search}%`;
            const filterConds = buildFilterConditions();

            // Customers matching by company or email
            const byCompany = await this.dbInstance
                .select({ id: customers.id })
                .from(customers)
                .where(and(...filterConds, or(ilike(customers.companyName, pattern), ilike(customers.email, pattern))));

            // Contacts matching by name or email → resolve to customer IDs
            const byContact = await this.dbInstance
                .select({ customerId: customerContactLinks.customerId })
                .from(customerContactLinks)
                .innerJoin(customerContacts, eq(customerContactLinks.contactId, customerContacts.id))
                .where(and(
                    eq(customerContactLinks.status, "active"),
                    or(
                        ilike(customerContacts.firstName, pattern),
                        ilike(customerContacts.lastName, pattern),
                        ilike(customerContacts.email, pattern),
                    ),
                ));

            // Union + deduplicate while preserving org filter for contact-derived IDs
            const seenIds = new Set<string>();
            for (const r of byCompany) seenIds.add(r.id);

            const contactDerivedIds = byContact.map(r => r.customerId).filter((id): id is string => id != null);
            if (contactDerivedIds.length > 0) {
                // Apply remaining filters to contact-derived customers
                const addlConds = buildFilterConditions();
                addlConds.push(inArray(customers.id, contactDerivedIds));
                const addl = await this.dbInstance
                    .select({ id: customers.id })
                    .from(customers)
                    .where(and(...addlConds));
                for (const r of addl) seenIds.add(r.id);
            }

            matchingIds = Array.from(seenIds);
        } else {
            const filterConds = buildFilterConditions();
            const rows = await this.dbInstance
                .select({ id: customers.id })
                .from(customers)
                .where(and(...filterConds));
            matchingIds = rows.map(r => r.id);
        }

        const total = matchingIds.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePageClamped = Math.min(page, totalPages);
        const offset = (safePageClamped - 1) * pageSize;
        let items: (Customer & { contacts?: CustomerContact[] })[] = [];
        if (matchingIds.length > 0) {
            const rows = await this.dbInstance
                .select()
                .from(customers)
                .where(and(eq(customers.organizationId, organizationId), inArray(customers.id, matchingIds)))
                .orderBy(...buildCustomerOrderBy(opts.sortBy, opts.sortDir))
                .limit(pageSize)
                .offset(offset);

            const pageIds = rows.map(c => c.id);

            const allContacts = pageIds.length > 0
                ? await this.dbInstance
                    .select({ contact: customerContacts, link: customerContactLinks })
                    .from(customerContactLinks)
                    .innerJoin(customerContacts, eq(customerContactLinks.contactId, customerContacts.id))
                    .where(and(
                        inArray(customerContactLinks.customerId, pageIds),
                        sql`${customerContactLinks.status} <> 'removed'`,
                    ))
                : [];

            items = rows.map(c => ({
                ...c,
                contacts: allContacts
                    .filter(({ link }) => link.customerId === c.id)
                    .map(({ contact, link }) => ({
                        ...contact,
                        customerId: link.customerId,
                        isPrimary: link.isPrimary,
                    })),
            }));
        }

        return {
            items,
            total,
            page: safePageClamped,
            pageSize,
            totalPages,
            hasNextPage: safePageClamped < totalPages,
            hasPreviousPage: safePageClamped > 1,
        };
    }

    // --------------------------------------------------------
    // Paginated contacts list with correct total count
    // --------------------------------------------------------
    async getContactsPaged(
        organizationId: string,
        opts: { search?: string; page?: number; pageSize?: number; sortBy?: string; sortDir?: string; filter?: string },
    ): Promise<{
        items: Array<CustomerContact & {
            companyName: string;
            linkedCustomersCount: number;
            linkedCustomers: Array<{ id: string; companyName: string; status: string; isPrimary: boolean }>;
            ordersCount: number;
            quotesCount: number;
            lastActivityAt: string | null;
        }>;
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
    }> {
        const page = Math.max(1, opts.page ?? 1);
        const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));

        const searchTerm = opts.search?.trim();
        const baseConditions: any[] = [eq(customerContacts.organizationId, organizationId)];

        if (opts.filter === "archived") {
            baseConditions.push(eq(customerContacts.status, "archived"));
        } else {
            baseConditions.push(eq(customerContacts.status, "active"));
        }

        if (opts.filter === "unlinked") {
            baseConditions.push(sql`not exists (
                select 1
                from customer_contact_links ccl
                where ccl.contact_id = ${customerContacts.id}
                  and ccl.status <> 'removed'
            )`);
        } else if (opts.filter === "linked") {
            baseConditions.push(sql`exists (
                select 1
                from customer_contact_links ccl
                where ccl.contact_id = ${customerContacts.id}
                  and ccl.status = 'active'
            )`);
        } else if (opts.filter === "former") {
            baseConditions.push(sql`exists (
                select 1
                from customer_contact_links ccl
                where ccl.contact_id = ${customerContacts.id}
                  and ccl.status = 'former'
            )`);
        }

        const whereClause = searchTerm
            ? and(
                ...baseConditions,
                or(
                    ilike(customerContacts.firstName, `%${searchTerm}%`),
                    ilike(customerContacts.lastName, `%${searchTerm}%`),
                    ilike(customerContacts.email, `%${searchTerm}%`),
                    ilike(customerContacts.phone, `%${searchTerm}%`),
                    ilike(customerContacts.mobile, `%${searchTerm}%`),
                    sql`exists (
                        select 1
                        from customer_contact_links ccl
                        join customers c on c.id = ccl.customer_id
                        where ccl.contact_id = ${customerContacts.id}
                          and ccl.status <> 'removed'
                          and c.company_name ilike ${`%${searchTerm}%`}
                    )`,
                ),
            )
            : and(...baseConditions);

        // True total count
        const [countRow] = await this.dbInstance
            .select({ count: sql<number>`count(*)` })
            .from(customerContacts)
            .where(whereClause);
        const total = Number(countRow?.count ?? 0);

        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePageClamped = Math.min(page, totalPages);

        const contactRows = await this.dbInstance
            .select()
            .from(customerContacts)
            .where(whereClause)
            .orderBy(...buildContactOrderBy(opts.sortBy, opts.sortDir))
            .limit(pageSize)
            .offset((safePageClamped - 1) * pageSize);

        const enriched = await Promise.all(contactRows.map(async (contact: CustomerContact) => {
            const linkedCustomerRows = await this.dbInstance
                .select({ link: customerContactLinks, customer: customers })
                .from(customerContactLinks)
                .innerJoin(customers, eq(customerContactLinks.customerId, customers.id))
                .where(and(
                    eq(customerContactLinks.contactId, contact.id),
                    sql`${customerContactLinks.status} <> 'removed'`,
                ))
                .orderBy(desc(customerContactLinks.isPrimary), asc(customers.companyName));

            const linkedCustomers = linkedCustomerRows.map(({ link, customer }) => ({
                id: customer.id,
                companyName: customer.companyName,
                status: link.status,
                isPrimary: link.isPrimary,
            }));
            const activeLinkedCustomers = linkedCustomers.filter((customer) => customer.status === "active");
            const companyName = activeLinkedCustomers.map((customer) => customer.companyName).join(", ") || "Unlinked";

            const [ordersRow] = await this.dbInstance.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.contactId, contact.id));
            const ordersCount = Number(ordersRow?.count ?? 0);

            const [quotesRow] = await this.dbInstance.select({ count: sql<number>`count(*)` }).from(quotes).where(eq(quotes.contactId, contact.id));
            const quotesCount = Number(quotesRow?.count ?? 0);

            const [lastOrder] = await this.dbInstance.select({ createdAt: orders.createdAt }).from(orders).where(eq(orders.contactId, contact.id)).orderBy(desc(orders.createdAt)).limit(1);
            const [lastQuote] = await this.dbInstance.select({ createdAt: quotes.createdAt }).from(quotes).where(eq(quotes.contactId, contact.id)).orderBy(desc(quotes.createdAt)).limit(1);

            let lastActivityAt: string | null = null;
            if (lastOrder?.createdAt && lastQuote?.createdAt) {
                lastActivityAt = new Date(lastOrder.createdAt) > new Date(lastQuote.createdAt)
                    ? lastOrder.createdAt
                    : lastQuote.createdAt.toISOString();
            } else if (lastOrder?.createdAt) {
                lastActivityAt = lastOrder.createdAt;
            } else if (lastQuote?.createdAt) {
                lastActivityAt = lastQuote.createdAt.toISOString();
            }

            return {
                ...contact,
                customerId: activeLinkedCustomers[0]?.id ?? contact.customerId ?? null,
                isPrimary: linkedCustomerRows.some(({ link }) => link.isPrimary && link.status === "active"),
                companyName,
                linkedCustomersCount: activeLinkedCustomers.length,
                linkedCustomers,
                ordersCount,
                quotesCount,
                lastActivityAt,
            };
        }));

        return {
            items: enriched,
            total,
            page: safePageClamped,
            pageSize,
            totalPages,
            hasNextPage: safePageClamped < totalPages,
            hasPreviousPage: safePageClamped > 1,
        };
    }
}
