import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================
// MULTI-TENANT ORGANIZATION SYSTEM
// ============================================================

// Organization type enum
export const organizationTypeEnum = pgEnum('organization_type', ['internal', 'external_saas']);

// Organization status enum
export const organizationStatusEnum = pgEnum('organization_status', ['active', 'suspended', 'trial', 'canceled']);

// Organizations table - top-level tenant container
export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(), // URL-friendly identifier
  type: organizationTypeEnum("type").notNull().default('internal'), // internal = single-tenant mode, external_saas = multi-tenant SaaS
  status: organizationStatusEnum("status").notNull().default('active'),
  settings: jsonb("settings").$type<{
    timezone?: string;
    dateFormat?: string;
    currency?: string;
    features?: Record<string, boolean>;
    branding?: {
      logoUrl?: string;
      primaryColor?: string;
      companyName?: string;
    };
  }>().default(sql`'{}'::jsonb`).notNull(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("organizations_slug_idx").on(table.slug),
  index("organizations_status_idx").on(table.status),
  index("organizations_type_idx").on(table.type),
]);

export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  type: z.enum(['internal', 'external_saas']).default('internal'),
  status: z.enum(['active', 'suspended', 'trial', 'canceled']).default('active'),
  slug: z.string().min(3).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
});

export const updateOrganizationSchema = insertOrganizationSchema.partial().extend({
  id: z.string(),
});

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type UpdateOrganization = z.infer<typeof updateOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;

// User-Organization membership role enum
export const orgMemberRoleEnum = pgEnum('org_member_role', ['owner', 'admin', 'manager', 'member']);

// User Organizations join table - links users to organizations with roles
export const userOrganizations = pgTable("user_organizations", {
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  role: orgMemberRoleEnum("role").notNull().default('member'), // Role within this organization
  isDefault: boolean("is_default").notNull().default(false), // User's default/active organization
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.organizationId] }),
  index("user_organizations_user_id_idx").on(table.userId),
  index("user_organizations_organization_id_idx").on(table.organizationId),
  index("user_organizations_is_default_idx").on(table.isDefault),
]);

export const insertUserOrganizationSchema = createInsertSchema(userOrganizations).omit({
  createdAt: true,
  updatedAt: true,
}).extend({
  role: z.enum(['owner', 'admin', 'manager', 'member']).default('member'),
  isDefault: z.boolean().default(false),
});

export const updateUserOrganizationSchema = insertUserOrganizationSchema.partial().extend({
  userId: z.string(),
  organizationId: z.string(),
});

export type InsertUserOrganization = z.infer<typeof insertUserOrganizationSchema>;
export type UpdateUserOrganization = z.infer<typeof updateUserOrganizationSchema>;
export type UserOrganization = typeof userOrganizations.$inferSelect;

// ============================================================
// PRODUCT TYPE SYSTEM - Central definition for all modules
// ============================================================

// Legacy ProductType enum removed - now using database table (productTypes)

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
  role: varchar("role", { length: 50 }).default("employee").notNull(), // owner, admin, manager, employee
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
  role: true,
});

export const updateUserSchema = createInsertSchema(users).pick({
  email: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
  isAdmin: true,
  role: true,
}).partial();

export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type User = typeof users.$inferSelect;

// Media Assets table
export const mediaAssets = pgTable("media_assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  filename: varchar("filename", { length: 255 }).notNull(),
  url: text("url").notNull(),
  uploadedBy: varchar("uploaded_by").notNull().references(() => users.id, { onDelete: 'cascade' }),
  fileSize: integer("file_size").notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
}, (table) => [
  index("media_assets_organization_id_idx").on(table.organizationId),
  index("media_assets_uploaded_by_idx").on(table.uploadedBy),
  index("media_assets_uploaded_at_idx").on(table.uploadedAt),
]);

export const insertMediaAssetSchema = createInsertSchema(mediaAssets).omit({
  id: true,
  uploadedAt: true,
});

export type InsertMediaAsset = z.infer<typeof insertMediaAssetSchema>;
export type MediaAsset = typeof mediaAssets.$inferSelect;

// Product Types table
export const productTypes = pgTable("product_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("product_types_organization_id_idx").on(table.organizationId),
  index("product_types_sort_order_idx").on(table.sortOrder),
]);

export const insertProductTypeSchema = createInsertSchema(productTypes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  sortOrder: z.coerce.number().int().default(0),
});

export const updateProductTypeSchema = insertProductTypeSchema.partial().extend({
  id: z.string(),
});

export type InsertProductType = z.infer<typeof insertProductTypeSchema>;
export type UpdateProductType = z.infer<typeof updateProductTypeSchema>;
export type SelectProductType = typeof productTypes.$inferSelect;

// Products table
export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description").notNull(),
  productTypeId: varchar("product_type_id").references(() => productTypes.id, { onDelete: 'restrict' }),
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
  // Production workflow flag
  requiresProductionJob: boolean("requires_production_job").default(true).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("products_organization_id_idx").on(table.organizationId),
]);

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  pricingFormula: z.string().optional().nullable(),
  sheetWidth: z.coerce.number().positive().optional().nullable(),
  sheetHeight: z.coerce.number().positive().optional().nullable(),
  minPricePerItem: z.coerce.number().positive().optional().nullable(),
  requiresProductionJob: z.boolean().default(true),
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
  requiresProductionJob: z.boolean().optional(),
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
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar("name", { length: 100 }).notNull(),
  value: text("value").notNull(), // Changed from decimal to text to support both numbers and strings
  description: text("description"),
  category: varchar("category", { length: 100 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("global_variables_organization_id_idx").on(table.organizationId),
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
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  quoteNumber: integer("quote_number"),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  customerId: varchar("customer_id").references(() => customers.id, { onDelete: 'set null' }),
  contactId: varchar("contact_id").references(() => customerContacts.id, { onDelete: 'set null' }),
  customerName: varchar("customer_name", { length: 255 }),
  source: varchar("source", { length: 50 }).notNull().default('internal'),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  taxRate: decimal("tax_rate", { precision: 5, scale: 4 }).default("0").notNull(),
  marginPercentage: decimal("margin_percentage", { precision: 5, scale: 4 }).default("0").notNull(),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0").notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("quotes_organization_id_idx").on(table.organizationId),
  index("quotes_user_id_idx").on(table.userId),
  index("quotes_customer_id_idx").on(table.customerId),
  index("quotes_contact_id_idx").on(table.contactId),
  index("quotes_created_at_idx").on(table.createdAt),
  index("quotes_quote_number_idx").on(table.quoteNumber),
  index("quotes_source_idx").on(table.source),
]);

