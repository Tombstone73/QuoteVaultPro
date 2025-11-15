import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table (required for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table (required for Replit Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  isAdmin: boolean("is_admin").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const upsertUserSchema = createInsertSchema(users).pick({
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
});

export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type User = typeof users.$inferSelect;

// Products table
export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description").notNull(),
  pricingFormula: text("pricing_formula").notNull(),
  storeUrl: varchar("store_url", { length: 512 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateProductSchema = insertProductSchema.partial();

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type UpdateProduct = z.infer<typeof updateProductSchema>;
export type Product = typeof products.$inferSelect;

// Product Variants table
export const productVariants = pgTable("product_variants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: 'cascade' }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  basePricePerSqft: decimal("base_price_per_sqft", { precision: 10, scale: 4 }).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  displayOrder: integer("display_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("product_variants_product_id_idx").on(table.productId),
]);

export const insertProductVariantSchema = createInsertSchema(productVariants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  basePricePerSqft: z.coerce.number().positive(),
  displayOrder: z.coerce.number().int(),
});

export const updateProductVariantSchema = insertProductVariantSchema.partial().extend({
  id: z.string(),
});

export type InsertProductVariant = z.infer<typeof insertProductVariantSchema>;
export type UpdateProductVariant = z.infer<typeof updateProductVariantSchema>;
export type ProductVariant = typeof productVariants.$inferSelect;

// Global Variables table
export const globalVariables = pgTable("global_variables", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull().unique(),
  value: decimal("value", { precision: 10, scale: 4 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("global_variables_name_idx").on(table.name),
  index("global_variables_category_idx").on(table.category),
]);

export const insertGlobalVariableSchema = createInsertSchema(globalVariables).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  value: z.coerce.number(),
});

export const updateGlobalVariableSchema = insertGlobalVariableSchema.partial().extend({
  id: z.string(),
});

export type InsertGlobalVariable = z.infer<typeof insertGlobalVariableSchema>;
export type UpdateGlobalVariable = z.infer<typeof updateGlobalVariableSchema>;
export type GlobalVariable = typeof globalVariables.$inferSelect;

// Product Options table
export const productOptions = pgTable("product_options", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: 'cascade' }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  type: varchar("type", { length: 50 }).notNull().$type<"toggle" | "number" | "select">(),
  defaultValue: text("default_value"),
  isDefaultEnabled: boolean("is_default_enabled").default(false).notNull(),
  setupCost: decimal("setup_cost", { precision: 10, scale: 2 }).default("0").notNull(),
  priceFormula: text("price_formula"),
  parentOptionId: varchar("parent_option_id").references((): any => productOptions.id, { onDelete: 'cascade' }),
  displayOrder: integer("display_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("product_options_product_id_idx").on(table.productId),
  index("product_options_parent_id_idx").on(table.parentOptionId),
]);

export const insertProductOptionSchema = createInsertSchema(productOptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  type: z.enum(["toggle", "number", "select"]),
  setupCost: z.coerce.number().min(0),
  displayOrder: z.coerce.number().int(),
});

export const updateProductOptionSchema = insertProductOptionSchema.partial().extend({
  id: z.string(),
});

export type InsertProductOption = z.infer<typeof insertProductOptionSchema>;
export type UpdateProductOption = z.infer<typeof updateProductOptionSchema>;
export type ProductOption = typeof productOptions.$inferSelect;

// Quotes table
export const quotes = pgTable("quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: 'cascade' }),
  variantId: varchar("variant_id").references(() => productVariants.id, { onDelete: 'set null' }),
  variantName: varchar("variant_name", { length: 255 }),
  customerName: varchar("customer_name", { length: 255 }),
  width: decimal("width", { precision: 10, scale: 2 }).notNull(),
  height: decimal("height", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").notNull(),
  addOns: jsonb("add_ons").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  selectedOptions: jsonb("selected_options").$type<Array<{
    optionId: string;
    optionName: string;
    value: string | number | boolean;
    setupCost: number;
    calculatedCost: number;
  }>>().default(sql`'[]'::jsonb`).notNull(),
  calculatedPrice: decimal("calculated_price", { precision: 10, scale: 2 }).notNull(),
  priceBreakdown: jsonb("price_breakdown").$type<{
    basePrice: number;
    addOnsPrice: number;
    optionsPrice: number;
    total: number;
    formula: string;
    variantInfo?: string;
  }>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("quotes_user_id_idx").on(table.userId),
  index("quotes_product_id_idx").on(table.productId),
  index("quotes_variant_id_idx").on(table.variantId),
  index("quotes_created_at_idx").on(table.createdAt),
]);

export const insertQuoteSchema = createInsertSchema(quotes).omit({
  id: true,
  createdAt: true,
}).extend({
  width: z.coerce.number().positive(),
  height: z.coerce.number().positive(),
  quantity: z.coerce.number().int().positive(),
  calculatedPrice: z.coerce.number().positive(),
});

export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Quote = typeof quotes.$inferSelect;

// Pricing rules table
export const pricingRules = pgTable("pricing_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull().unique(),
  description: text("description"),
  ruleValue: jsonb("rule_value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPricingRuleSchema = createInsertSchema(pricingRules).omit({
  id: true,
  updatedAt: true,
});

export const updatePricingRuleSchema = insertPricingRuleSchema.partial().required({ name: true });

export type InsertPricingRule = z.infer<typeof insertPricingRuleSchema>;
export type UpdatePricingRule = z.infer<typeof updatePricingRuleSchema>;
export type PricingRule = typeof pricingRules.$inferSelect;

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  quotes: many(quotes),
}));

export const productsRelations = relations(products, ({ many }) => ({
  quotes: many(quotes),
  options: many(productOptions),
  variants: many(productVariants),
}));

export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, {
    fields: [productVariants.productId],
    references: [products.id],
  }),
  quotes: many(quotes),
}));

export const productOptionsRelations = relations(productOptions, ({ one, many }) => ({
  product: one(products, {
    fields: [productOptions.productId],
    references: [products.id],
  }),
  parentOption: one(productOptions, {
    fields: [productOptions.parentOptionId],
    references: [productOptions.id],
  }),
  childOptions: many(productOptions),
}));

export const quotesRelations = relations(quotes, ({ one }) => ({
  user: one(users, {
    fields: [quotes.userId],
    references: [users.id],
  }),
  product: one(products, {
    fields: [quotes.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [quotes.variantId],
    references: [productVariants.id],
  }),
}));

// Extended quote type with relations
export type QuoteWithRelations = Quote & {
  user: User;
  product: Product;
};
