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
  isAdmin: true,
});

export const updateUserSchema = createInsertSchema(users).pick({
  email: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
  isAdmin: true,
}).partial();

export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type User = typeof users.$inferSelect;

// Media Assets table
export const mediaAssets = pgTable("media_assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: varchar("filename", { length: 255 }).notNull(),
  url: text("url").notNull(),
  uploadedBy: varchar("uploaded_by").notNull().references(() => users.id, { onDelete: 'cascade' }),
  fileSize: integer("file_size").notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
}, (table) => [
  index("media_assets_uploaded_by_idx").on(table.uploadedBy),
  index("media_assets_uploaded_at_idx").on(table.uploadedAt),
]);

export const insertMediaAssetSchema = createInsertSchema(mediaAssets).omit({
  id: true,
  uploadedAt: true,
});

export type InsertMediaAsset = z.infer<typeof insertMediaAssetSchema>;
export type MediaAsset = typeof mediaAssets.$inferSelect;

// Products table
export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description").notNull(),
  pricingFormula: text("pricing_formula"), // Made optional - not required when using nesting calculator
  variantLabel: varchar("variant_label", { length: 100 }).default("Variant"),
  category: varchar("category", { length: 100 }),
  storeUrl: varchar("store_url", { length: 512 }),
  showStoreLink: boolean("show_store_link").default(true).notNull(),
  thumbnailUrls: text("thumbnail_urls").array().default(sql`'{}'::text[]`).notNull(),
  priceBreaks: jsonb("price_breaks").$type<{
    enabled: boolean;
    type: "quantity" | "sheets" | "sqft";
    tiers: Array<{
      minValue: number;
      maxValue?: number;
      discountType: "percentage" | "fixed" | "multiplier";
      discountValue: number;
    }>;
  }>().default(sql`'{"enabled":false,"type":"quantity","tiers":[]}'::jsonb`).notNull(),
  // Nesting Calculator fields
  useNestingCalculator: boolean("use_nesting_calculator").default(false).notNull(),
  sheetWidth: decimal("sheet_width", { precision: 10, scale: 2 }),
  sheetHeight: decimal("sheet_height", { precision: 10, scale: 2 }),
  materialType: varchar("material_type", { length: 50 }).$type<"sheet" | "roll">().default("sheet"),
  minPricePerItem: decimal("min_price_per_item", { precision: 10, scale: 2 }),
  nestingVolumePricing: jsonb("nesting_volume_pricing").$type<{
    enabled: boolean;
    tiers: Array<{
      minSheets: number;
      maxSheets?: number;
      pricePerSheet: number;
    }>;
  }>().default(sql`'{"enabled":false,"tiers":[]}'::jsonb`).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  pricingFormula: z.string().optional().nullable(),
  sheetWidth: z.coerce.number().positive().optional().nullable(),
  sheetHeight: z.coerce.number().positive().optional().nullable(),
  minPricePerItem: z.coerce.number().positive().optional().nullable(),
});

export const updateProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  pricingFormula: z.string().optional().nullable(),
  sheetWidth: z.coerce.number().positive().optional().nullable(),
  sheetHeight: z.coerce.number().positive().optional().nullable(),
  minPricePerItem: z.coerce.number().positive().optional().nullable(),
}).partial();

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
  volumePricing: jsonb("volume_pricing").$type<{
    enabled: boolean;
    tiers: Array<{
      minSheets: number;
      maxSheets?: number;
      pricePerSheet: number;
    }>;
  }>().default(sql`'{"enabled":false,"tiers":[]}'::jsonb`).notNull(),
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
  value: text("value").notNull(), // Changed from decimal to text to support both numbers and strings
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
  value: z.string(), // Changed from z.coerce.number() to z.string() to support both numbers and strings
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
  defaultSelection: text("default_selection"),
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

// Quotes table (parent quote)
export const quotes = pgTable("quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  quoteNumber: integer("quote_number").unique(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  customerName: varchar("customer_name", { length: 255 }),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  taxRate: decimal("tax_rate", { precision: 5, scale: 4 }).default("0").notNull(),
  marginPercentage: decimal("margin_percentage", { precision: 5, scale: 4 }).default("0").notNull(),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0").notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("quotes_user_id_idx").on(table.userId),
  index("quotes_created_at_idx").on(table.createdAt),
  index("quotes_quote_number_idx").on(table.quoteNumber),
]);