// Quote Line Items table
export const quoteLineItems = pgTable("quote_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  quoteId: varchar("quote_id").notNull().references(() => quotes.id, { onDelete: 'cascade' }),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: 'cascade' }),
  productName: varchar("product_name", { length: 255 }).notNull(),
  variantId: varchar("variant_id").references(() => productVariants.id, { onDelete: 'set null' }),
  variantName: varchar("variant_name", { length: 255 }),
  productType: varchar("product_type", { length: 50 }).notNull().default('wide_roll'),
  width: decimal("width", { precision: 10, scale: 2 }).notNull(),
  height: decimal("height", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").notNull(),
  specsJson: jsonb("specs_json").$type<Record<string, any>>(),
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
  index("quote_line_items_product_type_idx").on(table.productType),
]);

export const insertQuoteSchema = createInsertSchema(quotes).omit({
  id: true,
  quoteNumber: true,
  createdAt: true,
}).extend({
  customerId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  source: z.enum(['internal', 'customer_quick_quote']).default('internal'),
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
  productType: z.string().default('wide_roll'),
  width: z.coerce.number().positive(),
  height: z.coerce.number().positive(),
  quantity: z.coerce.number().int().positive(),
  linePrice: z.coerce.number().positive(),
  displayOrder: z.coerce.number().int(),
  specsJson: z.record(z.any()).optional().nullable(),
});

export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type UpdateQuote = z.infer<typeof updateQuoteSchema>;
export type Quote = typeof quotes.$inferSelect;
export type InsertQuoteLineItem = z.infer<typeof insertQuoteLineItemSchema>;
export type QuoteLineItem = typeof quoteLineItems.$inferSelect;

// Pricing rules table
export const pricingRules = pgTable("pricing_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  ruleValue: jsonb("rule_value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("pricing_rules_organization_id_idx").on(table.organizationId),
]);

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
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  formula: text("formula").notNull(),
  category: varchar("category", { length: 100 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("formula_templates_organization_id_idx").on(table.organizationId),
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

// Organization relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  userOrganizations: many(userOrganizations),
  customers: many(customers),
  products: many(products),
  quotes: many(quotes),
  orders: many(orders),
}));

export const userOrganizationsRelations = relations(userOrganizations, ({ one }) => ({
  user: one(users, {
    fields: [userOrganizations.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [userOrganizations.organizationId],
    references: [organizations.id],
  }),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [products.organizationId],
    references: [organizations.id],
  }),
  lineItems: many(quoteLineItems),
  options: many(productOptions),
  variants: many(productVariants),
  productType: one(productTypes, {
    fields: [products.productTypeId],
    references: [productTypes.id],
  }),
}));

export const productTypesRelations = relations(productTypes, ({ many }) => ({
  products: many(products),
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
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
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
}, (table) => [
  index("email_settings_organization_id_idx").on(table.organizationId),
]);

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

// Audit Logs table
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").references(() => users.id),
  userName: varchar("user_name"),
  actionType: varchar("action_type").notNull(), // CREATE, UPDATE, DELETE, LOGIN, LOGOUT, etc.
  entityType: varchar("entity_type").notNull(), // user, product, quote, customer, etc.
  entityId: varchar("entity_id"),
  entityName: varchar("entity_name"),
  description: text("description").notNull(),
  oldValues: jsonb("old_values"),
  newValues: jsonb("new_values"),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_audit_logs_organization_id").on(table.organizationId),
  index("idx_audit_logs_user_id").on(table.userId),
  index("idx_audit_logs_action_type").on(table.actionType),
  index("idx_audit_logs_entity_type").on(table.entityType),
  index("idx_audit_logs_created_at").on(table.createdAt),
]);

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// Company Settings table
export const companySettings = pgTable("company_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  address: text("address"),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 255 }),
  website: varchar("website", { length: 255 }),
  logoUrl: text("logo_url"),
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).default("0").notNull(),
  defaultMargin: decimal("default_margin", { precision: 5, scale: 2 }).default("0").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("company_settings_organization_id_idx").on(table.organizationId),
]);

export const insertCompanySettingsSchema = createInsertSchema(companySettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateCompanySettingsSchema = insertCompanySettingsSchema.partial();

export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type UpdateCompanySettings = z.infer<typeof updateCompanySettingsSchema>;
export type CompanySettings = typeof companySettings.$inferSelect;

// Customers table
export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  customerType: varchar("customer_type", { length: 50 }).default("business"), // business, individual
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  website: varchar("website", { length: 255 }),
  billingAddress: text("billing_address"),
  shippingAddress: text("shipping_address"),
  taxId: varchar("tax_id", { length: 100 }),
  creditLimit: decimal("credit_limit", { precision: 10, scale: 2 }).default("0"),
  currentBalance: decimal("current_balance", { precision: 10, scale: 2 }).default("0"),
  status: varchar("status", { length: 50 }).default("active"), // active, inactive, suspended
  userId: varchar("user_id").references(() => users.id, { onDelete: 'set null' }), // Link to user account for customer login
  assignedTo: varchar("assigned_to").references(() => users.id),
  notes: text("notes"),
  // QuickBooks sync fields
  externalAccountingId: varchar("external_accounting_id", { length: 64 }),
  syncStatus: varchar("sync_status", { length: 20 }),
  syncError: text("sync_error"),
  syncedAt: timestamp("synced_at", { withTimezone: false }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("customers_organization_id_idx").on(table.organizationId),
  index("customers_user_id_idx").on(table.userId),
  index("customers_email_idx").on(table.email),
]);

