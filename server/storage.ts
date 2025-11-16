import {
  users,
  products,
  productOptions,
  productVariants,
  globalVariables,
  quotes,
  quoteLineItems,
  pricingRules,
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
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, like, sql } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

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
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
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
    
    // Create the parent quote (totalPrice initially same as subtotal, can be adjusted later)
    const quoteData = {
      userId: data.userId,
      customerName: data.customerName,
      subtotal: subtotal.toString(),
      totalPrice: subtotal.toString(),
    } as typeof quotes.$inferInsert;
    
    const [newQuote] = await db.insert(quotes).values(quoteData).returning();
    
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
      .orderBy(sql`${quotes.createdAt} DESC`);

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
      .orderBy(sql`${quotes.createdAt} DESC`);

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
}

export const storage = new DatabaseStorage();