// Quote Line Items table
export const quoteLineItems = pgTable("quote_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  quoteId: varchar("quote_id").notNull().references(() => quotes.id, { onDelete: 'cascade' }),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: 'cascade' }),
  productName: varchar("product_name", { length: 255 }).notNull(),
  variantId: varchar("variant_id").references(() => productVariants.id, { onDelete: 'set null' }),
  variantName: varchar("variant_name", { length: 255 }),
  width: decimal("width", { precision: 10, scale: 2 }).notNull(),
  height: decimal("height", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").notNull(),
  selectedOptions: jsonb("selected_options").$type<Array<{
    optionId: string;
    optionName: string;
    value: string | number | boolean;
    setupCost: number;
    calculatedCost: number;
  }>>().default(sql`'[]'::jsonb`).notNull(),
  linePrice: decimal("line_price", { precision: 10, scale: 2 }).notNull(),
  priceBreakdown: jsonb("price_breakdown").$type<{
    basePrice: number;
    optionsPrice: number;
    total: number;
    formula: string;
    variantInfo?: string;
  }>().notNull(),
  displayOrder: integer("display_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("quote_line_items_quote_id_idx").on(table.quoteId),
  index("quote_line_items_product_id_idx").on(table.productId),
]);

export const insertQuoteSchema = createInsertSchema(quotes).omit({
  id: true,
  quoteNumber: true,
  createdAt: true,
}).extend({
  subtotal: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(1),
  marginPercentage: z.coerce.number().min(0).max(1),
  discountAmount: z.coerce.number().min(0),
  totalPrice: z.coerce.number().min(0),
});

export const updateQuoteSchema = insertQuoteSchema.partial().extend({
  id: z.string(),
});

export const insertQuoteLineItemSchema = createInsertSchema(quoteLineItems).omit({
  id: true,
  createdAt: true,
}).extend({
  width: z.coerce.number().positive(),
  height: z.coerce.number().positive(),
  quantity: z.coerce.number().int().positive(),
  linePrice: z.coerce.number().positive(),
  displayOrder: z.coerce.number().int(),
});

export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type UpdateQuote = z.infer<typeof updateQuoteSchema>;
export type Quote = typeof quotes.$inferSelect;
export type InsertQuoteLineItem = z.infer<typeof insertQuoteLineItemSchema>;
export type QuoteLineItem = typeof quoteLineItems.$inferSelect;

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

// Formula Templates table
export const formulaTemplates = pgTable("formula_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull().unique(),
  description: text("description"),
  formula: text("formula").notNull(),
  category: varchar("category", { length: 100 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("formula_templates_name_idx").on(table.name),
  index("formula_templates_category_idx").on(table.category),
]);

export const insertFormulaTemplateSchema = createInsertSchema(formulaTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateFormulaTemplateSchema = insertFormulaTemplateSchema.partial().extend({
  id: z.string(),
});

export type InsertFormulaTemplate = z.infer<typeof insertFormulaTemplateSchema>;
export type UpdateFormulaTemplate = z.infer<typeof updateFormulaTemplateSchema>;
export type FormulaTemplate = typeof formulaTemplates.$inferSelect;

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  quotes: many(quotes),
}));

export const productsRelations = relations(products, ({ many }) => ({
  lineItems: many(quoteLineItems),
  options: many(productOptions),
  variants: many(productVariants),
}));

export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, {
    fields: [productVariants.productId],
    references: [products.id],
  }),
  lineItems: many(quoteLineItems),
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

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  user: one(users, {
    fields: [quotes.userId],
    references: [users.id],
  }),
  lineItems: many(quoteLineItems),
}));

export const quoteLineItemsRelations = relations(quoteLineItems, ({ one }) => ({
  quote: one(quotes, {
    fields: [quoteLineItems.quoteId],
    references: [quotes.id],
  }),
  product: one(products, {
    fields: [quoteLineItems.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [quoteLineItems.variantId],
    references: [productVariants.id],
  }),
}));

// Extended quote type with relations
export type QuoteWithRelations = Quote & {
  user: User;
  lineItems: (QuoteLineItem & {
    product: Product;
    variant?: ProductVariant | null;
  })[];
};

// Email Settings table
export const emailSettings = pgTable("email_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: varchar("provider", { length: 50 }).notNull().default("gmail"), // gmail, sendgrid, smtp, etc.
  fromAddress: varchar("from_address", { length: 255 }).notNull(),
  fromName: varchar("from_name", { length: 255 }).notNull(),

  // OAuth credentials (for Gmail)
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  refreshToken: text("refresh_token"),

  // SMTP credentials (for future use)
  smtpHost: varchar("smtp_host", { length: 255 }),
  smtpPort: integer("smtp_port"),
  smtpUsername: varchar("smtp_username", { length: 255 }),
  smtpPassword: text("smtp_password"),

  isActive: boolean("is_active").default(true).notNull(),
  isDefault: boolean("is_default").default(true).notNull(), // For multiple accounts
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEmailSettingsSchema = createInsertSchema(emailSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  provider: z.enum(["gmail", "sendgrid", "smtp"]).default("gmail"),
  fromAddress: z.string().email("Invalid email address"),
  fromName: z.string().min(1, "From name is required"),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  refreshToken: z.string().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().positive().optional(),
  smtpUsername: z.string().optional(),
  smtpPassword: z.string().optional(),
});

export const updateEmailSettingsSchema = insertEmailSettingsSchema.partial().extend({
  id: z.string(),
});

export type InsertEmailSettings = z.infer<typeof insertEmailSettingsSchema>;
export type UpdateEmailSettings = z.infer<typeof updateEmailSettingsSchema>;
export type EmailSettings = typeof emailSettings.$inferSelect;