export const insertCustomerSchema = createInsertSchema(customers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateCustomerSchema = insertCustomerSchema.partial();

export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type UpdateCustomer = z.infer<typeof updateCustomerSchema>;
export type Customer = typeof customers.$inferSelect;

// Customer Contacts table
export const customerContacts = pgTable("customer_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => customers.id, { onDelete: 'cascade' }),
  firstName: varchar("first_name", { length: 100 }).notNull(),
  lastName: varchar("last_name", { length: 100 }).notNull(),
  title: varchar("title", { length: 100 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  mobile: varchar("mobile", { length: 50 }),
  isPrimary: boolean("is_primary").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCustomerContactSchema = createInsertSchema(customerContacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateCustomerContactSchema = insertCustomerContactSchema.partial();

export type InsertCustomerContact = z.infer<typeof insertCustomerContactSchema>;
export type UpdateCustomerContact = z.infer<typeof updateCustomerContactSchema>;
export type CustomerContact = typeof customerContacts.$inferSelect;

// Customer Notes table
export const customerNotes = pgTable("customer_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => customers.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id),
  note: text("note").notNull(),
  isInternal: boolean("is_internal").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCustomerNoteSchema = createInsertSchema(customerNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateCustomerNoteSchema = insertCustomerNoteSchema.partial();

export type InsertCustomerNote = z.infer<typeof insertCustomerNoteSchema>;
export type UpdateCustomerNote = z.infer<typeof updateCustomerNoteSchema>;
export type CustomerNote = typeof customerNotes.$inferSelect;

// Customer Credit Transactions table
export const customerCreditTransactions = pgTable("customer_credit_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => customers.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id),
  transactionType: varchar("transaction_type", { length: 50 }).notNull(), // charge, payment, adjustment
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  description: text("description").notNull(),
  referenceNumber: varchar("reference_number", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCustomerCreditTransactionSchema = createInsertSchema(customerCreditTransactions).omit({
  id: true,
  createdAt: true,
});

export const updateCustomerCreditTransactionSchema = insertCustomerCreditTransactionSchema.partial();

export type InsertCustomerCreditTransaction = z.infer<typeof insertCustomerCreditTransactionSchema>;
export type UpdateCustomerCreditTransaction = z.infer<typeof updateCustomerCreditTransactionSchema>;
export type CustomerCreditTransaction = typeof customerCreditTransactions.$inferSelect;

// Customer with relations type
export type CustomerWithRelations = Customer & {
  contacts: CustomerContact[];
  notes: (CustomerNote & { user: User })[];
  creditTransactions: (CustomerCreditTransaction & { user: User })[];
  quotes?: Quote[];
  assignedUser?: User | null;
};

// Orders table (Job Management - derived from quotes or standalone)
export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderNumber: varchar("order_number", { length: 50 }).notNull(),
  quoteId: varchar("quote_id").references(() => quotes.id, { onDelete: 'set null' }),
  customerId: varchar("customer_id").notNull().references(() => customers.id, { onDelete: 'restrict' }),
  contactId: varchar("contact_id").references(() => customerContacts.id, { onDelete: 'set null' }),
  status: varchar("status", { length: 50 }).notNull().default("new"), // new, scheduled, in_production, ready_for_pickup, shipped, completed, on_hold, canceled
  priority: varchar("priority", { length: 50 }).notNull().default("normal"), // rush, normal, low
  fulfillmentStatus: varchar("fulfillment_status", { length: 50 }).notNull().default("pending"), // pending, packed, shipped, delivered
  dueDate: timestamp("due_date", { withTimezone: true }),
  promisedDate: timestamp("promised_date", { withTimezone: true }),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull().default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default("0"),
  discount: decimal("discount", { precision: 10, scale: 2 }).notNull().default("0"),
  notesInternal: text("notes_internal"),
  shippingAddress: jsonb("shipping_address").$type<{
    name?: string;
    company?: string;
    address1: string;
    address2?: string;
    city: string;
    state: string;
    zip: string;
    country?: string;
    phone?: string;
  }>(),
  packingSlipHtml: text("packing_slip_html"),
  // QuickBooks sync fields
  externalAccountingId: varchar("external_accounting_id", { length: 64 }),
  syncStatus: varchar("sync_status", { length: 20 }),
  syncError: text("sync_error"),
  syncedAt: timestamp("synced_at", { withTimezone: false }),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("orders_organization_id_idx").on(table.organizationId),
  index("orders_order_number_idx").on(table.orderNumber),
  index("orders_customer_id_idx").on(table.customerId),
  index("orders_status_idx").on(table.status),
  index("orders_fulfillment_status_idx").on(table.fulfillmentStatus),
  index("orders_due_date_idx").on(table.dueDate),
  index("orders_created_at_idx").on(table.createdAt),
  index("orders_created_by_user_id_idx").on(table.createdByUserId),
]);

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  orderNumber: z.string().min(1),
  status: z.enum(["new", "scheduled", "in_production", "ready_for_pickup", "shipped", "completed", "on_hold", "canceled"]).default("new"),
  priority: z.enum(["rush", "normal", "low"]).default("normal"),
  fulfillmentStatus: z.enum(["pending", "packed", "shipped", "delivered"]).default("pending"),
  subtotal: z.coerce.number().min(0),
  tax: z.coerce.number().min(0),
  total: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).default(0),
  shippingAddress: z.object({
    name: z.string().optional(),
    company: z.string().optional(),
    address1: z.string(),
    address2: z.string().optional(),
    city: z.string(),
    state: z.string(),
    zip: z.string(),
    country: z.string().optional(),
    phone: z.string().optional(),
  }).optional().nullable(),
  dueDate: z.preprocess((val) => {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'string') return new Date(val);
    return val;
  }, z.date().nullable().optional()),
  promisedDate: z.preprocess((val) => {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'string') return new Date(val);
    return val;
  }, z.date().nullable().optional()),
});

export const updateOrderSchema = insertOrderSchema.partial().extend({
  id: z.string(),
});

export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type UpdateOrder = z.infer<typeof updateOrderSchema>;
export type Order = typeof orders.$inferSelect;

// Order Line Items table
export const orderLineItems = pgTable("order_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  quoteLineItemId: varchar("quote_line_item_id").references(() => quoteLineItems.id, { onDelete: 'set null' }),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: 'restrict' }),
  productVariantId: varchar("product_variant_id").references(() => productVariants.id, { onDelete: 'set null' }),
  productType: varchar("product_type", { length: 50 }).notNull().default('wide_roll'),
  description: text("description").notNull(), // Snapshot of what we sold
  width: decimal("width", { precision: 10, scale: 2 }),
  height: decimal("height", { precision: 10, scale: 2 }),
  quantity: integer("quantity").notNull(),
  sqft: decimal("sqft", { precision: 10, scale: 2 }),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("queued"), // queued, printing, finishing, done, canceled
  specsJson: jsonb("specs_json").$type<Record<string, any>>(),
  selectedOptions: jsonb("selected_options").$type<Array<{
    optionId: string;
    optionName: string;
    value: string | number | boolean;
    setupCost: number;
    calculatedCost: number;
  }>>().default(sql`'[]'::jsonb`).notNull(),
  nestingConfigSnapshot: jsonb("nesting_config_snapshot").$type<{
    sheetWidth?: number;
    sheetHeight?: number;
    itemsPerSheet?: number;
    totalSheets?: number;
    pricePerSheet?: number;
    formula?: string;
  }>(),
  materialId: varchar("material_id").references(() => materials.id, { onDelete: 'set null' }), // link to primary material
  materialUsageJson: jsonb("material_usage_json").$type<Array<{
    materialId: string;
    materialName: string;
    quantityUsed: number;
    unitOfMeasure: string;
  }>>(), // snapshot of materials used
  requiresInventory: boolean("requires_inventory").notNull().default(true), // flag if inventory tracking is needed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("order_line_items_order_id_idx").on(table.orderId),
  index("order_line_items_product_id_idx").on(table.productId),
  index("order_line_items_status_idx").on(table.status),
  index("order_line_items_product_type_idx").on(table.productType),
]);

export const insertOrderLineItemSchema = createInsertSchema(orderLineItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  productType: z.string().default('wide_roll'),
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().min(0),
  totalPrice: z.coerce.number().min(0),
  width: z.coerce.number().positive().optional().nullable(),
  height: z.coerce.number().positive().optional().nullable(),
  sqft: z.coerce.number().positive().optional().nullable(),
  status: z.enum(["queued", "printing", "finishing", "done", "canceled"]).default("queued"),
  specsJson: z.record(z.any()).optional().nullable(),
});

