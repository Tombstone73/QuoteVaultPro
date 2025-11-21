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
  auditLogs,
  type AuditLog,
  type InsertAuditLog,
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
  }): Promise<Customer[]>;
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
    customerName?: string;
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
        customerName: data.customerName,
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
      width: item.width.toString(),
      height: item.height.toString(),
      quantity: item.quantity,
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
      width: lineItem.width.toString(),
      height: lineItem.height.toString(),
      quantity: lineItem.quantity,
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
  }): Promise<QuoteWithRelations[]> {
    const conditions = [eq(quotes.userId, userId)];

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
  }): Promise<Customer[]> {
    let query = db.select().from(customers);

    const conditions = [];

    // Temporarily disable search to fix SQL error
    // if (filters?.search) {
    //   const searchPattern = `%${filters.search}%`;
    //   conditions.push(
    //     or(
    //       ilike(customers.companyName, searchPattern),
    //       ilike(customers.email, searchPattern)
    //     )
    //   );
    // }

    if (filters?.status) {
      conditions.push(eq(customers.status, filters.status));
    }

    if (filters?.customerType) {
      conditions.push(eq(customers.customerType, filters.customerType as any));
    }

    if (filters?.assignedTo) {
      conditions.push(eq(customers.assignedTo, filters.assignedTo));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    return await query.orderBy(customers.companyName);
  }

  async getCustomerById(id: string): Promise<CustomerWithRelations | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));

    if (!customer) {
      return undefined;
    }

    // Fetch related data one at a time to isolate SQL errors
    const contacts = await db.select().from(customerContacts).where(eq(customerContacts.customerId, id)).catch(() => []);
    const notes = await db.select().from(customerNotes).where(eq(customerNotes.customerId, id)).orderBy(desc(customerNotes.createdAt)).catch(() => []);
    const creditTransactions = await db.select().from(customerCreditTransactions).where(eq(customerCreditTransactions.customerId, id)).orderBy(desc(customerCreditTransactions.createdAt)).catch(() => []);
    const customerQuotes = await db.select().from(quotes).where(eq(quotes.customerId, id)).orderBy(desc(quotes.createdAt)).catch(() => []);

    return {
      ...customer,
      contacts,
      notes,
      creditTransactions,
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
    let query = db.select().from(customerNotes).where(eq(customerNotes.customerId, customerId));

    const conditions = [eq(customerNotes.customerId, customerId)];

    if (filters?.noteType) {
      conditions.push(eq(customerNotes.noteType, filters.noteType as any));
    }

    if (filters?.assignedTo) {
      conditions.push(eq(customerNotes.assignedTo, filters.assignedTo));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    return await query.orderBy(desc(customerNotes.isPinned), desc(customerNotes.createdAt));
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

    const currentBalance = parseFloat(customer.currentBalance);
    const creditLimit = parseFloat(customer.creditLimit);

    // Calculate new balance
    const balanceBefore = currentBalance;
    const balanceAfter = type === 'credit'
      ? currentBalance + amount
      : currentBalance - amount;

    const availableCredit = creditLimit - balanceAfter;

    // Create transaction record
    await db.insert(customerCreditTransactions).values({
      customerId,
      transactionType: type,
      amount: amount.toString(),
      balanceBefore: balanceBefore.toString(),
      balanceAfter: balanceAfter.toString(),
      reason,
      createdBy,
      status: 'approved',
      approvedBy: createdBy,
      approvedAt: new Date(),
    });

    // Update customer balance
    const [updatedCustomer] = await db
      .update(customers)
      .set({
        currentBalance: balanceAfter.toString(),
        availableCredit: availableCredit.toString(),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, customerId))
      .returning();

    if (!updatedCustomer) {
      throw new Error("Failed to update customer balance");
    }

    return updatedCustomer;
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
}

export const storage = new DatabaseStorage();
