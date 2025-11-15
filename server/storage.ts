import {
  users,
  products,
  productOptions,
  productVariants,
  globalVariables,
  quotes,
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
  createQuote(quote: InsertQuote): Promise<Quote>;
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
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
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
    const [newProduct] = await db.insert(products).values(product).returning();
    return newProduct;
  }

  async updateProduct(id: string, productData: UpdateProduct): Promise<Product> {
    const [updated] = await db
      .update(products)
      .set({ ...productData, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    return updated;
  }

  async deleteProduct(id: string): Promise<void> {
    await db.delete(products).where(eq(products.id, id));
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
  async createQuote(quote: InsertQuote): Promise<Quote> {
    const quoteData = {
      ...quote,
      width: quote.width.toString(),
      height: quote.height.toString(),
      calculatedPrice: quote.calculatedPrice.toString(),
    } as typeof quotes.$inferInsert;
    
    const [newQuote] = await db.insert(quotes).values(quoteData).returning();
    return newQuote;
  }

  async getUserQuotes(userId: string, filters?: {
    searchCustomer?: string;
    searchProduct?: string;
    startDate?: string;
    endDate?: string;
    minPrice?: string;
    maxPrice?: string;
  }): Promise<QuoteWithRelations[]> {
    let query = db
      .select()
      .from(quotes)
      .innerJoin(users, eq(quotes.userId, users.id))
      .innerJoin(products, eq(quotes.productId, products.id))
      .where(eq(quotes.userId, userId));

    const conditions = [eq(quotes.userId, userId)];

    if (filters?.searchCustomer) {
      conditions.push(like(quotes.customerName, `%${filters.searchCustomer}%`));
    }

    if (filters?.searchProduct) {
      conditions.push(eq(quotes.productId, filters.searchProduct));
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
      conditions.push(sql`${quotes.calculatedPrice}::numeric >= ${filters.minPrice}::numeric`);
    }

    if (filters?.maxPrice) {
      conditions.push(sql`${quotes.calculatedPrice}::numeric <= ${filters.maxPrice}::numeric`);
    }

    const results = await db
      .select()
      .from(quotes)
      .innerJoin(users, eq(quotes.userId, users.id))
      .innerJoin(products, eq(quotes.productId, products.id))
      .where(and(...conditions))
      .orderBy(sql`${quotes.createdAt} DESC`);

    return results.map(row => ({
      ...row.quotes,
      user: row.users,
      product: row.products,
    }));
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

    if (filters?.searchUser) {
      conditions.push(like(users.email, `%${filters.searchUser}%`));
    }

    if (filters?.searchCustomer) {
      conditions.push(like(quotes.customerName, `%${filters.searchCustomer}%`));
    }

    if (filters?.searchProduct) {
      conditions.push(eq(quotes.productId, filters.searchProduct));
    }

    if (filters?.startDate) {
      conditions.push(gte(quotes.createdAt, new Date(filters.startDate)));
    }

    if (filters?.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(quotes.createdAt, endDate));
    }

    if (filters?.minQuantity) {
      conditions.push(gte(quotes.quantity, parseInt(filters.minQuantity)));
    }

    if (filters?.maxQuantity) {
      conditions.push(lte(quotes.quantity, parseInt(filters.maxQuantity)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await db
      .select()
      .from(quotes)
      .innerJoin(users, eq(quotes.userId, users.id))
      .innerJoin(products, eq(quotes.productId, products.id))
      .where(whereClause)
      .orderBy(sql`${quotes.createdAt} DESC`);

    return results.map(row => ({
      ...row.quotes,
      user: row.users,
      product: row.products,
    }));
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