export const updateOrderLineItemSchema = insertOrderLineItemSchema.partial().extend({
  id: z.string(),
});

export type InsertOrderLineItem = z.infer<typeof insertOrderLineItemSchema>;
export type UpdateOrderLineItem = z.infer<typeof updateOrderLineItemSchema>;
export type OrderLineItem = typeof orderLineItems.$inferSelect;

// Jobs table for production tracking
export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").references(() => orders.id, { onDelete: 'cascade' }), // added for direct order linkage
  orderLineItemId: varchar("order_line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),
  productType: varchar("product_type", { length: 50 }).notNull(),
  statusKey: varchar("status_key", { length: 50 }).notNull().references(() => jobStatuses.key, { onDelete: 'restrict' }), // Changed from status to statusKey with FK
  priority: varchar("priority", { length: 20 }).notNull().default("normal"), // rush, normal, low
  specsJson: jsonb("specs_json").$type<Record<string, any>>(),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: 'set null' }),
  notesInternal: text("notes_internal"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("jobs_order_line_item_id_idx").on(table.orderLineItemId),
  index("jobs_product_type_idx").on(table.productType),
  index("jobs_status_key_idx").on(table.statusKey),
  index("jobs_assigned_to_user_id_idx").on(table.assignedToUserId),
  index("jobs_order_id_idx").on(table.orderId),
]);

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  productType: z.string(),
  statusKey: z.string().min(3).max(50), // Will be validated against configured job statuses at API level
  priority: z.enum(["rush", "normal", "low"]).default("normal"),
  specsJson: z.record(z.any()).optional().nullable(),
});

export const updateJobSchema = insertJobSchema.partial().extend({
  id: z.string(),
});

export type InsertJob = z.infer<typeof insertJobSchema>;
export type UpdateJob = z.infer<typeof updateJobSchema>;
export type Job = typeof jobs.$inferSelect;

// -------------------- Invoicing & Payments (Future QuickBooks Sync Ready) --------------------

// Invoices table
export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  invoiceNumber: integer("invoice_number").notNull(), // Sequential numeric per org
  orderId: varchar("order_id").references(() => orders.id, { onDelete: 'set null' }),
  customerId: varchar("customer_id").notNull().references(() => customers.id, { onDelete: 'restrict' }),
  status: varchar("status", { length: 50 }).notNull().default('draft'), // draft, sent, partially_paid, paid, overdue
  terms: varchar("terms", { length: 50 }).notNull().default('due_on_receipt'), // due_on_receipt, net_15, net_30, net_45, custom
  customTerms: varchar("custom_terms", { length: 255 }),
  issueDate: timestamp("issue_date", { withTimezone: true }).defaultNow().notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default('0'),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull().default('0'),
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default('0'),
  amountPaid: decimal("amount_paid", { precision: 10, scale: 2 }).notNull().default('0'),
  balanceDue: decimal("balance_due", { precision: 10, scale: 2 }).notNull().default('0'),
  notesPublic: text("notes_public"),
  notesInternal: text("notes_internal"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  // QuickBooks / external accounting sync planning fields
  externalAccountingId: varchar("external_accounting_id"),
  syncStatus: varchar("sync_status", { length: 50 }).notNull().default('pending'), // pending, synced, error, skipped
  syncError: text("sync_error"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("invoices_organization_id_idx").on(table.organizationId),
  index("invoices_invoice_number_idx").on(table.invoiceNumber),
  index("invoices_customer_id_idx").on(table.customerId),
  index("invoices_order_id_idx").on(table.orderId),
  index("invoices_status_idx").on(table.status),
  index("invoices_due_date_idx").on(table.dueDate),
  index("invoices_sync_status_idx").on(table.syncStatus),
]);

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  amountPaid: true,
  balanceDue: true,
}).extend({
  invoiceNumber: z.number().int().positive(),
  status: z.enum(['draft','sent','partially_paid','paid','overdue']).default('draft'),
  terms: z.enum(['due_on_receipt','net_15','net_30','net_45','custom']).default('due_on_receipt'),
  customTerms: z.string().max(255).optional().nullable(),
  issueDate: z.preprocess((val) => val ? new Date(val as any) : new Date(), z.date()),
  dueDate: z.preprocess((val) => {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'string') return new Date(val);
    return val;
  }, z.date().nullable().optional()),
  subtotal: z.coerce.number().min(0),
  tax: z.coerce.number().min(0),
  total: z.coerce.number().min(0),
  notesPublic: z.string().optional().nullable(),
  notesInternal: z.string().optional().nullable(),
  syncStatus: z.enum(['pending','synced','error','skipped']).default('pending'),
  syncError: z.string().optional().nullable(),
});

export const updateInvoiceSchema = insertInvoiceSchema.partial().extend({
  id: z.string(),
});

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type UpdateInvoice = z.infer<typeof updateInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// Invoice Line Items snapshot table
export const invoiceLineItems = pgTable("invoice_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  orderLineItemId: varchar("order_line_item_id").references(() => orderLineItems.id, { onDelete: 'set null' }),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: 'restrict' }),
  productVariantId: varchar("product_variant_id").references(() => productVariants.id, { onDelete: 'set null' }),
  productType: varchar("product_type", { length: 50 }).notNull().default('wide_roll'),
  description: text("description").notNull(),
  width: decimal("width", { precision: 10, scale: 2 }),
  height: decimal("height", { precision: 10, scale: 2 }),
  quantity: integer("quantity").notNull(),
  sqft: decimal("sqft", { precision: 10, scale: 2 }),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  specsJson: jsonb("specs_json").$type<Record<string, any>>(),
  selectedOptions: jsonb("selected_options").$type<Array<{
    optionId: string;
    optionName: string;
    value: string | number | boolean;
    setupCost: number;
    calculatedCost: number;
  }>>().default(sql`'[]'::jsonb`).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("invoice_line_items_invoice_id_idx").on(table.invoiceId),
  index("invoice_line_items_product_id_idx").on(table.productId),
]);

export const insertInvoiceLineItemSchema = createInsertSchema(invoiceLineItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().min(0),
  totalPrice: z.coerce.number().min(0),
  width: z.coerce.number().positive().optional().nullable(),
  height: z.coerce.number().positive().optional().nullable(),
  sqft: z.coerce.number().positive().optional().nullable(),
});

export const updateInvoiceLineItemSchema = insertInvoiceLineItemSchema.partial().extend({
  id: z.string(),
});

export type InsertInvoiceLineItem = z.infer<typeof insertInvoiceLineItemSchema>;
export type UpdateInvoiceLineItem = z.infer<typeof updateInvoiceLineItemSchema>;
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;

