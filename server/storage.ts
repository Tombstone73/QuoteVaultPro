import {
  users,
  products,
  quotes,
  pricingRules,
  type User,
  type UpsertUser,
  type Product,
  type InsertProduct,
  type UpdateProduct,
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

  // Quote operations
  async createQuote(quote: InsertQuote): Promise<Quote> {
    const [newQuote] = await db.insert(quotes).values(quote).returning();
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
