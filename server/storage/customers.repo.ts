import { db } from "../db";
import {
    customers,
    customerContacts,
    customerNotes,
    customerCreditTransactions,
    users,
    quotes,
    orders,
    type Customer,
    type InsertCustomer,
    type CustomerWithRelations,
    type CustomerContact,
    type InsertCustomerContact,
    type CustomerNote,
    type InsertCustomerNote,
    type CustomerCreditTransaction,
    type InsertCustomerCreditTransaction,
    type User,
} from "@shared/schema";
import { eq, and, or, ilike, desc, sql, inArray } from "drizzle-orm";

export class CustomersRepository {
    constructor(private readonly dbInstance = db) { }

    // Customer operations (tenant-scoped)
    async getAllCustomers(organizationId: string, filters?: {
        search?: string;
        status?: string;
        customerType?: string;
        assignedTo?: string;
    }): Promise<(Customer & { contacts?: CustomerContact[] })[]> {
        // If search is provided, we need to search across customers AND contacts
        if (filters?.search) {
            const searchPattern = `%${filters.search}%`;

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
            const contactCustomerIds = Array.from(new Set(matchedContacts.map(c => c.customerId)));

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

        return {
            ...customer,
            contacts,
            notes: notes as any, // Type cast needed due to notes field conflict (text field vs array relation)
            creditTransactions: creditTransactions as any,
            quotes: customerQuotes,
        };
    }

    async createCustomer(organizationId: string, customerData: Omit<InsertCustomer, 'organizationId'>): Promise<Customer> {
        const [customer] = await this.dbInstance.insert(customers).values({ ...customerData, organizationId }).returning();
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
            const [customer] = await tx
                .insert(customers)
                .values({ ...data.customer, organizationId })
                .returning();

            if (!customer) {
                throw new Error("Failed to create customer");
            }

            let contact: CustomerContact | null = null;

            if (data.primaryContact) {
                const [createdContact] = await tx
                    .insert(customerContacts)
                    .values({
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
    async getCustomerContacts(customerId: string): Promise<CustomerContact[]> {
        return await this.dbInstance
            .select()
            .from(customerContacts)
            .where(eq(customerContacts.customerId, customerId))
            .orderBy(desc(customerContacts.isPrimary), customerContacts.firstName);
    }

    async getCustomerContactById(id: string): Promise<CustomerContact | undefined> {
        const [contact] = await this.dbInstance.select().from(customerContacts).where(eq(customerContacts.id, id));
        return contact;
    }

    async createCustomerContact(contactData: InsertCustomerContact): Promise<CustomerContact> {
        const [contact] = await this.dbInstance.insert(customerContacts).values(contactData).returning();
        if (!contact) {
            throw new Error("Failed to create customer contact");
        }
        return contact;
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

    async deleteCustomerContact(id: string): Promise<void> {
        await this.dbInstance.delete(customerContacts).where(eq(customerContacts.id, id));
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

    async createCustomerNote(noteData: InsertCustomerNote): Promise<CustomerNote> {
        const [note] = await this.dbInstance.insert(customerNotes).values(noteData).returning();
        if (!note) {
            throw new Error("Failed to create customer note");
        }
        return note;
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

    async deleteCustomerNote(id: string): Promise<void> {
        await this.dbInstance.delete(customerNotes).where(eq(customerNotes.id, id));
    }

    // Customer credit transactions operations
    async getCustomerCreditTransactions(customerId: string): Promise<CustomerCreditTransaction[]> {
        return await this.dbInstance
            .select()
            .from(customerCreditTransactions)
            .where(eq(customerCreditTransactions.customerId, customerId))
            .orderBy(desc(customerCreditTransactions.createdAt));
    }

    async createCustomerCreditTransaction(transactionData: InsertCustomerCreditTransaction): Promise<CustomerCreditTransaction> {
        const [transaction] = await this.dbInstance.insert(customerCreditTransactions).values(transactionData).returning();
        if (!transaction) {
            throw new Error("Failed to create customer credit transaction");
        }
        return transaction;
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
                    creditBalance: sql`${customers.creditBalance} + ${balanceChange}`,
                    updatedAt: new Date(),
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
    async getAllContacts(organizationId: string, params: { search?: string; page?: number; pageSize?: number }): Promise<Array<CustomerContact & { companyName: string; ordersCount: number; quotesCount: number; lastActivityAt: Date | null }>> {
        const { search, page = 1, pageSize = 50 } = params;

        // Get all customers for this organization
        const orgCustomers = await this.dbInstance.select().from(customers).where(eq(customers.organizationId, organizationId));
        const customerMap = new Map(orgCustomers.map(c => [c.id, c]));
        const customerIds = orgCustomers.map(c => c.id);

        if (customerIds.length === 0) return [];

        let contactsQuery = this.dbInstance.select().from(customerContacts).where(inArray(customerContacts.customerId, customerIds)) as any;

        if (search) {
            const pattern = `%${search}%`;
            contactsQuery = contactsQuery.where(and(
                inArray(customerContacts.customerId, customerIds),
                or(
                    ilike(customerContacts.firstName, pattern),
                    ilike(customerContacts.lastName, pattern),
                    ilike(customerContacts.email, pattern)
                )
            ));
        }

        contactsQuery = contactsQuery.orderBy(desc(customerContacts.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
        const contacts = await contactsQuery;

        // Enrich with company name and stats
        const enriched = await Promise.all(contacts.map(async (contact: CustomerContact) => {
            const customer = customerMap.get(contact.customerId);
            const companyName = customer?.companyName || 'Unknown';

            // Get orders count
            const contactOrders = await this.dbInstance.select({ count: sql<number>`count(*)` })
                .from(orders)
                .where(eq(orders.contactId, contact.id));
            const ordersCount = Number(contactOrders[0]?.count || 0);

            // Get quotes count
            const contactQuotes = await this.dbInstance.select({ count: sql<number>`count(*)` })
                .from(quotes)
                .where(eq(quotes.contactId, contact.id));
            const quotesCount = Number(contactQuotes[0]?.count || 0);

            // Get last activity (most recent order or quote)
            const recentOrders = await this.dbInstance.select({ createdAt: orders.createdAt })
                .from(orders)
                .where(eq(orders.contactId, contact.id))
                .orderBy(desc(orders.createdAt))
                .limit(1);

            const recentQuotes = await this.dbInstance.select({ createdAt: quotes.createdAt })
                .from(quotes)
                .where(eq(quotes.contactId, contact.id))
                .orderBy(desc(quotes.createdAt))
                .limit(1);

            let lastActivityAt: Date | null = null;
            if (recentOrders[0] && recentQuotes[0]) {
                lastActivityAt = recentOrders[0].createdAt > recentQuotes[0].createdAt
                    ? recentOrders[0].createdAt
                    : recentQuotes[0].createdAt;
            } else if (recentOrders[0]) {
                lastActivityAt = recentOrders[0].createdAt;
            } else if (recentQuotes[0]) {
                lastActivityAt = recentQuotes[0].createdAt;
            }

            return {
                ...contact,
                companyName,
                ordersCount,
                quotesCount,
                lastActivityAt,
            };
        }));

        return enriched;
    }

    async getContactWithRelations(id: string): Promise<(CustomerContact & { customer?: Customer }) | undefined> {
        const [contact] = await this.dbInstance.select().from(customerContacts).where(eq(customerContacts.id, id));
        if (!contact) return undefined;
        const [customer] = contact.customerId ? await this.dbInstance.select().from(customers).where(eq(customers.id, contact.customerId)) : [undefined];
        return { ...contact, customer };
    }
}