// Payments table (applied to invoices)
export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  method: varchar("method", { length: 50 }).notNull().default('other'), // cash, check, credit_card, ach, other
  notes: text("notes"),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  externalAccountingId: varchar("external_accounting_id"),
  syncStatus: varchar("sync_status", { length: 50 }).notNull().default('pending'), // pending, synced, error, skipped
  syncError: text("sync_error"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("payments_invoice_id_idx").on(table.invoiceId),
  index("payments_method_idx").on(table.method),
  index("payments_created_by_user_id_idx").on(table.createdByUserId),
  index("payments_sync_status_idx").on(table.syncStatus),
]);

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  syncedAt: true,
}).extend({
  amount: z.coerce.number().positive(),
  method: z.enum(['cash','check','credit_card','ach','other']).default('other'),
  notes: z.string().optional().nullable(),
  syncStatus: z.enum(['pending','synced','error','skipped']).default('pending'),
});

export const updatePaymentSchema = insertPaymentSchema.partial().extend({
  id: z.string(),
});

export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type UpdatePayment = z.infer<typeof updatePaymentSchema>;
export type Payment = typeof payments.$inferSelect;

// -------------------- Shipping & Fulfillment --------------------

// Shipments table (tracks packages sent to customers)
export const shipments = pgTable("shipments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  carrier: varchar("carrier", { length: 100 }).notNull(), // ups, fedex, usps, dhl, other
  trackingNumber: varchar("tracking_number", { length: 255 }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }).defaultNow().notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  notes: text("notes"),
  externalShippingId: varchar("external_shipping_id"), // ShipStation / carrier API ID
  syncStatus: varchar("sync_status", { length: 50 }).notNull().default('pending'), // pending, synced, error, skipped
  syncError: text("sync_error"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("shipments_order_id_idx").on(table.orderId),
  index("shipments_carrier_idx").on(table.carrier),
  index("shipments_tracking_number_idx").on(table.trackingNumber),
  index("shipments_sync_status_idx").on(table.syncStatus),
]);

export const insertShipmentSchema = createInsertSchema(shipments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  syncedAt: true,
}).extend({
  carrier: z.string().min(1),
  trackingNumber: z.string().optional().nullable(),
  shippedAt: z.preprocess((val) => {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return new Date(val);
    return val;
  }, z.date()),
  deliveredAt: z.preprocess((val) => {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'string') return new Date(val);
    return val;
  }, z.date().nullable().optional()),
  notes: z.string().optional().nullable(),
  syncStatus: z.enum(['pending','synced','error','skipped']).default('pending'),
});

export const updateShipmentSchema = insertShipmentSchema.partial().extend({
  id: z.string(),
});

export type InsertShipment = z.infer<typeof insertShipmentSchema>;
export type UpdateShipment = z.infer<typeof updateShipmentSchema>;
export type Shipment = typeof shipments.$inferSelect;

// Append-only job notes & status log tables (no duplicate jobs table)
export const jobNotes = pgTable('job_notes', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  userId: varchar('user_id').references(() => users.id, { onDelete: 'set null' }),
  noteText: text('note_text').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('job_notes_job_id_idx').on(table.jobId),
  index('job_notes_created_at_idx').on(table.createdAt),
]);

export const insertJobNoteSchema = createInsertSchema(jobNotes).omit({
  id: true,
  createdAt: true,
});
export type InsertJobNote = z.infer<typeof insertJobNoteSchema>;
export type JobNote = typeof jobNotes.$inferSelect;

export const jobStatusLog = pgTable('job_status_log', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  oldStatusKey: varchar('old_status_key', { length: 50 }),
  newStatusKey: varchar('new_status_key', { length: 50 }).notNull(),
  userId: varchar('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('job_status_log_job_id_idx').on(table.jobId),
  index('job_status_log_created_at_idx').on(table.createdAt),
]);

export const insertJobStatusLogSchema = createInsertSchema(jobStatusLog).omit({
  id: true,
  createdAt: true,
});
export type InsertJobStatusLog = z.infer<typeof insertJobStatusLogSchema>;
export type JobStatusLog = typeof jobStatusLog.$inferSelect;

// Job Status Configuration - Configurable workflow pipeline
export const jobStatuses = pgTable('job_statuses', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 50 }).notNull(), // pending_prepress, prepress, etc.
  label: varchar('label', { length: 100 }).notNull(), // "Pending Prepress", "Prepress", etc.
  position: integer('position').notNull(), // Column order on board
  badgeVariant: varchar('badge_variant', { length: 50 }).default('default'), // UI variant for badge
  isDefault: boolean('is_default').default(false).notNull(), // Initial status for new jobs
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('job_statuses_organization_id_idx').on(table.organizationId),
  index('job_statuses_position_idx').on(table.position),
  index('job_statuses_key_idx').on(table.key),
  index('job_statuses_is_default_idx').on(table.isDefault),
]);

