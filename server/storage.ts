import {
  users,
  products,
  productOptions,
  productVariants,
  globalVariables,
  quotes,
  quoteLineItems,
  pricingRules,
  mediaAssets,
  formulaTemplates,
  emailSettings,
  companySettings,
  customers,
  customerContacts,
  customerNotes,
  customerCreditTransactions,
  orders,
  orderLineItems,
  jobs,
  jobNotes,
  jobStatusLog,
  type User,
  type UpsertUser,
  type Product,
  type InsertProduct,
  type UpdateProduct,
  type ProductOption,
  type InsertProductOption,
  type UpdateProductOption,
  type ProductVariant,
  type InsertProductVariant,
  type UpdateProductVariant,
  type GlobalVariable,
  type InsertGlobalVariable,
  type UpdateGlobalVariable,
  type Quote,
  type InsertQuote,
  type UpdateQuote,
  type QuoteLineItem,
  type InsertQuoteLineItem,
  type QuoteWithRelations,
  type PricingRule,
  type InsertPricingRule,
  type UpdatePricingRule,
  type MediaAsset,
  type InsertMediaAsset,
  type FormulaTemplate,
  type InsertFormulaTemplate,
  type UpdateFormulaTemplate,
  type EmailSettings,
  type InsertEmailSettings,
  type UpdateEmailSettings,
  type CompanySettings,
  type InsertCompanySettings,
  type UpdateCompanySettings,
  type Customer,
  type InsertCustomer,
  type UpdateCustomer,
  type CustomerWithRelations,
  type CustomerContact,
  type InsertCustomerContact,
  type UpdateCustomerContact,
  type CustomerNote,
  type InsertCustomerNote,
  type UpdateCustomerNote,
  type CustomerCreditTransaction,
  type InsertCustomerCreditTransaction,
  type UpdateCustomerCreditTransaction,
  type Order,
  type InsertOrder,
  type UpdateOrder,
  type OrderWithRelations,
  type OrderLineItem,
  type InsertOrderLineItem,
  type UpdateOrderLineItem,
  type Job,
  type InsertJob,
  type UpdateJob,
  type JobNote,
  type InsertJobNote,
  type JobStatusLog,
  type InsertJobStatusLog,
  auditLogs,
  type AuditLog,
  type InsertAuditLog,
  orderAuditLog,
  type OrderAuditLog,
  type InsertOrderAuditLog,
  orderAttachments,
  type OrderAttachment,
  type InsertOrderAttachment,
  quoteWorkflowStates,
  type QuoteWorkflowState,
  type InsertQuoteWorkflowState,
  jobStatuses,
  type JobStatus,
  type InsertJobStatus,
  type UpdateJobStatus,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, gte, lte, like, ilike, sql, desc } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User>;
  deleteUser(id: string): Promise<void>;

  // Product operations
  getAllProducts(): Promise<Product[]>;
  getProductById(id: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: string, product: UpdateProduct): Promise<Product>;
  deleteProduct(id: string): Promise<void>;
  cloneProduct(id: string): Promise<Product>;

  // Product options operations
  getProductOptions(productId: string): Promise<ProductOption[]>;
  createProductOption(option: InsertProductOption): Promise<ProductOption>;
  updateProductOption(id: string, option: Partial<InsertProductOption>): Promise<ProductOption>;
  deleteProductOption(id: string): Promise<void>;

  // Product variants operations
  getProductVariants(productId: string): Promise<ProductVariant[]>;
  createProductVariant(variant: InsertProductVariant): Promise<ProductVariant>;
  updateProductVariant(id: string, variant: Partial<InsertProductVariant>): Promise<ProductVariant>;
  deleteProductVariant(id: string): Promise<void>;

  // Global variables operations
  getAllGlobalVariables(): Promise<GlobalVariable[]>;
  getGlobalVariableById(id: string): Promise<GlobalVariable | undefined>;
  getGlobalVariableByName(name: string): Promise<GlobalVariable | undefined>;
  createGlobalVariable(variable: InsertGlobalVariable): Promise<GlobalVariable>;
  updateGlobalVariable(id: string, variable: Partial<InsertGlobalVariable>): Promise<GlobalVariable>;
  deleteGlobalVariable(id: string): Promise<void>;

  // Quote operations
  createQuote(data: {
    userId: string;
    customerName?: string;
    lineItems: Omit<InsertQuoteLineItem, 'quoteId'>[];
  }): Promise<QuoteWithRelations>;
  getQuoteById(id: string, userId?: string): Promise<QuoteWithRelations | undefined>;
  getMaxQuoteNumber(): Promise<number | null>;
  updateQuote(id: string, data: {
    customerName?: string;
    subtotal?: number;
    taxRate?: number;
    marginPercentage?: number;
    discountAmount?: number;
    totalPrice?: number;
  }): Promise<QuoteWithRelations>;
  deleteQuote(id: string): Promise<void>;
  addLineItem(quoteId: string, lineItem: Omit<InsertQuoteLineItem, 'quoteId'>): Promise<QuoteLineItem>;
  updateLineItem(id: string, lineItem: Partial<InsertQuoteLineItem>): Promise<QuoteLineItem>;
  deleteLineItem(id: string): Promise<void>;
  getUserQuotes(userId: string, filters?: {
    searchCustomer?: string;
    searchProduct?: string;
    startDate?: string;
    endDate?: string;
    minPrice?: string;
    maxPrice?: string;
  }): Promise<QuoteWithRelations[]>;
  getAllQuotes(filters?: {
    searchUser?: string;
    searchCustomer?: string;
    searchProduct?: string;
    startDate?: string;
    endDate?: string;
    minQuantity?: string;
    maxQuantity?: string;
  }): Promise<QuoteWithRelations[]>;

  // Pricing rules operations
  getAllPricingRules(): Promise<PricingRule[]>;
  getPricingRuleByName(name: string): Promise<PricingRule | undefined>;
  createPricingRule(rule: InsertPricingRule): Promise<PricingRule>;
  updatePricingRule(rule: UpdatePricingRule): Promise<PricingRule>;

  // Media assets operations
  getAllMediaAssets(): Promise<MediaAsset[]>;
  getMediaAssetById(id: string): Promise<MediaAsset | undefined>;
  createMediaAsset(asset: InsertMediaAsset): Promise<MediaAsset>;
  deleteMediaAsset(id: string): Promise<void>;

  // Formula templates operations
  getAllFormulaTemplates(): Promise<FormulaTemplate[]>;
  getFormulaTemplateById(id: string): Promise<FormulaTemplate | undefined>;
  createFormulaTemplate(template: InsertFormulaTemplate): Promise<FormulaTemplate>;
  updateFormulaTemplate(id: string, updates: Partial<FormulaTemplate>): Promise<FormulaTemplate>;
  deleteFormulaTemplate(id: string): Promise<void>;
  getProductsByFormulaTemplate(templateId: string): Promise<Product[]>;

  // Email settings operations
  getAllEmailSettings(): Promise<EmailSettings[]>;
  getEmailSettingsById(id: string): Promise<EmailSettings | undefined>;
  getDefaultEmailSettings(): Promise<EmailSettings | undefined>;
  createEmailSettings(settings: InsertEmailSettings): Promise<EmailSettings>;
  updateEmailSettings(id: string, settings: Partial<InsertEmailSettings>): Promise<EmailSettings>;
  deleteEmailSettings(id: string): Promise<void>;

  // Company settings operations
  getCompanySettings(): Promise<CompanySettings | undefined>;
  createCompanySettings(settings: InsertCompanySettings): Promise<CompanySettings>;
  updateCompanySettings(id: string, settings: Partial<InsertCompanySettings>): Promise<CompanySettings>;

  // Customer operations
  getAllCustomers(filters?: {
    search?: string;
    status?: string;
    customerType?: string;
    assignedTo?: string;
  }): Promise<(Customer & { contacts?: CustomerContact[] })[]>;
  getCustomerById(id: string): Promise<CustomerWithRelations | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomer(id: string, customer: Partial<InsertCustomer>): Promise<Customer>;
  deleteCustomer(id: string): Promise<void>;

  // Customer contacts operations
  getCustomerContacts(customerId: string): Promise<CustomerContact[]>;
  getCustomerContactById(id: string): Promise<CustomerContact | undefined>;
  createCustomerContact(contact: InsertCustomerContact): Promise<CustomerContact>;
  updateCustomerContact(id: string, contact: Partial<InsertCustomerContact>): Promise<CustomerContact>;
  deleteCustomerContact(id: string): Promise<void>;

  // Customer notes operations
  getCustomerNotes(customerId: string, filters?: {
    noteType?: string;
    assignedTo?: string;
  }): Promise<CustomerNote[]>;
  createCustomerNote(note: InsertCustomerNote): Promise<CustomerNote>;
  updateCustomerNote(id: string, note: Partial<InsertCustomerNote>): Promise<CustomerNote>;
  deleteCustomerNote(id: string): Promise<void>;

  // Customer credit transactions operations
  getCustomerCreditTransactions(customerId: string): Promise<CustomerCreditTransaction[]>;
  createCustomerCreditTransaction(transaction: InsertCustomerCreditTransaction): Promise<CustomerCreditTransaction>;
  updateCustomerCreditTransaction(id: string, transaction: Partial<InsertCustomerCreditTransaction>): Promise<CustomerCreditTransaction>;
  updateCustomerBalance(customerId: string, amount: number, type: 'credit' | 'debit', reason: string, createdBy: string): Promise<Customer>;

  // Order operations
  getAllOrders(filters?: {
    search?: string;
    status?: string;
    priority?: string;
    customerId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<Order[]>;
  getOrderById(id: string): Promise<OrderWithRelations | undefined>;
  createOrder(data: {
    customerId: string;
    contactId?: string | null;
    quoteId?: string | null;
    status?: string;
    priority?: string;
    dueDate?: Date | null;
    promisedDate?: Date | null;
    discount?: number;
    notesInternal?: string | null;
    createdByUserId: string;
    lineItems: Omit<InsertOrderLineItem, 'orderId'>[];
  }): Promise<OrderWithRelations>;
  updateOrder(id: string, order: Partial<InsertOrder>): Promise<Order>;
  deleteOrder(id: string): Promise<void>;
  convertQuoteToOrder(quoteId: string, createdByUserId: string, options?: {
    dueDate?: Date;
    promisedDate?: Date;
    priority?: string;
    notesInternal?: Date;
  }): Promise<OrderWithRelations>;

  // Order line item operations
  getOrderLineItems(orderId: string): Promise<OrderLineItem[]>;
  getOrderLineItemById(id: string): Promise<OrderLineItem | undefined>;
  createOrderLineItem(lineItem: InsertOrderLineItem): Promise<OrderLineItem>;
  updateOrderLineItem(id: string, lineItem: Partial<InsertOrderLineItem>): Promise<OrderLineItem>;
  deleteOrderLineItem(id: string): Promise<void>;

  // Audit log operations
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(filters?: {
    userId?: string;
    actionType?: string;
    entityType?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<AuditLog[]>;

  // Order audit log operations
  getOrderAuditLog(orderId: string): Promise<OrderAuditLog[]>;
  createOrderAuditLog(log: InsertOrderAuditLog): Promise<OrderAuditLog>;

  // Order attachments operations
  getOrderAttachments(orderId: string): Promise<OrderAttachment[]>;
  createOrderAttachment(attachment: InsertOrderAttachment): Promise<OrderAttachment>;
  deleteOrderAttachment(id: string): Promise<void>;

  // Quote workflow operations
  getQuoteWorkflowState(quoteId: string): Promise<QuoteWorkflowState | undefined>;
  createQuoteWorkflowState(state: InsertQuoteWorkflowState): Promise<QuoteWorkflowState>;
  updateQuoteWorkflowState(quoteId: string, updates: Partial<InsertQuoteWorkflowState>): Promise<QuoteWorkflowState>;

  // Contacts (required by routes)
  getAllContacts(params: { search?: string; page?: number; pageSize?: number }): Promise<CustomerContact[]>;
  getContactWithRelations(id: string): Promise<(CustomerContact & { customer?: Customer }) | undefined>;

  // Job operations (production workflow)
  getJobs(filters?: { status?: string; assignedToUserId?: string; orderId?: string }): Promise<(Job & { order?: Order | null; orderLineItem?: OrderLineItem | null })[]>;
  getJob(id: string): Promise<(Job & { order?: Order | null; orderLineItem?: OrderLineItem | null; notesLog?: JobNote[]; statusLog?: JobStatusLog[] }) | undefined>;
  updateJob(id: string, data: Partial<InsertJob>, userId?: string): Promise<Job>;
  addJobNote(jobId: string, noteText: string, userId: string): Promise<JobNote>;
  getJobsForOrder(orderId: string): Promise<Job[]>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(users.email);
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User> {
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };

    const [user] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning();

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // Try to insert, and if there's a conflict on either id or email, update the user
    try {
      const updateFields: any = {
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        profileImageUrl: userData.profileImageUrl,
        updatedAt: new Date(),
      };

      // Only include isAdmin if it's explicitly provided
      if (userData.isAdmin !== undefined) {
        updateFields.isAdmin = userData.isAdmin;
      }

      // Only include role if it's explicitly provided
      if (userData.role !== undefined) {
        updateFields.role = userData.role;
      }

      const [user] = await db
        .insert(users)
        .values(userData)
        .onConflictDoUpdate({
          target: users.id,
          set: updateFields,
        })
        .returning();
      return user;
    } catch (error: any) {
      // If we get a unique constraint violation on email, find and update that user
      if (error?.code === '23505' && error?.constraint === 'users_email_unique') {
        const [existingUser] = await db
          .select()
          .from(users)
          .where(sql`${users.email} = ${userData.email}`);

        if (existingUser) {
          // Update the existing user's profile, keep their original id
          const updateFields: any = {
            firstName: userData.firstName,
            lastName: userData.lastName,
            profileImageUrl: userData.profileImageUrl,
            updatedAt: new Date(),
          };

          // Only include isAdmin if it's explicitly provided
          if (userData.isAdmin !== undefined) {
            updateFields.isAdmin = userData.isAdmin;
          }

          // Only include role if it's explicitly provided
          if (userData.role !== undefined) {
            updateFields.role = userData.role;
          }
          
          const [updatedUser] = await db
            .update(users)
            .set(updateFields)
            .where(eq(users.id, existingUser.id))
            .returning();
          return updatedUser;
        }
      }
      // Re-throw if it's a different error
      throw error;
    }
  }

  // Product operations
  async getAllProducts(): Promise<Product[]> {
    return await db.select().from(products).orderBy(products.name);
  }

  async getProductById(id: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const cleanProduct: any = {};
    Object.entries(product).forEach(([k, v]) => {
      if (k === 'variantLabel' && v === null) {
        // Omit null variantLabel so DB default applies
        return;
      }
      cleanProduct[k] = v;
    });
    const [newProduct] = await db.insert(products).values(cleanProduct).returning();
    return newProduct;
  }

  async updateProduct(id: string, productData: UpdateProduct): Promise<Product> {
    const cleanProductData: any = { updatedAt: new Date() };
    Object.entries(productData).forEach(([k, v]) => {
      if (k === 'variantLabel' && v === null) {
        // Reset to default value when null
        cleanProductData[k] = 'Variant';
        return;
      }
      cleanProductData[k] = v;
    });
    const [updated] = await db
      .update(products)
      .set(cleanProductData)
      .where(eq(products.id, id))
      .returning();
    return updated;
  }

  async deleteProduct(id: string): Promise<void> {
    await db.delete(products).where(eq(products.id, id));
  }

  async cloneProduct(id: string): Promise<Product> {
    const originalProduct = await this.getProductById(id);
    if (!originalProduct) {
      throw new Error('Product not found');
    }

    const newProductData: InsertProduct = {
      name: `${originalProduct.name} (Copy)`,
      description: originalProduct.description,
      pricingFormula: originalProduct.pricingFormula,
      variantLabel: originalProduct.variantLabel,
      category: originalProduct.category,
      storeUrl: originalProduct.storeUrl,
      showStoreLink: originalProduct.showStoreLink,
      isActive: originalProduct.isActive,
    };

    const newProduct = await this.createProduct(newProductData);

    const originalVariants = await this.getProductVariants(id);
    for (const variant of originalVariants) {
      await this.createProductVariant({
        productId: newProduct.id,
        name: variant.name,
        description: variant.description || undefined,
        basePricePerSqft: parseFloat(variant.basePricePerSqft),
        isDefault: variant.isDefault,
        displayOrder: variant.displayOrder,
        isActive: variant.isActive,
      });
    }

    const originalOptions = await this.getProductOptions(id);
    
    const optionIdMap: Record<string, string> = {};
    
    const parentOptions = originalOptions.filter(opt => !opt.parentOptionId);
    for (const option of parentOptions) {
      const newOption = await this.createProductOption({
        productId: newProduct.id,
        name: option.name,
        description: option.description || undefined,
        type: option.type,
        defaultValue: option.defaultValue || undefined,
        defaultSelection: option.defaultSelection || undefined,
        isDefaultEnabled: option.isDefaultEnabled,
        setupCost: parseFloat(option.setupCost),
        priceFormula: option.priceFormula || undefined,
        parentOptionId: undefined,
        displayOrder: option.displayOrder,
        isActive: option.isActive,
      });
      optionIdMap[option.id] = newOption.id;
    }

    const childOptions = originalOptions.filter(opt => opt.parentOptionId);
    for (const option of childOptions) {
      const newParentId = option.parentOptionId ? optionIdMap[option.parentOptionId] : undefined;
      const newOption = await this.createProductOption({
        productId: newProduct.id,
        name: option.name,
        description: option.description || undefined,
        type: option.type,
        defaultValue: option.defaultValue || undefined,
        defaultSelection: option.defaultSelection || undefined,
        isDefaultEnabled: option.isDefaultEnabled,
        setupCost: parseFloat(option.setupCost),
        priceFormula: option.priceFormula || undefined,
        parentOptionId: newParentId,
        displayOrder: option.displayOrder,
        isActive: option.isActive,
      });
      optionIdMap[option.id] = newOption.id;
    }

    return newProduct;
  }

  // Product options operations
  async getProductOptions(productId: string): Promise<ProductOption[]> {
    return await db
      .select()
      .from(productOptions)
      .where(eq(productOptions.productId, productId))
      .orderBy(productOptions.displayOrder);
  }

  async createProductOption(option: InsertProductOption): Promise<ProductOption> {
    const optionData = {
      ...option,
      setupCost: option.setupCost.toString(),
    } as typeof productOptions.$inferInsert;
    
    const [newOption] = await db.insert(productOptions).values(optionData).returning();
    return newOption;
  }

  async updateProductOption(id: string, optionData: Partial<InsertProductOption>): Promise<ProductOption> {
    const updateData: Record<string, any> = {
      ...optionData,
      updatedAt: new Date(),
    };
    
    if (optionData.setupCost !== undefined) {
      updateData.setupCost = optionData.setupCost.toString();
    }
    
    const [updated] = await db
      .update(productOptions)
      .set(updateData)
      .where(eq(productOptions.id, id))
      .returning();
    return updated;
  }

  async deleteProductOption(id: string): Promise<void> {
    await db.delete(productOptions).where(eq(productOptions.id, id));
  }

  // Product variants operations
  async getProductVariants(productId: string): Promise<ProductVariant[]> {
    return await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .orderBy(productVariants.displayOrder);
  }

  async createProductVariant(variant: InsertProductVariant): Promise<ProductVariant> {
    const variantData = {
      ...variant,
      basePricePerSqft: variant.basePricePerSqft.toString(),
    } as typeof productVariants.$inferInsert;
    
    const [newVariant] = await db.insert(productVariants).values(variantData).returning();
    return newVariant;
  }

  async updateProductVariant(id: string, variantData: Partial<InsertProductVariant>): Promise<ProductVariant> {
    const updateData: Record<string, any> = {
      ...variantData,
      updatedAt: new Date(),
    };
    
    if (variantData.basePricePerSqft !== undefined) {
      updateData.basePricePerSqft = variantData.basePricePerSqft.toString();
    }
    
    const [updated] = await db
      .update(productVariants)
      .set(updateData)
      .where(eq(productVariants.id, id))
      .returning();
    return updated;
  }

  async deleteProductVariant(id: string): Promise<void> {
    await db.delete(productVariants).where(eq(productVariants.id, id));
  }

  // Global variables operations
  async getAllGlobalVariables(): Promise<GlobalVariable[]> {
    return await db
      .select()
      .from(globalVariables)
      .where(eq(globalVariables.isActive, true))
      .orderBy(globalVariables.category, globalVariables.name);
  }

  async getGlobalVariableByName(name: string): Promise<GlobalVariable | undefined> {
    const [variable] = await db
      .select()
      .from(globalVariables)
      .where(eq(globalVariables.name, name));
    return variable;
  }

  async getGlobalVariableById(id: string): Promise<GlobalVariable | undefined> {
    const [variable] = await db
      .select()
      .from(globalVariables)
      .where(eq(globalVariables.id, id));
    return variable;
  }

  async createGlobalVariable(variable: InsertGlobalVariable): Promise<GlobalVariable> {
    const variableData = {
      ...variable,
      value: variable.value.toString(),
    } as typeof globalVariables.$inferInsert;
    
    const [newVariable] = await db.insert(globalVariables).values(variableData).returning();
    return newVariable;
  }

  async updateGlobalVariable(id: string, variableData: Partial<InsertGlobalVariable>): Promise<GlobalVariable> {
    const updateData: Record<string, any> = {
      ...variableData,
      updatedAt: new Date(),
    };
    
    if (variableData.value !== undefined) {
      updateData.value = variableData.value.toString();
    }
    
    const [updated] = await db
      .update(globalVariables)
      .set(updateData)
      .where(eq(globalVariables.id, id))
      .returning();
    return updated;
  }

  async deleteGlobalVariable(id: string): Promise<void> {
    await db.delete(globalVariables).where(eq(globalVariables.id, id));
  }

  // Quote operations
  async createQuote(data: {
    userId: string;
    customerId?: string;
    contactId?: string;
    customerName?: string;
    source?: string;
    lineItems: Omit<InsertQuoteLineItem, 'quoteId'>[];
  }): Promise<QuoteWithRelations> {
    // Calculate subtotal from line items
    const subtotal = data.lineItems.reduce((sum, item) => sum + Number(item.linePrice), 0);
    
    // Use a transaction with row-level locking to ensure atomic quote number assignment
    const newQuote = await db.transaction(async (tx) => {
      // Lock the row to prevent concurrent access - use raw SQL for SELECT FOR UPDATE
      const result = await tx.execute(sql`
        SELECT * FROM ${globalVariables}
        WHERE ${globalVariables.name} = 'next_quote_number'
        FOR UPDATE
      `);
      
      const quoteNumberVar = result.rows[0] as any;
      
      if (!quoteNumberVar) {
        throw new Error('Quote numbering system not initialized');
      }
      
      const quoteNumber = Math.floor(Number(quoteNumberVar.value));
      
      // Create the parent quote (totalPrice initially same as subtotal, can be adjusted later)
      const quoteData = {
        userId: data.userId,
        quoteNumber,
        customerId: data.customerId || null,
        contactId: data.contactId || null,
        customerName: data.customerName,
        source: data.source || 'internal',
        subtotal: subtotal.toString(),
        totalPrice: subtotal.toString(),
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
    const lineItemsData = data.lineItems.map((item, index) => ({
      quoteId: newQuote.id,
      productId: item.productId,
      productName: item.productName,
      variantId: item.variantId,
      variantName: item.variantName,
      productType: (item as any).productType || 'wide_roll',
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
    }));
    
    const createdLineItems = await db.insert(quoteLineItems).values(lineItemsData).returning();
    
    // Fetch user and product details for line items
    const lineItemsWithRelations = await Promise.all(
      createdLineItems.map(async (lineItem) => {
        const [product] = await db.select().from(products).where(eq(products.id, lineItem.productId));
        let variant = null;
        if (lineItem.variantId) {
          [variant] = await db.select().from(productVariants).where(eq(productVariants.id, lineItem.variantId));
        }
        return {
          ...lineItem,
          product,
          variant,
        };
      })
    );
    
    const [user] = await db.select().from(users).where(eq(users.id, newQuote.userId));
    
    return {
      ...newQuote,
      user,
      lineItems: lineItemsWithRelations,
    };
  }

  async getQuoteById(id: string, userId?: string): Promise<QuoteWithRelations | undefined> {
    const conditions = [eq(quotes.id, id)];
    if (userId) {
      conditions.push(eq(quotes.userId, userId));
    }

    const [quote] = await db
      .select()
      .from(quotes)
      .where(and(...conditions));

    if (!quote) {
      return undefined;
    }

    const lineItems = await db
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.quoteId, id));

    // Fetch product and variant details for line items
    const lineItemsWithRelations = await Promise.all(
      lineItems.map(async (lineItem) => {
        const [product] = await db.select().from(products).where(eq(products.id, lineItem.productId));
        let variant = null;
        if (lineItem.variantId) {
          [variant] = await db.select().from(productVariants).where(eq(productVariants.id, lineItem.variantId));
        }
        return {
          ...lineItem,
          product,
          variant,
        };
      })
    );

    const [user] = await db.select().from(users).where(eq(users.id, quote.userId));

    return {
      ...quote,
      user,
      lineItems: lineItemsWithRelations,
    };
  }

  async getMaxQuoteNumber(): Promise<number | null> {
    const result = await db
      .select({ maxNumber: sql<number>`MAX(${quotes.quoteNumber})` })
      .from(quotes);
    
    return result[0]?.maxNumber ?? null;
  }

  async updateQuote(id: string, data: {
    customerName?: string;
    subtotal?: number;
    taxRate?: number;
    marginPercentage?: number;
    discountAmount?: number;
    totalPrice?: number;
  }): Promise<QuoteWithRelations> {
    const updateData: any = {};
    if (data.customerName !== undefined) updateData.customerName = data.customerName;
    if (data.subtotal !== undefined) updateData.subtotal = data.subtotal.toString();
    if (data.taxRate !== undefined) updateData.taxRate = data.taxRate.toString();
    if (data.marginPercentage !== undefined) updateData.marginPercentage = data.marginPercentage.toString();
    if (data.discountAmount !== undefined) updateData.discountAmount = data.discountAmount.toString();
    if (data.totalPrice !== undefined) updateData.totalPrice = data.totalPrice.toString();

    console.log(`[updateQuote] ID: ${id}, updateData:`, updateData);

    const [updated] = await db
      .update(quotes)
      .set(updateData)
      .where(eq(quotes.id, id))
      .returning();

    console.log(`[updateQuote] Updated row:`, updated);

    if (!updated) {
      throw new Error(`Quote ${id} not found`);
    }

    // Fetch the complete quote with relations
    const result = await this.getQuoteById(id);
    console.log(`[updateQuote] Fetched result customerName:`, result?.customerName);
    if (!result) {
      throw new Error(`Quote ${id} not found after update`);
    }
    return result;
  }

  async deleteQuote(id: string): Promise<void> {
    await db.delete(quotes).where(eq(quotes.id, id));
  }

  async addLineItem(quoteId: string, lineItem: Omit<InsertQuoteLineItem, 'quoteId'>): Promise<QuoteLineItem> {
    const lineItemData = {
      quoteId,
      productId: lineItem.productId,
      productName: lineItem.productName,
      variantId: lineItem.variantId,
      variantName: lineItem.variantName,
      productType: (lineItem as any).productType || 'wide_roll',
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

    const [created] = await db.insert(quoteLineItems).values(lineItemData).returning();
    return created;
  }

  async updateLineItem(id: string, lineItem: Partial<InsertQuoteLineItem>): Promise<QuoteLineItem> {
    const updateData: any = {};
    if (lineItem.productId !== undefined) updateData.productId = lineItem.productId;
    if (lineItem.productName !== undefined) updateData.productName = lineItem.productName;
    if (lineItem.variantId !== undefined) updateData.variantId = lineItem.variantId;
    if (lineItem.variantName !== undefined) updateData.variantName = lineItem.variantName;
    if (lineItem.width !== undefined) updateData.width = lineItem.width.toString();
    if (lineItem.height !== undefined) updateData.height = lineItem.height.toString();
    if (lineItem.quantity !== undefined) updateData.quantity = lineItem.quantity;
    if (lineItem.selectedOptions !== undefined) updateData.selectedOptions = lineItem.selectedOptions;
    if (lineItem.linePrice !== undefined) updateData.linePrice = lineItem.linePrice.toString();
    if (lineItem.priceBreakdown !== undefined) updateData.priceBreakdown = lineItem.priceBreakdown;
    if (lineItem.displayOrder !== undefined) updateData.displayOrder = lineItem.displayOrder;

    const [updated] = await db
      .update(quoteLineItems)
      .set(updateData)
      .where(eq(quoteLineItems.id, id))
      .returning();

    if (!updated) {
      throw new Error(`Line item ${id} not found`);
    }

    return updated;
  }

  async deleteLineItem(id: string): Promise<void> {
    await db.delete(quoteLineItems).where(eq(quoteLineItems.id, id));
  }

  async getUserQuotes(userId: string, filters?: {
    searchCustomer?: string;
    searchProduct?: string;
    startDate?: string;
    endDate?: string;
    minPrice?: string;
    maxPrice?: string;
    userRole?: string;
    source?: string;
  }): Promise<QuoteWithRelations[]> {
    const conditions = [];
    
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

    if (filters?.minPrice) {
      conditions.push(sql`${quotes.totalPrice}::numeric >= ${filters.minPrice}::numeric`);
    }

    if (filters?.maxPrice) {
      conditions.push(sql`${quotes.totalPrice}::numeric <= ${filters.maxPrice}::numeric`);
    }

    const userQuotes = await db
      .select()
      .from(quotes)
      .where(and(...conditions))
      .orderBy(desc(quotes.createdAt));

    // Fetch user and line items for each quote
    return await Promise.all(
      userQuotes.map(async (quote) => {
        const [user] = await db.select().from(users).where(eq(users.id, quote.userId));
        
        // Fetch line items
        const lineItems = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quote.id));
        
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
            const [product] = await db.select().from(products).where(eq(products.id, lineItem.productId));
            let variant = null;
            if (lineItem.variantId) {
              [variant] = await db.select().from(productVariants).where(eq(productVariants.id, lineItem.variantId));
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

  async getAllQuotes(filters?: {
    searchUser?: string;
    searchCustomer?: string;
    searchProduct?: string;
    startDate?: string;
    endDate?: string;
    minQuantity?: string;
    maxQuantity?: string;
  }): Promise<QuoteWithRelations[]> {
    const conditions = [];

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

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const allQuotes = await db
      .select()
      .from(quotes)
      .where(whereClause)
      .orderBy(desc(quotes.createdAt));

    // Fetch user and line items for each quote
    return await Promise.all(
      allQuotes.map(async (quote) => {
        const [user] = await db.select().from(users).where(eq(users.id, quote.userId));
        
        // Apply user filter if specified
        if (filters?.searchUser && !user.email?.includes(filters.searchUser)) {
          return null;
        }
        
        // Fetch line items
        const lineItems = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quote.id));
        
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
            const [product] = await db.select().from(products).where(eq(products.id, lineItem.productId));
            let variant = null;
            if (lineItem.variantId) {
              [variant] = await db.select().from(productVariants).where(eq(productVariants.id, lineItem.variantId));
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

  // Pricing rules operations
  async getAllPricingRules(): Promise<PricingRule[]> {
    return await db.select().from(pricingRules);
  }

  async getPricingRuleByName(name: string): Promise<PricingRule | undefined> {
    const [rule] = await db.select().from(pricingRules).where(eq(pricingRules.name, name));
    return rule;
  }

  async createPricingRule(rule: InsertPricingRule): Promise<PricingRule> {
    const [newRule] = await db.insert(pricingRules).values(rule).returning();
    return newRule;
  }

  async updatePricingRule(ruleData: UpdatePricingRule): Promise<PricingRule> {
    const [updated] = await db
      .update(pricingRules)
      .set({ ...ruleData, updatedAt: new Date() })
      .where(eq(pricingRules.name, ruleData.name))
      .returning();
    return updated;
  }

  // Media assets operations
  async getAllMediaAssets(): Promise<MediaAsset[]> {
    return await db.select().from(mediaAssets).orderBy(desc(mediaAssets.uploadedAt));
  }

  async getMediaAssetById(id: string): Promise<MediaAsset | undefined> {
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id));
    return asset;
  }

  async createMediaAsset(assetData: InsertMediaAsset): Promise<MediaAsset> {
    const [newAsset] = await db.insert(mediaAssets).values(assetData).returning();
    return newAsset;
  }

  async deleteMediaAsset(id: string): Promise<void> {
    await db.delete(mediaAssets).where(eq(mediaAssets.id, id));
  }

  // Formula templates operations
  async getAllFormulaTemplates(): Promise<FormulaTemplate[]> {
    return await db
      .select()
      .from(formulaTemplates)
      .where(eq(formulaTemplates.isActive, true))
      .orderBy(formulaTemplates.category, formulaTemplates.name);
  }

  async getFormulaTemplateById(id: string): Promise<FormulaTemplate | undefined> {
    const [template] = await db
      .select()
      .from(formulaTemplates)
      .where(eq(formulaTemplates.id, id));
    return template;
  }

  async createFormulaTemplate(template: InsertFormulaTemplate): Promise<FormulaTemplate> {
    const [newTemplate] = await db
      .insert(formulaTemplates)
      .values(template)
      .returning();
    return newTemplate;
  }

  async updateFormulaTemplate(id: string, updates: Partial<FormulaTemplate>): Promise<FormulaTemplate> {
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };

    const [template] = await db
      .update(formulaTemplates)
      .set(updateData)
      .where(eq(formulaTemplates.id, id))
      .returning();

    if (!template) {
      throw new Error("Formula template not found");
    }

    return template;
  }

  async deleteFormulaTemplate(id: string): Promise<void> {
    await db.delete(formulaTemplates).where(eq(formulaTemplates.id, id));
  }

  async getProductsByFormulaTemplate(templateId: string): Promise<Product[]> {
    // Get the formula template first
    const template = await this.getFormulaTemplateById(templateId);
    if (!template) {
      return [];
    }

    // Find all products that use this exact formula
    const allProducts = await db.select().from(products).where(eq(products.isActive, true));
    return allProducts.filter(product => product.pricingFormula === template.formula);
  }

  // Email settings operations
  async getAllEmailSettings(): Promise<EmailSettings[]> {
    return await db
      .select()
      .from(emailSettings)
      .where(eq(emailSettings.isActive, true))
      .orderBy(emailSettings.isDefault, emailSettings.createdAt);
  }

  async getEmailSettingsById(id: string): Promise<EmailSettings | undefined> {
    const [settings] = await db
      .select()
      .from(emailSettings)
      .where(eq(emailSettings.id, id));
    return settings;
  }

  async getDefaultEmailSettings(): Promise<EmailSettings | undefined> {
    const [settings] = await db
      .select()
      .from(emailSettings)
      .where(and(eq(emailSettings.isActive, true), eq(emailSettings.isDefault, true)))
      .limit(1);
    return settings;
  }

  async createEmailSettings(settings: InsertEmailSettings): Promise<EmailSettings> {
    // If this is set as default, unset all other defaults first
    if (settings.isDefault) {
      await db
        .update(emailSettings)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(emailSettings.isDefault, true));
    }

    const [newSettings] = await db
      .insert(emailSettings)
      .values(settings as typeof emailSettings.$inferInsert)
      .returning();
    return newSettings;
  }

  async updateEmailSettings(id: string, settingsData: Partial<InsertEmailSettings>): Promise<EmailSettings> {
    // If this is being set as default, unset all other defaults first
    if (settingsData.isDefault) {
      await db
        .update(emailSettings)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(emailSettings.isDefault, true), sql`${emailSettings.id} != ${id}`));
    }

    const updateData = {
      ...settingsData,
      updatedAt: new Date(),
    };

    const [updated] = await db
      .update(emailSettings)
      .set(updateData)
      .where(eq(emailSettings.id, id))
      .returning();
    return updated;
  }

  async deleteEmailSettings(id: string): Promise<void> {
    await db.delete(emailSettings).where(eq(emailSettings.id, id));
  }

  // Company settings operations
  async getCompanySettings(): Promise<CompanySettings | undefined> {
    const [settings] = await db.select().from(companySettings).limit(1);
    return settings;
  }

  async createCompanySettings(settingsData: InsertCompanySettings): Promise<CompanySettings> {
    const [settings] = await db.insert(companySettings).values(settingsData).returning();
    if (!settings) {
      throw new Error("Failed to create company settings");
    }
    return settings;
  }

  async updateCompanySettings(id: string, settingsData: Partial<InsertCompanySettings>): Promise<CompanySettings> {
    const updateData: any = {
      ...settingsData,
      updatedAt: new Date(),
    };

    const [settings] = await db
      .update(companySettings)
      .set(updateData)
      .where(eq(companySettings.id, id))
      .returning();

    if (!settings) {
      throw new Error("Company settings not found");
    }

    return settings;
  }

  // Customer operations
  async getAllCustomers(filters?: {
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

      const matchedCustomers = await db
        .select()
        .from(customers)
        .where(and(...customerConditions))
        .orderBy(customers.companyName);

      // Also search for customers by contact name/email
      const matchedContacts = await db
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

        additionalCustomers = await db
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
        ? await db
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
    const conditions = [];
    
    if (filters?.status) {
      conditions.push(eq(customers.status, filters.status));
    }
    if (filters?.customerType) {
      conditions.push(eq(customers.customerType, filters.customerType as any));
    }
    if (filters?.assignedTo) {
      conditions.push(eq(customers.assignedTo, filters.assignedTo));
    }

    let query = db.select().from(customers);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const allCustomers = await query.orderBy(customers.companyName);
    
    // Fetch contacts for all customers
    const allCustomerIds = allCustomers.map(c => c.id);
    const allContacts = allCustomerIds.length > 0
      ? await db
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

  async getCustomerById(id: string): Promise<CustomerWithRelations | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));

    if (!customer) {
      return undefined;
    }

    // Fetch related data with user relations
    const contacts = await db.select().from(customerContacts).where(eq(customerContacts.customerId, id)).catch(() => []);
    
    const notesWithUsers = await db
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
    
    const transactionsWithUsers = await db
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
    
    const customerQuotes = await db.select().from(quotes).where(eq(quotes.customerId, id)).orderBy(desc(quotes.createdAt)).catch(() => []);

    return {
      ...customer,
      contacts,
      notes: notes as any, // Type cast needed due to notes field conflict (text field vs array relation)
      creditTransactions: creditTransactions as any,
      quotes: customerQuotes,
    };
  }

  async createCustomer(customerData: InsertCustomer): Promise<Customer> {
    const [customer] = await db.insert(customers).values(customerData).returning();
    if (!customer) {
      throw new Error("Failed to create customer");
    }
    return customer;
  }

  async updateCustomer(id: string, customerData: Partial<InsertCustomer>): Promise<Customer> {
    const updateData: any = {
      ...customerData,
      updatedAt: new Date(),
    };

    const [customer] = await db
      .update(customers)
      .set(updateData)
      .where(eq(customers.id, id))
      .returning();

    if (!customer) {
      throw new Error("Customer not found");
    }

    return customer;
  }

  async deleteCustomer(id: string): Promise<void> {
    await db.delete(customers).where(eq(customers.id, id));
  }

  // Customer contacts operations
  async getCustomerContacts(customerId: string): Promise<CustomerContact[]> {
    return await db
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.customerId, customerId))
      .orderBy(desc(customerContacts.isPrimary), customerContacts.firstName);
  }

  async getCustomerContactById(id: string): Promise<CustomerContact | undefined> {
    const [contact] = await db.select().from(customerContacts).where(eq(customerContacts.id, id));
    return contact;
  }

  async createCustomerContact(contactData: InsertCustomerContact): Promise<CustomerContact> {
    const [contact] = await db.insert(customerContacts).values(contactData).returning();
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

    const [contact] = await db
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
    await db.delete(customerContacts).where(eq(customerContacts.id, id));
  }

  // Customer notes operations
  async getCustomerNotes(customerId: string, filters?: {
    noteType?: string;
    assignedTo?: string;
  }): Promise<CustomerNote[]> {
    // Simplified query - removed non-existent fields (noteType, assignedTo, isPinned)
    return await db
      .select()
      .from(customerNotes)
      .where(eq(customerNotes.customerId, customerId))
      .orderBy(desc(customerNotes.createdAt));
  }

  async createCustomerNote(noteData: InsertCustomerNote): Promise<CustomerNote> {
    const [note] = await db.insert(customerNotes).values(noteData).returning();
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

    const [note] = await db
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
    await db.delete(customerNotes).where(eq(customerNotes.id, id));
  }

  // Customer credit transactions operations
  async getCustomerCreditTransactions(customerId: string): Promise<CustomerCreditTransaction[]> {
    return await db
      .select()
      .from(customerCreditTransactions)
      .where(eq(customerCreditTransactions.customerId, customerId))
      .orderBy(desc(customerCreditTransactions.createdAt));
  }

  async createCustomerCreditTransaction(transactionData: InsertCustomerCreditTransaction): Promise<CustomerCreditTransaction> {
    const [transaction] = await db.insert(customerCreditTransactions).values(transactionData).returning();
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

    const [transaction] = await db
      .update(customerCreditTransactions)
      .set(updateData)
      .where(eq(customerCreditTransactions.id, id))
      .returning();

    if (!transaction) {
      throw new Error("Customer credit transaction not found");
    }

    return transaction;
  }

  async updateCustomerBalance(
    customerId: string,
    amount: number,
    type: 'credit' | 'debit',
    reason: string,
    createdBy: string
  ): Promise<Customer> {
    // Get current customer
    const [customer] = await db.select().from(customers).where(eq(customers.id, customerId));
    if (!customer) {
      throw new Error("Customer not found");
    }

    const currentBalance = parseFloat(customer.currentBalance || '0');
    const creditLimit = parseFloat(customer.creditLimit || '0');

    // Calculate new balance
    const balanceAfter = type === 'credit'
      ? currentBalance + amount
      : currentBalance - amount;

    // Create transaction record
    await db.insert(customerCreditTransactions).values({
      customerId,
      userId: createdBy,
      transactionType: type,
      amount: amount.toString(),
      description: reason,
    });

    // Update customer balance
    const [updatedCustomer] = await db
      .update(customers)
      .set({
        currentBalance: balanceAfter.toString(),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, customerId))
      .returning();

    if (!updatedCustomer) {
      throw new Error("Failed to update customer balance");
    }

    return updatedCustomer;
  }

  // =============================
  // Order operations (core CRUD)
  // =============================

  private async generateNextOrderNumber(tx?: any): Promise<string> {
    // Try globalVariables first (pattern similar to quotes). If missing, fallback to MAX(order_number)+1
    const executor = tx || db;
    try {
      const result = await executor.execute(sql`
        SELECT * FROM ${globalVariables}
        WHERE ${globalVariables.name} = 'next_order_number'
        FOR UPDATE
      `);
      const row = (result as any).rows?.[0];
      if (row) {
        const current = Math.floor(Number(row.value));
        // Increment for next
        await executor.update(globalVariables)
          .set({ value: (current + 1).toString(), updatedAt: new Date() })
          .where(eq(globalVariables.id, row.id));
        return current.toString();
      }
    } catch (e) {
      // Ignore and fallback
    }
    // Fallback: compute max existing numeric orderNumber
    const maxResult = await db.execute(sql`SELECT MAX(CAST(order_number AS INTEGER)) AS max_num FROM orders WHERE order_number ~ '^[0-9]+$'`);
    const maxNum = (maxResult as any).rows?.[0]?.max_num ? Number((maxResult as any).rows[0].max_num) : 999;
    return (maxNum + 1).toString();
  }

  async getAllOrders(filters?: {
    search?: string;
    status?: string;
    priority?: string;
    customerId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<Order[]> {
    const conditions = [] as any[];
    if (filters?.search) {
      const pattern = `%${filters.search}%`;
      conditions.push(or(
        ilike(orders.orderNumber, pattern),
        ilike(orders.notesInternal, pattern)
      ));
    }
    if (filters?.status) conditions.push(eq(orders.status, filters.status));
    if (filters?.priority) conditions.push(eq(orders.priority, filters.priority));
    if (filters?.customerId) conditions.push(eq(orders.customerId, filters.customerId));
    if (filters?.startDate) conditions.push(gte(orders.createdAt, filters.startDate));
    if (filters?.endDate) conditions.push(lte(orders.createdAt, filters.endDate));

    let query = db.select().from(orders) as any;
    if (conditions.length) {
      query = query.where(and(...conditions));
    }
    query = query.orderBy(desc(orders.createdAt));
    const rows = await query;
    
    // Enrich orders with customer and contact data
    const enrichedOrders = await Promise.all(rows.map(async (order: Order) => {
      const [customer] = order.customerId 
        ? await db.select().from(customers).where(eq(customers.id, order.customerId))
        : [undefined];
      
      const [contact] = order.contactId 
        ? await db.select().from(customerContacts).where(eq(customerContacts.id, order.contactId))
        : [undefined];
      
      return { ...order, customer, contact };
    }));
    
    return enrichedOrders;
  }

  async getOrderById(id: string): Promise<OrderWithRelations | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    if (!order) return undefined;
    const rawLineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, id));
    const enrichedLineItems = await Promise.all(
      rawLineItems.map(async (li) => {
        const [product] = await db.select().from(products).where(eq(products.id, li.productId));
        let productVariant = null as any;
        if (li.productVariantId) {
          [productVariant] = await db.select().from(productVariants).where(eq(productVariants.id, li.productVariantId));
        }
        return { ...li, product, productVariant } as any;
      })
    );
    const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId)).catch(() => []);
    let contact: CustomerContact | null = null;
    if (order.contactId) {
      const contactRows = await db.select().from(customerContacts).where(eq(customerContacts.id, order.contactId));
      contact = contactRows[0] || null;
    }
    const [createdByUser] = await db.select().from(users).where(eq(users.id, order.createdByUserId));
    return {
      ...order,
      lineItems: enrichedLineItems,
      customer,
      contact,
      createdByUser,
    } as OrderWithRelations;
  }

  async createOrder(data: {
    customerId: string;
    contactId?: string | null;
    quoteId?: string | null;
    status?: string;
    priority?: string;
    dueDate?: Date | null;
    promisedDate?: Date | null;
    discount?: number;
    notesInternal?: string | null;
    createdByUserId: string;
    lineItems: Omit<InsertOrderLineItem, 'orderId'>[];
  }): Promise<OrderWithRelations> {
    if (!data.customerId) throw new Error('customerId required');
    if (!data.lineItems || data.lineItems.length === 0) throw new Error('At least one line item required');
    const subtotal = data.lineItems.reduce((sum, li: any) => sum + Number(li.totalPrice || li.linePrice || 0), 0);
    const discount = data.discount || 0;
    const tax = 0; // Future: compute tax
    const total = subtotal - discount + tax;

    const created = await db.transaction(async (tx) => {
      const orderNumber = await this.generateNextOrderNumber(tx);
      const orderInsert: typeof orders.$inferInsert = {
        orderNumber,
        quoteId: data.quoteId || null,
        customerId: data.customerId,
        contactId: data.contactId || null,
        status: data.status || 'new',
        priority: data.priority || 'normal',
        dueDate: data.dueDate || null,
        promisedDate: data.promisedDate || null,
        subtotal: subtotal.toString(),
        tax: tax.toString(),
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
        } as typeof orderLineItems.$inferInsert;
      });
      const createdLineItems = lineItemsData.length ? await tx.insert(orderLineItems).values(lineItemsData).returning() : [];
      return { order, lineItems: createdLineItems };
    });

    // Auto-create jobs for each line item (if missing)
    await Promise.all(created.lineItems.map(async (li) => {
      const [existing] = await db.select().from(jobs).where(eq(jobs.orderLineItemId as any, li.id));
      if (!existing) {
        const jobInsert: typeof jobs.$inferInsert = {
          orderId: created.order.id,
          orderLineItemId: li.id,
          productType: (li as any).productType || 'wide_roll',
          status: 'pending_prepress',
          priority: 'normal',
          specsJson: (li as any).specsJson || null,
          assignedToUserId: null,
          notesInternal: null,
        } as any;
        const [newJob] = await db.insert(jobs).values(jobInsert).returning();
        await db.insert(jobStatusLog).values({
          jobId: newJob.id,
          oldStatus: null,
          newStatus: 'pending_prepress',
          userId: data.createdByUserId,
        } as InsertJobStatusLog).returning();
      }
    }));

    const [customer] = await db.select().from(customers).where(eq(customers.id, data.customerId));
    let contact: CustomerContact | null = null;
    if (data.contactId) {
      const contactRows = await db.select().from(customerContacts).where(eq(customerContacts.id, data.contactId));
      contact = contactRows[0] || null;
    }
    const [createdByUser] = await db.select().from(users).where(eq(users.id, data.createdByUserId));
    const enrichedLineItems = await Promise.all(
      created.lineItems.map(async (li) => {
        const [product] = await db.select().from(products).where(eq(products.id, li.productId));
        let productVariant = null as any;
        if (li.productVariantId) {
          [productVariant] = await db.select().from(productVariants).where(eq(productVariants.id, li.productVariantId));
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

  async updateOrder(id: string, order: Partial<InsertOrder>): Promise<Order> {
    const updateData: Record<string, any> = { ...order, updatedAt: new Date() };
    if (order.subtotal !== undefined) updateData.subtotal = order.subtotal.toString();
    if (order.tax !== undefined) updateData.tax = order.tax.toString();
    if (order.total !== undefined) updateData.total = order.total.toString();
    if (order.discount !== undefined) updateData.discount = order.discount.toString();
    const [updated] = await db.update(orders).set(updateData).where(eq(orders.id, id)).returning();
    if (!updated) throw new Error('Order not found');
    return updated;
  }

  async deleteOrder(id: string): Promise<void> {
    await db.delete(orders).where(eq(orders.id, id));
  }

  async getOrderLineItems(orderId: string): Promise<OrderLineItem[]> {
    return await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId)).orderBy(desc(orderLineItems.createdAt));
  }

  async getOrderLineItemById(id: string): Promise<OrderLineItem | undefined> {
    const [li] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, id));
    return li;
  }

  async createOrderLineItem(lineItem: InsertOrderLineItem): Promise<OrderLineItem> {
    const prepared: typeof orderLineItems.$inferInsert = {
      ...lineItem,
      width: lineItem.width ? lineItem.width.toString() : null,
      height: lineItem.height ? lineItem.height.toString() : null,
      sqft: lineItem.sqft ? lineItem.sqft.toString() : null,
      unitPrice: lineItem.unitPrice.toString(),
      totalPrice: lineItem.totalPrice.toString(),
    } as any;
    const [created] = await db.insert(orderLineItems).values(prepared).returning();
    
    // Check if product requires production job
    const [product] = await db.select().from(products).where(eq(products.id, created.productId));
    if (product && product.requiresProductionJob === false) {
      return created; // Skip job creation
    }

    // Auto-create job for this new line item if missing
    const [existing] = await db.select().from(jobs).where(eq(jobs.orderLineItemId as any, created.id));
    if (!existing) {
      // Fetch default status
      const [defaultStatus] = await db.select().from(jobStatuses).where(eq(jobStatuses.isDefault, true));
      const initialStatusKey = defaultStatus?.key || 'pending_prepress';

      // find orderId
      const [orderRow] = await db.select().from(orders).where(eq(orders.id, created.orderId));
      const jobInsert: typeof jobs.$inferInsert = {
        orderId: orderRow?.id || created.orderId,
        orderLineItemId: created.id,
        productType: (created as any).productType || 'wide_roll',
        statusKey: initialStatusKey,
        priority: 'normal',
        specsJson: (created as any).specsJson || null,
        assignedToUserId: null,
        notesInternal: null,
      } as any;
      const [newJob] = await db.insert(jobs).values(jobInsert).returning();
      await db.insert(jobStatusLog).values({
        jobId: newJob.id,
        oldStatusKey: null,
        newStatusKey: initialStatusKey,
        userId: orderRow?.createdByUserId || null,
      } as InsertJobStatusLog).returning();
    }
    return created;
  }

  async updateOrderLineItem(id: string, lineItem: Partial<InsertOrderLineItem>): Promise<OrderLineItem> {
    const updateData: Record<string, any> = { ...lineItem, updatedAt: new Date() };
    ['width','height','sqft','unitPrice','totalPrice'].forEach(f => {
      const val = (lineItem as any)[f];
      if (val !== undefined) updateData[f] = val === null ? null : val.toString();
    });
    const [updated] = await db.update(orderLineItems).set(updateData).where(eq(orderLineItems.id, id)).returning();
    if (!updated) throw new Error('Order line item not found');
    
    // Check if product requires production job
    const [product] = await db.select().from(products).where(eq(products.id, updated.productId));
    if (product && product.requiresProductionJob === false) {
      return updated; // Skip job creation
    }

    // Do not delete jobs automatically; ensure a job exists (if productType changes or newly created somehow)
    const [existingJob] = await db.select().from(jobs).where(eq(jobs.orderLineItemId as any, id));
    if (!existingJob) {
      // Fetch default status
      const [defaultStatus] = await db.select().from(jobStatuses).where(eq(jobStatuses.isDefault, true));
      const initialStatusKey = defaultStatus?.key || 'pending_prepress';

      const jobInsert: typeof jobs.$inferInsert = {
        orderId: updated.orderId,
        orderLineItemId: id,
        productType: (updated as any).productType || 'wide_roll',
        statusKey: initialStatusKey,
        priority: 'normal',
        specsJson: (updated as any).specsJson || null,
        assignedToUserId: null,
        notesInternal: null,
      } as any;
      const [newJob] = await db.insert(jobs).values(jobInsert).returning();
      await db.insert(jobStatusLog).values({
        jobId: newJob.id,
        oldStatusKey: null,
        newStatusKey: initialStatusKey,
        userId: null,
      } as InsertJobStatusLog).returning();
    }
    return updated;
  }

  async deleteOrderLineItem(id: string): Promise<void> {
    await db.delete(orderLineItems).where(eq(orderLineItems.id, id));
  }

  async convertQuoteToOrder(quoteId: string, createdByUserId: string, options?: {
    customerId?: string;
    contactId?: string;
    dueDate?: Date;
    promisedDate?: Date;
    priority?: string;
    notesInternal?: Date; // Note: original interface had Date, likely should be string
    }): Promise<OrderWithRelations> {
    const quote = await this.getQuoteById(quoteId);
    if (!quote) throw new Error('Quote not found');
    const customerId = options?.customerId || quote.customerId;
    if (!customerId) throw new Error('Quote missing customer');
    const contactId = options?.contactId || quote.contactId || null;
    const subtotal = quote.lineItems.reduce((sum, li: any) => sum + Number(li.linePrice), 0);
    const discount = 0; const tax = 0; const total = subtotal - discount + tax;
    const created = await db.transaction(async (tx) => {
      const orderNumber = await this.generateNextOrderNumber(tx);
      const orderInsert: typeof orders.$inferInsert = {
        orderNumber,
        quoteId: quote.id,
        customerId,
        contactId: contactId || null,
        status: 'new',
        priority: options?.priority || 'normal',
        dueDate: options?.dueDate || null,
        promisedDate: options?.promisedDate || null,
        subtotal: subtotal.toString(),
        tax: tax.toString(),
        total: total.toString(),
        discount: discount.toString(),
        notesInternal: (options as any)?.notesInternal || null,
        createdByUserId,
      };
      const [order] = await tx.insert(orders).values(orderInsert).returning();
      const lineItemsData = quote.lineItems.map((li: any) => {
        const unit = Number(li.linePrice) / (li.quantity || 1);
        return {
          orderId: order.id,
          quoteLineItemId: li.id,
          productId: li.productId,
          productVariantId: li.variantId || null,
          productType: li.productType || 'wide_roll',
          description: li.product?.name || li.productName || 'Item',
          width: li.width ? li.width.toString() : null,
          height: li.height ? li.height.toString() : null,
          quantity: li.quantity,
          sqft: (li as any).sqft ? (li as any).sqft.toString() : null,
          unitPrice: unit.toString(),
          totalPrice: li.linePrice.toString(),
          status: 'queued',
          specsJson: li.specsJson || null,
          selectedOptions: li.selectedOptions || [],
          nestingConfigSnapshot: null,
        } as typeof orderLineItems.$inferInsert;
      });
      const createdLineItems = await tx.insert(orderLineItems).values(lineItemsData).returning();
      return { order, lineItems: createdLineItems };
    });
    // Auto-create jobs for each created line item
    // Fetch default status
    const [defaultStatus] = await db.select().from(jobStatuses).where(eq(jobStatuses.isDefault, true));
    const initialStatusKey = defaultStatus?.key || 'pending_prepress';

    await Promise.all(created.lineItems.map(async (li) => {
      // Check if product requires production job
      const [product] = await db.select().from(products).where(eq(products.id, li.productId));
      if (product && product.requiresProductionJob === false) {
        return; // Skip job creation
      }

      const [existing] = await db.select().from(jobs).where(eq(jobs.orderLineItemId as any, li.id));
      if (!existing) {
        const jobInsert: typeof jobs.$inferInsert = {
          orderId: created.order.id,
          orderLineItemId: li.id,
          productType: (li as any).productType || 'wide_roll',
          statusKey: initialStatusKey,
          priority: 'normal',
          specsJson: (li as any).specsJson || null,
          assignedToUserId: null,
          notesInternal: null,
        } as any;
        const [newJob] = await db.insert(jobs).values(jobInsert).returning();
        await db.insert(jobStatusLog).values({
          jobId: newJob.id,
          oldStatusKey: null,
          newStatusKey: initialStatusKey,
          userId: createdByUserId,
        } as InsertJobStatusLog).returning();
      }
    }));

    const [customer] = await db.select().from(customers).where(eq(customers.id, customerId));
    let contact: CustomerContact | null = null;
    if (contactId) {
      const contactRows = await db.select().from(customerContacts).where(eq(customerContacts.id, contactId));
      contact = contactRows[0] || null;
    }
    const [createdByUser] = await db.select().from(users).where(eq(users.id, createdByUserId));
    const enrichedLineItems = await Promise.all(
      created.lineItems.map(async (li) => {
        const [product] = await db.select().from(products).where(eq(products.id, li.productId));
        let productVariant = null as any;
        if (li.productVariantId) {
          [productVariant] = await db.select().from(productVariants).where(eq(productVariants.id, li.productVariantId));
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

  // Audit log operations
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [auditLog] = await db.insert(auditLogs).values(log).returning();
    return auditLog;
  }

  async getAuditLogs(filters?: {
    userId?: string;
    actionType?: string;
    entityType?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<AuditLog[]> {
    const conditions = [];

    if (filters?.userId) {
      conditions.push(eq(auditLogs.userId, filters.userId));
    }
    if (filters?.actionType) {
      conditions.push(eq(auditLogs.actionType, filters.actionType));
    }
    if (filters?.entityType) {
      conditions.push(eq(auditLogs.entityType, filters.entityType));
    }
    if (filters?.startDate) {
      conditions.push(gte(auditLogs.createdAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(auditLogs.createdAt, filters.endDate));
    }

    let query = db.select().from(auditLogs);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    query = query.orderBy(desc(auditLogs.createdAt)) as any;

    if (filters?.limit) {
      query = query.limit(filters.limit) as any;
    }

    return await query;
  }

  // Order audit log operations
  async getOrderAuditLog(orderId: string): Promise<OrderAuditLog[]> {
    return await db
      .select()
      .from(orderAuditLog)
      .where(eq(orderAuditLog.orderId, orderId))
      .orderBy(desc(orderAuditLog.createdAt));
  }

  async createOrderAuditLog(log: InsertOrderAuditLog): Promise<OrderAuditLog> {
    const [auditLogEntry] = await db.insert(orderAuditLog).values(log).returning();
    return auditLogEntry;
  }

  // Order attachments operations
  async getOrderAttachments(orderId: string): Promise<OrderAttachment[]> {
    return await db
      .select()
      .from(orderAttachments)
      .where(eq(orderAttachments.orderId, orderId))
      .orderBy(desc(orderAttachments.createdAt));
  }

  async createOrderAttachment(attachment: InsertOrderAttachment): Promise<OrderAttachment> {
    const [newAttachment] = await db.insert(orderAttachments).values(attachment).returning();
    return newAttachment;
  }

  async deleteOrderAttachment(id: string): Promise<void> {
    await db.delete(orderAttachments).where(eq(orderAttachments.id, id));
  }

  // Quote workflow operations
  async getQuoteWorkflowState(quoteId: string): Promise<QuoteWorkflowState | undefined> {
    const [state] = await db
      .select()
      .from(quoteWorkflowStates)
      .where(eq(quoteWorkflowStates.quoteId, quoteId));
    return state;
  }

  async createQuoteWorkflowState(state: InsertQuoteWorkflowState): Promise<QuoteWorkflowState> {
    const [newState] = await db.insert(quoteWorkflowStates).values(state).returning();
    return newState;
  }

  async updateQuoteWorkflowState(quoteId: string, updates: Partial<InsertQuoteWorkflowState>): Promise<QuoteWorkflowState> {
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };
    const [state] = await db
      .update(quoteWorkflowStates)
      .set(updateData)
      .where(eq(quoteWorkflowStates.quoteId, quoteId))
      .returning();
    if (!state) {
      throw new Error("Quote workflow state not found");
    }
    return state;
  }

  // Contacts operations
  async getAllContacts(params: { search?: string; page?: number; pageSize?: number }): Promise<CustomerContact[]> {
    const { search, page = 1, pageSize = 50 } = params;
    let query = db.select().from(customerContacts) as any;
    if (search) {
      const pattern = `%${search}%`;
      query = query.where(or(
        ilike(customerContacts.firstName, pattern),
        ilike(customerContacts.lastName, pattern),
        ilike(customerContacts.email, pattern)
      ));
    }
    query = query.orderBy(desc(customerContacts.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    return await query;
  }

  async getContactWithRelations(id: string): Promise<(CustomerContact & { customer?: Customer }) | undefined> {
    const [contact] = await db.select().from(customerContacts).where(eq(customerContacts.id, id));
    if (!contact) return undefined;
    const [customer] = contact.customerId ? await db.select().from(customers).where(eq(customers.id, contact.customerId)) : [undefined];
    return { ...contact, customer };
  }

  // =============================
  // Job operations
  // =============================
  async getJobs(filters?: { statusKey?: string; assignedToUserId?: string; orderId?: string }): Promise<(Job & { order?: Order | null; orderLineItem?: OrderLineItem | null })[]> {
    const conditions: any[] = [];
    if (filters?.statusKey) conditions.push(eq(jobs.statusKey as any, filters.statusKey));
    if (filters?.assignedToUserId) conditions.push(eq(jobs.assignedToUserId as any, filters.assignedToUserId));
    if (filters?.orderId) conditions.push(eq(jobs.orderId as any, filters.orderId));
    let query = db.select().from(jobs) as any;
    if (conditions.length) query = query.where(and(...conditions));
    query = query.orderBy(desc(jobs.createdAt as any));
    const records: Job[] = await query;
    const enriched = await Promise.all(records.map(async (j) => {
      const [order] = j.orderId ? await db.select().from(orders).where(eq(orders.id, j.orderId)) : [undefined];
      const [li] = j.orderLineItemId ? await db.select().from(orderLineItems).where(eq(orderLineItems.id, j.orderLineItemId)) : [undefined];
      return { ...j, order: order || null, orderLineItem: li || null } as any;
    }));
    return enriched as any;
  }

  async getJob(id: string): Promise<(Job & { order?: Order | null; orderLineItem?: OrderLineItem | null; notesLog?: JobNote[]; statusLog?: JobStatusLog[] }) | undefined> {
    const [job] = await db.select().from(jobs).where(eq(jobs.id as any, id));
    if (!job) return undefined;
    const [order] = job.orderId ? await db.select().from(orders).where(eq(orders.id, job.orderId)) : [undefined];
    const [li] = job.orderLineItemId ? await db.select().from(orderLineItems).where(eq(orderLineItems.id, job.orderLineItemId)) : [undefined];
    const notes = await db.select().from(jobNotes).where(eq(jobNotes.jobId as any, job.id)).orderBy(desc(jobNotes.createdAt as any));
    const status = await db.select().from(jobStatusLog).where(eq(jobStatusLog.jobId as any, job.id)).orderBy(desc(jobStatusLog.createdAt as any));
    return { ...job, order: order || null, orderLineItem: li || null, notesLog: notes as any, statusLog: status as any } as any;
  }

  async updateJob(id: string, data: Partial<InsertJob>, userId?: string): Promise<Job> {
    const [existing] = await db.select().from(jobs).where(eq(jobs.id as any, id));
    if (!existing) throw new Error('Job not found');
    const updateData: any = { ...data, updatedAt: new Date() };
    if ((data as any).assignedTo !== undefined) {
      updateData.assignedToUserId = (data as any).assignedTo;
      delete (updateData as any).assignedTo;
    }
    if ((data as any).notes !== undefined) {
      updateData.notesInternal = (data as any).notes;
      delete (updateData as any).notes;
    }
    const [updated] = await db.update(jobs).set(updateData).where(eq(jobs.id as any, id)).returning();
    if (!updated) throw new Error('Job not found after update');
    if (data.statusKey && data.statusKey !== existing.statusKey) {
      await db.insert(jobStatusLog).values({
        jobId: id,
        oldStatusKey: existing.statusKey,
        newStatusKey: data.statusKey,
        userId: userId || null,
      } as InsertJobStatusLog).returning();
    }
    return updated;
  }

  async addJobNote(jobId: string, noteText: string, userId: string): Promise<JobNote> {
    const [note] = await db.insert(jobNotes).values({ jobId, userId, noteText } as InsertJobNote).returning();
    return note;
  }

  // =============================
  // Job Status Configuration
  // =============================
  async getJobStatuses(): Promise<JobStatus[]> {
    return db.select().from(jobStatuses).orderBy(jobStatuses.position);
  }

  async createJobStatus(data: InsertJobStatus): Promise<JobStatus> {
    const [status] = await db.insert(jobStatuses).values(data).returning();
    return status;
  }

  async updateJobStatus(id: string, data: Partial<InsertJobStatus>): Promise<JobStatus> {
    const [updated] = await db.update(jobStatuses).set({ ...data, updatedAt: new Date() }).where(eq(jobStatuses.id, id)).returning();
    if (!updated) throw new Error('Job status not found');
    return updated;
  }

  async deleteJobStatus(id: string): Promise<void> {
    await db.delete(jobStatuses).where(eq(jobStatuses.id, id));
  }

  async getJobsForOrder(orderId: string): Promise<Job[]> {
    return await db.select().from(jobs).where(eq(jobs.orderId as any, orderId)).orderBy(desc(jobs.createdAt as any));
  }
}

export const storage = new DatabaseStorage();