export const insertJobStatusSchema = createInsertSchema(jobStatuses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  key: z.string().min(3).max(50).regex(/^[a-z_]+$/),
  label: z.string().min(1).max(100),
  position: z.number().int().nonnegative(),
  badgeVariant: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export const updateJobStatusSchema = insertJobStatusSchema.partial().extend({
  id: z.string().uuid(),
});

export type InsertJobStatus = z.infer<typeof insertJobStatusSchema>;
export type UpdateJobStatus = z.infer<typeof updateJobStatusSchema>;
export type JobStatus = typeof jobStatuses.$inferSelect;

// ============================================================
// ARTWORK & FILE HANDLING SYSTEM
// ============================================================

// File role enum - defines purpose of a file attachment
export const fileRoleEnum = pgEnum('file_role', [
  'artwork',       // Production artwork
  'proof',         // Proof/mockup
  'reference',     // Reference file
  'customer_po',   // Customer purchase order
  'setup',         // Setup/template file
  'output',        // Production output/result
  'other'          // Miscellaneous
]);

// File side enum - for sided products (front/back)
export const fileSideEnum = pgEnum('file_side', ['front', 'back', 'na']);

// Order Attachments table - files uploaded by customers or staff
// EXTENDED with artwork metadata (role, side, isPrimary, thumbnailUrl, orderLineItemId)
export const orderAttachments = pgTable("order_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  orderLineItemId: varchar("order_line_item_id").references(() => orderLineItems.id, { onDelete: 'cascade' }), // NEW: Per-line-item attachment
  quoteId: varchar("quote_id").references(() => quotes.id, { onDelete: 'set null' }), // Track if uploaded during quote checkout
  uploadedByUserId: varchar("uploaded_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  uploadedByName: varchar("uploaded_by_name", { length: 255 }), // Snapshot
  fileName: varchar("file_name", { length: 500 }).notNull(),
  fileUrl: text("file_url").notNull(), // GCS path
  fileSize: integer("file_size"), // bytes
  mimeType: varchar("mime_type", { length: 100 }),
  description: text("description"),
  // NEW artwork metadata fields
  role: fileRoleEnum("role").default('other'), // artwork, proof, reference, etc.
  side: fileSideEnum("side").default('na'), // front, back, or n/a
  isPrimary: boolean("is_primary").default(false).notNull(), // Primary artwork for this side/role
  thumbnailUrl: text("thumbnail_url"), // Optional thumbnail for quick preview
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("order_attachments_order_id_idx").on(table.orderId),
  index("order_attachments_order_line_item_id_idx").on(table.orderLineItemId),
  index("order_attachments_quote_id_idx").on(table.quoteId),
  index("order_attachments_role_idx").on(table.role),
]);

export const insertOrderAttachmentSchema = createInsertSchema(orderAttachments).omit({
  id: true,
  createdAt: true,
}).extend({
  role: z.enum(['artwork', 'proof', 'reference', 'customer_po', 'setup', 'output', 'other']).default('other'),
  side: z.enum(['front', 'back', 'na']).default('na'),
  isPrimary: z.boolean().default(false),
});

export const updateOrderAttachmentSchema = insertOrderAttachmentSchema.pick({
  role: true,
  side: true,
  isPrimary: true,
  description: true,
}).partial();

export type InsertOrderAttachment = z.infer<typeof insertOrderAttachmentSchema>;
export type UpdateOrderAttachment = z.infer<typeof updateOrderAttachmentSchema>;
export type OrderAttachment = typeof orderAttachments.$inferSelect;

// Job Files table - links files to production jobs
export const jobFiles = pgTable("job_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  fileId: varchar("file_id").notNull().references(() => orderAttachments.id, { onDelete: 'cascade' }), // Link to order attachment
  role: fileRoleEnum("role").default('artwork'), // production_art, setup_reference, output
  attachedByUserId: varchar("attached_by_user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("job_files_job_id_idx").on(table.jobId),
  index("job_files_file_id_idx").on(table.fileId),
  index("job_files_role_idx").on(table.role),
]);

export const insertJobFileSchema = createInsertSchema(jobFiles).omit({
  id: true,
  createdAt: true,
}).extend({
  role: z.enum(['artwork', 'proof', 'reference', 'customer_po', 'setup', 'output', 'other']).default('artwork'),
});

export type InsertJobFile = z.infer<typeof insertJobFileSchema>;
export type JobFile = typeof jobFiles.$inferSelect;

export type JobWithRelations = Job & {
  order?: Order | null;
  orderLineItem?: OrderLineItem | null;
  customer?: Customer | null;
  contact?: CustomerContact | null;
  assignedUser?: User | null;
  notesLog?: JobNote[];
  statusLog?: JobStatusLog[];
};

// Order with relations type
export type OrderWithRelations = Order & {
  customer: Customer;
  contact?: CustomerContact | null;
  quote?: Quote | null;
  createdByUser: User;
  lineItems: (OrderLineItem & {
    product: Product;
    productVariant?: ProductVariant | null;
  })[];
};

// Order relations
export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  contact: one(customerContacts, {
    fields: [orders.contactId],
    references: [customerContacts.id],
  }),
  quote: one(quotes, {
    fields: [orders.quoteId],
    references: [quotes.id],
  }),
  createdByUser: one(users, {
    fields: [orders.createdByUserId],
    references: [users.id],
  }),
  lineItems: many(orderLineItems),
}));

export const orderLineItemsRelations = relations(orderLineItems, ({ one, many }) => ({
  order: one(orders, {
    fields: [orderLineItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderLineItems.productId],
    references: [products.id],
  }),
  productVariant: one(productVariants, {
    fields: [orderLineItems.productVariantId],
    references: [productVariants.id],
  }),
  quoteLineItem: one(quoteLineItems, {
    fields: [orderLineItems.quoteLineItemId],
    references: [quoteLineItems.id],
  }),
  jobs: many(jobs),
}));

// Jobs relations
export const jobsRelations = relations(jobs, ({ one, many }) => ({
  orderLineItem: one(orderLineItems, {
    fields: [jobs.orderLineItemId],
    references: [orderLineItems.id],
  }),
  assignedToUser: one(users, {
    fields: [jobs.assignedToUserId],
    references: [users.id],
  }),
  files: many(jobFiles), // NEW: Job files relation
}));

// Job Files relations
export const jobFilesRelations = relations(jobFiles, ({ one }) => ({
  job: one(jobs, {
    fields: [jobFiles.jobId],
    references: [jobs.id],
  }),
  file: one(orderAttachments, {
    fields: [jobFiles.fileId],
    references: [orderAttachments.id],
  }),
  attachedByUser: one(users, {
    fields: [jobFiles.attachedByUserId],
    references: [users.id],
  }),
}));

// Order Attachments relations
export const orderAttachmentsRelations = relations(orderAttachments, ({ one, many }) => ({
  order: one(orders, {
    fields: [orderAttachments.orderId],
    references: [orders.id],
  }),
  orderLineItem: one(orderLineItems, {
    fields: [orderAttachments.orderLineItemId],
    references: [orderLineItems.id],
  }),
  quote: one(quotes, {
    fields: [orderAttachments.quoteId],
    references: [quotes.id],
  }),
  uploadedByUser: one(users, {
    fields: [orderAttachments.uploadedByUserId],
    references: [users.id],
  }),
  jobFiles: many(jobFiles), // Files can be attached to multiple jobs
}));

// Order Audit Log table - tracks all state changes, approvals, rejections, etc.
export const orderAuditLog = pgTable("order_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'set null' }),
  userName: varchar("user_name", { length: 255 }), // Snapshot in case user is deleted
  actionType: varchar("action_type", { length: 100 }).notNull(), // status_change, note_added, file_uploaded, approved, rejected, change_requested
  fromStatus: varchar("from_status", { length: 50 }),
  toStatus: varchar("to_status", { length: 50 }),
  note: text("note"),
  metadata: jsonb("metadata").$type<Record<string, any>>(), // Additional context (file IDs, etc.)
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("order_audit_log_order_id_idx").on(table.orderId),
  index("order_audit_log_created_at_idx").on(table.createdAt),
]);

export const insertOrderAuditLogSchema = createInsertSchema(orderAuditLog).omit({
  id: true,
  createdAt: true,
});

export type InsertOrderAuditLog = z.infer<typeof insertOrderAuditLogSchema>;
export type OrderAuditLog = typeof orderAuditLog.$inferSelect;

// Quote workflow states - extend quotes table conceptually
export const quoteWorkflowStates = pgTable("quote_workflow_states", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  quoteId: varchar("quote_id").notNull().references(() => quotes.id, { onDelete: 'cascade' }),
  status: varchar("status", { length: 50 }).notNull().default("draft"), // draft, pending_customer_approval, customer_approved, staff_approved, rejected, converted_to_order
  approvedByCustomerUserId: varchar("approved_by_customer_user_id").references(() => users.id, { onDelete: 'set null' }),
  approvedByStaffUserId: varchar("approved_by_staff_user_id").references(() => users.id, { onDelete: 'set null' }),
  rejectedByUserId: varchar("rejected_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  rejectionReason: text("rejection_reason"),
  customerNotes: text("customer_notes"), // Notes from customer during approval/checkout
  staffNotes: text("staff_notes"), // Internal staff notes
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("quote_workflow_states_quote_id_idx").on(table.quoteId),
  index("quote_workflow_states_status_idx").on(table.status),
]);

export const insertQuoteWorkflowStateSchema = createInsertSchema(quoteWorkflowStates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateQuoteWorkflowStateSchema = insertQuoteWorkflowStateSchema.partial();

export type InsertQuoteWorkflowState = z.infer<typeof insertQuoteWorkflowStateSchema>;
export type UpdateQuoteWorkflowState = z.infer<typeof updateQuoteWorkflowStateSchema>;
export type QuoteWorkflowState = typeof quoteWorkflowStates.$inferSelect;

// ============================================================
// INVENTORY MANAGEMENT SYSTEM
// ============================================================

// Materials table - tracks all inventory items (sheets, rolls, inks, consumables)
export const materials = pgTable("materials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar("name", { length: 255 }).notNull(),
  sku: varchar("sku", { length: 100 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(), // sheet, roll, ink, consumable
  unitOfMeasure: varchar("unit_of_measure", { length: 50 }).notNull(), // sheet, sqft, linear_ft, ml, ea
  width: decimal("width", { precision: 10, scale: 2 }), // nullable for width dimension
  height: decimal("height", { precision: 10, scale: 2 }), // nullable for height dimension
  thickness: decimal("thickness", { precision: 10, scale: 4 }), // nullable for thickness
  color: varchar("color", { length: 100 }), // nullable color specification
  costPerUnit: decimal("cost_per_unit", { precision: 10, scale: 4 }).notNull(),
  stockQuantity: decimal("stock_quantity", { precision: 10, scale: 2 }).notNull().default("0"),
  minStockAlert: decimal("min_stock_alert", { precision: 10, scale: 2 }).notNull().default("0"),
  vendorId: varchar("vendor_id"), // legacy placeholder
  preferredVendorId: varchar("preferred_vendor_id").references(() => vendors.id, { onDelete: 'set null' }),
  vendorSku: varchar("vendor_sku", { length: 150 }),
  vendorCostPerUnit: decimal("vendor_cost_per_unit", { precision: 10, scale: 4 }),
  specsJson: jsonb("specs_json").$type<Record<string, any>>(), // router/ink/material metadata
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("materials_organization_id_idx").on(table.organizationId),
  index("materials_type_idx").on(table.type),
  index("materials_sku_idx").on(table.sku),
  index("materials_stock_quantity_idx").on(table.stockQuantity),
  index("materials_preferred_vendor_id_idx").on(table.preferredVendorId),
]);

export const insertMaterialSchema = createInsertSchema(materials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  type: z.enum(["sheet", "roll", "ink", "consumable"]),
  unitOfMeasure: z.enum(["sheet", "sqft", "linear_ft", "ml", "ea"]),
  costPerUnit: z.coerce.number().nonnegative(),
  stockQuantity: z.coerce.number().nonnegative().default(0),
  minStockAlert: z.coerce.number().nonnegative().default(0),
});

export const updateMaterialSchema = insertMaterialSchema.partial();

export type InsertMaterial = z.infer<typeof insertMaterialSchema>;
export type UpdateMaterial = z.infer<typeof updateMaterialSchema>;
export type Material = typeof materials.$inferSelect;

// Inventory Adjustments table - logs all inventory changes
export const inventoryAdjustments = pgTable("inventory_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  materialId: varchar("material_id").notNull().references(() => materials.id, { onDelete: 'cascade' }),
  type: varchar("type", { length: 50 }).notNull(), // manual_increase, manual_decrease, waste, shrinkage, job_usage
  quantityChange: decimal("quantity_change", { precision: 10, scale: 2 }).notNull(), // positive or negative
  reason: text("reason"),
  orderId: varchar("order_id").references(() => orders.id, { onDelete: 'set null' }), // nullable, for job usage tracking
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("inventory_adjustments_material_id_idx").on(table.materialId),
  index("inventory_adjustments_type_idx").on(table.type),
  index("inventory_adjustments_order_id_idx").on(table.orderId),
  index("inventory_adjustments_created_at_idx").on(table.createdAt),
]);

export const insertInventoryAdjustmentSchema = createInsertSchema(inventoryAdjustments).omit({
  id: true,
  createdAt: true,
}).extend({
  type: z.enum(["manual_increase", "manual_decrease", "waste", "shrinkage", "job_usage", "purchase_receipt"]),
  quantityChange: z.coerce.number(),
});

export type InsertInventoryAdjustment = z.infer<typeof insertInventoryAdjustmentSchema>;
export type InventoryAdjustment = typeof inventoryAdjustments.$inferSelect;

// =============================================
// Vendors & Purchase Orders (MVP)
// =============================================
export const vendors = pgTable('vendors', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  website: varchar('website', { length: 255 }),
  notes: text('notes'),
  paymentTerms: varchar('payment_terms', { length: 50 }).notNull().default('due_on_receipt'),
  defaultLeadTimeDays: integer('default_lead_time_days'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('vendors_organization_id_idx').on(table.organizationId),
  index('vendors_name_idx').on(table.name),
  index('vendors_is_active_idx').on(table.isActive)
]);

export const insertVendorSchema = createInsertSchema(vendors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  paymentTerms: z.enum(['due_on_receipt','net_15','net_30','net_45','custom']).default('due_on_receipt'),
  defaultLeadTimeDays: z.number().int().positive().optional(),
  isActive: z.boolean().optional().default(true),
});
export const updateVendorSchema = insertVendorSchema.partial();
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type UpdateVendor = z.infer<typeof updateVendorSchema>;
export type Vendor = typeof vendors.$inferSelect;

export const purchaseOrders = pgTable('purchase_orders', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  poNumber: varchar('po_number', { length: 50 }).notNull(),
  vendorId: varchar('vendor_id').notNull().references(() => vendors.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 30 }).notNull().default('draft'),
  issueDate: timestamp('issue_date').notNull(),
  expectedDate: timestamp('expected_date'),
  receivedDate: timestamp('received_date'),
  notes: text('notes'),
  subtotal: decimal('subtotal', { precision: 10, scale: 2 }).notNull().default('0'),
  taxTotal: decimal('tax_total', { precision: 10, scale: 2 }).notNull().default('0'),
  shippingTotal: decimal('shipping_total', { precision: 10, scale: 2 }).notNull().default('0'),
  grandTotal: decimal('grand_total', { precision: 10, scale: 2 }).notNull().default('0'),
  createdByUserId: varchar('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('purchase_orders_organization_id_idx').on(table.organizationId),
  index('purchase_orders_vendor_id_idx').on(table.vendorId),
  index('purchase_orders_status_idx').on(table.status),
  index('purchase_orders_issue_date_idx').on(table.issueDate),
]);

export const purchaseOrderLineItems = pgTable('purchase_order_line_items', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  purchaseOrderId: varchar('purchase_order_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  materialId: varchar('material_id').references(() => materials.id, { onDelete: 'set null' }),
  description: varchar('description', { length: 255 }).notNull(),
  vendorSku: varchar('vendor_sku', { length: 150 }),
  quantityOrdered: decimal('quantity_ordered', { precision: 10, scale: 2 }).notNull(),
  quantityReceived: decimal('quantity_received', { precision: 10, scale: 2 }).notNull().default('0'),
  unitCost: decimal('unit_cost', { precision: 10, scale: 4 }).notNull(),
  lineTotal: decimal('line_total', { precision: 10, scale: 4 }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('purchase_order_line_items_po_id_idx').on(table.purchaseOrderId),
  index('purchase_order_line_items_material_id_idx').on(table.materialId),
]);

export const insertPurchaseOrderLineItemSchema = createInsertSchema(purchaseOrderLineItems).omit({
  id: true,
  purchaseOrderId: true,
  lineTotal: true,
  createdAt: true,
  updatedAt: true,
  quantityReceived: true,
}).extend({
  quantityOrdered: z.coerce.number().positive(),
  unitCost: z.coerce.number().nonnegative(),
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  poNumber: true,
  status: true,
  subtotal: true,
  taxTotal: true,
  shippingTotal: true,
  grandTotal: true,
  createdByUserId: true,
}).extend({
  issueDate: z.string().or(z.coerce.date()),
  expectedDate: z.string().optional().or(z.coerce.date().optional()),
  lineItems: z.array(insertPurchaseOrderLineItemSchema).min(1),
});
export const updatePurchaseOrderSchema = insertPurchaseOrderSchema.partial().extend({
  status: z.enum(['draft','sent','partially_received','received','cancelled']).optional(),
});
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type UpdatePurchaseOrder = z.infer<typeof updatePurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderLineItem = typeof purchaseOrderLineItems.$inferSelect;

// Order Material Usage table - tracks which materials were used for each order line item
export const orderMaterialUsage = pgTable("order_material_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  orderLineItemId: varchar("order_line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),
  materialId: varchar("material_id").notNull().references(() => materials.id, { onDelete: 'restrict' }),
  quantityUsed: decimal("quantity_used", { precision: 10, scale: 2 }).notNull(),
  unitOfMeasure: varchar("unit_of_measure", { length: 50 }).notNull(),
  calculatedBy: varchar("calculated_by", { length: 50 }).notNull().default("auto"), // auto or manual
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("order_material_usage_order_id_idx").on(table.orderId),
  index("order_material_usage_order_line_item_id_idx").on(table.orderLineItemId),
  index("order_material_usage_material_id_idx").on(table.materialId),
]);

export const insertOrderMaterialUsageSchema = createInsertSchema(orderMaterialUsage).omit({
  id: true,
  createdAt: true,
}).extend({
  quantityUsed: z.coerce.number().positive(),
  calculatedBy: z.enum(["auto", "manual"]).default("auto"),
});

export type InsertOrderMaterialUsage = z.infer<typeof insertOrderMaterialUsageSchema>;
export type OrderMaterialUsage = typeof orderMaterialUsage.$inferSelect;

// Relations for invoicing & payments
export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  customer: one(customers, {
    fields: [invoices.customerId],
    references: [customers.id],
  }),
  order: one(orders, {
    fields: [invoices.orderId],
    references: [orders.id],
  }),
  createdByUser: one(users, {
    fields: [invoices.createdByUserId],
    references: [users.id],
  }),
  lineItems: many(invoiceLineItems),
  payments: many(payments),
}));

export const invoiceLineItemsRelations = relations(invoiceLineItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceLineItems.invoiceId],
    references: [invoices.id],
  }),
  orderLineItem: one(orderLineItems, {
    fields: [invoiceLineItems.orderLineItemId],
    references: [orderLineItems.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(invoices, {
    fields: [payments.invoiceId],
    references: [invoices.id],
  }),
  createdByUser: one(users, {
    fields: [payments.createdByUserId],
    references: [users.id],
  }),
}));

export const shipmentsRelations = relations(shipments, ({ one }) => ({
  order: one(orders, {
    fields: [shipments.orderId],
    references: [orders.id],
  }),
  createdByUser: one(users, {
    fields: [shipments.createdByUserId],
    references: [users.id],
  }),
}));

// Inventory management relations
export const materialsRelations = relations(materials, ({ many }) => ({
  adjustments: many(inventoryAdjustments),
  orderUsages: many(orderMaterialUsage),
}));

export const inventoryAdjustmentsRelations = relations(inventoryAdjustments, ({ one }) => ({
  material: one(materials, {
    fields: [inventoryAdjustments.materialId],
    references: [materials.id],
  }),
  order: one(orders, {
    fields: [inventoryAdjustments.orderId],
    references: [orders.id],
  }),
  user: one(users, {
    fields: [inventoryAdjustments.userId],
    references: [users.id],
  }),
}));

export const orderMaterialUsageRelations = relations(orderMaterialUsage, ({ one }) => ({
  order: one(orders, {
    fields: [orderMaterialUsage.orderId],
    references: [orders.id],
  }),
  orderLineItem: one(orderLineItems, {
    fields: [orderMaterialUsage.orderLineItemId],
    references: [orderLineItems.id],
  }),
  material: one(materials, {
    fields: [orderMaterialUsage.materialId],
    references: [materials.id],
  }),
}));

// ==================== QuickBooks Integration ====================

export const accountingProviderEnum = pgEnum('accounting_provider', ['quickbooks']);
export const syncDirectionEnum = pgEnum('sync_direction', ['push', 'pull']);
export const syncStatusEnum = pgEnum('sync_status_enum', ['pending', 'processing', 'synced', 'error', 'skipped']);
export const syncResourceEnum = pgEnum('sync_resource', ['customers', 'invoices', 'orders']);

export const oauthConnections = pgTable('oauth_connections', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  provider: accountingProviderEnum('provider').notNull(),
  companyId: varchar('company_id', { length: 64 }).notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: timestamp('token_expires_at'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('oauth_connections_organization_id_idx').on(table.organizationId),
  index('oauth_connections_provider_idx').on(table.provider),
]);

export const accountingSyncJobs = pgTable('accounting_sync_jobs', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  provider: accountingProviderEnum('provider').notNull(),
  resourceType: syncResourceEnum('resource_type').notNull(),
  direction: syncDirectionEnum('direction').notNull(),
  status: syncStatusEnum('status').notNull().default('pending'),
  error: text('error'),
  payloadJson: jsonb('payload_json'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('sync_jobs_organization_id_idx').on(table.organizationId),
  index('sync_jobs_status_idx').on(table.status),
  index('sync_jobs_resource_direction_idx').on(table.resourceType, table.direction),
]);

export type OAuthConnection = typeof oauthConnections.$inferSelect;
export type InsertOAuthConnection = typeof oauthConnections.$inferInsert;
export type AccountingSyncJob = typeof accountingSyncJobs.$inferSelect;
export type InsertAccountingSyncJob = typeof accountingSyncJobs.$inferInsert;
