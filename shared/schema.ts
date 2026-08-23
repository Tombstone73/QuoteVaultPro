import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  date,
  decimal,
  index,
  uniqueIndex,
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
import { normalizeOptionalWebsite } from "./vendorWebsite";
import { PRICING_PROFILE_KEYS, type FlatGoodsConfig } from "./pricingProfiles";
import {
  inventoryMovementTypeValues,
  materialReorderRequestStatusValues,
} from "./materialInventory";
import { MATERIAL_WEIGHT_BASES, MATERIAL_WEIGHT_UNITS } from "./materialWeight";
import { normalizeMaterialVendorProductUrl } from "./materialVendorPurchasing";
import { MATERIAL_PURCHASE_UNITS, normalizeMaterialPurchaseUnit } from "./materialVendorCost";
import { calculateUsableRollCapacity, MATERIAL_FORMS, MATERIAL_INVENTORY_UNITS, normalizeMaterialUnit } from "./materialUnits";
import {
  workflowStatusPillAssignmentSourceSchema,
  workflowStatusPillTriggerSchema,
} from "./orderStatusWorkflowAutomation";
import {
  type AiReviewKind,
  aiReviewKindValues,
  type AiReviewStatus,
  aiReviewStatusValues,
  type AiSeverityLevel,
  aiSeverityLevelValues,
  type BugAiReviewResult,
  type RevenueRisk,
  revenueRiskValues,
  type SuggestedOwner,
  suggestedOwnerValues,
  type WorkflowImpact,
  workflowImpactValues,
} from "./aiReviewContracts";
import {
  type AiTriageBriefResult,
  triageBriefStatusValues,
} from "./aiTriageBriefContracts";
import {
  aiFeatureValues,
  aiModeValues,
  aiProviderValues,
  type AiFeature,
  type AiMode,
  type AiProvider,
} from "./aiFoundationContracts";
import {
  assistantConversationStatusValues,
  assistantExecutionPlanStatusValues,
  assistantExecutionStepStatusValues,
  assistantIdempotencyStatusValues,
  assistantMessageRoleValues,
  assistantToolExecutionStatusValues,
  assistantTurnStatusValues,
  type AssistantContextEnvelope,
  type AssistantConversationStatus,
  type AssistantExecutionPlanStatus,
  type AssistantMessageRole,
  type AssistantStructuredCard,
  type AssistantTurnStatus,
} from "./assistantContracts";
import type { ReportDefinition } from "./aiReportingContracts";

// ============================================================
// DOWNLOAD INTENT (Future-proofing for preflight/print variants)
// ============================================================

/**
 * DownloadIntent determines which file variant to download.
 * 
 * - "original": Original uploaded file (current default behavior)
 * - "print": Print-ready file (preflighted, color-corrected)
 * - "proof": Client-facing proof/preview file
 * - "preferred": Auto-select best available (print > proof > original)
 * 
 * TODO: When file variants are implemented, wire up resolution logic.
 * For now, all intents resolve to the original file.
 */
export type DownloadIntent = "original" | "print" | "proof" | "preferred";

export const downloadIntentSchema = z.enum(["original", "print", "proof", "preferred"]).default("original");

export const lineItemWorkflowStateValues = [
  "new",
  "needs_design",
  "in_design",
  "awaiting_proof_approval",
  "ready_for_prepress",
  "in_prepress",
  "ready_for_production",
  "in_production",
  "completed",
  "on_hold",
  "canceled",
] as const;

export const lineItemWorkflowStateSchema = z.enum(lineItemWorkflowStateValues);
export type LineItemWorkflowState = (typeof lineItemWorkflowStateValues)[number];

export const lineItemDesignStatusValues = [
  "needs_design",
  "in_design",
  "design_complete",
] as const;

export const lineItemDesignStatusSchema = z.enum(lineItemDesignStatusValues);
export type LineItemDesignStatus = (typeof lineItemDesignStatusValues)[number];

export const productDesignPricingModeValues = [
  "none",
  "flat_fee",
  "included_minutes_plus_overage",
  "hourly",
  "manual_quote",
] as const;

export const productDesignPricingModeSchema = z.enum(productDesignPricingModeValues);
export type ProductDesignPricingMode = (typeof productDesignPricingModeValues)[number];

export const lineItemDesignBriefStatusValues = [
  "not_required",
  "required_missing",
  "captured",
] as const;

export const lineItemDesignBriefStatusSchema = z.enum(lineItemDesignBriefStatusValues);
export type LineItemDesignBriefStatus = (typeof lineItemDesignBriefStatusValues)[number];

export const orderLineItemNoteCategoryValues = [
  "internal",
  "design_working",
] as const;

export const orderLineItemNoteCategorySchema = z.enum(orderLineItemNoteCategoryValues);
export type OrderLineItemNoteCategory = (typeof orderLineItemNoteCategoryValues)[number];

export const designCostStateValues = [
  "not_applicable",
  "estimated",
  "accrued",
  "finalized",
] as const;

export const designCostStateSchema = z.enum(designCostStateValues);
export type DesignCostState = (typeof designCostStateValues)[number];

export const lineItemDesignBillingStatusValues = [
  "not_billable",
  "candidate",
  "approved_for_invoice",
  "invoiced",
  "waived",
] as const;

export const lineItemDesignBillingStatusSchema = z.enum(lineItemDesignBillingStatusValues);
export type LineItemDesignBillingStatus = (typeof lineItemDesignBillingStatusValues)[number];

// ============================================================
// MULTI-TENANT ORGANIZATION SYSTEM
// ============================================================

// Organization type enum
export const organizationTypeEnum = pgEnum('organization_type', ['internal', 'external_saas']);

// Organization status enum
export const organizationStatusEnum = pgEnum('organization_status', ['active', 'suspended', 'trial', 'canceled']);

// Quote status enum
export const quoteStatusEnum = pgEnum('quote_status', ['draft', 'pending_approval', 'pending', 'active', 'canceled']);

export const userAccountTypeEnum = pgEnum('user_account_type', ['INTERNAL_USER', 'PORTAL_CUSTOMER']);

export const customerPortalAccessStatusEnum = pgEnum('customer_portal_access_status', [
  'DISABLED',
  'PENDING_INVITE',
  'ACTIVE',
  'SUSPENDED',
]);

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
    preferences?: {
      fileUploadNaming?: {
        fileUploadJobPrefixMode?: 'none' | 'numeric_only' | 'full_job_number';
        prepressFileLabelMode?: 'optional' | 'required';
      };
      orders?: {
        billingReadyPolicy?: 'all_line_items_done' | 'manual' | 'none';
      };
      proofing?: {
        proofApprovalLockEnabled?: boolean;
        policy?: 'automatic' | 'manual_requested_only';
        defaultProofDisclaimerText?: string;
      };
      fulfillment?: {
        pickupRetentionDaysAfterPickedUp?: number;
        verificationPolicy?: 'strict_separate_verification' | 'packing_completes_fulfillment';
      };
      billingInvoiceTriggerPolicy?:
        | 'manual_only'
        | 'order_entry'
        | 'quote_approval'
        | 'proof_approval'
        | 'production_complete'
        | 'ready_for_pickup_or_ready_to_ship'
        | 'picked_up_or_shipped';
    };
    branding?: {
      logoUrl?: string;
      primaryColor?: string;
      companyName?: string;
    };
    emailTemplates?: {
      replyToEmail?: string;
      quoteEmailSubject?: string;
      quoteEmailBody?: string;
      invoiceEmailSubject?: string;
      invoiceEmailBody?: string;
    };
    setupStatus?: "DRAFT_REQUEST" | "ORGANIZATION_CREATED" | "CONFIGURATION_COPYING" | "READY" | "COPY_FAILED";
    setupCopyJobId?: string;
  }>().default(sql`'{}'::jsonb`).notNull(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  // Tax system fields
  defaultTaxRate: decimal("default_tax_rate", { precision: 5, scale: 4 }).default("0").notNull(),
  taxEnabled: boolean("tax_enabled").default(true).notNull(),
  // PBV2 activation governance
  pbv2ActivationMode: varchar("pbv2_activation_mode", { length: 20 })
    .$type<'auto_on_save' | 'manual_publish'>()
    .default('auto_on_save')
    .notNull(),
  // Prepress default system (migration 0051)
  prepressDefaultEnabled: boolean("prepress_default_enabled").notNull().default(true),
  // Soft delete lifecycle tracking
  deleteState: text("delete_state").notNull().default('active'), // 'active' | 'pending_delete' | 'soft_deleted'
  deleteRequestedAt: timestamp("delete_requested_at", { withTimezone: true }),
  deleteRequestedByUserId: varchar("delete_requested_by_user_id").references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  deleteConfirmedAt: timestamp("delete_confirmed_at", { withTimezone: true }),
  deleteConfirmedByUserId: varchar("delete_confirmed_by_user_id").references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByUserId: varchar("deleted_by_user_id").references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  deleteReason: text("delete_reason"),
  deletedIp: text("deleted_ip"),
  deletedUserAgent: text("deleted_user_agent"),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedByUserId: varchar("archived_by_user_id").references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("organizations_slug_idx").on(table.slug),
  index("organizations_status_idx").on(table.status),
  index("organizations_type_idx").on(table.type),
  index("organizations_delete_state_idx").on(table.deleteState),
  index("organizations_delete_requested_at_idx").on(table.deleteRequestedAt),
  index("organizations_is_archived_idx").on(table.isArchived),
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

export const organizationConfigurationCopyJobs = pgTable("organization_configuration_copy_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceOrganizationId: varchar("source_organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  destinationOrganizationId: varchar("destination_organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 32 })
    .$type<"pending" | "copying" | "completed" | "failed">()
    .notNull()
    .default("pending"),
  requestedByUserId: varchar("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  entityCounts: jsonb("entity_counts").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
  warnings: jsonb("warnings").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  errorSummary: text("error_summary"),
  errorDetails: jsonb("error_details").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("org_config_copy_jobs_source_idx").on(table.sourceOrganizationId),
  index("org_config_copy_jobs_destination_idx").on(table.destinationOrganizationId),
  index("org_config_copy_jobs_status_idx").on(table.status),
  index("org_config_copy_jobs_created_at_idx").on(table.createdAt),
]);

export type OrganizationConfigurationCopyJob = typeof organizationConfigurationCopyJobs.$inferSelect;
export type InsertOrganizationConfigurationCopyJob = typeof organizationConfigurationCopyJobs.$inferInsert;

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

// User storage table (profile data only - credentials in auth_identities)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  accountType: userAccountTypeEnum("account_type").notNull().default('INTERNAL_USER'),
  passwordHash: text("password_hash"), // DEPRECATED: Use auth_identities.password_hash instead. Will be removed in v1.1.
  isAdmin: boolean("is_admin").default(false).notNull(),
  isPlatformAdmin: boolean("is_platform_admin").default(false).notNull(),
  isPlatformDeveloper: boolean("is_platform_developer").default(false).notNull(),
  role: varchar("role", { length: 50 }).default("employee").notNull(), // owner, admin, manager, employee
  mustSetPassword: boolean("must_set_password").default(false).notNull(), // True if invited with temp password, must set new password on first login
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  lastActiveOrgId: varchar("last_active_org_id").references((): AnyPgColumn => organizations.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Auth identities table - stores authentication credentials separately from user profiles
export const authIdentities = pgTable("auth_identities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar("provider").notNull(), // 'password', 'google', etc.
  passwordHash: text("password_hash"), // Only for provider='password'
  passwordSetAt: timestamp("password_set_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("auth_identities_user_provider_unique").on(table.userId, table.provider),
  index("auth_identities_user_id_idx").on(table.userId),
  index("auth_identities_provider_idx").on(table.provider),
]);

// Password reset tokens table - for forgot/reset password flow
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text("token_hash").notNull(), // SHA256 hash of token
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("password_reset_tokens_token_hash_unique").on(table.tokenHash),
  index("password_reset_tokens_user_id_idx").on(table.userId),
  index("password_reset_tokens_expires_at_idx").on(table.expiresAt),
]);

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

// Server-side only: for bootstrap scripts and admin password management
// NEVER expose this schema to public client-facing APIs
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  email: z.string().email().min(1, "Email is required"),
  passwordHash: z.string().optional(), // Optional: null for OAuth users, required for standard auth
  role: z.enum(['owner', 'admin', 'manager', 'employee']).default('employee'),
  isAdmin: z.boolean().default(false),
});

export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Auth identity schemas
export const insertAuthIdentitySchema = createInsertSchema(authIdentities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  provider: z.enum(['password', 'google']),
  passwordHash: z.string().optional(),
});

export const updateAuthIdentitySchema = insertAuthIdentitySchema.partial().extend({
  id: z.string(),
});

export type InsertAuthIdentity = z.infer<typeof insertAuthIdentitySchema>;
export type UpdateAuthIdentity = z.infer<typeof updateAuthIdentitySchema>;
export type AuthIdentity = typeof authIdentities.$inferSelect;

// Password reset token schemas
export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({
  id: true,
  createdAt: true,
});

export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

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
  organizationId: true,
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
  // Production routing defaults
  defaultStationKey: varchar("default_station_key", { length: 40 }),
  defaultStepKey: varchar("default_step_key", { length: 40 }),
  sendToProductionDefault: boolean("send_to_production_default").notNull().default(false),
  // Prepress override (migration 0051): null=inherit org default, true=force, false=skip
  requiresPrepressOverride: boolean("requires_prepress_override"),
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
  organizationId: true,
}).extend({
  sortOrder: z.coerce.number().int().default(0),
  defaultStationKey: z.string().max(40).nullish(),
  defaultStepKey: z.string().max(40).nullish(),
  sendToProductionDefault: z.boolean().default(false),
  requiresPrepressOverride: z.boolean().nullish(),
});

export const updateProductTypeSchema = insertProductTypeSchema.partial().extend({
  id: z.string(),
});

export type InsertProductType = z.infer<typeof insertProductTypeSchema>;
export type UpdateProductType = z.infer<typeof updateProductTypeSchema>;
export type SelectProductType = typeof productTypes.$inferSelect;

// ============================================================
// PRICING FORMULAS LIBRARY
// ============================================================

// Pricing Formulas table - reusable pricing definitions
export const pricingFormulas = pgTable("pricing_formulas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),

  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 100 }), // optional slug / short key
  description: text("description"),

  // Which calculator profile this formula uses, e.g. "flat_goods", "qty_only", etc.
  pricingProfileKey: varchar("pricing_profile_key", { length: 100 }).notNull(),

  // Optional raw expression for simple formulas (sqft * p * q, etc.)
  expression: text("expression"),

  // Calculator-specific config (sheet sizes, rotation flags, min sheets, etc.)
  config: jsonb("config").$type<FlatGoodsConfig | Record<string, any>>(),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("pricing_formulas_org_id_idx").on(table.organizationId),
  index("pricing_formulas_code_org_idx").on(table.organizationId, table.code),
]);

export const insertPricingFormulaSchema = createInsertSchema(pricingFormulas).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
}).extend({
  pricingProfileKey: z.enum(PRICING_PROFILE_KEYS as [string, ...string[]]),
  expression: z.string().optional().nullable(),
  config: z.record(z.any()).optional().nullable(),
});

export const updatePricingFormulaSchema = insertPricingFormulaSchema.partial();

export type InsertPricingFormula = z.infer<typeof insertPricingFormulaSchema>;
export type UpdatePricingFormula = z.infer<typeof updatePricingFormulaSchema>;
export type PricingFormula = typeof pricingFormulas.$inferSelect;

// ============================================================
// V2 FORMULA DOMAIN
// ============================================================
// `pricing_formulas` remains the V1 compatibility source. New V2 Formula
// authoring is identity -> immutable revision; Products bind a revision.
export const formulaVisibility = pgEnum("v2_formula_visibility", ["product_scoped", "library"]);
export const formulaStatus = pgEnum("v2_formula_status", ["active", "inactive", "archived"]);

export const v2FormulaIdentities = pgTable("v2_formula_identities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  normalizedName: varchar("normalized_name", { length: 255 }).notNull(),
  description: text("description"),
  visibility: formulaVisibility("visibility").notNull().default("product_scoped"),
  status: formulaStatus("status").notNull().default("active"),
  currentRevisionId: varchar("current_revision_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (table) => [index("v2_formula_identities_catalog_idx").on(table.organizationId, table.status, table.visibility, table.normalizedName)]);

export const v2FormulaRevisions = pgTable("formula_revisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  formulaId: varchar("formula_id").notNull(),
  revisionNumber: integer("revision_number").notNull(),
  expression: text("expression").notNull(),
  declaredInputs: jsonb("declared_inputs").notNull(),
  validationEvidence: jsonb("validation_evidence").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (table) => [index("formula_revisions_formula_idx").on(table.organizationId, table.formulaId, table.revisionNumber)]);

// ============================================================
// PRODUCTS
// ============================================================

// Line item material usage tracking - supports multiple materials per line item
export type LineItemMaterialUsage = {
  materialId: string;
  unitType: "sheet" | "sqft" | "linear_ft";
  quantity: number;
};

// Product option type for inline options stored as JSON with enhanced sub-options support
export type ProductOptionItem = {
  id: string;
  label: string;
  type: "checkbox" | "quantity" | "toggle" | "select" | "attachment";
  priceMode: "flat" | "per_qty" | "per_sqft" | "percent_of_base" | "flat_per_item";
  amount?: number;
  percentBase?: "media" | "line"; // For percent_of_base mode: "media" = percent of media cost only, "line" = percent of full line (default)
  defaultSelected?: boolean; // Controls whether this option is selected by default on new line items
  /** Preferred boolean default for checkbox/toggle. Backward compatible with defaultSelected. */
  defaultChecked?: boolean;
  /** Preferred numeric default for quantity options. */
  defaultQty?: number;
  /** Optional quantity constraints (UI/runtime). */
  min?: number;
  max?: number;
  step?: number;
  sortOrder?: number; // Controls display order in calculator/quote UI
  // Grouping metadata (stored in optionsJson)
  groupKey?: string; // internal, stable group key (e.g., "finish_opt")
  groupLabel?: string; // customer-facing group label (e.g., "Finishing Options")
  group?: string; // legacy group string (backward compatibility)
  // UI/editor metadata (stored in optionsJson)
  required?: boolean;
  defaultValue?: string | number | boolean;
  choices?: Array<{
    /** Stable identifier for editor + drag/drop. Stored in optionsJson (no DB schema change). */
    id?: string;
    value: string;
    label: string;
    requiresNote?: boolean;
    noteLabel?: string;
    notePlaceholder?: string;
  }>;
  ui?: {
    visible?: boolean;
    showPrice?: boolean;
  };
  layout?: {
    layoutSpan?: 1 | 2 | 3;
    minWidth?: number;
  };
  children?: Array<{
    label: string;
    type: "boolean" | "number" | "select" | "segmented" | "text";
    selectionKey: string;
    defaultValue?: string | number | boolean;
    required?: boolean;
    choices?: Array<{
      /** Stable identifier for editor + drag/drop. Stored in optionsJson (no DB schema change). */
      id?: string;
      value: string;
      label: string;
      requiresNote?: boolean;
      noteLabel?: string;
      notePlaceholder?: string;
    }>;
    visibleWhen?:
      | { key: string; when: "truthy" }
      | { key: string; when: "equals"; value: string | number | boolean };
    layout?: {
      layoutSpan?: 1 | 2 | 3;
      minWidth?: number;
    };
    inline?: boolean;
  }>;
  config?: {
    kind: "grommets" | "sides" | "thickness" | "hems" | "pole_pockets" | "generic";
    // For grommets
    locations?: Array<"all_corners" | "top_corners" | "top_even" | "custom">;
    defaultLocation?: "all_corners" | "top_corners" | "top_even" | "custom";
    defaultSpacingCount?: number; // For top_even
    defaultSpacingInches?: number; // e.g., 12, 24 - for banner grommets with inch-based spacing
    spacingOptions?: number[]; // e.g., [12, 24] for 12" and 24" spacing options
    customNotes?: string; // For custom
    // For sides toggle
    singleLabel?: string;
    doubleLabel?: string;
    defaultSide?: "single" | "double"; // Default selection for sides
    doublePriceMultiplier?: number; // e.g., 1.6x (only used when pricingMode = "multiplier")
    pricingMode?: "multiplier" | "volume"; // Default is "multiplier" for backward compatibility
    volumeTiers?: Array<{
      minSheets: number;
      maxSheets: number | null; // null means "infinity"
      singlePricePerSheet: number;
      doublePricePerSheet: number;
    }>;
    // For thickness selector
    defaultThicknessKey?: string;
    thicknessVariants?: Array<{
      key: string; // internal identifier (e.g., "4mm", "10mm")
      label: string; // display name
      materialId: string; // reference to materials table
      pricingMode: "multiplier" | "volume";
      priceMultiplier?: number; // for multiplier mode
      volumeTiers?: Array<{
        minSheets: number;
        maxSheets: number | null;
        pricePerSheet: number;
      }>;
    }>;
    // For hems (banner finishing)
    hemsChoices?: string[]; // e.g., ["none", "all_sides", "top_bottom", "left_right"]
    defaultHems?: "none" | "all_sides" | "top_bottom" | "left_right";
    // For pole pockets (banner finishing)
    polePocketChoices?: string[]; // e.g., ["none", "top", "bottom", "top_bottom"]
    defaultPolePocket?: "none" | "top" | "bottom" | "top_bottom";
  };
  // Sub-config for nested options (e.g., grommets sub-options)
  subConfig?: {
    type: "grommets" | "hemming" | "custom";
    config: any; // Structure depends on type
  };
  // Material add-on configuration - for options that consume additional materials (e.g., laminate)
  materialAddonConfig?: {
    materialId: string; // Material to consume (e.g., laminate roll)
    usageBasis: "same_area" | "same_sheets"; // How to calculate usage
    unitType: "sqft" | "sheet"; // How to record usage
    wasteFactor?: number; // Optional waste percentage (0.05 = 5% extra)
  };
};

// Products table
export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar("name", { length: 255 }).notNull(),
  // Short, tenant-editable operator label. Customer-facing documents continue
  // to use `name`; this alias is only consumed by production-facing adapters.
  shopName: varchar("shop_name", { length: 120 }),
  description: text("description").notNull(),
  aiParsingDescription: text("ai_parsing_description"),
  aiParsingDescriptionLinkedToDescription: boolean("ai_parsing_description_linked_to_description").default(false).notNull(),
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
  // NEW: Pricing mode - determines how pricing is calculated
  pricingMode: varchar("pricing_mode", { length: 32 }).$type<"area" | "quantity" | "flat">().default("area").notNull(),
  // Controls customer-entered order measurements independently from PBV2 pricing configuration.
  measurementMode: varchar("measurement_mode", { length: 32 }).$type<"dimensions_required" | "quantity_only">().default("dimensions_required").notNull(),
  // Product-level operational intent; independent from measurement and pricing.
  workflowIntent: varchar("workflow_intent", { length: 32 }).$type<"standard_production" | "fulfillment_only" | "service_fee">().default("standard_production").notNull(),
  // An explicit opt-in is required to sell a zero-priced item without a warning.
  allowZeroPrice: boolean("allow_zero_price").default(false).notNull(),
  // NEW: Service/fee flag - marks product as a service (design fee, rush fee, etc.)
  isService: boolean("is_service").default(false).notNull(),
  // NEW: Primary material linkage for cost calculations
  primaryMaterialId: varchar("primary_material_id").references(() => materials.id, { onDelete: 'set null' }),
  // NEW: Inline options stored as JSON
  optionsJson: jsonb("options_json").$type<ProductOptionItem[]>(),
  // NEW: Option Tree v2 (additive, opt-in)
  optionTreeJson: jsonb("option_tree_json").$type<any>(),

  // PBV2: Active tree version pointer (draft is derived by querying pbv2_tree_versions where status=DRAFT)
  // Note: Foreign key is enforced at the DB level via migration; keep this column simple here to avoid circular refs.
  pbv2ActiveTreeVersionId: varchar("pbv2_active_tree_version_id"),
  // Artwork policy for this product (controls missing_artwork derivation)
  artworkPolicy: varchar("artwork_policy", { length: 32 }).$type<"not_required" | "required">().default("not_required").notNull(),
  // NEW: Pricing profile key - points to which calculator to use
  pricingProfileKey: varchar("pricing_profile_key", { length: 100 }).default("default"),
  // NEW: Pricing profile config - calculator-specific settings (e.g., FlatGoodsConfig)
  pricingProfileConfig: jsonb("pricing_profile_config").$type<FlatGoodsConfig | Record<string, any>>(),
  // NEW: Pricing engine selection - which UI mode user selected (formulaLibrary, pricingProfile, pricingFormula)
  pricingEngine: varchar("pricing_engine", { length: 32 }).$type<"formulaLibrary" | "pricingProfile" | "pricingFormula">().default("pricingProfile"),
  // NEW: Link to reusable pricing formula
  pricingFormulaId: varchar("pricing_formula_id").references(() => pricingFormulas.id, { onDelete: 'set null' }),
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
  requiresProofApproval: boolean("requires_proof_approval").default(false).notNull(),
  // Tax system
  isTaxable: boolean("is_taxable").default(true).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("products_organization_id_idx").on(table.organizationId),
  index("products_primary_material_id_idx").on(table.primaryMaterialId),
  index("products_pricing_formula_id_idx").on(table.pricingFormulaId),
  index("products_pbv2_active_tree_version_id_idx").on(table.pbv2ActiveTreeVersionId),
]);

export const productDesignConfigs = pgTable("product_design_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  productId: varchar("product_id")
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  requiresDesign: boolean("requires_design").notNull().default(false),
  designBriefRequired: boolean("design_brief_required").notNull().default(false),
  useKeyInstructions: boolean("use_key_instructions").notNull().default(true),
  useDesignObjective: boolean("use_design_objective").notNull().default(true),
  useRequestedContent: boolean("use_requested_content").notNull().default(false),
  useLayoutNotes: boolean("use_layout_notes").notNull().default(false),
  useBrandStyleNotes: boolean("use_brand_style_notes").notNull().default(false),
  useReferenceNotes: boolean("use_reference_notes").notNull().default(false),
  usePriorityNotes: boolean("use_priority_notes").notNull().default(false),
  requireKeyInstructions: boolean("require_key_instructions").notNull().default(false),
  requireDesignObjective: boolean("require_design_objective").notNull().default(false),
  estimatedDesignMinutes: integer("estimated_design_minutes"),
  includedDesignMinutes: integer("included_design_minutes"),
  allowDesignStartWhenBriefMissing: boolean("allow_design_start_when_brief_missing").notNull().default(false),
  designPricingMode: varchar("design_pricing_mode", { length: 50 })
    .$type<ProductDesignPricingMode>()
    .notNull()
    .default("none"),
  flatFeeAmount: decimal("flat_fee_amount", { precision: 10, scale: 2 }),
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  overageRate: decimal("overage_rate", { precision: 10, scale: 2 }),
  internalLaborRate: decimal("internal_labor_rate", { precision: 10, scale: 2 }),
  costTrackingEnabled: boolean("cost_tracking_enabled").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("product_design_configs_product_id_unique").on(table.productId),
  index("product_design_configs_organization_id_idx").on(table.organizationId),
]);

// ============================================================
// PRODUCT BUILDER V2 (PBV2) - VERSIONED TREE MODEL
// ============================================================

export const pbv2TreeVersionStatusEnum = pgEnum("pbv2_tree_version_status", [
  "DRAFT",
  "ACTIVE",
  "DEPRECATED",
  "ARCHIVED",
]);

export const pbv2TreeVersions = pgTable(
  "pbv2_tree_versions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    productId: varchar("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),

    status: pbv2TreeVersionStatusEnum("status").notNull().default("DRAFT"),
    schemaVersion: integer("schema_version").notNull().default(1),
    treeJson: jsonb("tree_json").$type<Record<string, any>>().default(sql`'{}'::jsonb`).notNull(),

    publishedAt: timestamp("published_at", { withTimezone: true }),

    createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("pbv2_tree_versions_org_id_idx").on(table.organizationId),
    index("pbv2_tree_versions_product_id_idx").on(table.productId),
    index("pbv2_tree_versions_status_idx").on(table.status),
    index("pbv2_tree_versions_org_product_status_idx").on(table.organizationId, table.productId, table.status),
    index("pbv2_tree_versions_updated_at_idx").on(table.updatedAt),
  ]
);

export const insertPbv2TreeVersionSchema = createInsertSchema(pbv2TreeVersions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  organizationId: true,
  createdByUserId: true,
  updatedByUserId: true,
});

export const updatePbv2TreeVersionSchema = insertPbv2TreeVersionSchema.partial().extend({
  id: z.string(),
});

export type InsertPbv2TreeVersion = z.infer<typeof insertPbv2TreeVersionSchema>;
export type UpdatePbv2TreeVersion = z.infer<typeof updatePbv2TreeVersionSchema>;
export type Pbv2TreeVersion = typeof pbv2TreeVersions.$inferSelect;

/** Immutable Formula revision selected by one ProductVersion.  The database
 * trigger permits retargeting only while that ProductVersion remains a Draft. */
export const v2ProductVersionFormulaRevisionBindings = pgTable(
  "v2_product_version_formula_revision_bindings",
  {
    organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    productId: varchar("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    productVersionId: varchar("product_version_id").notNull().references(() => pbv2TreeVersions.id, { onDelete: "restrict" }),
    formulaId: varchar("formula_id").notNull().references(() => v2FormulaIdentities.id, { onDelete: "restrict" }),
    formulaRevisionId: varchar("formula_revision_id").notNull().references(() => v2FormulaRevisions.id, { onDelete: "restrict" }),
    inputValues: jsonb("input_values").$type<Record<string, number | boolean>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.productVersionId] }),
    index("v2_product_version_formula_revision_formula_idx").on(table.organizationId, table.formulaId, table.formulaRevisionId),
  ],
);
export type V2ProductVersionFormulaRevisionBinding = typeof v2ProductVersionFormulaRevisionBindings.$inferSelect;

export const productIntakeSessionSourceTypeValues = ["json_upload", "json_paste", "text_description"] as const;
export const productIntakeSessionStatusValues = ["analyzed", "needs_answers", "ready_for_draft", "draft_created", "abandoned"] as const;
export const productIntakeQuestionTypeValues = ["select", "multiselect", "text", "number", "boolean"] as const;
export const productIntakeAiDiagnosticSourceTypeValues = ["uploaded_json", "pasted_json", "text_description"] as const;

export const productIntakeSessions = pgTable("product_intake_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceType: text("source_type").$type<typeof productIntakeSessionSourceTypeValues[number]>().notNull(),
  sourceJson: jsonb("source_json").$type<unknown>(),
  sourceText: text("source_text"),
  sourceFingerprint: text("source_fingerprint"),
  aiBriefJson: jsonb("ai_brief_json").$type<Record<string, unknown>>().notNull(),
  confidenceJson: jsonb("confidence_json").$type<Record<string, unknown>>(),
  missingDecisionsJson: jsonb("missing_decisions_json").$type<unknown[]>(),
  status: text("status").$type<typeof productIntakeSessionStatusValues[number]>().notNull().default("analyzed"),
  createdProductId: varchar("created_product_id").references(() => products.id, { onDelete: "set null" }),
  createdPbv2TreeVersionId: varchar("created_pbv2_tree_version_id").references(() => pbv2TreeVersions.id, { onDelete: "set null" }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  abandonedAt: timestamp("abandoned_at", { withTimezone: true }),
}, (table) => [
  index("product_intake_sessions_org_status_idx").on(table.organizationId, table.status),
  index("product_intake_sessions_org_created_idx").on(table.organizationId, table.createdAt),
  index("product_intake_sessions_source_fingerprint_idx").on(table.sourceFingerprint),
  index("product_intake_sessions_created_product_idx").on(table.createdProductId),
  index("product_intake_sessions_created_pbv2_tree_idx").on(table.createdPbv2TreeVersionId),
]);

export const productIntakeQuestions = pgTable("product_intake_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sessionId: varchar("session_id").notNull().references(() => productIntakeSessions.id, { onDelete: "cascade" }),
  questionKey: text("question_key").notNull(),
  questionType: text("question_type").$type<typeof productIntakeQuestionTypeValues[number]>().notNull(),
  label: text("label").notNull(),
  helpText: text("help_text"),
  required: boolean("required").notNull().default(false),
  optionsJson: jsonb("options_json").$type<unknown[]>(),
  defaultValueJson: jsonb("default_value_json").$type<unknown>(),
  sourcePath: text("source_path"),
  confidence: decimal("confidence", { precision: 5, scale: 2 }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("product_intake_questions_session_idx").on(table.sessionId),
  index("product_intake_questions_org_session_idx").on(table.organizationId, table.sessionId),
  uniqueIndex("product_intake_questions_session_key_uidx").on(table.sessionId, table.questionKey),
]);

export const productIntakeAnswers = pgTable("product_intake_answers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sessionId: varchar("session_id").notNull().references(() => productIntakeSessions.id, { onDelete: "cascade" }),
  questionId: varchar("question_id").notNull().references(() => productIntakeQuestions.id, { onDelete: "cascade" }),
  questionKey: text("question_key").notNull(),
  answerJson: jsonb("answer_json").$type<unknown>(),
  answeredByUserId: varchar("answered_by_user_id").references(() => users.id, { onDelete: "set null" }),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("product_intake_answers_session_idx").on(table.sessionId),
  index("product_intake_answers_question_idx").on(table.questionId),
  uniqueIndex("product_intake_answers_session_key_uidx").on(table.sessionId, table.questionKey),
]);

export type ProductIntakeSessionRow = typeof productIntakeSessions.$inferSelect;
export type InsertProductIntakeSessionRow = typeof productIntakeSessions.$inferInsert;
export type ProductIntakeQuestionRow = typeof productIntakeQuestions.$inferSelect;
export type InsertProductIntakeQuestionRow = typeof productIntakeQuestions.$inferInsert;
export type ProductIntakeAnswerRow = typeof productIntakeAnswers.$inferSelect;
export type InsertProductIntakeAnswerRow = typeof productIntakeAnswers.$inferInsert;

// Conversational quote intake is intentionally separate from assistant turns.
// A turn may be retried or re-rendered, while this server-owned record is the
// immutable proposal reference consumed by the confirmed draft-only commands.
export const assistantQuoteIntakeSessions = pgTable("assistant_quote_intake_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull(),
  quoteId: varchar("quote_id").references(() => quotes.id, { onDelete: "set null" }),
  status: varchar("status", { length: 32 }).$type<"collecting" | "preview_ready" | "created" | "abandoned">().notNull().default("collecting"),
  intakeJson: jsonb("intake_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  proposalFingerprint: varchar("proposal_fingerprint", { length: 64 }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("assistant_quote_intake_org_user_idx").on(table.organizationId, table.userId, table.updatedAt),
  index("assistant_quote_intake_org_conversation_idx").on(table.organizationId, table.conversationId, table.updatedAt),
  index("assistant_quote_intake_quote_idx").on(table.quoteId),
]);

export type AssistantQuoteIntakeSessionRow = typeof assistantQuoteIntakeSessions.$inferSelect;

// Order intake has its own durable proposal record.  Keeping it distinct from
// quote intake prevents a confirmed order command from accepting a quote draft
// session or bypassing the deferred-production creation policy.
export const assistantOrderIntakeSessions = pgTable("assistant_order_intake_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull(),
  orderId: varchar("order_id").references(() => orders.id, { onDelete: "set null" }),
  quoteId: varchar("quote_id").references(() => quotes.id, { onDelete: "set null" }),
  status: varchar("status", { length: 32 }).$type<"collecting" | "preview_ready" | "created" | "abandoned">().notNull().default("collecting"),
  intakeJson: jsonb("intake_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  proposalFingerprint: varchar("proposal_fingerprint", { length: 64 }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("assistant_order_intake_org_user_idx").on(table.organizationId, table.userId, table.updatedAt),
  index("assistant_order_intake_org_conversation_idx").on(table.organizationId, table.conversationId, table.updatedAt),
  index("assistant_order_intake_order_idx").on(table.orderId),
  index("assistant_order_intake_quote_idx").on(table.quoteId),
]);

export type AssistantOrderIntakeSessionRow = typeof assistantOrderIntakeSessions.$inferSelect;

// CRM proposals are deliberately separate from quote/order intake. They hold
// server-normalized customer/contact changes until an authenticated user uses
// the dedicated confirmation control.
export const assistantCrmIntakeSessions = pgTable("assistant_crm_intake_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull(),
  customerId: varchar("customer_id").references(() => customers.id, { onDelete: "set null" }),
  contactId: varchar("contact_id").references(() => customerContacts.id, { onDelete: "set null" }),
  commandName: varchar("command_name", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).$type<"collecting" | "preview_ready" | "created" | "abandoned">().notNull().default("collecting"),
  intakeJson: jsonb("intake_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  proposalFingerprint: varchar("proposal_fingerprint", { length: 64 }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("assistant_crm_intake_org_user_idx").on(table.organizationId, table.userId, table.updatedAt),
  index("assistant_crm_intake_org_conversation_idx").on(table.organizationId, table.conversationId, table.updatedAt),
  index("assistant_crm_intake_customer_idx").on(table.customerId),
  index("assistant_crm_intake_contact_idx").on(table.contactId),
]);

export type AssistantCrmIntakeSessionRow = typeof assistantCrmIntakeSessions.$inferSelect;

export const assistantProductionIntakeSessions = pgTable("assistant_production_intake_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull(),
  commandName: varchar("command_name", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).$type<"preview_ready" | "created" | "abandoned">().notNull().default("preview_ready"),
  intakeJson: jsonb("intake_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  proposalFingerprint: varchar("proposal_fingerprint", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("assistant_production_intake_org_user_idx").on(table.organizationId, table.userId, table.updatedAt)]);
export type AssistantProductionIntakeSessionRow = typeof assistantProductionIntakeSessions.$inferSelect;

export const assistantFulfillmentIntakeSessions = pgTable("assistant_fulfillment_intake_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`), organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), conversationId: varchar("conversation_id").notNull(), commandName: varchar("command_name", { length: 64 }).notNull(), status: varchar("status", { length: 32 }).$type<"preview_ready" | "created" | "abandoned">().notNull().default("preview_ready"), intakeJson: jsonb("intake_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`), proposalFingerprint: varchar("proposal_fingerprint", { length: 64 }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("assistant_fulfillment_intake_org_user_idx").on(table.organizationId, table.userId, table.updatedAt)]);
export type AssistantFulfillmentIntakeSessionRow = typeof assistantFulfillmentIntakeSessions.$inferSelect;

// Billing proposals retain only server-normalized identifiers and safe draft
// fields until the authenticated user confirms the dedicated assistant action.
export const assistantBillingIntakeSessions = pgTable("assistant_billing_intake_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull(),
  commandName: varchar("command_name", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).$type<"preview_ready" | "created" | "abandoned">().notNull().default("preview_ready"),
  intakeJson: jsonb("intake_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  proposalFingerprint: varchar("proposal_fingerprint", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("assistant_billing_intake_org_user_idx").on(table.organizationId, table.userId, table.updatedAt)]);
export type AssistantBillingIntakeSessionRow = typeof assistantBillingIntakeSessions.$inferSelect;

// Payment proposals retain only normalized, non-authoritative payment intent
// until an authenticated user confirms the dedicated assistant action.
export const assistantPaymentIntakeSessions = pgTable("assistant_payment_intake_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull(),
  commandName: varchar("command_name", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).$type<"preview_ready" | "created" | "abandoned">().notNull().default("preview_ready"),
  intakeJson: jsonb("intake_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  proposalFingerprint: varchar("proposal_fingerprint", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("assistant_payment_intake_org_user_idx").on(table.organizationId, table.userId, table.updatedAt)]);
export type AssistantPaymentIntakeSessionRow = typeof assistantPaymentIntakeSessions.$inferSelect;

export const productIntakeAiDiagnostics = pgTable("product_intake_ai_diagnostics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sessionId: varchar("session_id").references(() => productIntakeSessions.id, { onDelete: "cascade" }),
  sourceType: text("source_type").$type<typeof productIntakeAiDiagnosticSourceTypeValues[number]>().notNull(),
  sourceFingerprint: text("source_fingerprint"),
  provider: text("provider"),
  model: text("model"),
  rawAiResponse: text("raw_ai_response").notNull(),
  validationErrors: jsonb("validation_errors").$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'::jsonb`),
  failedSchemaPaths: jsonb("failed_schema_paths").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  repairActions: jsonb("repair_actions").$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'::jsonb`),
  promptVersion: text("prompt_version"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("product_intake_ai_diagnostics_org_created_idx").on(table.organizationId, table.createdAt),
  index("product_intake_ai_diagnostics_org_source_idx").on(table.organizationId, table.sourceType),
  index("product_intake_ai_diagnostics_session_idx").on(table.sessionId),
  index("product_intake_ai_diagnostics_fingerprint_idx").on(table.sourceFingerprint),
]);

export type ProductIntakeAiDiagnosticRow = typeof productIntakeAiDiagnostics.$inferSelect;
export type InsertProductIntakeAiDiagnosticRow = typeof productIntakeAiDiagnostics.$inferInsert;

export const pbv2OptionGroupTemplateStateValues = ["active", "archived"] as const;

export const pbv2OptionGroupTemplates = pgTable(
  "pbv2_option_group_templates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    isSystemTemplate: boolean("is_system_template").notNull().default(false),
    state: text("state").$type<(typeof pbv2OptionGroupTemplateStateValues)[number]>().notNull().default("active"),
    category: text("category").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    tags: jsonb("tags").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    difficultyLevel: text("difficulty_level"),
    recommendedProductTypes: jsonb("recommended_product_types").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    recommendedIndustries: jsonb("recommended_industries").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    recommendedPairings: jsonb("recommended_pairings").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    compatibilityMetadata: jsonb("compatibility_metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    workflowMetadata: jsonb("workflow_metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    pricingMetadata: jsonb("pricing_metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    intentMetadata: jsonb("intent_metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    previewConfig: jsonb("preview_config").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    templateTree: jsonb("template_tree").$type<Record<string, any>>().notNull(),
    createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("pbv2_option_group_templates_org_state_idx").on(table.organizationId, table.state),
    index("pbv2_option_group_templates_category_state_idx").on(table.category, table.state),
    index("pbv2_option_group_templates_system_idx").on(table.isSystemTemplate),
    index("pbv2_option_group_templates_slug_idx").on(table.slug),
    uniqueIndex("pbv2_option_group_templates_system_slug_uidx")
      .on(table.slug)
      .where(sql`${table.isSystemTemplate} = true`),
    uniqueIndex("pbv2_option_group_templates_org_slug_uidx")
      .on(table.organizationId, table.slug)
      .where(sql`${table.isSystemTemplate} = false AND ${table.organizationId} IS NOT NULL`),
  ],
);

export const insertPbv2OptionGroupTemplateSchema = createInsertSchema(pbv2OptionGroupTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
});

export const updatePbv2OptionGroupTemplateSchema = insertPbv2OptionGroupTemplateSchema.partial().extend({
  id: z.string(),
  state: z.enum(pbv2OptionGroupTemplateStateValues).optional(),
});

export type InsertPbv2OptionGroupTemplate = z.infer<typeof insertPbv2OptionGroupTemplateSchema>;
export type UpdatePbv2OptionGroupTemplate = z.infer<typeof updatePbv2OptionGroupTemplateSchema>;
export type Pbv2OptionGroupTemplate = typeof pbv2OptionGroupTemplates.$inferSelect;

// Zod schema for product options with enhanced sub-options
const productOptionItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(["checkbox", "quantity", "toggle", "select", "attachment"]),
  priceMode: z.enum(["flat", "per_qty", "per_sqft", "percent_of_base", "flat_per_item"]).default("flat"),
  amount: z.number().optional(),
  percentBase: z.enum(["media", "line"]).optional(),
  defaultSelected: z.boolean().optional(),
  defaultChecked: z.boolean().optional(),
  defaultQty: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  sortOrder: z.number().optional(),
  groupKey: z.string().optional(),
  groupLabel: z.string().optional(),
  group: z.string().optional(),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  choices: z
    .array(
      z.object({
        id: z.string().optional(),
        value: z.string(),
        label: z.string(),
        requiresNote: z.boolean().optional(),
        noteLabel: z.string().optional(),
        notePlaceholder: z.string().optional(),
      })
    )
    .optional(),
  ui: z
    .object({
      visible: z.boolean().optional(),
      showPrice: z.boolean().optional(),
    })
    .optional(),
  layout: z
    .object({
      layoutSpan: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      minWidth: z.number().optional(),
    })
    .optional(),
  children: z
    .array(
      z.object({
        label: z.string(),
        type: z.enum(["boolean", "number", "select", "segmented", "text"]),
        selectionKey: z.string(),
        defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
        required: z.boolean().optional(),
        choices: z
          .array(
            z.object({
              id: z.string().optional(),
              value: z.string(),
              label: z.string(),
              requiresNote: z.boolean().optional(),
              noteLabel: z.string().optional(),
              notePlaceholder: z.string().optional(),
            })
          )
          .optional(),
        visibleWhen: z
          .union([
            z.object({ key: z.string(), when: z.literal("truthy") }),
            z.object({ key: z.string(), when: z.literal("equals"), value: z.union([z.string(), z.number(), z.boolean()]) }),
          ])
          .optional(),
        layout: z
          .object({
            layoutSpan: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
            minWidth: z.number().optional(),
          })
          .optional(),
        inline: z.boolean().optional(),
      })
    )
    .optional(),
  config: z
    .object({
      kind: z.enum(["grommets", "sides", "thickness", "hems", "pole_pockets", "generic"]).default("generic"),
      // For grommets
      locations: z
        .array(
          z.enum(["all_corners", "top_corners", "top_even", "custom"])
        )
        .optional(),
      defaultLocation: z
        .enum(["all_corners", "top_corners", "top_even", "custom"])
        .optional(),
      defaultSpacingCount: z.number().int().optional(),
      defaultSpacingInches: z.number().optional(), // e.g., 12, 24 for banner grommets
      spacingOptions: z.array(z.number()).optional(), // e.g., [12, 24]
      customNotes: z.string().optional(),
      // For sides toggle
      singleLabel: z.string().optional(),
      doubleLabel: z.string().optional(),
      defaultSide: z.enum(["single", "double"]).optional(),
      doublePriceMultiplier: z.number().optional(),
      pricingMode: z.enum(["multiplier", "volume"]).optional(),
      // Volume tiers for sides pricing
      volumeTiers: z.array(z.object({
        minSheets: z.number(),
        maxSheets: z.number().nullable().optional(),
        singlePricePerSheet: z.number(),
        doublePricePerSheet: z.number(),
      })).optional(),
      // For thickness selector
      defaultThicknessKey: z.string().optional(),
      thicknessVariants: z.array(z.object({
        key: z.string(),
        label: z.string(),
        materialId: z.string(),
        pricingMode: z.enum(["multiplier", "volume"]),
        priceMultiplier: z.number().optional(),
        volumeTiers: z.array(z.object({
          minSheets: z.number(),
          maxSheets: z.number().nullable().optional(),
          pricePerSheet: z.number(),
        })).optional(),
      })).optional(),
      // For hems (banner finishing)
      hemsChoices: z.array(z.string()).optional(), // e.g., ["none", "all_sides", "top_bottom", "left_right"]
      defaultHems: z.enum(["none", "all_sides", "top_bottom", "left_right"]).optional(),
      // For pole pockets (banner finishing)
      polePocketChoices: z.array(z.string()).optional(), // e.g., ["none", "top", "bottom", "top_bottom"]
      defaultPolePocket: z.enum(["none", "top", "bottom", "top_bottom"]).optional(),
    })
    .optional(),
  // Material add-on configuration
  materialAddonConfig: z.object({
    materialId: z.string(),
    usageBasis: z.enum(["same_area", "same_sheets"]),
    unitType: z.enum(["sqft", "sheet"]),
    wasteFactor: z.number().optional(),
  }).optional(),
});

// Zod schema for flat goods pricing config
const flatGoodsConfigSchema = z.object({
  sheetWidth: z.coerce.number().positive(),
  sheetHeight: z.coerce.number().positive(),
  allowRotation: z.boolean().default(false),
  minSheets: z.coerce.number().int().positive().optional(),
  materialType: z.enum(["sheet", "roll"]).default("sheet"),
  minPricePerItem: z.coerce.number().positive().optional().nullable(),
}).passthrough();

// Union for pricing profile config (extensible for future profile types)
const pricingProfileConfigSchema = z.union([
  flatGoodsConfigSchema,
  z.record(z.any()), // Allow any object for future profile types
]).optional().nullable();

const optionalAiParsingDescriptionSchema = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v == null ? undefined : v;
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  },
  z.string().max(10000).optional().nullable()
);

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
}).extend({
  pricingFormula: z.string().optional().nullable(),
  pricingMode: z.enum(["area", "quantity", "flat"]).default("area"),
  measurementMode: z.enum(["dimensions_required", "quantity_only"]).default("dimensions_required"),
  workflowIntent: z.enum(["standard_production", "fulfillment_only", "service_fee"]).default("standard_production"),
  allowZeroPrice: z.boolean().default(false),
  isService: z.boolean().default(false),
  primaryMaterialId: z.string().optional().nullable(),
  optionsJson: z.array(productOptionItemSchema).optional().nullable(),
  optionTreeJson: z.any().optional().nullable(),
  artworkPolicy: z.enum(["not_required", "required"]).default("not_required"),
  pricingProfileKey: z.enum(PRICING_PROFILE_KEYS as [string, ...string[]]).default("default"),
  pricingProfileConfig: pricingProfileConfigSchema,
  pricingFormulaId: z.string().optional().nullable(),
  sheetWidth: z.coerce.number().positive().optional().nullable(),
  sheetHeight: z.coerce.number().positive().optional().nullable(),
  minPricePerItem: z.coerce.number().positive().optional().nullable(),
  requiresProductionJob: z.boolean().default(true),
  aiParsingDescription: optionalAiParsingDescriptionSchema,
  aiParsingDescriptionLinkedToDescription: z.boolean().default(false),
});

export const updateProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
}).extend({
  pricingFormula: z.string().optional().nullable(),
  pricingMode: z.enum(["area", "quantity", "flat"]).optional(),
  measurementMode: z.enum(["dimensions_required", "quantity_only"]).optional(),
  workflowIntent: z.enum(["standard_production", "fulfillment_only", "service_fee"]).optional(),
  allowZeroPrice: z.boolean().optional(),
  isService: z.boolean().optional(),
  primaryMaterialId: z.string().optional().nullable(),
  optionsJson: z.array(productOptionItemSchema).optional().nullable(),
  optionTreeJson: z.any().optional().nullable(),
  artworkPolicy: z.enum(["not_required", "required"]).optional(),
  pricingProfileKey: z.enum(PRICING_PROFILE_KEYS as [string, ...string[]]).optional(),
  pricingProfileConfig: pricingProfileConfigSchema,
  pricingFormulaId: z.string().optional().nullable(),
  sheetWidth: z.coerce.number().positive().optional().nullable(),
  sheetHeight: z.coerce.number().positive().optional().nullable(),
  minPricePerItem: z.coerce.number().positive().optional().nullable(),
  requiresProductionJob: z.boolean().optional(),
  aiParsingDescription: optionalAiParsingDescriptionSchema,
  aiParsingDescriptionLinkedToDescription: z.boolean().optional(),
}).partial();

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type UpdateProduct = z.infer<typeof updateProductSchema>;
export type Product = typeof products.$inferSelect;

export const insertProductDesignConfigSchema = createInsertSchema(productDesignConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
  productId: true,
}).extend({
  estimatedDesignMinutes: z.coerce.number().int().nonnegative().optional().nullable(),
  includedDesignMinutes: z.coerce.number().int().nonnegative().optional().nullable(),
  designPricingMode: productDesignPricingModeSchema.default("none"),
  flatFeeAmount: z.coerce.number().nonnegative().optional().nullable(),
  hourlyRate: z.coerce.number().nonnegative().optional().nullable(),
  overageRate: z.coerce.number().nonnegative().optional().nullable(),
  internalLaborRate: z.coerce.number().nonnegative().optional().nullable(),
});

export const updateProductDesignConfigSchema = insertProductDesignConfigSchema.partial();

export type ProductDesignConfig = typeof productDesignConfigs.$inferSelect;
export type InsertProductDesignConfig = typeof productDesignConfigs.$inferInsert;
export type UpdateProductDesignConfig = z.infer<typeof updateProductDesignConfigSchema>;

// Product Variants table
export const productVariants = pgTable("product_variants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: 'cascade' }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  basePricePerSqft: decimal("base_price_per_sqft", { precision: 10, scale: 4 }).notNull(),
  // Tiered pricing support
  wholesaleBaseRate: decimal("wholesale_base_rate", { precision: 10, scale: 4 }),
  wholesaleMinCharge: decimal("wholesale_min_charge", { precision: 10, scale: 2 }),
  retailBaseRate: decimal("retail_base_rate", { precision: 10, scale: 4 }),
  retailMinCharge: decimal("retail_min_charge", { precision: 10, scale: 2 }),
  volumePricing: jsonb("volume_pricing").$type<{
    enabled: boolean;
    tiers: Array<{
      minSheets: number;
      maxSheets?: number;
      pricePerSheet: number;
    }>;
  }>().default(sql`'{"enabled":false,"tiers":[]}'::jsonb`).notNull(),
  // Tax system
  isTaxable: boolean("is_taxable").default(true).notNull(),
  taxCategoryId: varchar("tax_category_id").references(() => taxCategories.id, { onDelete: 'set null' }),
  isDefault: boolean("is_default").default(false).notNull(),
  displayOrder: integer("display_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("product_variants_product_id_idx").on(table.productId),
  index("product_variants_tax_category_idx").on(table.taxCategoryId),
]);

export const insertProductVariantSchema = createInsertSchema(productVariants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  basePricePerSqft: z.coerce.number().positive(),
  // Tiered pricing fields
  wholesaleBaseRate: z.coerce.number().nonnegative().optional().nullable(),
  wholesaleMinCharge: z.coerce.number().nonnegative().optional().nullable(),
  retailBaseRate: z.coerce.number().nonnegative().optional().nullable(),
  retailMinCharge: z.coerce.number().nonnegative().optional().nullable(),
  displayOrder: z.coerce.number().int(),
});

export const updateProductVariantSchema = insertProductVariantSchema.partial().extend({
  id: z.string(),
});

export type InsertProductVariant = z.infer<typeof insertProductVariantSchema>;
export type UpdateProductVariant = z.infer<typeof updateProductVariantSchema>;
export type ProductVariant = typeof productVariants.$inferSelect;

// ============================================================
// SAAS TAX SYSTEM - Multi-State, Multi-Zone
// ============================================================

// Tax Zones: Geographic areas with specific tax rates
export const taxZones = pgTable("tax_zones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  country: text("country").notNull().default("US"),
  state: text("state"),
  county: text("county"),
  city: text("city"),
  postalStart: text("postal_start"),
  postalEnd: text("postal_end"),
  combinedRate: decimal("combined_rate", { precision: 10, scale: 6 }).notNull().default("0"),
  stateRate: decimal("state_rate", { precision: 10, scale: 6 }),
  countyRate: decimal("county_rate", { precision: 10, scale: 6 }),
  cityRate: decimal("city_rate", { precision: 10, scale: 6 }),
  districtRate: decimal("district_rate", { precision: 10, scale: 6 }),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("tax_zones_org_state_idx").on(table.organizationId, table.state, table.active),
  index("tax_zones_postal_idx").on(table.organizationId, table.state, table.postalStart, table.postalEnd),
]);

export const insertTaxZoneSchema = createInsertSchema(taxZones).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
}).extend({
  combinedRate: z.coerce.number().nonnegative(),
  stateRate: z.coerce.number().nonnegative().optional().nullable(),
  countyRate: z.coerce.number().nonnegative().optional().nullable(),
  cityRate: z.coerce.number().nonnegative().optional().nullable(),
  districtRate: z.coerce.number().nonnegative().optional().nullable(),
});

export const updateTaxZoneSchema = insertTaxZoneSchema.partial().extend({
  id: z.string(),
});

export type InsertTaxZone = z.infer<typeof insertTaxZoneSchema>;
export type UpdateTaxZone = z.infer<typeof updateTaxZoneSchema>;
export type TaxZone = typeof taxZones.$inferSelect;

// Tax Categories: Product classification for tax purposes
export const taxCategories = pgTable("tax_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  defaultTaxable: boolean("default_taxable").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("tax_categories_org_name_idx").on(table.organizationId, table.name),
]);

export const insertTaxCategorySchema = createInsertSchema(taxCategories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
});

export const updateTaxCategorySchema = insertTaxCategorySchema.partial().extend({
  id: z.string(),
});

export type InsertTaxCategory = z.infer<typeof insertTaxCategorySchema>;
export type UpdateTaxCategory = z.infer<typeof updateTaxCategorySchema>;
export type TaxCategory = typeof taxCategories.$inferSelect;

// Organization Tax Nexus: Where organization must collect sales tax
export const organizationTaxNexus = pgTable("organization_tax_nexus", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  country: text("country").notNull().default("US"),
  state: text("state").notNull(),
  county: text("county"),
  city: text("city"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("org_tax_nexus_idx").on(table.organizationId, table.state, table.active),
]);

export const insertOrganizationTaxNexusSchema = createInsertSchema(organizationTaxNexus).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
});

export const updateOrganizationTaxNexusSchema = insertOrganizationTaxNexusSchema.partial().extend({
  id: z.string(),
});

export type InsertOrganizationTaxNexus = z.infer<typeof insertOrganizationTaxNexusSchema>;
export type UpdateOrganizationTaxNexus = z.infer<typeof updateOrganizationTaxNexusSchema>;
export type OrganizationTaxNexus = typeof organizationTaxNexus.$inferSelect;

// Tax Rules: Per-zone, per-category overrides/exemptions
export const taxRules = pgTable("tax_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  taxZoneId: varchar("tax_zone_id").notNull().references(() => taxZones.id, { onDelete: 'cascade' }),
  taxCategoryId: varchar("tax_category_id").notNull().references(() => taxCategories.id, { onDelete: 'cascade' }),
  taxable: boolean("taxable").notNull().default(true),
  rateOverride: decimal("rate_override", { precision: 10, scale: 6 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("tax_rules_lookup_idx").on(table.organizationId, table.taxZoneId, table.taxCategoryId),
]);

export const insertTaxRuleSchema = createInsertSchema(taxRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
}).extend({
  rateOverride: z.coerce.number().nonnegative().optional().nullable(),
});

export const updateTaxRuleSchema = insertTaxRuleSchema.partial().extend({
  id: z.string(),
});

export type InsertTaxRule = z.infer<typeof insertTaxRuleSchema>;
export type UpdateTaxRule = z.infer<typeof updateTaxRuleSchema>;
export type TaxRule = typeof taxRules.$inferSelect;

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
  organizationId: true,
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
  displayNumber: varchar("display_number", { length: 64 }),
  numberCore: integer("number_core"),
  label: text("label"), // Free-text label for categorization/notes
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: quoteStatusEnum("status").notNull().default("active"),
  customerId: varchar("customer_id").references(() => customers.id, { onDelete: 'set null' }),
  contactId: varchar("contact_id").references(() => customerContacts.id, { onDelete: 'set null' }),
  customerName: varchar("customer_name", { length: 255 }),
  source: varchar("source", { length: 50 }).notNull().default('internal'),
  visibleInCustomerPortal: boolean("visible_in_customer_portal").notNull().default(false),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  // Tax system fields (taxRate kept for backward compatibility but now represents effective snapshot)
  taxRate: decimal("tax_rate", { precision: 5, scale: 4 }),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).default("0").notNull(),
  taxableSubtotal: decimal("taxable_subtotal", { precision: 10, scale: 2 }).default("0").notNull(),
  marginPercentage: decimal("margin_percentage", { precision: 5, scale: 4 }).default("0").notNull(),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0").notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull().default("0"),
  
  // Customer snapshot (billing address)
  billToName: text("bill_to_name"),
  billToCompany: text("bill_to_company"),
  billToAddress1: text("bill_to_address1"),
  billToAddress2: text("bill_to_address2"),
  billToCity: text("bill_to_city"),
  billToState: text("bill_to_state"),
  billToPostalCode: text("bill_to_postal_code"),
  billToCountry: text("bill_to_country"),
  billToPhone: text("bill_to_phone"),
  billToEmail: text("bill_to_email"),
  
  // Shipping snapshot
  shippingMethod: varchar("shipping_method", { length: 50 }), // pickup, ship, deliver
  shippingMode: varchar("shipping_mode", { length: 50 }), // single_shipment, multi_shipment
  shipToName: text("ship_to_name"),
  shipToCompany: text("ship_to_company"),
  shipToAddress1: text("ship_to_address1"),
  shipToAddress2: text("ship_to_address2"),
  shipToCity: text("ship_to_city"),
  shipToState: text("ship_to_state"),
  shipToPostalCode: text("ship_to_postal_code"),
  shipToCountry: text("ship_to_country"),
  shipToPhone: text("ship_to_phone"),
  shipToEmail: text("ship_to_email"),
  carrier: text("carrier"),
  carrierAccountNumber: text("carrier_account_number"),
  shippingInstructions: text("shipping_instructions"),
  shippingCents: integer("shipping_cents"), // Shipping cost in cents (nullable)
  
  // Dates
  requestedDueDate: timestamp("requested_due_date", { withTimezone: true, mode: "string" }),
  validUntil: timestamp("valid_until", { withTimezone: true, mode: "string" }),

  // Legacy field - kept for backward compatibility
  convertedToOrderId: varchar("converted_to_order_id"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("quotes_organization_id_idx").on(table.organizationId),
  index("quotes_user_id_idx").on(table.userId),
  index("quotes_customer_id_idx").on(table.customerId),
  index("quotes_contact_id_idx").on(table.contactId),
  index("quotes_created_at_idx").on(table.createdAt),
  index("quotes_quote_number_idx").on(table.quoteNumber),
  index("quotes_display_number_idx").on(table.displayNumber),
  index("quotes_number_core_idx").on(table.numberCore),
  index("quotes_portal_visibility_idx").on(table.organizationId, table.customerId, table.visibleInCustomerPortal),
  uniqueIndex("quotes_org_display_number_unique").on(table.organizationId, table.displayNumber).where(sql`${table.displayNumber} IS NOT NULL`),
  uniqueIndex("quotes_org_number_core_unique").on(table.organizationId, table.numberCore).where(sql`${table.numberCore} IS NOT NULL`),
  index("quotes_source_idx").on(table.source),
]);

// Quote Line Items table
export const quoteLineItemStatusEnum = pgEnum("quote_line_item_status", ["draft", "active", "canceled"]);
export const lineItemRoleEnum = pgEnum("line_item_role", ["standalone", "parent", "child"]);
export const lineItemChildDisplayModeEnum = pgEnum("line_item_child_display_mode", ["hidden", "visible_summary", "visible_detail"]);
export const lineItemParentPriceModeEnum = pgEnum("line_item_parent_price_mode", ["sum_children", "manual_override"]);
export const quoteLineItems = pgTable("quote_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  quoteId: varchar("quote_id").references(() => quotes.id, { onDelete: 'cascade' }),
  status: quoteLineItemStatusEnum("status").notNull().default("active"),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: 'cascade' }),
  productName: varchar("product_name", { length: 255 }).notNull(),
  variantId: varchar("variant_id").references(() => productVariants.id, { onDelete: 'set null' }),
  variantName: varchar("variant_name", { length: 255 }),
  productType: varchar("product_type", { length: 50 }).notNull().default('wide_roll'),
  width: decimal("width", { precision: 10, scale: 2 }).notNull(),
  height: decimal("height", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").notNull(),
  specsJson: jsonb("specs_json").$type<Record<string, any>>(),
  // PBV2 pricing snapshot fields (migration 0036 - server-authoritative, migration 0041 made pbv2TreeVersionId nullable)
  pbv2TreeVersionId: varchar("pbv2_tree_version_id").references(() => pbv2TreeVersions.id, { onDelete: 'restrict' }),
  pbv2SnapshotJson: jsonb("pbv2_snapshot_json").$type<Record<string, any>>().notNull(),
  pricedAt: timestamp("priced_at", { withTimezone: true }).notNull().defaultNow(),
  // NEW: v2 canonical option selections (additive)
  optionSelectionsJson: jsonb("option_selections_json").$type<any>(),
  selectedOptions: jsonb("selected_options").$type<Array<{
    optionId: string;
    optionName: string;
    value: string | number | boolean;
    note?: string;
    setupCost: number;
    calculatedCost: number;
  }>>().default(sql`'[]'::jsonb`).notNull(),
  linePrice: decimal("line_price", { precision: 10, scale: 2 }).notNull(),
  formulaLinePrice: decimal("formula_line_price", { precision: 10, scale: 2 }),
  priceOverride: jsonb("price_override").$type<{
    mode: 'unit' | 'total';
    value: number;
  } | null>(),
  priceBreakdown: jsonb("price_breakdown").$type<{
    basePrice: number;
    optionsPrice: number;
    total: number;
    formula: string;
    variantInfo?: string;
  }>().notNull(),
  materialUsages: jsonb("material_usages").$type<LineItemMaterialUsage[]>().default(sql`'[]'::jsonb`).notNull(),
  // Tax system fields
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).default("0").notNull(),
  isTaxableSnapshot: boolean("is_taxable_snapshot").default(true).notNull(),
  displayOrder: integer("display_order").default(0).notNull(),
  // Temporary line item support (for artwork before quote is saved)
  isTemporary: boolean("is_temporary").default(false).notNull(),
  // Line item enhancements (migration 0039)
  description: text("description"),
  overridePriceCents: integer("override_price_cents"),
  overrideAt: timestamp("override_at", { withTimezone: true }),
  overrideByUserId: varchar("override_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  overrideReason: text("override_reason"),
  // Line item production notes (migration 0040)
  productionNotes: text("production_notes"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Canonical routing intent (migration 0015).
  // These fields carry explicit routing truth so quote-to-order conversion
  // preserves mixed routing without heuristic inference.
  //   requiresDesign   = true  → needs_design on conversion
  //   requiresPrepress = true  → ready_for_prepress (after design, if any)
  //   requiresPrepress = false → ready_for_production (skip prepress)
  //   requiresPrepress = null  → fall back to productType / org default at conversion time
  requiresDesignSnapshot: boolean("requires_design_snapshot").notNull().default(false),
  designBriefRequiredSnapshot: boolean("design_brief_required_snapshot").notNull().default(false),
  estimatedDesignMinutesSnapshot: integer("estimated_design_minutes_snapshot"),
  includedDesignMinutesSnapshot: integer("included_design_minutes_snapshot"),
  designPricingModeSnapshot: varchar("design_pricing_mode_snapshot", { length: 50 })
    .$type<ProductDesignPricingMode>()
    .notNull()
    .default("none"),
  flatFeeAmountSnapshot: decimal("flat_fee_amount_snapshot", { precision: 10, scale: 2 }),
  hourlyRateSnapshot: decimal("hourly_rate_snapshot", { precision: 10, scale: 2 }),
  overageRateSnapshot: decimal("overage_rate_snapshot", { precision: 10, scale: 2 }),
  internalLaborRateSnapshot: decimal("internal_labor_rate_snapshot", { precision: 10, scale: 2 }),
  needsDesignOverride: boolean("needs_design_override"),
  requiresDesign: boolean("requires_design").notNull().default(false),
  requiresPrepress: boolean("requires_prepress"),
  // Proof-approval snapshot (migration 0032). NULL = legacy row, falls back to live product on conversion.
  requiresProofApproval: boolean("requires_proof_approval"),
  // Bundle metadata (migration 0131). Parent wrappers are pricing/display-only;
  // their production requirements are always disabled by the bundle service.
  parentLineItemId: varchar("parent_line_item_id").references((): AnyPgColumn => quoteLineItems.id, { onDelete: 'set null' }),
  lineItemRole: lineItemRoleEnum("line_item_role").notNull().default("standalone"),
  childDisplayMode: lineItemChildDisplayModeEnum("child_display_mode").notNull().default("hidden"),
  parentPriceMode: lineItemParentPriceModeEnum("parent_price_mode").notNull().default("sum_children"),
  childCalculatedTotalCents: integer("child_calculated_total_cents"),
}, (table) => [
  index("quote_line_items_quote_id_idx").on(table.quoteId),
  index("quote_line_items_product_id_idx").on(table.productId),
  index("quote_line_items_product_type_idx").on(table.productType),
  index("quote_line_items_pbv2_tree_version_id_idx").on(table.pbv2TreeVersionId),
  index("quote_line_items_priced_at_idx").on(table.pricedAt),
  index("quote_line_items_parent_line_item_id_idx").on(table.parentLineItemId),
  index("quote_line_items_role_idx").on(table.lineItemRole),
]);

export const insertQuoteSchema = createInsertSchema(quotes).omit({
  id: true,
  quoteNumber: true,
  createdAt: true,
  organizationId: true,
}).extend({
  customerId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  status: z.enum(['draft', 'active', 'canceled']).default('draft').optional(),
  source: z.enum(['internal', 'customer_quick_quote']).default('internal'),
  visibleInCustomerPortal: z.boolean().optional(),
  subtotal: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(1).optional().nullable(),
  taxAmount: z.coerce.number().min(0).default(0),
  taxableSubtotal: z.coerce.number().min(0).default(0),
  marginPercentage: z.coerce.number().min(0).max(1),
  discountAmount: z.coerce.number().min(0),
  totalPrice: z.coerce.number().min(0),
  // Snapshot fields
  shippingMethod: z.enum(['pickup', 'ship', 'deliver']).optional().nullable(),
  shippingMode: z.enum(['single_shipment', 'multi_shipment']).optional().nullable(),
  requestedDueDate: z.string().optional().nullable(),
  validUntil: z.string().optional().nullable(),
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
  estimatedDesignMinutesSnapshot: z.coerce.number().int().nonnegative().optional().nullable(),
  includedDesignMinutesSnapshot: z.coerce.number().int().nonnegative().optional().nullable(),
  designPricingModeSnapshot: productDesignPricingModeSchema.optional(),
  flatFeeAmountSnapshot: z.coerce.number().nonnegative().optional().nullable(),
  hourlyRateSnapshot: z.coerce.number().nonnegative().optional().nullable(),
  overageRateSnapshot: z.coerce.number().nonnegative().optional().nullable(),
  internalLaborRateSnapshot: z.coerce.number().nonnegative().optional().nullable(),
  needsDesignOverride: z.boolean().optional().nullable(),
});

export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type UpdateQuote = z.infer<typeof updateQuoteSchema>;
export type Quote = typeof quotes.$inferSelect;
export type InsertQuoteLineItem = z.infer<typeof insertQuoteLineItemSchema>;
export type QuoteLineItem = typeof quoteLineItems.$inferSelect;

// Storage provider enum - for future multi-provider support
export const storageProviderEnum = pgEnum('storage_provider', ['local', 's3', 'gcs', 'supabase']);

// Thumbnail status enum - tracks thumbnail generation lifecycle
export const thumbStatusEnum = pgEnum('thumb_status', ['uploaded', 'thumb_pending', 'thumb_ready', 'thumb_failed']);

// Page count status enum - tracks PDF page count detection lifecycle
export const pageCountStatusEnum = pgEnum('page_count_status', ['unknown', 'detecting', 'known', 'failed']);

// Quote Attachments table - files uploaded during quote creation (before order conversion)
// Supports both quote-level attachments (quoteLineItemId = null) and line-item attachments
export const quoteAttachments = pgTable("quote_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  quoteId: varchar("quote_id").notNull().references(() => quotes.id, { onDelete: 'cascade' }),
  quoteLineItemId: varchar("quote_line_item_id").references(() => quoteLineItems.id, { onDelete: 'cascade' }), // NEW: Per-line-item attachment
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  fileRecordId: varchar("file_record_id").references((): AnyPgColumn => fileRecords.id, { onDelete: 'set null' }),
  uploadedByUserId: varchar("uploaded_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  uploadedByName: varchar("uploaded_by_name", { length: 255 }),
  // Legacy mirror fields (nullable; canonical source of truth is fileRecordId)
  fileName: varchar("file_name", { length: 500 }).notNull(),
  fileUrl: text("file_url"),
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type", { length: 100 }),
  description: text("description"),
  // NEW: Enhanced file storage fields
  originalFilename: varchar("original_filename", { length: 500 }), // Exact client-provided name
  storedFilename: varchar("stored_filename", { length: 500 }), // Sanitized disk filename
  relativePath: text("relative_path"), // Path relative to storage root
  storageProvider: storageProviderEnum("storage_provider").default('local'), // local, s3, gcs, etc.
  extension: varchar("extension", { length: 20 }), // File extension without dot
  sizeBytes: integer("size_bytes"), // File size in bytes
  checksum: varchar("checksum", { length: 64 }), // SHA256 or MD5 hash
  // Canonical production instruction for this quote-line/file relationship.
  // A shared group represents one finished variant, including its Front/Back.
  productionQuantity: integer("production_quantity"),
  productionGroupId: varchar("production_group_id", { length: 128 }),
  productionRole: varchar("production_role", { length: 16 }).default("artwork"),
  // Thumbnail support (legacy fields kept for backward compatibility)
  thumbnailRelativePath: text("thumbnail_relative_path"),
  thumbnailGeneratedAt: timestamp("thumbnail_generated_at"),
  // Thumbnail scaffolding fields (migration 0034)
  thumbStatus: thumbStatusEnum("thumb_status").default('uploaded'),
  thumbKey: text("thumb_key"), // Storage key for small thumbnail (e.g., 200x200)
  previewKey: text("preview_key"), // Storage key for medium preview (e.g., 800x800)
  thumbError: text("thumb_error"), // Error message if thumbnail generation failed
  // PDF page count (for multi-page PDF support)
  pageCount: integer("page_count"), // Total number of pages for PDF files
  pageCountStatus: pageCountStatusEnum("page_count_status").default('unknown'), // Status of page count detection
  pageCountError: text("page_count_error"), // Error message if page count detection failed
  pageCountUpdatedAt: timestamp("page_count_updated_at"), // Timestamp when page count status was last updated
  customerVisible: boolean("customer_visible").default(false).notNull(),
  portalFileCategory: varchar("portal_file_category", { length: 64 }),
  portalDisplayName: varchar("portal_display_name", { length: 500 }),
  portalDescription: text("portal_description"),
  portalVisibilityUpdatedAt: timestamp("portal_visibility_updated_at"),
  portalVisibilityUpdatedBy: varchar("portal_visibility_updated_by").references(() => users.id, { onDelete: 'set null' }),
  customerUploadReviewStatus: varchar("customer_upload_review_status", { length: 32 }),
  customerUploadReviewedByUserId: varchar("customer_upload_reviewed_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  customerUploadReviewedAt: timestamp("customer_upload_reviewed_at"),
  customerUploadReviewNote: text("customer_upload_review_note"),
  customerUploadPromotionType: varchar("customer_upload_promotion_type", { length: 32 }),
  customerUploadPromotedByUserId: varchar("customer_upload_promoted_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  customerUploadPromotedAt: timestamp("customer_upload_promoted_at"),
  bucket: varchar("bucket", { length: 100 }).default('titan-private'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("quote_attachments_quote_id_idx").on(table.quoteId),
  index("quote_attachments_quote_line_item_id_idx").on(table.quoteLineItemId),
  index("quote_attachments_organization_id_idx").on(table.organizationId),
  index("quote_attachments_file_record_id_idx").on(table.fileRecordId),
  index("quote_attachments_production_group_idx").on(table.quoteLineItemId, table.productionGroupId),
  index("quote_attachments_thumb_status_idx").on(table.thumbStatus),
  index("quote_attachments_page_count_status_idx").on(table.pageCountStatus),
  index("quote_attachments_portal_visible_idx").on(table.organizationId, table.quoteId, table.customerVisible),
  index("quote_attachments_customer_upload_review_idx").on(table.organizationId, table.customerUploadReviewStatus),
  index("quote_attachments_customer_upload_promotion_idx").on(table.organizationId, table.customerUploadPromotionType),
]);

export const insertQuoteAttachmentSchema = createInsertSchema(quoteAttachments).omit({
  id: true,
  createdAt: true,
}).extend({
  quoteLineItemId: z.string().optional().nullable(),
});

export type InsertQuoteAttachment = z.infer<typeof insertQuoteAttachmentSchema>;
export type QuoteAttachment = typeof quoteAttachments.$inferSelect;

// Quote attachment pages table (for multi-page PDF thumbnails)
export const quoteAttachmentPages = pgTable("quote_attachment_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  attachmentId: varchar("attachment_id").notNull().references(() => quoteAttachments.id, { onDelete: 'cascade' }),
  pageIndex: integer("page_index").notNull(), // 0-based page index
  thumbStatus: thumbStatusEnum("thumb_status").notNull().default('uploaded'),
  thumbFileRecordId: varchar("thumb_file_record_id").references(() => fileRecords.id, { onDelete: 'set null' }),
  thumbKey: text("thumb_key"), // Storage key for page thumbnail
  previewFileRecordId: varchar("preview_file_record_id").references(() => fileRecords.id, { onDelete: 'set null' }),
  previewKey: text("preview_key"), // Storage key for page preview
  thumbError: text("thumb_error"), // Error message if page thumbnail generation failed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("quote_attachment_pages_attachment_id_idx").on(table.attachmentId),
  index("quote_attachment_pages_organization_id_idx").on(table.organizationId),
  index("quote_attachment_pages_thumb_file_idx").on(table.thumbFileRecordId),
  index("quote_attachment_pages_preview_file_idx").on(table.previewFileRecordId),
  // Enforce uniqueness: one row per page per attachment
  uniqueIndex("quote_attachment_pages_attachment_page_idx").on(table.attachmentId, table.pageIndex),
]);

export const insertQuoteAttachmentPageSchema = createInsertSchema(quoteAttachmentPages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertQuoteAttachmentPage = z.infer<typeof insertQuoteAttachmentPageSchema>;
export type QuoteAttachmentPage = typeof quoteAttachmentPages.$inferSelect;

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
  organizationId: true,
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
  organizationId: true,
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
  materialLinks: many(materialProductLinks),
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

  // Platform-managed OAuth connection state (migration 0061)
  connectionStatus: varchar("connection_status", { length: 50 }).notNull().default("not_connected"),
  connectedAt: timestamp("connected_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("email_settings_organization_id_idx").on(table.organizationId),
]);

export const insertEmailSettingsSchema = createInsertSchema(emailSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
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
  connectionStatus: z.enum(["not_connected", "connected", "disconnected", "token_exchange_failed", "revoked_or_invalid"]).default("not_connected").optional(),
  connectedAt: z.date().nullable().optional(),
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
  organizationId: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

export const printerProfileTypeValues = ["production_ticket", "shipping_label", "office_document", "other"] as const;
export const printerProfileScopeValues = ["organization"] as const;

export const printerProfiles = pgTable("printer_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  displayName: varchar("display_name", { length: 160 }).notNull(),
  printerType: varchar("printer_type", { length: 40 }).notNull().$type<typeof printerProfileTypeValues[number]>(),
  intendedUse: varchar("intended_use", { length: 80 }).notNull().default("production_ticket"),
  stationRoute: varchar("station_route", { length: 120 }),
  scope: varchar("scope", { length: 40 }).notNull().default("organization").$type<typeof printerProfileScopeValues[number]>(),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("printer_profiles_org_idx").on(table.organizationId),
  index("printer_profiles_org_active_idx").on(table.organizationId, table.isActive),
  index("printer_profiles_org_type_idx").on(table.organizationId, table.printerType),
  uniqueIndex("printer_profiles_org_default_use_uidx")
    .on(table.organizationId, table.intendedUse)
    .where(sql`${table.isDefault} = true AND ${table.isActive} = true`),
]);

export const insertPrinterProfileSchema = createInsertSchema(printerProfiles).omit({
  id: true,
  organizationId: true,
  createdByUserId: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
  lastUsedAt: true,
}).extend({
  displayName: z.string().trim().min(1).max(160),
  printerType: z.enum(printerProfileTypeValues),
  intendedUse: z.string().trim().min(1).max(80).default("production_ticket"),
  stationRoute: z.string().trim().max(120).optional().nullable(),
  scope: z.enum(printerProfileScopeValues).default("organization"),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

export const updatePrinterProfileSchema = insertPrinterProfileSchema.partial();

export type PrinterProfile = typeof printerProfiles.$inferSelect;
export type InsertPrinterProfile = z.infer<typeof insertPrinterProfileSchema>;
export type UpdatePrinterProfile = z.infer<typeof updatePrinterProfileSchema>;

export type PortalFollowUpEventType =
  | "QUOTE_APPROVED"
  | "QUOTE_DECLINED"
  | "QUOTE_REVISION_REQUESTED"
  | "PROOF_APPROVED"
  | "PROOF_REJECTED"
  | "PROOF_REVISION_REQUESTED"
  | "INVOICE_PAYMENT_SUCCEEDED";

export type PortalFollowUpStatus = "new" | "pending" | "completed";

export const portalFollowUpItems = pgTable("portal_follow_up_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
  eventType: varchar("event_type", { length: 80 }).notNull().$type<PortalFollowUpEventType>(),
  status: varchar("status", { length: 30 }).notNull().default("new").$type<PortalFollowUpStatus>(),
  customerId: varchar("customer_id").references(() => customers.id, { onDelete: "set null" }),
  customerName: text("customer_name"),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  entityId: varchar("entity_id").notNull(),
  relatedOrderId: varchar("related_order_id"),
  relatedQuoteId: varchar("related_quote_id"),
  relatedProofId: varchar("related_proof_id"),
  title: text("title").notNull(),
  description: text("description"),
  followUpArea: varchar("follow_up_area", { length: 80 }),
  actionUrl: text("action_url"),
  source: varchar("source", { length: 80 }).notNull().default("customer_portal"),
  sourceAuditLogId: varchar("source_audit_log_id").references(() => auditLogs.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("portal_follow_up_items_org_idempotency_uidx").on(table.organizationId, table.idempotencyKey),
  index("portal_follow_up_items_org_status_created_idx").on(table.organizationId, table.status, table.createdAt),
  index("portal_follow_up_items_org_event_created_idx").on(table.organizationId, table.eventType, table.createdAt),
  index("portal_follow_up_items_customer_idx").on(table.customerId),
  index("portal_follow_up_items_entity_idx").on(table.organizationId, table.entityType, table.entityId),
]);

export const insertPortalFollowUpItemSchema = createInsertSchema(portalFollowUpItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PortalFollowUpItem = typeof portalFollowUpItems.$inferSelect;
export type InsertPortalFollowUpItem = z.infer<typeof insertPortalFollowUpItemSchema>;

// ============================================================
// PLATFORM AUDIT LOGS — cross-org platform events (orgId nullable)
// ============================================================
export const platformAuditLogs = pgTable("platform_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // varchar matches organizations.id / users.id type; nullable FKs SET NULL on delete
  // so audit records survive org/user deletion.
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: 'set null' }),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: 'set null' }),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),      // e.g. 'org.create', 'platform.reauth'
  ip: text("ip").notNull(),
  userAgent: text("user_agent").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("platform_audit_logs_actor_user_id_idx").on(table.actorUserId),
  index("platform_audit_logs_action_idx").on(table.action),
  index("platform_audit_logs_created_at_idx").on(table.createdAt),
  index("platform_audit_logs_action_created_at_idx").on(table.action, table.createdAt),
]);

export type PlatformAuditLog = typeof platformAuditLogs.$inferSelect;

// ============================================================
// ORG INVITES — platform-admin created, owner bootstrapping
// ============================================================
export const orgInvites = pgTable("org_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  email: text("email").notNull(),
  role: text("role").notNull().default('owner'),
  tokenHash: text("token_hash").notNull(), // SHA-256 of raw token; never store raw (uniqueness enforced by composite index)
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // RESTRICT: cannot delete platform-admin user while outstanding invites exist (accountability)
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
}, (table) => [
  index("org_invites_org_id_idx").on(table.orgId),
  index("org_invites_email_idx").on(table.email),
  index("org_invites_expires_at_idx").on(table.expiresAt),
  index("org_invites_created_by_user_id_idx").on(table.createdByUserId),
  uniqueIndex("org_invites_org_id_token_hash_uidx").on(table.orgId, table.tokenHash),
]);

export type OrgInvite = typeof orgInvites.$inferSelect;

export type CompanySettingsAddress = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

export type CompanySettingsRemittanceAddress = CompanySettingsAddress & {
  enabled?: boolean | null;
};

// Company Settings table
export const companySettings = pgTable("company_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  companyDisplayName: varchar("company_display_name", { length: 255 }),
  legalCompanyName: varchar("legal_company_name", { length: 255 }),
  address: text("address"),
  physicalAddress: jsonb("physical_address").$type<CompanySettingsAddress>(),
  remittanceAddress: jsonb("remittance_address").$type<CompanySettingsRemittanceAddress>(),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 255 }),
  website: varchar("website", { length: 255 }),
  taxId: varchar("tax_id", { length: 100 }),
  logoUrl: text("logo_url"),
  invoiceLogoUrl: text("invoice_logo_url"),
  invoiceLogoAssetId: varchar("invoice_logo_asset_id"),
  invoicePaymentInstructions: text("invoice_payment_instructions"),
  invoiceFooterNote: text("invoice_footer_note"),
  checksPayableTo: varchar("checks_payable_to", { length: 255 }),
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
  organizationId: true,
});

export const updateCompanySettingsSchema = insertCompanySettingsSchema.partial();

export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type UpdateCompanySettings = z.infer<typeof updateCompanySettingsSchema>;
export type CompanySettings = typeof companySettings.$inferSelect;

// Customers table
export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  organizationId: varchar("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),

  companyName: varchar("company_name", { length: 255 }).notNull(),
  customerType: varchar("customer_type", { length: 50 }).default("business"),
  displayName: varchar("display_name", { length: 255 }),
  individualFirstName: varchar("individual_first_name", { length: 100 }),
  individualLastName: varchar("individual_last_name", { length: 100 }),
  sourceContactId: varchar("source_contact_id"),
  accountCreationSource: varchar("account_creation_source", { length: 50 }),

  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  website: varchar("website", { length: 255 }),

  // Legacy fields kept for backward compatibility
  billingAddress: text("billing_address"),
  shippingAddress: text("shipping_address"),

  // NEW structured billing address
  billingStreet1: varchar("billing_street1", { length: 255 }),
  billingStreet2: varchar("billing_street2", { length: 255 }),
  billingCity: varchar("billing_city", { length: 100 }),
  billingState: varchar("billing_state", { length: 100 }),
  billingPostalCode: varchar("billing_postal_code", { length: 20 }),
  billingCountry: varchar("billing_country", { length: 100 }),

  // NEW structured shipping address
  shippingStreet1: varchar("shipping_street1", { length: 255 }),
  shippingStreet2: varchar("shipping_street2", { length: 255 }),
  shippingCity: varchar("shipping_city", { length: 100 }),
  shippingState: varchar("shipping_state", { length: 100 }),
  shippingPostalCode: varchar("shipping_postal_code", { length: 20 }),
  shippingCountry: varchar("shipping_country", { length: 100 }),

  taxId: varchar("tax_id", { length: 100 }),
  creditLimit: decimal("credit_limit", { precision: 10, scale: 2 }).default("0"),
  // A legacy zero cannot safely tell us whether credit was intentionally set
  // to $0. This marker preserves the distinction without replacing the money
  // column or rewriting financial history.
  creditLimitConfiguredAt: timestamp("credit_limit_configured_at", { withTimezone: true }),

  // Pricing tier for wholesale/retail support
  pricingTier: varchar("pricing_tier", { length: 20 }).default("default"),

  // Per-customer pricing modifiers (applied after tier selection)
  defaultDiscountPercent: decimal("default_discount_percent", { precision: 5, scale: 2 }),
  defaultMarkupPercent: decimal("default_markup_percent", { precision: 5, scale: 2 }),
  defaultMarginPercent: decimal("default_margin_percent", { precision: 5, scale: 2 }),

  // Product visibility control for customer portal
  productVisibilityMode: varchar("product_visibility_mode", { length: 20 }).default("default").notNull(),

  // Tax system fields
  isTaxExempt: boolean("is_tax_exempt").default(false).notNull(),
  taxRateOverride: decimal("tax_rate_override", { precision: 5, scale: 4 }),
  taxExemptReason: text("tax_exempt_reason"),
  taxExemptCertificateRef: text("tax_exempt_certificate_ref"),
  // Commercial defaults used for future quote/order context only.
  paymentTerms: varchar("payment_terms", { length: 50 }).notNull().default("due_on_receipt"),
  blindShipping: boolean("blind_shipping").notNull().default(false),
  // Customer-specific operational preference. This remains effective even when
  // product-driven proofing is temporarily suspended for the organization.
  alwaysRequireProof: boolean("always_require_proof").notNull().default(false),

  // 🔥 SAFETY FIX — add back is_active so Drizzle stops trying to drop it
  isActive: boolean("is_active").default(true),

  currentBalance: decimal("current_balance", { precision: 10, scale: 2 }).default("0"),

  // Future replacement for is_active, but NOT removing the old column yet
  status: varchar("status", { length: 50 }).default("active"),

  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  assignedTo: varchar("assigned_to").references(() => users.id),
  notes: text("notes"),

  // QuickBooks sync
  externalAccountingId: varchar("external_accounting_id", { length: 64 }),
  /**
   * Per-field override flags to prevent external (e.g. QuickBooks) pulls from overwriting Titan values.
   * v1: JSONB map of fieldName -> true.
   */
  qbFieldOverrides: jsonb("qb_field_overrides").$type<Record<string, boolean>>(),
  syncStatus: varchar("sync_status", { length: 20 }),
  syncError: text("sync_error"),
  syncedAt: timestamp("synced_at", { withTimezone: false }),

  // Customer merge provenance. Merged records are retained, never deleted.
  mergedIntoCustomerId: varchar("merged_into_customer_id").references((): any => customers.id, { onDelete: "restrict" }),
  mergedAt: timestamp("merged_at", { withTimezone: true }),
  mergedByUserId: varchar("merged_by_user_id").references(() => users.id, { onDelete: "set null" }),
  customerMergeOperationId: varchar("customer_merge_operation_id"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("customers_organization_id_idx").on(table.organizationId),
  index("customers_user_id_idx").on(table.userId),
  index("customers_email_idx").on(table.email),
  index("customers_source_contact_idx").on(table.organizationId, table.sourceContactId),
  uniqueIndex("customers_individual_source_contact_uidx")
    .on(table.organizationId, table.sourceContactId)
    .where(sql`customer_type = 'individual' AND source_contact_id IS NOT NULL`),
  index("customers_merged_into_customer_idx").on(table.organizationId, table.mergedIntoCustomerId),
]);

export const customerMergeOperations = pgTable("customer_merge_operations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  survivorCustomerId: varchar("survivor_customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
  sourceCustomerIds: jsonb("source_customer_ids").notNull().$type<string[]>(),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  fieldChoices: jsonb("field_choices").$type<Record<string, string>>(),
  relationshipCounts: jsonb("relationship_counts").notNull().$type<Record<string, number>>(),
  warnings: jsonb("warnings").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("customer_merge_operations_org_created_idx").on(table.organizationId, table.createdAt),
  index("customer_merge_operations_survivor_idx").on(table.organizationId, table.survivorCustomerId),
]);

export const insertCustomerSchema = createInsertSchema(customers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
}).extend({
  pricingTier: z.enum(["default", "wholesale", "retail"]).default("default"),
  // Per-customer pricing modifiers
  defaultDiscountPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  defaultMarkupPercent: z.coerce.number().min(0).max(500).optional().nullable(),
  defaultMarginPercent: z.coerce.number().min(0).max(95).optional().nullable(),
  productVisibilityMode: z.enum(["default", "linked-only"]).default("default"),
  // Tax fields
  isTaxExempt: z.boolean().default(false),
  taxRateOverride: z.coerce.number().min(0).max(0.30).optional().nullable().transform(val => val === undefined || isNaN(val as any) ? null : val),
  taxExemptReason: z.string().max(255).optional().nullable(),
  taxExemptCertificateRef: z.string().max(512).optional().nullable(),
  paymentTerms: z.enum(["due_on_receipt", "net_15", "net_30", "net_45", "custom"]).default("due_on_receipt"),
  blindShipping: z.boolean().default(false),
  // All structured address fields are optional
  billingStreet1: z.string().max(255).optional(),
  billingStreet2: z.string().max(255).optional(),
  billingCity: z.string().max(100).optional(),
  billingState: z.string().max(100).optional(),
  billingPostalCode: z.string().max(20).optional(),
  billingCountry: z.string().max(100).optional(),
  shippingStreet1: z.string().max(255).optional(),
  shippingStreet2: z.string().max(255).optional(),
  shippingCity: z.string().max(100).optional(),
  shippingState: z.string().max(100).optional(),
  shippingPostalCode: z.string().max(20).optional(),
  shippingCountry: z.string().max(100).optional(),
  qbFieldOverrides: z.record(z.boolean()).optional().nullable(),
});

// Base schema for updates (before refinement)
const baseCustomerSchema = insertCustomerSchema;

// Refined schema with tax exempt validation
export const insertCustomerSchemaRefined = insertCustomerSchema.refine(
  (data) => {
    // If tax exempt is true, require a reason
    if (data.isTaxExempt && !data.taxExemptReason) {
      return false;
    }
    return true;
  },
  {
    message: "Tax exempt reason is required when marking customer as tax exempt",
    path: ["taxExemptReason"],
  }
);

export const updateCustomerSchema = baseCustomerSchema.partial();

export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type UpdateCustomer = z.infer<typeof updateCustomerSchema>;
export type Customer = typeof customers.$inferSelect;

// ==================== Data Import / Export Jobs ====================

export const importResourceEnum = pgEnum('import_resource', ['customers', 'materials', 'products']);
export const importJobStatusEnum = pgEnum('import_job_status', ['validated', 'applied', 'error']);
export const importApplyModeEnum = pgEnum('import_apply_mode', ['MERGE_RESPECT_OVERRIDES', 'MERGE_AND_SET_OVERRIDES']);
export const importRowStatusEnum = pgEnum('import_row_status', ['valid', 'invalid', 'applied', 'skipped', 'error']);

export const importJobs = pgTable('import_jobs', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  resource: importResourceEnum('resource').notNull(),
  status: importJobStatusEnum('status').notNull().default('validated'),
  applyMode: importApplyModeEnum('apply_mode').notNull().default('MERGE_RESPECT_OVERRIDES'),
  sourceFilename: varchar('source_filename', { length: 255 }),
  createdByUserId: varchar('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  summaryJson: jsonb('summary_json'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('import_jobs_organization_id_idx').on(table.organizationId),
  index('import_jobs_resource_status_idx').on(table.resource, table.status),
  index('import_jobs_created_at_idx').on(table.createdAt),
]);

export const importJobRows = pgTable('import_job_rows', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  jobId: varchar('job_id').notNull().references(() => importJobs.id, { onDelete: 'cascade' }),
  rowNumber: integer('row_number').notNull(),
  status: importRowStatusEnum('status').notNull().default('valid'),
  rawJson: jsonb('raw_json'),
  normalizedJson: jsonb('normalized_json'),
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('import_job_rows_organization_id_idx').on(table.organizationId),
  index('import_job_rows_job_id_idx').on(table.jobId),
  index('import_job_rows_status_idx').on(table.status),
]);

export type ImportJob = typeof importJobs.$inferSelect;
export type InsertImportJob = typeof importJobs.$inferInsert;
export type ImportJobRow = typeof importJobRows.$inferSelect;
export type InsertImportJobRow = typeof importJobRows.$inferInsert;

// ==================== Material Import Batches ====================
// Dedicated staging tables for the CSV materials import workflow.
// Permanent materials are only modified during the explicit commit step.
// Batch status values: uploaded | parsed | validated | review_ready | committed | failed | cancelled
// Row status values:   pending | valid | invalid | conflict | ready_to_apply | applied | skipped

export type MaterialImportBatchStatus =
  | 'uploaded'
  | 'parsed'
  | 'validated'
  | 'review_ready'
  | 'committed'
  | 'failed'
  | 'cancelled';

export type MaterialImportRowStatus =
  | 'pending'
  | 'valid'
  | 'invalid'
  | 'conflict'
  | 'ready_to_apply'
  | 'applied'
  | 'skipped';

export type MaterialImportRowAction = 'create' | 'update' | 'skip' | null;

export const materialImportBatches = pgTable('material_import_batches', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 30 }).notNull().default('uploaded').$type<MaterialImportBatchStatus>(),
  sourceFilename: varchar('source_filename', { length: 255 }),
  createdByUserId: varchar('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  totalRows: integer('total_rows').notNull().default(0),
  validRows: integer('valid_rows').notNull().default(0),
  invalidRows: integer('invalid_rows').notNull().default(0),
  conflictRows: integer('conflict_rows').notNull().default(0),
  skippedRows: integer('skipped_rows').notNull().default(0),
  errorMessage: text('error_message'),
  summaryJson: jsonb('summary_json'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('material_import_batches_org_idx').on(table.organizationId),
  index('material_import_batches_status_idx').on(table.status),
  index('material_import_batches_created_idx').on(table.createdAt),
]);

export const materialImportRows = pgTable('material_import_rows', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  batchId: varchar('batch_id').notNull().references(() => materialImportBatches.id, { onDelete: 'cascade' }),
  rowNumber: integer('row_number').notNull(),
  status: varchar('status', { length: 30 }).notNull().default('pending').$type<MaterialImportRowStatus>(),
  action: varchar('action', { length: 20 }).$type<'create' | 'update' | 'skip'>(),
  existingMaterialId: varchar('existing_material_id').references(() => materials.id, { onDelete: 'set null' }),
  rawJson: jsonb('raw_json'),
  normalizedJson: jsonb('normalized_json'),
  validationErrors: jsonb('validation_errors').$type<string[]>(),
  matchedBy: varchar('matched_by', { length: 30 }).$type<'material_id' | 'sku' | 'vendor_lookup' | 'name' | 'new' | 'conflict'>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('material_import_rows_batch_idx').on(table.batchId),
  index('material_import_rows_org_idx').on(table.organizationId),
  index('material_import_rows_status_idx').on(table.status),
]);

export type MaterialImportBatch = typeof materialImportBatches.$inferSelect;
export type MaterialImportRow = typeof materialImportRows.$inferSelect;

// Customer Visible Products - Junction table for portal product visibility
export const customerVisibleProducts = pgTable("customer_visible_products", {
  customerId: varchar("customer_id").notNull().references(() => customers.id, { onDelete: 'cascade' }),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.customerId, table.productId] }),
  index("customer_visible_products_customer_id_idx").on(table.customerId),
  index("customer_visible_products_product_id_idx").on(table.productId),
]);

export const insertCustomerVisibleProductSchema = createInsertSchema(customerVisibleProducts).omit({
  createdAt: true,
});

export type InsertCustomerVisibleProduct = z.infer<typeof insertCustomerVisibleProductSchema>;
export type CustomerVisibleProduct = typeof customerVisibleProducts.$inferSelect;

// Customer Contacts table
export const customerContacts = pgTable("customer_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  // Deprecated compatibility field: relationship membership lives in customerContactLinks.
  customerId: varchar("customer_id").references(() => customers.id, { onDelete: 'set null' }),
  firstName: varchar("first_name", { length: 100 }).notNull(),
  lastName: varchar("last_name", { length: 100 }).notNull(),
  title: varchar("title", { length: 100 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  mobile: varchar("mobile", { length: 50 }),
  isPrimary: boolean("is_primary").default(false).notNull(),
  // Structured address fields for contact
  street1: varchar("street1", { length: 255 }),
  street2: varchar("street2", { length: 255 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 100 }),
  postalCode: varchar("postal_code", { length: 20 }),
  country: varchar("country", { length: 100 }),
  // External source tracking for idempotent QB sync
  externalSource: varchar("external_source", { length: 30 }),
  externalSourceId: text("external_source_id"),
  externalSourceType: varchar("external_source_type", { length: 50 }),
  // Internal CRM fields — staff-only, never exposed to customer-facing views
  internalNotes: text("internal_notes"),
  flags: jsonb("flags").$type<string[]>(),
  status: varchar("status", { length: 30 }).default("active").notNull().$type<"active" | "archived">(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("customer_contacts_org_idx").on(table.organizationId),
  index("customer_contacts_legacy_customer_idx").on(table.customerId),
  index("customer_contacts_status_idx").on(table.status),
  // Partial unique index: one source-tracked contact per QB identity per customer.
  // Only enforced when both external_source and external_source_id are non-null,
  // so manually-created contacts (no source) are never affected.
  uniqueIndex("customer_contacts_qb_source_uidx")
    .on(table.customerId, table.externalSource, table.externalSourceId, table.externalSourceType)
    .where(sql`external_source IS NOT NULL AND external_source_id IS NOT NULL`),
]);

export const customerContactLinks = pgTable("customer_contact_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").notNull().references(() => customerContacts.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 30 }).default("active").notNull().$type<"active" | "former" | "removed">(),
  isPrimary: boolean("is_primary").default(false).notNull(),
  isBilling: boolean("is_billing").default(false).notNull(),
  isPortal: boolean("is_portal").default(false).notNull(),
  isProof: boolean("is_proof").default(false).notNull(),
  role: varchar("role", { length: 100 }),
  sourceSystem: varchar("source_system", { length: 50 }),
  sourceRecordId: varchar("source_record_id", { length: 255 }),
  startDate: timestamp("start_date", { withTimezone: false }),
  endDate: timestamp("end_date", { withTimezone: false }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("customer_contact_links_org_idx").on(table.organizationId),
  index("customer_contact_links_customer_idx").on(table.customerId),
  index("customer_contact_links_contact_idx").on(table.contactId),
  index("customer_contact_links_status_idx").on(table.status),
  uniqueIndex("customer_contact_links_active_pair_uidx")
    .on(table.customerId, table.contactId)
    .where(sql`status <> 'removed'`),
  uniqueIndex("customer_contact_links_primary_uidx")
    .on(table.customerId)
    .where(sql`is_primary = true AND status = 'active'`),
]);

export const insertCustomerContactSchema = createInsertSchema(customerContacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  organizationId: z.string().optional(),
  customerId: z.string().nullable().optional(),
  // All structured address fields are optional
  street1: z.string().max(255).optional(),
  street2: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
  internalNotes: z.string().max(10000).nullable().optional(),
  flags: z.array(
    z.enum(["vip", "billing_contact", "artwork_contact", "do_not_email", "needs_follow_up", "problem_contact"])
  ).nullable().optional(),
});

export const updateCustomerContactSchema = insertCustomerContactSchema.partial();

export const insertCustomerContactLinkSchema = createInsertSchema(customerContactLinks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(["active", "former", "removed"]).optional(),
});

export const updateCustomerContactLinkSchema = insertCustomerContactLinkSchema.partial();

export type InsertCustomerContact = z.infer<typeof insertCustomerContactSchema>;
export type UpdateCustomerContact = z.infer<typeof updateCustomerContactSchema>;
export type CustomerContact = typeof customerContacts.$inferSelect;
export type InsertCustomerContactLink = z.infer<typeof insertCustomerContactLinkSchema>;
export type UpdateCustomerContactLink = z.infer<typeof updateCustomerContactLinkSchema>;
export type CustomerContactLink = typeof customerContactLinks.$inferSelect;

// ==================== Customer + Contact Migration ====================
// Staging tables for platform-led onboarding imports. Permanent customer,
// contact, link, and external identity records are only changed at finalize.

export type CustomerContactImportBatchStatus =
  | "uploaded"
  | "parsed"
  | "validated"
  | "matching"
  | "needs_review"
  | "ready_to_finalize"
  | "finalizing"
  | "completed"
  | "completed_with_exceptions"
  | "failed"
  | "cancelled";

export type CustomerContactImportCompanyStatus =
  | "pending"
  | "matched_existing"
  | "new_company"
  | "ambiguous"
  | "rejected"
  | "imported"
  | "failed";

export type CustomerContactImportContactStatus =
  | "pending"
  | "matched_existing_person"
  | "new_person"
  | "ambiguous_person"
  | "company_matched"
  | "company_ambiguous"
  | "company_pending"
  | "company_missing"
  | "rejected"
  | "imported"
  | "failed";

export type CustomerContactImportRelationshipStatus =
  | "pending"
  | "ready"
  | "pending_company"
  | "ambiguous"
  | "created"
  | "updated"
  | "skipped"
  | "failed";

export const externalIdentityMappings = pgTable("external_identity_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: varchar("entity_id", { length: 255 }).notNull(),
  sourceSystem: varchar("source_system", { length: 50 }).notNull(),
  sourceEntityType: varchar("source_entity_type", { length: 50 }).notNull(),
  sourceRecordId: varchar("source_record_id", { length: 255 }).notNull(),
  sourceDisplayName: varchar("source_display_name", { length: 255 }),
  metadataJson: jsonb("metadata_json"),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("external_identity_mappings_org_entity_idx").on(table.organizationId, table.entityType, table.entityId),
  index("external_identity_mappings_org_source_idx").on(table.organizationId, table.sourceSystem, table.sourceEntityType),
  uniqueIndex("external_identity_mappings_source_uidx")
    .on(table.organizationId, table.sourceSystem, table.sourceEntityType, table.sourceRecordId),
]);

export const customerContactImportBatches = pgTable("customer_contact_import_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 40 }).notNull().default("uploaded").$type<CustomerContactImportBatchStatus>(),
  sourceLabel: varchar("source_label", { length: 255 }),
  qbSourceLabel: varchar("qb_source_label", { length: 255 }),
  infoFloCompanyFilename: varchar("infoflo_company_filename", { length: 255 }),
  infoFloCompanyChecksum: varchar("infoflo_company_checksum", { length: 128 }),
  infoFloContactsFilename: varchar("infoflo_contacts_filename", { length: 255 }),
  infoFloContactsChecksum: varchar("infoflo_contacts_checksum", { length: 128 }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  finalizedByUserId: varchar("finalized_by_user_id").references(() => users.id, { onDelete: "set null" }),
  finalizedAt: timestamp("finalized_at", { withTimezone: false }),
  lockedAt: timestamp("locked_at", { withTimezone: false }),
  lockToken: varchar("lock_token", { length: 100 }),
  failingStage: varchar("failing_stage", { length: 100 }),
  failingRecordId: varchar("failing_record_id", { length: 255 }),
  errorMessage: text("error_message"),
  summaryJson: jsonb("summary_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("customer_contact_import_batches_org_idx").on(table.organizationId),
  index("customer_contact_import_batches_status_idx").on(table.status),
  index("customer_contact_import_batches_created_idx").on(table.createdAt),
]);

export type CustomerContactQuickBooksSourceMode = "live" | "upload";

export const customerContactQuickBooksSourceSnapshots = pgTable("customer_contact_quickbooks_source_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceMode: varchar("source_mode", { length: 20 }).notNull().$type<CustomerContactQuickBooksSourceMode>(),
  status: varchar("status", { length: 30 }).notNull().default("ready"),
  connectedCompanyName: varchar("connected_company_name", { length: 255 }),
  quickBooksCompanyId: varchar("quickbooks_company_id", { length: 64 }),
  lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { withTimezone: false }),
  retrievedCount: integer("retrieved_count").notNull().default(0),
  rawCustomersJson: jsonb("raw_customers_json").$type<Record<string, unknown>[]>(),
  apiError: text("api_error"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("cc_qb_source_snapshots_org_created_idx").on(table.organizationId, table.createdAt),
  index("cc_qb_source_snapshots_org_status_idx").on(table.organizationId, table.status),
]);

export const customerContactImportCompanyRecords = pgTable("customer_contact_import_company_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  batchId: varchar("batch_id").notNull().references(() => customerContactImportBatches.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  status: varchar("status", { length: 40 }).notNull().default("pending").$type<CustomerContactImportCompanyStatus>(),
  sourceSystem: varchar("source_system", { length: 50 }).notNull().default("infoflo"),
  sourceRecordId: varchar("source_record_id", { length: 255 }),
  quickBooksCustomerId: varchar("quickbooks_customer_id", { length: 64 }),
  selectedCustomerId: varchar("selected_customer_id").references(() => customers.id, { onDelete: "set null" }),
  rawJson: jsonb("raw_json"),
  normalizedJson: jsonb("normalized_json"),
  matchCandidatesJson: jsonb("match_candidates_json"),
  proposedChangesJson: jsonb("proposed_changes_json"),
  reviewDecisionJson: jsonb("review_decision_json"),
  warningsJson: jsonb("warnings_json").$type<string[]>(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("cc_import_company_batch_idx").on(table.batchId),
  index("cc_import_company_org_status_idx").on(table.organizationId, table.status),
  index("cc_import_company_source_idx").on(table.organizationId, table.sourceSystem, table.sourceRecordId),
]);

export const customerContactImportContactRecords = pgTable("customer_contact_import_contact_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  batchId: varchar("batch_id").notNull().references(() => customerContactImportBatches.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  status: varchar("status", { length: 40 }).notNull().default("pending").$type<CustomerContactImportContactStatus>(),
  sourceSystem: varchar("source_system", { length: 50 }).notNull().default("infoflo"),
  sourceRecordId: varchar("source_record_id", { length: 255 }),
  selectedContactId: varchar("selected_contact_id").references(() => customerContacts.id, { onDelete: "set null" }),
  selectedCustomerId: varchar("selected_customer_id").references(() => customers.id, { onDelete: "set null" }),
  rawJson: jsonb("raw_json"),
  normalizedJson: jsonb("normalized_json"),
  matchCandidatesJson: jsonb("match_candidates_json"),
  proposedChangesJson: jsonb("proposed_changes_json"),
  reviewDecisionJson: jsonb("review_decision_json"),
  warningsJson: jsonb("warnings_json").$type<string[]>(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("cc_import_contact_batch_idx").on(table.batchId),
  index("cc_import_contact_org_status_idx").on(table.organizationId, table.status),
  index("cc_import_contact_source_idx").on(table.organizationId, table.sourceSystem, table.sourceRecordId),
]);

export const customerContactImportRelationshipRecords = pgTable("customer_contact_import_relationship_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  batchId: varchar("batch_id").notNull().references(() => customerContactImportBatches.id, { onDelete: "cascade" }),
  companyRecordId: varchar("company_record_id").references(() => customerContactImportCompanyRecords.id, { onDelete: "set null" }),
  contactRecordId: varchar("contact_record_id").references(() => customerContactImportContactRecords.id, { onDelete: "set null" }),
  status: varchar("status", { length: 40 }).notNull().default("pending").$type<CustomerContactImportRelationshipStatus>(),
  selectedCustomerId: varchar("selected_customer_id").references(() => customers.id, { onDelete: "set null" }),
  selectedContactId: varchar("selected_contact_id").references(() => customerContacts.id, { onDelete: "set null" }),
  selectedLinkId: varchar("selected_link_id").references(() => customerContactLinks.id, { onDelete: "set null" }),
  isPrimary: boolean("is_primary").default(false).notNull(),
  isBilling: boolean("is_billing").default(false).notNull(),
  isProof: boolean("is_proof").default(false).notNull(),
  relationshipStatus: varchar("relationship_status", { length: 30 }).default("active"),
  role: varchar("role", { length: 100 }),
  sourceSystem: varchar("source_system", { length: 50 }).default("infoflo"),
  sourceRecordId: varchar("source_record_id", { length: 255 }),
  proposedChangesJson: jsonb("proposed_changes_json"),
  reviewDecisionJson: jsonb("review_decision_json"),
  warningsJson: jsonb("warnings_json").$type<string[]>(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("cc_import_relationship_batch_idx").on(table.batchId),
  index("cc_import_relationship_org_status_idx").on(table.organizationId, table.status),
  index("cc_import_relationship_company_idx").on(table.companyRecordId),
  index("cc_import_relationship_contact_idx").on(table.contactRecordId),
]);

export type ExternalIdentityMapping = typeof externalIdentityMappings.$inferSelect;
export type InsertExternalIdentityMapping = typeof externalIdentityMappings.$inferInsert;
export type CustomerContactImportBatch = typeof customerContactImportBatches.$inferSelect;
export type CustomerContactQuickBooksSourceSnapshot = typeof customerContactQuickBooksSourceSnapshots.$inferSelect;
export type CustomerContactImportCompanyRecord = typeof customerContactImportCompanyRecords.$inferSelect;
export type CustomerContactImportContactRecord = typeof customerContactImportContactRecords.$inferSelect;
export type CustomerContactImportRelationshipRecord = typeof customerContactImportRelationshipRecords.$inferSelect;

export const customerPortalAccess = pgTable("customer_portal_access", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").references(() => customerContacts.id, { onDelete: "set null" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  status: customerPortalAccessStatusEnum("status").notNull().default("DISABLED"),
  email: varchar("email", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  accessRole: varchar("access_role", { length: 40 }).notNull().default("VIEWER").$type<"COMPANY_ADMIN" | "BUYER" | "BILLING" | "VIEWER">(),
  inviteSentAt: timestamp("invite_sent_at", { withTimezone: true }),
  inviteAcceptedAt: timestamp("invite_accepted_at", { withTimezone: true }),
  passwordSetAt: timestamp("password_set_at", { withTimezone: true }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("customer_portal_access_org_idx").on(table.organizationId),
  index("customer_portal_access_customer_idx").on(table.customerId),
  index("customer_portal_access_contact_idx").on(table.contactId),
  index("customer_portal_access_status_idx").on(table.status),
  uniqueIndex("customer_portal_access_org_contact_uidx")
    .on(table.organizationId, table.contactId)
    .where(sql`contact_id IS NOT NULL`),
  uniqueIndex("customer_portal_access_user_uidx")
    .on(table.userId)
    .where(sql`user_id IS NOT NULL`),
]);

export const customerPortalInviteTokens = pgTable("customer_portal_invite_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accessId: varchar("access_id").notNull().references(() => customerPortalAccess.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("customer_portal_invite_tokens_hash_uidx").on(table.tokenHash),
  index("customer_portal_invite_tokens_access_idx").on(table.accessId),
  index("customer_portal_invite_tokens_org_idx").on(table.organizationId),
  index("customer_portal_invite_tokens_expires_idx").on(table.expiresAt),
  uniqueIndex("customer_portal_invite_tokens_active_access_uidx")
    .on(table.accessId)
    .where(sql`used_at IS NULL AND revoked_at IS NULL`),
]);

export const customerPortalCompanySettings = pgTable("customer_portal_company_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  state: varchar("state", { length: 30 }).notNull().default("disabled").$type<"disabled" | "enabled" | "suspended">(),
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("customer_portal_company_settings_org_customer_uidx").on(table.organizationId, table.customerId),
  index("customer_portal_company_settings_org_idx").on(table.organizationId),
  index("customer_portal_company_settings_state_idx").on(table.state),
]);

export const customerPortalOnboardingBatches = pgTable("customer_portal_onboarding_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 30 }).notNull().default("pending").$type<"pending" | "running" | "completed" | "completed_with_failures" | "failed">(),
  action: varchar("action", { length: 60 }).notNull(),
  total: integer("total").notNull().default(0),
  pending: integer("pending").notNull().default(0),
  sent: integer("sent").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  accepted: integer("accepted").notNull().default(0),
  initiatedByUserId: varchar("initiated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  summaryJson: jsonb("summary_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("customer_portal_onboarding_batches_org_idx").on(table.organizationId),
  index("customer_portal_onboarding_batches_status_idx").on(table.status),
  index("customer_portal_onboarding_batches_created_idx").on(table.createdAt),
]);

export const customerPortalOnboardingBatchItems = pgTable("customer_portal_onboarding_batch_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  batchId: varchar("batch_id").notNull().references(() => customerPortalOnboardingBatches.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").references(() => customerContacts.id, { onDelete: "set null" }),
  accessId: varchar("access_id").references(() => customerPortalAccess.id, { onDelete: "set null" }),
  email: varchar("email", { length: 255 }),
  accessRole: varchar("access_role", { length: 40 }),
  status: varchar("status", { length: 30 }).notNull().default("pending").$type<"pending" | "sent" | "failed" | "skipped" | "accepted">(),
  failureCode: varchar("failure_code", { length: 80 }),
  failureMessage: text("failure_message"),
  metadataJson: jsonb("metadata_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("customer_portal_onboarding_batch_items_batch_idx").on(table.batchId),
  index("customer_portal_onboarding_batch_items_org_idx").on(table.organizationId),
  index("customer_portal_onboarding_batch_items_status_idx").on(table.status),
]);

export const insertCustomerPortalAccessSchema = createInsertSchema(customerPortalAccess).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCustomerPortalInviteTokenSchema = createInsertSchema(customerPortalInviteTokens).omit({
  id: true,
  createdAt: true,
});

export type CustomerPortalAccessStatus = typeof customerPortalAccessStatusEnum.enumValues[number];
export type InsertCustomerPortalAccess = z.infer<typeof insertCustomerPortalAccessSchema>;
export type CustomerPortalAccess = typeof customerPortalAccess.$inferSelect;
export type InsertCustomerPortalInviteToken = z.infer<typeof insertCustomerPortalInviteTokenSchema>;
export type CustomerPortalInviteToken = typeof customerPortalInviteTokens.$inferSelect;
export type CustomerPortalCompanySetting = typeof customerPortalCompanySettings.$inferSelect;
export type CustomerPortalOnboardingBatch = typeof customerPortalOnboardingBatches.$inferSelect;
export type CustomerPortalOnboardingBatchItem = typeof customerPortalOnboardingBatchItems.$inferSelect;

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
  customerProductionFolderReference?: CustomerProductionFolderReference | null;
  localCompanyFolderPath?: string | null;
};

// ============================================================
// STORAGE FOUNDATION (TitanOS BYOS / Titan-managed Phase 1)
// ============================================================

export const organizationStorageModeEnum = pgEnum("organization_storage_mode", [
  "titan_managed",
  "byos_cloud",
  "byos_local",
  "hybrid",
  "disabled",
]);

export const organizationStorageProfileStatusEnum = pgEnum("organization_storage_profile_status", [
  "unconfigured",
  "active",
  "invalid",
  "disabled",
]);

export const storageProviderTypeEnum = pgEnum("storage_provider_type", [
  "titan_managed",
  "supabase",
  "local_filesystem",
  "gcs",
  "s3",
  "azure_blob",
]);

export const storageProviderRoleEnum = pgEnum("storage_provider_role", [
  "intake",
  "canonical",
  "archive",
]);

export const storageProviderConfigStatusEnum = pgEnum("storage_provider_config_status", [
  "missing",
  "configured",
  "validated",
  "invalid",
  "disabled",
]);

export const fileStorageClassEnum = pgEnum("file_storage_class", ["hot", "warm", "cold", "archive"]);

export const fileLifecycleStateEnum = pgEnum("file_lifecycle_state", [
  "upload_pending",
  "stored_hot",
  "stored_warm",
  "stored_cold",
  "archived",
  "restore_pending",
  "deleted",
]);

export const storagePlacementRoleEnum = pgEnum("storage_placement_role", [
  "intake",
  "canonical",
  "archive",
  "restore_source",
]);

export const storagePlacementStateEnum = pgEnum("storage_placement_state", [
  "active",
  "superseded",
  "restore_source",
  "missing",
  "deleted",
]);

export const fileDerivativeTypeEnum = pgEnum("file_derivative_type", [
  "thumbnail",
  "preview",
  "proof",
  "print_ready",
  "other",
]);

export const fileDerivativeStateEnum = pgEnum("file_derivative_state", [
  "pending",
  "ready",
  "failed",
  "replaced",
  "deleted",
]);

export const customerProductionFolderTypeEnum = pgEnum("customer_production_folder_type", [
  "production_destination",
]);

export const customerProductionFolderStatusEnum = pgEnum("customer_production_folder_status", [
  "missing",
  "configured",
  "validated",
  "invalid",
  "disabled",
]);

export const storageJobTypeEnum = pgEnum("storage_job_type", [
  "finalize_upload",
  "verify_object",
  "validate_provider",
  "generate_derivative",
  "migrate_placement",
]);

export const storageJobStateEnum = pgEnum("storage_job_state", [
  "queued",
  "running",
  "succeeded",
  "retryable_failed",
  "failed",
  "cancelled",
]);

export const customerProductionFolderReferences = pgTable("customer_production_folder_references", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").references(() => customers.id, { onDelete: "set null" }),
  label: varchar("label", { length: 255 }).notNull(),
  folderType: customerProductionFolderTypeEnum("folder_type").notNull().default("production_destination"),
  pathOrUri: text("path_or_uri").notNull(),
  status: customerProductionFolderStatusEnum("status").notNull().default("configured"),
  validationError: text("validation_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("customer_prod_folder_refs_org_customer_idx").on(table.organizationId, table.customerId),
  index("customer_prod_folder_refs_org_status_idx").on(table.organizationId, table.status),
]);

export const insertCustomerProductionFolderReferenceSchema = createInsertSchema(customerProductionFolderReferences).omit({
  id: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  label: z.string().min(1).max(255),
  pathOrUri: z.string().max(2048),
  folderType: z.enum(["production_destination"]).default("production_destination"),
  status: z.enum(["missing", "configured", "validated", "invalid", "disabled"]).default("configured"),
  validationError: z.string().max(2048).optional().nullable(),
});

export const updateCustomerProductionFolderReferenceSchema = insertCustomerProductionFolderReferenceSchema.partial();

export type InsertCustomerProductionFolderReference = z.infer<typeof insertCustomerProductionFolderReferenceSchema>;
export type UpdateCustomerProductionFolderReference = z.infer<typeof updateCustomerProductionFolderReferenceSchema>;
export type CustomerProductionFolderReference = typeof customerProductionFolderReferences.$inferSelect;

export const storageProviderConfigs = pgTable("storage_provider_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  providerType: storageProviderTypeEnum("provider_type").notNull(),
  role: storageProviderRoleEnum("role").notNull(),
  status: storageProviderConfigStatusEnum("status").notNull().default("configured"),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  configJson: jsonb("config_json").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  validationError: text("validation_error"),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("storage_provider_configs_org_idx").on(table.organizationId),
  index("storage_provider_configs_org_role_idx").on(table.organizationId, table.role),
  index("storage_provider_configs_org_status_idx").on(table.organizationId, table.status),
]);

export type StorageProviderConfig = typeof storageProviderConfigs.$inferSelect;
export type InsertStorageProviderConfig = typeof storageProviderConfigs.$inferInsert;

export const organizationStorageProfiles = pgTable("organization_storage_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  mode: organizationStorageModeEnum("mode").notNull().default("titan_managed"),
  status: organizationStorageProfileStatusEnum("status").notNull().default("unconfigured"),
  primaryProviderConfigId: varchar("primary_provider_config_id").references((): AnyPgColumn => storageProviderConfigs.id, { onDelete: "set null" }),
  intakeProviderConfigId: varchar("intake_provider_config_id").references((): AnyPgColumn => storageProviderConfigs.id, { onDelete: "set null" }),
  archiveProviderConfigId: varchar("archive_provider_config_id").references((): AnyPgColumn => storageProviderConfigs.id, { onDelete: "set null" }),
  productionFolderReferenceId: varchar("production_folder_reference_id").references((): AnyPgColumn => customerProductionFolderReferences.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("organization_storage_profiles_org_uidx").on(table.organizationId),
  index("organization_storage_profiles_status_idx").on(table.status),
]);

export type OrganizationStorageProfile = typeof organizationStorageProfiles.$inferSelect;
export type InsertOrganizationStorageProfile = typeof organizationStorageProfiles.$inferInsert;

export const fileRecords = pgTable("file_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  storageClass: fileStorageClassEnum("storage_class").notNull().default("hot"),
  lifecycleState: fileLifecycleStateEnum("lifecycle_state").notNull().default("upload_pending"),
  originalFilename: varchar("original_filename", { length: 512 }).notNull(),
  mimeType: varchar("mime_type", { length: 255 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  checksum: varchar("checksum", { length: 128 }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("file_records_org_created_idx").on(table.organizationId, table.createdAt),
  index("file_records_org_state_idx").on(table.organizationId, table.lifecycleState),
]);

export type FileRecord = typeof fileRecords.$inferSelect;
export type InsertFileRecord = typeof fileRecords.$inferInsert;

// Business ownership of an artwork file is intentionally separate from its
// physical file record and storage placement. Workflow artifacts (proofs and
// nested run files) never use this relationship.
export const lineItemArtworkRoleEnum = pgEnum("line_item_artwork_role", [
  "customer_source",
  "production",
  "modified_production",
]);

export const lineItemArtworkStatusEnum = pgEnum("line_item_artwork_status", [
  "current",
  "superseded",
]);

export const lineItemArtworkSideEnum = pgEnum("line_item_artwork_side", [
  "front",
  "back",
  "both",
  "unknown",
  "not_applicable",
]);

export const lineItemArtworkOriginEnum = pgEnum("line_item_artwork_origin", [
  "customer_upload",
  "staff_upload",
  "promoted_existing",
  "modified_copy",
  "legacy_backfill",
]);

export const lineItemArtwork = pgTable("line_item_artwork", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  lineItemId: varchar("line_item_id").notNull().references(() => orderLineItems.id, { onDelete: "cascade" }),
  fileRecordId: varchar("file_record_id").notNull().references(() => fileRecords.id, { onDelete: "restrict" }),
  role: lineItemArtworkRoleEnum("role").notNull(),
  status: lineItemArtworkStatusEnum("status").notNull().default("current"),
  side: lineItemArtworkSideEnum("side").notNull().default("unknown"),
  allocationQuantity: integer("allocation_quantity"),
  allocationGroupId: varchar("allocation_group_id", { length: 128 }),
  origin: lineItemArtworkOriginEnum("origin").notNull(),
  parentArtworkId: varchar("parent_artwork_id").references((): AnyPgColumn => lineItemArtwork.id, { onDelete: "restrict" }),
  supersedesArtworkId: varchar("supersedes_artwork_id").references((): AnyPgColumn => lineItemArtwork.id, { onDelete: "restrict" }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  supersededByUserId: varchar("superseded_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (table) => [
  index("line_item_artwork_org_line_idx").on(table.organizationId, table.lineItemId),
  index("line_item_artwork_current_idx").on(table.organizationId, table.lineItemId, table.role, table.status),
  index("line_item_artwork_file_record_idx").on(table.fileRecordId),
  index("line_item_artwork_parent_idx").on(table.parentArtworkId),
  index("line_item_artwork_supersedes_idx").on(table.supersedesArtworkId),
]);

export type LineItemArtwork = typeof lineItemArtwork.$inferSelect;
export type InsertLineItemArtwork = typeof lineItemArtwork.$inferInsert;

export const storagePlacements = pgTable("storage_placements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileRecordId: varchar("file_record_id").notNull().references(() => fileRecords.id, { onDelete: "cascade" }),
  providerConfigId: varchar("provider_config_id").notNull().references(() => storageProviderConfigs.id, { onDelete: "restrict" }),
  placementRole: storagePlacementRoleEnum("placement_role").notNull().default("canonical"),
  placementState: storagePlacementStateEnum("placement_state").notNull().default("active"),
  bucket: varchar("bucket", { length: 255 }),
  objectKey: text("object_key"),
  localPathRef: text("local_path_ref"),
  checksum: varchar("checksum", { length: 128 }),
  sizeBytes: integer("size_bytes"),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("storage_placements_file_idx").on(table.fileRecordId),
  index("storage_placements_provider_idx").on(table.providerConfigId),
  index("storage_placements_state_idx").on(table.placementState),
]);

export type StoragePlacement = typeof storagePlacements.$inferSelect;
export type InsertStoragePlacement = typeof storagePlacements.$inferInsert;

export const fileDerivatives = pgTable("file_derivatives", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileRecordId: varchar("file_record_id").notNull().references(() => fileRecords.id, { onDelete: "cascade" }),
  derivativeType: fileDerivativeTypeEnum("derivative_type").notNull().default("preview"),
  state: fileDerivativeStateEnum("state").notNull().default("pending"),
  sourcePlacementId: varchar("source_placement_id").references(() => storagePlacements.id, { onDelete: "set null" }),
  bucket: varchar("bucket", { length: 255 }),
  objectKey: text("object_key"),
  mimeType: varchar("mime_type", { length: 255 }),
  sizeBytes: integer("size_bytes"),
  errorText: text("error_text"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("file_derivatives_file_idx").on(table.fileRecordId),
  index("file_derivatives_state_idx").on(table.state),
]);

export type FileDerivative = typeof fileDerivatives.$inferSelect;
export type InsertFileDerivative = typeof fileDerivatives.$inferInsert;

export const storageJobs = pgTable("storage_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobType: storageJobTypeEnum("job_type").notNull(),
  state: storageJobStateEnum("state").notNull().default("queued"),
  fileRecordId: varchar("file_record_id").references(() => fileRecords.id, { onDelete: "set null" }),
  sourcePlacementId: varchar("source_placement_id").references(() => storagePlacements.id, { onDelete: "set null" }),
  targetProviderConfigId: varchar("target_provider_config_id").references(() => storageProviderConfigs.id, { onDelete: "set null" }),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown> | null>(),
  errorText: text("error_text"),
  attempts: integer("attempts").notNull().default(0),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("storage_jobs_org_state_idx").on(table.organizationId, table.state),
  index("storage_jobs_org_created_idx").on(table.organizationId, table.createdAt),
  index("storage_jobs_file_idx").on(table.fileRecordId),
]);

export type StorageJob = typeof storageJobs.$inferSelect;
export type InsertStorageJob = typeof storageJobs.$inferInsert;

// Orders table (Job Management - derived from quotes or standalone)
export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderNumber: varchar("order_number", { length: 50 }).notNull(),
  displayNumber: varchar("display_number", { length: 64 }),
  numberCore: integer("number_core"),
  poNumber: varchar("po_number", { length: 64 }), // Customer PO number
  label: text("label"), // Free-text label for categorization/notes
  quoteId: varchar("quote_id").references(() => quotes.id, { onDelete: 'set null' }),
  sourceQuoteNumber: integer("source_quote_number"), // Snapshot of quote number at time of conversion (immutable)
  // An order may be addressed to an independent contact.  Application code
  // enforces that at least one of customerId/contactId is present.
  customerId: varchar("customer_id").references(() => customers.id, { onDelete: 'restrict' }),
  contactId: varchar("contact_id").references(() => customerContacts.id, { onDelete: 'set null' }),
  status: varchar("status", { length: 50 }).notNull().default("new"), // new, in_production, on_hold, ready_for_shipment, completed, canceled [DEPRECATED: use state instead]
  // TitanOS State Architecture (canonical workflow states)
  state: varchar("state", { length: 50 }).notNull().default("open"), // open, production_complete, closed, canceled
  // Per-org configurable workflow status system (Phase 1)
  workflowStatusId: varchar("workflow_status_id", { length: 64 }),
  canonicalState: varchar("canonical_state", { length: 32 }),
  statusPillValue: varchar("status_pill_value", { length: 100 }), // Org-configurable status pill within current state
  statusPillId: varchar("status_pill_id").references(() => orderStatusPills.id, { onDelete: 'set null' }),
  statusPillAssignedByUserId: varchar("status_pill_assigned_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  statusPillAssignedAt: timestamp("status_pill_assigned_at", { withTimezone: true }),
  statusPillReason: text("status_pill_reason"),
  paymentStatus: varchar("payment_status", { length: 50 }).default("unpaid"), // unpaid, partial, paid
  routingTarget: varchar("routing_target", { length: 50 }), // 'fulfillment' or 'invoicing' (set on production_complete)
  // Billing readiness (MVP invoicing)
  billingStatus: varchar("billing_status", { length: 20 }).notNull().default('not_ready'), // not_ready | ready | billed
  billingReadyAt: timestamp("billing_ready_at", { withTimezone: true }),
  billingReadyPolicy: text("billing_ready_policy"),
  billingReadyOverride: boolean("billing_ready_override").notNull().default(false),
  billingReadyOverrideNote: text("billing_ready_override_note"),
  billingReadyOverrideAt: timestamp("billing_ready_override_at", { withTimezone: true }),
  billingReadyOverrideByUserId: varchar("billing_ready_override_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  proofApprovalPolicyOverride: varchar("proof_approval_policy_override", { length: 32 }).notNull().default("inherit_default"),
  proofApprovalOverrideReason: text("proof_approval_override_reason"),
  proofApprovalOverrideAt: timestamp("proof_approval_override_at", { withTimezone: true }),
  proofApprovalOverrideByUserId: varchar("proof_approval_override_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  productionCompletedAt: timestamp("production_completed_at", { withTimezone: true, mode: "string" }),
  closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
  priority: varchar("priority", { length: 50 }).notNull().default("normal"), // rush, normal, low
  fulfillmentStatus: varchar("fulfillment_status", { length: 50 }).notNull().default("pending"), // pending, packed, shipped, delivered
  dueDate: timestamp("due_date", { withTimezone: true, mode: "string" }),
  promisedDate: timestamp("promised_date", { withTimezone: true, mode: "string" }),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull().default("0"),
  // Tax system fields (new detailed tracking)
  taxRate: decimal("tax_rate", { precision: 5, scale: 4 }),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).default("0").notNull(),
  taxableSubtotal: decimal("taxable_subtotal", { precision: 10, scale: 2 }).default("0").notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default("0"),
  discount: decimal("discount", { precision: 10, scale: 2 }).notNull().default("0"),
  notesInternal: text("notes_internal"),
  
  // Customer snapshot (billing address)
  billToName: text("bill_to_name"),
  billToCompany: text("bill_to_company"),
  billToAddress1: text("bill_to_address1"),
  billToAddress2: text("bill_to_address2"),
  billToCity: text("bill_to_city"),
  billToState: text("bill_to_state"),
  billToPostalCode: text("bill_to_postal_code"),
  billToCountry: text("bill_to_country"),
  billToPhone: text("bill_to_phone"),
  billToEmail: text("bill_to_email"),
  
  // Shipping snapshot
  shippingMethod: varchar("shipping_method", { length: 50 }), // pickup, ship, deliver
  shippingMode: varchar("shipping_mode", { length: 50 }), // single_shipment, multi_shipment
  shipToName: text("ship_to_name"),
  shipToCompany: text("ship_to_company"),
  shipToAddress1: text("ship_to_address1"),
  shipToAddress2: text("ship_to_address2"),
  shipToCity: text("ship_to_city"),
  shipToState: text("ship_to_state"),
  shipToPostalCode: text("ship_to_postal_code"),
  shipToCountry: text("ship_to_country"),
  shipToPhone: text("ship_to_phone"),
  shipToEmail: text("ship_to_email"),
  carrier: text("carrier"),
  carrierAccountNumber: text("carrier_account_number"),
  shippingInstructions: text("shipping_instructions"),
  shippingCents: integer("shipping_cents").notNull().default(0), // Shipping/delivery cost in cents
  trackingNumber: text("tracking_number"),
  shippedAt: timestamp("shipped_at", { withTimezone: true, mode: "string" }),
  
  // Dates
  requestedDueDate: timestamp("requested_due_date", { withTimezone: true, mode: "string" }),
  productionDueDate: timestamp("production_due_date", { withTimezone: true, mode: "string" }),
  
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
  syncedAt: timestamp("synced_at", { withTimezone: false, mode: "string" }),
  // State transition timestamps
  startedProductionAt: timestamp("started_production_at", { withTimezone: true, mode: "string" }),
  completedProductionAt: timestamp("completed_production_at", { withTimezone: true, mode: "string" }),
  canceledAt: timestamp("canceled_at", { withTimezone: true, mode: "string" }),
  canceledByUserId: varchar("canceled_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  cancellationReason: text("cancellation_reason"),
  cancellationNotes: text("cancellation_notes"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => [
  index("orders_organization_id_idx").on(table.organizationId),
  index("orders_order_number_idx").on(table.orderNumber),
  index("orders_display_number_idx").on(table.displayNumber),
  index("orders_number_core_idx").on(table.numberCore),
  uniqueIndex("orders_org_display_number_unique").on(table.organizationId, table.displayNumber).where(sql`${table.displayNumber} IS NOT NULL`),
  uniqueIndex("orders_org_number_core_unique").on(table.organizationId, table.numberCore).where(sql`${table.numberCore} IS NOT NULL`),
  index("orders_customer_id_idx").on(table.customerId),
  index("orders_workflow_status_id_idx").on(table.workflowStatusId),
  index("orders_canonical_state_idx").on(table.canonicalState),
  index("orders_status_idx").on(table.status),
  index("orders_state_idx").on(table.state), // NEW: Index for state filtering
  index("orders_payment_status_idx").on(table.paymentStatus), // NEW: Index for payment status
  index("orders_fulfillment_status_idx").on(table.fulfillmentStatus),
  index("orders_due_date_idx").on(table.dueDate),
  index("orders_created_at_idx").on(table.createdAt),
  index("orders_started_production_at_idx").on(table.startedProductionAt),
  index("orders_completed_production_at_idx").on(table.completedProductionAt),
  index("orders_canceled_at_idx").on(table.canceledAt),
  index("orders_canceled_by_user_id_idx").on(table.canceledByUserId),
  index("orders_created_by_user_id_idx").on(table.createdByUserId),
]);

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
}).extend({
  orderNumber: z.string().min(1),
  status: z.enum(["new", "in_production", "on_hold", "ready_for_shipment", "completed", "canceled"]).default("new"),
  state: z.enum(["open", "production_complete", "closed", "canceled"]).default("open"),
  statusPillValue: z.string().max(100).optional().nullable(),
  paymentStatus: z.enum(["unpaid", "partial", "paid"]).default("unpaid"),
  routingTarget: z.enum(["fulfillment", "invoicing"]).optional().nullable(),
  priority: z.enum(["rush", "normal", "low"]).default("normal"),
  fulfillmentStatus: z.enum(["pending", "packed", "shipped", "delivered"]).default("pending"),
  subtotal: z.coerce.number().min(0),
  tax: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(1).optional().nullable(),
  taxAmount: z.coerce.number().min(0).default(0),
  taxableSubtotal: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).default(0),
  shippingMethod: z.enum(['pickup', 'ship', 'deliver']).optional().nullable(),
  shippingMode: z.enum(['single_shipment', 'multi_shipment']).optional().nullable(),
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
    if (val instanceof Date) return val.toISOString();
    if (typeof val === 'string') return val;
    return null;
  }, z.string().nullable().optional()),
  promisedDate: z.preprocess((val) => {
    if (!val) return null;
    if (val instanceof Date) return val.toISOString();
    if (typeof val === 'string') return val;
    return null;
  }, z.string().nullable().optional()),
  requestedDueDate: z.string().optional().nullable(),
  productionDueDate: z.string().optional().nullable(),
  shippedAt: z.string().optional().nullable(),
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
  // PBV2 pricing snapshot fields (migration 0023 - nullable for backward compat with existing orders)
  pbv2TreeVersionId: varchar("pbv2_tree_version_id").references(() => pbv2TreeVersions.id, { onDelete: 'restrict' }),
  pbv2SnapshotJson: jsonb("pbv2_snapshot_json").$type<Record<string, any>>(),
  pricedAt: timestamp("priced_at", { withTimezone: true }), // When this line item was last priced (Phase 5)
  productType: varchar("product_type", { length: 50 }).notNull().default('wide_roll'),
  description: text("description").notNull(), // Snapshot of what we sold
  width: decimal("width", { precision: 10, scale: 2 }),
  height: decimal("height", { precision: 10, scale: 2 }),
  quantity: integer("quantity").notNull(),
  sqft: decimal("sqft", { precision: 10, scale: 2 }),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("new"), // new, in_production, complete, canceled
  specsJson: jsonb("specs_json").$type<Record<string, any>>(),
  // NEW: v2 canonical option selections (additive)
  optionSelectionsJson: jsonb("option_selections_json").$type<any>(),
  selectedOptions: jsonb("selected_options").$type<Array<{
    optionId: string;
    optionName: string;
    value: string | number | boolean;
    note?: string;
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
  materialUsages: jsonb("material_usages").$type<LineItemMaterialUsage[]>().default(sql`'[]'::jsonb`).notNull(), // structured material usage tracking
  requiresInventory: boolean("requires_inventory").notNull().default(true), // flag if inventory tracking is needed
  sortOrder: integer("sort_order").notNull().default(0), // Display order in UI (for drag-and-drop reordering)
  workflowState: varchar("workflow_state", { length: 50 }).notNull().default("new"),
  designStatus: varchar("design_status", { length: 50 }).$type<LineItemDesignStatus | null>(),
  requiresDesignSnapshot: boolean("requires_design_snapshot").notNull().default(false),
  designBriefRequiredSnapshot: boolean("design_brief_required_snapshot").notNull().default(false),
  estimatedDesignMinutesSnapshot: integer("estimated_design_minutes_snapshot"),
  includedDesignMinutesSnapshot: integer("included_design_minutes_snapshot"),
  designPricingModeSnapshot: varchar("design_pricing_mode_snapshot", { length: 50 })
    .$type<ProductDesignPricingMode>()
    .notNull()
    .default("none"),
  flatFeeAmountSnapshot: decimal("flat_fee_amount_snapshot", { precision: 10, scale: 2 }),
  hourlyRateSnapshot: decimal("hourly_rate_snapshot", { precision: 10, scale: 2 }),
  overageRateSnapshot: decimal("overage_rate_snapshot", { precision: 10, scale: 2 }),
  internalLaborRateSnapshot: decimal("internal_labor_rate_snapshot", { precision: 10, scale: 2 }),
  needsDesignOverride: boolean("needs_design_override"),
  requiresDesign: boolean("requires_design").notNull().default(false),
  requiresProofApproval: boolean("requires_proof_approval").notNull().default(false),
  // Prepress requirement snapshot (migration 0051 - TEMP→PERMANENT contract)
  requiresPrepress: boolean("requires_prepress").notNull().default(true),
  approvedProofVersionId: varchar("approved_proof_version_id"),
  // Tax system fields
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).default("0").notNull(),
  isTaxableSnapshot: boolean("is_taxable_snapshot").default(true).notNull(),
  // Line item enhancements (migration 0039)
  overridePriceCents: integer("override_price_cents"),
  overrideAt: timestamp("override_at", { withTimezone: true }),
  overrideByUserId: varchar("override_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  overrideReason: text("override_reason"),
  // Line item production notes (migration 0040)
  productionNotes: text("production_notes"),
  // Explicit operational override for non-produced sales (blank media, hardware,
  // raw materials, etc.). This never represents production completion.
  productionBypassed: boolean("production_bypassed").notNull().default(false),
  productionBypassReason: text("production_bypass_reason"),
  productionBypassedByUserId: varchar("production_bypassed_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  productionBypassedAt: timestamp("production_bypassed_at", { withTimezone: true }),
  // Bundle metadata copied from quote lines on conversion (migration 0131).
  parentLineItemId: varchar("parent_line_item_id").references((): AnyPgColumn => orderLineItems.id, { onDelete: 'set null' }),
  lineItemRole: lineItemRoleEnum("line_item_role").notNull().default("standalone"),
  childDisplayMode: lineItemChildDisplayModeEnum("child_display_mode").notNull().default("hidden"),
  parentPriceMode: lineItemParentPriceModeEnum("parent_price_mode").notNull().default("sum_children"),
  childCalculatedTotalCents: integer("child_calculated_total_cents"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("order_line_items_order_id_idx").on(table.orderId),
  index("order_line_items_product_id_idx").on(table.productId),
  index("order_line_items_status_idx").on(table.status),
  index("order_line_items_workflow_state_idx").on(table.workflowState),
  index("order_line_items_design_status_idx").on(table.designStatus),
  index("order_line_items_requires_design_idx").on(table.requiresDesign),
  index("order_line_items_requires_proof_approval_idx").on(table.requiresProofApproval),
  index("order_line_items_requires_prepress_idx").on(table.requiresPrepress),
  index("order_line_items_production_bypassed_idx").on(table.productionBypassed),
  index("order_line_items_approved_proof_version_idx").on(table.approvedProofVersionId),
  index("order_line_items_product_type_idx").on(table.productType),
  index("order_line_items_pbv2_tree_version_id_idx").on(table.pbv2TreeVersionId),
  index("order_line_items_parent_line_item_id_idx").on(table.parentLineItemId),
  index("order_line_items_role_idx").on(table.lineItemRole),
]);

export const lineItemDesignBriefs = pgTable("line_item_design_briefs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  orderLineItemId: varchar("order_line_item_id")
    .notNull()
    .references(() => orderLineItems.id, { onDelete: 'cascade' }),
  keyInstructions: text("key_instructions"),
  designObjective: text("design_objective"),
  requestedContent: text("requested_content"),
  layoutNotes: text("layout_notes"),
  brandStyleNotes: text("brand_style_notes"),
  referenceNotes: text("reference_notes"),
  priorityNotes: text("priority_notes"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("line_item_design_briefs_line_item_id_unique").on(table.orderLineItemId),
  index("line_item_design_briefs_org_id_idx").on(table.organizationId),
  index("line_item_design_briefs_order_id_idx").on(table.orderId),
]);

export const lineItemDesignCostSummaries = pgTable("line_item_design_cost_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  lineItemId: varchar("line_item_id")
    .notNull()
    .references(() => orderLineItems.id, { onDelete: 'cascade' }),
  designCostState: varchar("design_cost_state", { length: 50 })
    .$type<DesignCostState>()
    .notNull()
    .default("not_applicable"),
  actualTrackedMinutes: decimal("actual_tracked_minutes", { precision: 10, scale: 2 }).notNull().default("0.00"),
  correctedTrackedMinutes: decimal("corrected_tracked_minutes", { precision: 10, scale: 2 }).notNull().default("0.00"),
  internalDesignCostCalculated: decimal("internal_design_cost_calculated", { precision: 10, scale: 2 }),
  quotedDesignAmount: decimal("quoted_design_amount", { precision: 10, scale: 2 }),
  soldDesignAmount: decimal("sold_design_amount", { precision: 10, scale: 2 }),
  billableDesignMinutes: decimal("billable_design_minutes", { precision: 10, scale: 2 }),
  billableDesignAmount: decimal("billable_design_amount", { precision: 10, scale: 2 }),
  billingStatus: varchar("billing_status", { length: 50 })
    .$type<LineItemDesignBillingStatus>()
    .notNull()
    .default("not_billable"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("line_item_design_cost_summaries_line_item_id_unique").on(table.lineItemId),
  index("line_item_design_cost_summaries_org_id_idx").on(table.organizationId),
  index("line_item_design_cost_summaries_order_id_idx").on(table.orderId),
  index("line_item_design_cost_summaries_billing_status_idx").on(table.billingStatus),
]);

export const orderInternalNotes = pgTable("order_internal_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  noteText: text("note_text").notNull(),
  audienceTags: jsonb("audience_tags").$type<string[] | null>(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("order_internal_notes_order_created_idx").on(table.orderId, table.createdAt),
  index("order_internal_notes_org_order_idx").on(table.organizationId, table.orderId),
]);

/**
 * Canonical internal-only quote note ledger. This table intentionally has no
 * update/delete fields or customer-facing visibility flag: notes are
 * append-only staff records, not shipping instructions or portal content.
 */
export const quoteInternalNotes = pgTable("quote_internal_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  quoteId: varchar("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  noteText: text("note_text").notNull(),
  source: varchar("source", { length: 32 }).notNull().default("manual"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  assistantConversationId: varchar("assistant_conversation_id").references(() => aiConversations.id, { onDelete: "set null" }),
  assistantPlanId: varchar("assistant_plan_id").references(() => aiExecutionPlans.id, { onDelete: "set null" }),
  assistantExecutionId: varchar("assistant_execution_id"),
  domainAuditId: varchar("domain_audit_id").references(() => auditLogs.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("quote_internal_notes_org_quote_created_idx").on(table.organizationId, table.quoteId, table.createdAt),
  uniqueIndex("quote_internal_notes_assistant_plan_unique").on(table.assistantPlanId).where(sql`${table.assistantPlanId} IS NOT NULL`),
]);

export const orderLineItemNotes = pgTable("order_line_item_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  lineItemId: varchar("line_item_id")
    .notNull()
    .references(() => orderLineItems.id, { onDelete: 'cascade' }),
  category: varchar("category", { length: 50 })
    .$type<OrderLineItemNoteCategory>()
    .notNull(),
  noteText: text("note_text").notNull(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("order_line_item_notes_order_created_idx").on(table.orderId, table.createdAt),
  index("order_line_item_notes_line_category_created_idx").on(table.lineItemId, table.category, table.createdAt),
  index("order_line_item_notes_org_line_idx").on(table.organizationId, table.lineItemId),
]);

// Order Line Item Components (PBV2 child item acceptance)
export const orderLineItemComponents = pgTable("order_line_item_components", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  orderLineItemId: varchar("order_line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),

  status: text("status").notNull().default('ACCEPTED'), // ACCEPTED | VOIDED
  source: text("source").notNull().default('PBV2'),

  kind: text("kind").notNull(), // inlineSku | productRef
  title: text("title").notNull(),
  skuRef: text("sku_ref"),
  childProductId: varchar("child_product_id"),

  qty: decimal("qty", { precision: 10, scale: 2 }).notNull(),
  unitPriceCents: integer("unit_price_cents"),
  amountCents: integer("amount_cents"),
  invoiceVisibility: text("invoice_visibility").notNull().default('rollup'), // hidden | rollup | separateLine

  pbv2TreeVersionId: varchar("pbv2_tree_version_id"),
  pbv2SourceNodeId: varchar("pbv2_source_node_id"),
  pbv2EffectIndex: integer("pbv2_effect_index"),

  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("order_line_item_components_org_idx").on(table.organizationId),
  index("order_line_item_components_order_id_idx").on(table.orderId),
  index("order_line_item_components_line_item_id_idx").on(table.orderLineItemId),
  // NOTE: PBV2 idempotency uniqueness is enforced via a PARTIAL UNIQUE INDEX in SQL migration 0024.
]);

export const insertOrderLineItemSchema = createInsertSchema(orderLineItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedProofVersionId: true,
}).extend({
  productType: z.string().default('wide_roll'),
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().min(0),
  totalPrice: z.coerce.number().min(0),
  width: z.coerce.number().positive().optional().nullable(),
  height: z.coerce.number().positive().optional().nullable(),
  sqft: z.coerce.number().positive().optional().nullable(),
  estimatedDesignMinutesSnapshot: z.coerce.number().int().nonnegative().optional().nullable(),
  includedDesignMinutesSnapshot: z.coerce.number().int().nonnegative().optional().nullable(),
  designPricingModeSnapshot: productDesignPricingModeSchema.optional(),
  flatFeeAmountSnapshot: z.coerce.number().nonnegative().optional().nullable(),
  hourlyRateSnapshot: z.coerce.number().nonnegative().optional().nullable(),
  overageRateSnapshot: z.coerce.number().nonnegative().optional().nullable(),
  internalLaborRateSnapshot: z.coerce.number().nonnegative().optional().nullable(),
  needsDesignOverride: z.boolean().optional().nullable(),
  status: z.enum(["new", "in_production", "complete", "canceled"]).default("new"),
  workflowState: lineItemWorkflowStateSchema.default("new"),
  designStatus: lineItemDesignStatusSchema.optional().nullable().default(null),
  requiresDesign: z.boolean().default(false),
  requiresProofApproval: z.boolean().default(false),
  specsJson: z.record(z.any()).optional().nullable(),
  // PBV2 request-only fields (not persisted directly; snapshots are persisted).
  // Keep validation permissive enough for future option expansions, but still JSON-safe.
  pbv2ExplicitSelections: (() => {
    const isPlainObject = (value: unknown): value is Record<string, unknown> => {
      if (!value || typeof value !== 'object') return false;
      if (Array.isArray(value)) return false;
      const proto = Object.getPrototypeOf(value);
      return proto === Object.prototype || proto === null;
    };

    const isJsonValue = (value: unknown, depth = 0): boolean => {
      // Guard against pathological inputs
      if (depth > 50) return false;

      if (value === null) return true;
      if (typeof value === 'boolean') return true;
      if (typeof value === 'string') return true;
      if (typeof value === 'number') return Number.isFinite(value);

      if (Array.isArray(value)) {
        for (const v of value) {
          if (!isJsonValue(v, depth + 1)) return false;
        }
        return true;
      }

      if (isPlainObject(value)) {
        for (const v of Object.values(value)) {
          if (!isJsonValue(v, depth + 1)) return false;
        }
        return true;
      }

      // Reject Date, functions, bigint, symbols, class instances, etc.
      return false;
    };

    const zJsonObject = z.custom<Record<string, unknown>>(
      (v) => isPlainObject(v) && isJsonValue(v),
      { message: 'Expected JSON-serializable plain object' },
    );

    return z.preprocess((v) => (v === null ? undefined : v), zJsonObject.optional());
  })(),
  pbv2Env: (() => {
    const zEnvNumber = z.preprocess(
      (v) => {
        if (v === null) return undefined;
        if (typeof v === 'string') {
          const trimmed = v.trim();
          if (!trimmed) return v;
          const n = Number(trimmed);
          return n;
        }
        return v;
      },
      z.number().finite(),
    );

    return z
      .preprocess((v) => (v === null ? undefined : v),
        z
          .object({
            widthIn: zEnvNumber.optional(),
            heightIn: zEnvNumber.optional(),
            qty: zEnvNumber.optional(),
            quantity: zEnvNumber.optional(),
          })
          // Allow additional builder variables, but keep them numeric and finite.
          .catchall(zEnvNumber)
          .optional(),
      );
  })(),
  // Request-only duplication context. The create route validates this source
  // line belongs to the same order and uses it to suppress generated workflow
  // side effects (production scheduling, proof state, reservations).
  duplicateSourceLineItemId: z.string().uuid().optional(),
});

export type OrderLineItemComponent = typeof orderLineItemComponents.$inferSelect;
export type InsertOrderLineItemComponent = typeof orderLineItemComponents.$inferInsert;

export const updateOrderLineItemSchema = insertOrderLineItemSchema.partial().extend({
  id: z.string(),
});

export type InsertOrderLineItem = z.infer<typeof insertOrderLineItemSchema>;
export type UpdateOrderLineItem = z.infer<typeof updateOrderLineItemSchema>;
export type OrderLineItem = typeof orderLineItems.$inferSelect;

export const insertLineItemDesignCostSummarySchema = createInsertSchema(lineItemDesignCostSummaries).omit({
  id: true,
  organizationId: true,
  orderId: true,
  lineItemId: true,
  lastSyncedAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  designCostState: designCostStateSchema,
  actualTrackedMinutes: z.coerce.number().nonnegative(),
  correctedTrackedMinutes: z.coerce.number().nonnegative(),
  internalDesignCostCalculated: z.coerce.number().nonnegative().optional().nullable(),
  quotedDesignAmount: z.coerce.number().nonnegative().optional().nullable(),
  soldDesignAmount: z.coerce.number().nonnegative().optional().nullable(),
  billableDesignMinutes: z.coerce.number().nonnegative().optional().nullable(),
  billableDesignAmount: z.coerce.number().nonnegative().optional().nullable(),
  billingStatus: lineItemDesignBillingStatusSchema,
});

export type LineItemDesignCostSummary = typeof lineItemDesignCostSummaries.$inferSelect;
export type InsertLineItemDesignCostSummary = typeof lineItemDesignCostSummaries.$inferInsert;

export const insertLineItemDesignBriefSchema = createInsertSchema(lineItemDesignBriefs).omit({
  id: true,
  organizationId: true,
  orderId: true,
  orderLineItemId: true,
  createdByUserId: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  keyInstructions: z.string().trim().optional().nullable(),
  designObjective: z.string().trim().optional().nullable(),
  requestedContent: z.string().trim().optional().nullable(),
  layoutNotes: z.string().trim().optional().nullable(),
  brandStyleNotes: z.string().trim().optional().nullable(),
  referenceNotes: z.string().trim().optional().nullable(),
  priorityNotes: z.string().trim().optional().nullable(),
});

export const updateLineItemDesignBriefSchema = insertLineItemDesignBriefSchema.partial();

export type LineItemDesignBrief = typeof lineItemDesignBriefs.$inferSelect;
export type InsertLineItemDesignBrief = typeof lineItemDesignBriefs.$inferInsert;
export type UpdateLineItemDesignBrief = z.infer<typeof updateLineItemDesignBriefSchema>;

export const insertOrderInternalNoteSchema = createInsertSchema(orderInternalNotes).omit({
  id: true,
  organizationId: true,
  orderId: true,
  createdByUserId: true,
  createdAt: true,
}).extend({
  noteText: z.string().trim().min(1).max(4000),
  audienceTags: z.array(z.string().trim().min(1).max(100)).max(20).optional().nullable(),
});

export const insertOrderLineItemNoteSchema = createInsertSchema(orderLineItemNotes).omit({
  id: true,
  organizationId: true,
  orderId: true,
  lineItemId: true,
  createdByUserId: true,
  createdAt: true,
}).extend({
  category: orderLineItemNoteCategorySchema,
  noteText: z.string().trim().min(1).max(4000),
});

export const insertQuoteInternalNoteSchema = createInsertSchema(quoteInternalNotes).omit({
  id: true,
  organizationId: true,
  quoteId: true,
  createdByUserId: true,
  source: true,
  assistantConversationId: true,
  assistantPlanId: true,
  assistantExecutionId: true,
  domainAuditId: true,
  createdAt: true,
}).extend({
  noteText: z.string().trim().min(1).max(4000),
});

export type OrderInternalNote = typeof orderInternalNotes.$inferSelect;
export type InsertOrderInternalNote = typeof orderInternalNotes.$inferInsert;
export type CreateOrderInternalNote = z.infer<typeof insertOrderInternalNoteSchema>;
export type QuoteInternalNote = typeof quoteInternalNotes.$inferSelect;
export type InsertQuoteInternalNote = typeof quoteInternalNotes.$inferInsert;
export type CreateQuoteInternalNote = z.infer<typeof insertQuoteInternalNoteSchema>;
export type OrderLineItemNote = typeof orderLineItemNotes.$inferSelect;
export type InsertOrderLineItemNote = typeof orderLineItemNotes.$inferInsert;
export type CreateOrderLineItemNote = z.infer<typeof insertOrderLineItemNoteSchema>;

// ============================================================
// Order Workflow Status System (Per-Org, Configurable)
// ============================================================

export const orderWorkflowVersions = pgTable("order_workflow_versions", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text("name").notNull().default("Default Workflow"),
  isActive: boolean("is_active").notNull().default(false),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (table) => [
  index("order_workflow_versions_org_idx").on(table.organizationId),
  index("order_workflow_versions_org_active_idx").on(table.organizationId, table.isActive),
]);

export const orderWorkflowStatuses = pgTable("order_workflow_statuses", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  workflowVersionId: varchar("workflow_version_id", { length: 64 }).notNull().references(() => orderWorkflowVersions.id, { onDelete: 'cascade' }),
  key: text("key").notNull(),
  label: text("label").notNull(),
  category: varchar("category", { length: 32 }).notNull(), // new | active | ready | completed | canceled | on_hold
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  isDefaultForNew: boolean("is_default_for_new").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("order_workflow_statuses_org_idx").on(table.organizationId),
  index("order_workflow_statuses_version_idx").on(table.workflowVersionId),
  index("order_workflow_statuses_category_idx").on(table.category),
  uniqueIndex("order_workflow_statuses_version_key_uidx").on(table.workflowVersionId, table.key),
]);

export const orderWorkflowTransitions = pgTable("order_workflow_transitions", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  workflowVersionId: varchar("workflow_version_id", { length: 64 }).notNull().references(() => orderWorkflowVersions.id, { onDelete: 'cascade' }),
  fromStatusId: varchar("from_status_id", { length: 64 }).notNull().references(() => orderWorkflowStatuses.id, { onDelete: 'cascade' }),
  toStatusId: varchar("to_status_id", { length: 64 }).notNull().references(() => orderWorkflowStatuses.id, { onDelete: 'cascade' }),
}, (table) => [
  index("order_workflow_transitions_org_idx").on(table.organizationId),
  index("order_workflow_transitions_version_idx").on(table.workflowVersionId),
  uniqueIndex("order_workflow_transitions_unique").on(table.workflowVersionId, table.fromStatusId, table.toStatusId),
]);

export const orderStatusEvents = pgTable("order_status_events", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  fromStatusId: varchar("from_status_id", { length: 64 }).references(() => orderWorkflowStatuses.id, { onDelete: 'set null' }),
  toStatusId: varchar("to_status_id", { length: 64 }).references(() => orderWorkflowStatuses.id, { onDelete: 'set null' }),
  fromStatusLabel: text("from_status_label"),
  toStatusLabel: text("to_status_label"),
  changedByUserId: varchar("changed_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
  eventType: varchar("event_type", { length: 50 }).notNull().default("workflow_status_changed"),
  fromStatusPillId: varchar("from_status_pill_id").references(() => orderStatusPills.id, { onDelete: 'set null' }),
  toStatusPillId: varchar("to_status_pill_id").references(() => orderStatusPills.id, { onDelete: 'set null' }),
  fromStatusKey: varchar("from_status_key", { length: 100 }),
  toStatusKey: varchar("to_status_key", { length: 100 }),
  source: varchar("source", { length: 30 }).notNull().default("user"),
  reason: text("reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
}, (table) => [
  index("order_status_events_org_order_idx").on(table.organizationId, table.orderId),
  index("order_status_events_changed_at_idx").on(table.changedAt),
  index("order_status_events_org_type_idx").on(table.organizationId, table.eventType, table.changedAt),
  index("order_status_events_to_pill_idx").on(table.organizationId, table.toStatusPillId, table.changedAt),
]);

export type OrderWorkflowVersion = typeof orderWorkflowVersions.$inferSelect;
export type InsertOrderWorkflowVersion = typeof orderWorkflowVersions.$inferInsert;
export type OrderWorkflowStatus = typeof orderWorkflowStatuses.$inferSelect;
export type InsertOrderWorkflowStatus = typeof orderWorkflowStatuses.$inferInsert;
export type OrderWorkflowTransition = typeof orderWorkflowTransitions.$inferSelect;
export type InsertOrderWorkflowTransition = typeof orderWorkflowTransitions.$inferInsert;
export type OrderStatusEvent = typeof orderStatusEvents.$inferSelect;
export type InsertOrderStatusEvent = typeof orderStatusEvents.$inferInsert;

// Order Status Pills (TitanOS State Architecture)
// Org-configurable status pills scoped within canonical states
export const orderStatusPills = pgTable("order_status_pills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  stateScope: varchar("state_scope", { length: 50 }).notNull(), // 'open', 'production_complete', 'closed', 'canceled'
  key: varchar("key", { length: 100 }).notNull(), // Stable tenant-scoped automation identity; labels may change
  name: varchar("name", { length: 100 }).notNull(), // Display label (e.g., "In Production", "On Hold")
  color: varchar("color", { length: 50 }).notNull().default("#3b82f6"), // Hex color or design token
  category: varchar("category", { length: 50 }),
  lifecycleMapping: varchar("lifecycle_mapping", { length: 50 }),
  customerVisible: boolean("customer_visible").notNull().default(false),
  notificationTriggerEligible: boolean("notification_trigger_eligible").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false), // One default pill per (org_id, state_scope)
  isActive: boolean("is_active").notNull().default(true), // Soft delete flag
  sortOrder: integer("sort_order").notNull().default(0), // Display order in UI
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => [
  index("order_status_pills_org_idx").on(table.organizationId),
  index("order_status_pills_state_scope_idx").on(table.stateScope),
  index("order_status_pills_org_state_idx").on(table.organizationId, table.stateScope),
  uniqueIndex("order_status_pills_org_key_uidx").on(table.organizationId, table.key),
  // Unique constraint: only one default pill per (org_id, state_scope)
  // This is enforced in the migration with a partial unique index
]);

export const orderStatusPillLifecycleMappingValues = [
  "intake", "order", "artwork", "design", "proof", "prepress", "production",
  "fulfillment", "invoicing", "payment", "complete", "closed", "hold", "exception", "canceled",
] as const;
export const orderStatusPillLifecycleMappingSchema = z.enum(orderStatusPillLifecycleMappingValues);
export type OrderStatusPillLifecycleMapping = z.infer<typeof orderStatusPillLifecycleMappingSchema>;

export const insertOrderStatusPillSchema = createInsertSchema(orderStatusPills).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  organizationId: z.string().uuid(),
  stateScope: z.enum(["open", "production_complete", "closed", "canceled"]),
  key: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(100),
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#3b82f6"),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  category: z.string().max(50).optional().nullable(),
  lifecycleMapping: orderStatusPillLifecycleMappingSchema.optional().nullable(),
  customerVisible: z.boolean().default(false),
  notificationTriggerEligible: z.boolean().default(true),
});

export const updateOrderStatusPillSchema = insertOrderStatusPillSchema.partial().extend({
  id: z.string().uuid(),
});

export type InsertOrderStatusPill = z.infer<typeof insertOrderStatusPillSchema>;
export type UpdateOrderStatusPill = z.infer<typeof updateOrderStatusPillSchema>;
export type OrderStatusPill = typeof orderStatusPills.$inferSelect;

// Tenant-editable mappings from durable workflow triggers to stable status-pill keys.
// The target remains a key rather than a label or pill ID so tenant label edits are safe.
export const workflowStatusPillMappings = pgTable("workflow_status_pill_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  triggerKey: varchar("trigger_key", { length: 100 }).notNull(),
  targetStatusKey: varchar("target_status_key", { length: 100 }).notNull(),
  source: varchar("source", { length: 30 }).notNull().default("system"),
  isActive: boolean("is_active").notNull().default(true),
  overwriteExceptionStatus: boolean("overwrite_exception_status").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("workflow_status_pill_mappings_org_trigger_uidx").on(table.organizationId, table.triggerKey),
  index("workflow_status_pill_mappings_org_target_idx").on(table.organizationId, table.targetStatusKey),
]);

export const insertWorkflowStatusPillMappingSchema = createInsertSchema(workflowStatusPillMappings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  organizationId: z.string().uuid(),
  triggerKey: workflowStatusPillTriggerSchema,
  targetStatusKey: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(100),
  source: workflowStatusPillAssignmentSourceSchema.default("system"),
  isActive: z.boolean().default(true),
  overwriteExceptionStatus: z.boolean().default(false),
});

export type WorkflowStatusPillMapping = typeof workflowStatusPillMappings.$inferSelect;
export type InsertWorkflowStatusPillMapping = z.infer<typeof insertWorkflowStatusPillMappingSchema>;

// Jobs table for production tracking
export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }), // Migration 0014 - direct tenant filtering
  orderId: varchar("order_id").references(() => orders.id, { onDelete: 'cascade' }), // added for direct order linkage
  orderLineItemId: varchar("order_line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),
  productType: varchar("product_type", { length: 50 }).notNull(),
  statusKey: varchar("status_key", { length: 50 }).notNull(),// Changed from status to statusKey with FK
  priority: varchar("priority", { length: 20 }).notNull().default("normal"), // rush, normal, low
  specsJson: jsonb("specs_json").$type<Record<string, any>>(),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: 'set null' }),
  notesInternal: text("notes_internal"),
  // Production tracking fields - set by production staff, NOT required at quote/order time
  rollWidthUsedInches: decimal("roll_width_used_inches", { precision: 10, scale: 2 }), // Roll width actually used in production
  materialId: varchar("material_id").references(() => materials.id, { onDelete: 'set null' }), // Material used in production (for inventory/costing)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("jobs_organization_id_idx").on(table.organizationId, table.createdAt), // Migration 0014
  index("jobs_order_line_item_id_idx").on(table.orderLineItemId),
  index("jobs_product_type_idx").on(table.productType),
  index("jobs_status_key_idx").on(table.statusKey),
  index("jobs_assigned_to_user_id_idx").on(table.assignedToUserId),
  index("jobs_order_id_idx").on(table.orderId),
  index("jobs_material_id_idx").on(table.materialId),
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
  // Production tracking fields - optional, set by production staff
  rollWidthUsedInches: z.coerce.number().positive().optional().nullable(),
  materialId: z.string().optional().nullable(),
});

export const updateJobSchema = insertJobSchema.partial().extend({
  id: z.string(),
});

export type InsertJob = z.infer<typeof insertJobSchema>;
export type UpdateJob = z.infer<typeof updateJobSchema>;
export type Job = typeof jobs.$inferSelect;

// ============================================================
// Production MVP (Modular Production Views) - Flatbed first
// ============================================================

export type ProductionJobStatus = "queued" | "in_progress" | "done" | "canceled";
export type ProductionEventType =
  | "intake"
  | "routing_override"
  | "timer_started"
  | "timer_stopped"
  | "note"
  | "reprint_incremented"
  | "media_used_set"
  | "printer_assigned"
  | "production_alert_acknowledged";

export const productionAlertTypeValues = [
  "color_match",
  "pms_match",
  "customer_specific",
  "machine_setting",
  "finishing_instruction",
  "registration_instruction",
  "general_warning",
] as const;

export const productionAlertSeverityValues = ["info", "warning", "critical"] as const;
export const productionAlertStationValues = ["prepress", "roll", "flatbed", "fulfillment", "all"] as const;
export const productionAlertStatusValues = ["active", "acknowledged", "resolved", "cancelled", "archived"] as const;

export type ProductionAlertType = typeof productionAlertTypeValues[number];
export type ProductionAlertSeverity = typeof productionAlertSeverityValues[number];
export type ProductionAlertStation = typeof productionAlertStationValues[number];
export type ProductionAlertStatus = typeof productionAlertStatusValues[number];

export const productionStationStepTriggerSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.unknown()).optional().default({}),
});

export const productionStationStepTriggersSchema = z.array(productionStationStepTriggerSchema).default([]);

export type ProductionStationStepTrigger = z.infer<typeof productionStationStepTriggerSchema>;

/** Existing tenant station table from migration 0001_stations.sql. This
 * projection permits read-only reporting to use the authoritative station
 * label and active flag without introducing another station definition. */
export const stations = pgTable("stations", {
  id: varchar("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 50 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("stations_organization_key_uidx").on(table.organizationId, table.key),
]);

export const productionJobs = pgTable("production_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  lineItemId: varchar("line_item_id").references(() => orderLineItems.id, { onDelete: 'cascade' }),
  stationKey: varchar("station_key", { length: 40 }).notNull().default("flatbed"),
  stepKey: varchar("step_key", { length: 40 }).notNull().default("prepress"),
  status: varchar("status", { length: 20 }).notNull().default("queued"),
  assignedPrinterId: varchar("assigned_printer_id", { length: 120 }),
  assignedPrinterName: varchar("assigned_printer_name", { length: 120 }),
  assignedPrinterByUserId: varchar("assigned_printer_by_user_id").references(() => users.id, { onDelete: "set null" }),
  assignedPrinterAt: timestamp("assigned_printer_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedByUserId: varchar("completed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  previousStatus: text("previous_status"),
  previousStation: text("previous_station"),
  restoreUntil: timestamp("restore_until", { withTimezone: true }),
  restoredAt: timestamp("restored_at", { withTimezone: true }),
  restoredByUserId: varchar("restored_by_user_id").references(() => users.id, { onDelete: "set null" }),
  restoreReason: text("restore_reason"),
  totalSeconds: integer("total_seconds").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("production_jobs_org_status_idx").on(table.organizationId, table.status),
  index("production_jobs_org_station_status_idx").on(table.organizationId, table.stationKey, table.status),
  index("production_jobs_org_completed_at_idx").on(table.organizationId, table.completedAt),
  index("production_jobs_org_restore_until_idx").on(table.organizationId, table.restoreUntil),
  index("production_jobs_order_id_idx").on(table.orderId),
  index("production_jobs_line_item_id_idx").on(table.lineItemId),
  index("production_jobs_assigned_printer_idx").on(table.organizationId, table.assignedPrinterName),
]);

export const productionEvents = pgTable("production_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  productionJobId: varchar("production_job_id").notNull().references(() => productionJobs.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").references(() => orders.id, { onDelete: 'set null' }),
  orderLineItemId: varchar("order_line_item_id").references(() => orderLineItems.id, { onDelete: 'set null' }),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: 'set null' }),
  type: varchar("type", { length: 40 }).notNull(),
  payload: jsonb("payload").$type<Record<string, any>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("production_events_org_job_created_idx").on(table.organizationId, table.productionJobId, table.createdAt),
  index("production_events_org_type_created_idx").on(table.organizationId, table.type, table.createdAt),
  index("production_events_order_id_idx").on(table.orderId),
  index("production_events_order_line_item_id_idx").on(table.orderLineItemId),
  index("production_events_actor_user_id_idx").on(table.actorUserId),
]);

export const productionAlerts = pgTable("production_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  orderLineItemId: varchar("order_line_item_id").references(() => orderLineItems.id, { onDelete: "set null" }),
  productionJobId: varchar("production_job_id").references(() => productionJobs.id, { onDelete: "set null" }),
  title: varchar("title", { length: 160 }).notNull(),
  message: text("message"),
  alertType: varchar("alert_type", { length: 40 }).$type<ProductionAlertType>().notNull().default("general_warning"),
  severity: varchar("severity", { length: 20 }).$type<ProductionAlertSeverity>().notNull().default("warning"),
  visibleStations: jsonb("visible_stations").$type<ProductionAlertStation[]>().notNull().default(sql`'["all"]'::jsonb`),
  status: varchar("status", { length: 20 }).$type<ProductionAlertStatus>().notNull().default("active"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  acknowledgedByUserId: varchar("acknowledged_by_user_id").references(() => users.id, { onDelete: "set null" }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  resolvedByUserId: varchar("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  metadataJson: jsonb("metadata_json").$type<Record<string, any>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("production_alerts_org_status_idx").on(table.organizationId, table.status),
  index("production_alerts_order_id_idx").on(table.orderId),
  index("production_alerts_order_line_item_id_idx").on(table.orderLineItemId),
  index("production_alerts_production_job_id_idx").on(table.productionJobId),
  index("production_alerts_org_severity_idx").on(table.organizationId, table.severity),
]);

export const productionAlertPresets = pgTable("production_alert_presets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  message: text("message"),
  alertType: varchar("alert_type", { length: 40 }).$type<ProductionAlertType>().notNull().default("general_warning"),
  severity: varchar("severity", { length: 20 }).$type<ProductionAlertSeverity>().notNull().default("warning"),
  visibleStations: jsonb("visible_stations").$type<ProductionAlertStation[]>().notNull().default(sql`'["all"]'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  metadataJson: jsonb("metadata_json").$type<Record<string, any>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("production_alert_presets_org_active_sort_idx").on(table.organizationId, table.isActive, table.sortOrder),
  uniqueIndex("production_alert_presets_org_name_uidx").on(table.organizationId, table.name),
]);

export const productionStationSteps = pgTable("production_station_steps", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  stationKey: varchar("station_key", { length: 50 }).notNull(),
  key: varchar("key", { length: 80 }).notNull(),
  label: varchar("label", { length: 200 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  triggers: jsonb("triggers").$type<ProductionStationStepTrigger[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("production_station_steps_org_station_key_uidx").on(table.organizationId, table.stationKey, table.key),
  index("production_station_steps_org_station_sort_idx").on(table.organizationId, table.stationKey, table.sortOrder),
]);

export const insertProductionStationStepSchema = createInsertSchema(productionStationSteps).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  triggers: productionStationStepTriggersSchema.optional().default([]),
});

/** One physical production operation. Jobs remain the line-item aggregate. */
export const productionRuns = pgTable("production_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  orderId: varchar("order_id").references(() => orders.id, { onDelete: "set null" }),
  runNumber: integer("run_number").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("draft").$type<"draft" | "ready_for_production" | "in_production" | "partially_completed" | "completed" | "completed_with_exceptions" | "canceled">(),
  stationKey: varchar("station_key", { length: 40 }).notNull(),
  productionFileStrategy: varchar("production_file_strategy", { length: 32 }).notNull().default("staff_prepared").$type<"rip_managed" | "staff_prepared">(),
  materialId: varchar("material_id").references(() => materials.id, { onDelete: "set null" }),
  materialSnapshot: jsonb("material_snapshot").$type<Record<string, unknown>>(),
  sheetWidth: decimal("sheet_width", { precision: 10, scale: 2 }),
  sheetHeight: decimal("sheet_height", { precision: 10, scale: 2 }),
  plannedSheetCount: integer("planned_sheet_count"),
  nominalPiecesPerSheet: integer("nominal_pieces_per_sheet"),
  sheetPlanInputSnapshot: jsonb("sheet_plan_input_snapshot").$type<Record<string, unknown>>(),
  calculatedSheetPlanSnapshot: jsonb("calculated_sheet_plan_snapshot").$type<Record<string, unknown>>(),
  effectiveSheetPlanSnapshot: jsonb("effective_sheet_plan_snapshot").$type<Record<string, unknown>>(),
  sheetProgressSnapshot: jsonb("sheet_progress_snapshot").$type<Record<string, unknown>>(),
  sheetPlanOverrideReason: text("sheet_plan_override_reason"),
  sheetPlanOverrideByUserId: varchar("sheet_plan_override_by_user_id").references(() => users.id, { onDelete: "set null" }),
  sheetPlanOverrideAt: timestamp("sheet_plan_override_at", { withTimezone: true }),
  sheetPlanCalculatorVersion: varchar("sheet_plan_calculator_version", { length: 64 }),
  notes: text("notes"),
  compatibilityOverrideReason: text("compatibility_override_reason"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  canceledByUserId: varchar("canceled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  cancelReason: text("cancel_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("production_runs_org_number_uidx").on(table.organizationId, table.runNumber),
  index("production_runs_org_order_status_idx").on(table.organizationId, table.orderId, table.status),
  index("production_runs_org_status_idx").on(table.organizationId, table.status),
]);

/** Reserved and completed customer quantity for a job within a physical run. */
export const productionRunMembers = pgTable("production_run_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  productionRunId: varchar("production_run_id").notNull().references(() => productionRuns.id, { onDelete: "cascade" }),
  productionJobId: varchar("production_job_id").notNull().references(() => productionJobs.id, { onDelete: "restrict" }),
  orderLineItemId: varchar("order_line_item_id").notNull().references(() => orderLineItems.id, { onDelete: "restrict" }),
  allocatedQuantity: integer("allocated_quantity").notNull(),
  completedQuantity: integer("completed_quantity").notNull().default(0),
  successfulQuantity: integer("successful_quantity").notNull().default(0),
  damagedQuantity: integer("damaged_quantity").notNull().default(0),
  remainingQuantity: integer("remaining_quantity").notNull().default(0),
  outcomeStatus: varchar("outcome_status", { length: 40 }).notNull().default("pending").$type<"pending" | "completed" | "partially_completed" | "failed" | "requires_reprint" | "return_to_prepress" | "cancelled" | "hold_for_review">(),
  recoveryDisposition: varchar("recovery_disposition", { length: 40 }).$type<"none" | "return_to_prepress" | "return_to_production_queue" | "requires_reprint" | "hold_for_review" | "cancel_remaining" | null>(),
  operatorNote: text("operator_note"),
  outcomeSegments: jsonb("outcome_segments").$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'::jsonb`),
  lastOutcomeIdempotencyKey: varchar("last_outcome_idempotency_key", { length: 160 }),
  lastOutcomeAt: timestamp("last_outcome_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("production_run_members_run_job_uidx").on(table.productionRunId, table.productionJobId),
  index("production_run_members_org_job_idx").on(table.organizationId, table.productionJobId),
  index("production_run_members_line_item_idx").on(table.orderLineItemId),
  index("production_run_members_org_outcome_idx").on(table.organizationId, table.outcomeStatus),
]);

export type ProductionJob = typeof productionJobs.$inferSelect;
export type InsertProductionJob = typeof productionJobs.$inferInsert;
export type ProductionRun = typeof productionRuns.$inferSelect;
export type InsertProductionRun = typeof productionRuns.$inferInsert;
export type ProductionRunMember = typeof productionRunMembers.$inferSelect;
export type ProductionEvent = typeof productionEvents.$inferSelect;
export type InsertProductionEvent = typeof productionEvents.$inferInsert;
export type ProductionAlert = typeof productionAlerts.$inferSelect;
export type InsertProductionAlert = typeof productionAlerts.$inferInsert;
export type ProductionAlertPreset = typeof productionAlertPresets.$inferSelect;
export type InsertProductionAlertPreset = typeof productionAlertPresets.$inferInsert;
export type ProductionStationStep = typeof productionStationSteps.$inferSelect;
export type InsertProductionStationStep = z.infer<typeof insertProductionStationStepSchema>;

// -------------------- Invoicing & Payments (Future QuickBooks Sync Ready) --------------------

// Invoices table
export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  invoiceNumber: integer("invoice_number").notNull(), // Sequential numeric per org
  displayNumber: varchar("display_number", { length: 64 }),
  numberCore: integer("number_core"),
  orderId: varchar("order_id").references(() => orders.id, { onDelete: 'set null' }),
  sourceOrderNumber: integer("source_order_number"), // Snapshot of order number at time of invoice creation (immutable)
  customerId: varchar("customer_id").notNull().references(() => customers.id, { onDelete: 'restrict' }),
  status: varchar("status", { length: 50 }).notNull().default('draft'), // MVP: draft | billed | paid | void (legacy values may exist)
  // Lightweight invoice versioning
  invoiceVersion: integer("invoice_version").notNull().default(1),
  lastSentVersion: integer("last_sent_version"),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  lastSentVia: text("last_sent_via"),
  lastQbSyncedVersion: integer("last_qb_synced_version"),
  terms: varchar("terms", { length: 50 }).notNull().default('due_on_receipt'), // due_on_receipt, net_15, net_30, net_45, custom
  customTerms: varchar("custom_terms", { length: 255 }),
  issueDate: timestamp("issue_date", { withTimezone: true }).defaultNow().notNull(),
  // Billing lifecycle timestamps
  issuedAt: timestamp("issued_at", { withTimezone: true }), // set when billed
  dueDate: timestamp("due_date", { withTimezone: true }),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default('0'),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull().default('0'),
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default('0'),
  // Cents snapshot fields (MVP)
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  shippingCents: integer("shipping_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  currency: varchar("currency", { length: 8 }).notNull().default('USD'),
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
  // MVP QB sync fields (TitanOS system of record)
  qbInvoiceId: text("qb_invoice_id"),
  qbSyncStatus: varchar("qb_sync_status", { length: 20 }).notNull().default('not_synced'), // not_synced | pending | synced | failed | needs_resync
  qbLastError: text("qb_last_error"),
  modifiedAfterBilling: boolean("modified_after_billing").notNull().default(false),
  // QB import tracking (migration 0042)
  importSource: varchar("import_source", { length: 30 }),            // 'quickbooks' | null
  isHistorical: boolean("is_historical").notNull().default(false),   // true = closed/paid, read-only A/R record
  qbImportBalanceDue: decimal("qb_import_balance_due", { precision: 10, scale: 2 }), // QB Balance snapshot at import time
  importedAt: timestamp("imported_at", { withTimezone: true }),
  lockedReason: text("locked_reason"),                               // e.g. 'historical_import'
  qbDocNumber: text("qb_doc_number"),                                // QB DocNumber (human-readable invoice #)
  qbLineItemsSnapshot: jsonb("qb_line_items_snapshot").$type<any[]>(), // structured QBInvoiceLineItemDetail[] snapshot (parsedDetails included)
  // Customer PO tracking (migration 0043)
  customerPoNumber: varchar("customer_po_number", { length: 100 }),  // Customer PO/reference number
  qbPoSource: varchar("qb_po_source", { length: 50 }),               // QB field PO was extracted from: 'custom_field_sales1' | 'custom_field' | 'private_note' | 'customer_memo' | 'line_description'
  invoiceCreationSource: varchar("invoice_creation_source", { length: 32 }).notNull().default('manual'), // manual | automation
  billingMilestone: varchar("billing_milestone", { length: 64 }), // automation trigger milestone; null for manual invoices
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("invoices_organization_id_idx").on(table.organizationId),
  index("invoices_invoice_number_idx").on(table.invoiceNumber),
  index("invoices_display_number_idx").on(table.displayNumber),
  index("invoices_number_core_idx").on(table.numberCore),
  uniqueIndex("invoices_org_display_number_unique").on(table.organizationId, table.displayNumber).where(sql`${table.displayNumber} IS NOT NULL`),
  uniqueIndex("invoices_org_number_core_unique").on(table.organizationId, table.numberCore).where(sql`${table.numberCore} IS NOT NULL`),
  uniqueIndex("invoices_automation_milestone_uidx")
    .on(table.organizationId, table.orderId, table.billingMilestone)
    .where(sql`${table.invoiceCreationSource} = 'automation' AND ${table.orderId} IS NOT NULL AND ${table.billingMilestone} IS NOT NULL`),
  index("invoices_customer_id_idx").on(table.customerId),
  index("invoices_order_id_idx").on(table.orderId),
  index("invoices_status_idx").on(table.status),
  index("invoices_due_date_idx").on(table.dueDate),
  index("invoices_sync_status_idx").on(table.syncStatus),
  index("invoices_import_source_org_idx").on(table.organizationId, table.importSource),
  index("invoices_is_historical_org_idx").on(table.organizationId, table.isHistorical),
  index("invoices_customer_po_number_org_idx").on(table.organizationId, table.customerPoNumber),
  index("invoices_creation_source_org_idx").on(table.organizationId, table.invoiceCreationSource),
  index("invoices_billing_milestone_org_idx").on(table.organizationId, table.billingMilestone),
]);

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  amountPaid: true,
  balanceDue: true,
  organizationId: true,
  invoiceVersion: true,
  lastSentVersion: true,
  lastSentAt: true,
  lastSentVia: true,
  lastQbSyncedVersion: true,
}).extend({
  invoiceNumber: z.number().int().positive(),
  status: z.enum(['draft','finalized','billed','paid','void','sent','partially_paid','overdue']).default('draft'),
  terms: z.enum(['due_on_receipt','net_15','net_30','net_45','custom']).default('due_on_receipt'),
  customTerms: z.string().max(255).optional().nullable(),
  issueDate: z.preprocess((val) => val ? new Date(val as any) : new Date(), z.date()),
  issuedAt: z.preprocess((val) => {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'string') return new Date(val);
    return val;
  }, z.date().nullable().optional()),
  dueDate: z.preprocess((val) => {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'string') return new Date(val);
    return val;
  }, z.date().nullable().optional()),
  subtotal: z.coerce.number().min(0),
  tax: z.coerce.number().min(0),
  total: z.coerce.number().min(0),
  subtotalCents: z.coerce.number().int().min(0).optional(),
  taxCents: z.coerce.number().int().min(0).optional(),
  shippingCents: z.coerce.number().int().min(0).optional(),
  totalCents: z.coerce.number().int().min(0).optional(),
  currency: z.string().min(1).max(8).optional(),
  notesPublic: z.string().optional().nullable(),
  notesInternal: z.string().optional().nullable(),
  syncStatus: z.enum(['pending','synced','error','skipped']).default('pending'),
  syncError: z.string().optional().nullable(),
  qbInvoiceId: z.string().optional().nullable(),
  qbSyncStatus: z.enum(['not_synced','pending','synced','failed','needs_resync']).default('not_synced'),
  qbLastError: z.string().optional().nullable(),
  modifiedAfterBilling: z.boolean().default(false),
  importSource: z.string().max(30).optional().nullable(),
  isHistorical: z.boolean().default(false).optional(),
  qbImportBalanceDue: z.coerce.number().optional().nullable(),
  importedAt: z.preprocess((val) => {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'string') return new Date(val);
    return val;
  }, z.date().nullable().optional()),
  lockedReason: z.string().optional().nullable(),
  qbDocNumber: z.string().optional().nullable(),
  qbLineItemsSnapshot: z.array(z.any()).optional().nullable(),
  customerPoNumber: z.string().max(100).optional().nullable(),
  qbPoSource: z.string().max(50).optional().nullable(),
  invoiceCreationSource: z.enum(['manual','automation']).default('manual').optional(),
  billingMilestone: z.enum([
    'order_entry',
    'quote_approval',
    'proof_approval',
    'production_complete',
    'ready_for_pickup_or_ready_to_ship',
    'picked_up_or_shipped',
  ]).optional().nullable(),
});

export const updateInvoiceSchema = insertInvoiceSchema.partial().extend({
  id: z.string(),
});

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type UpdateInvoice = z.infer<typeof updateInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

export const invoiceEmailLogs = pgTable("invoice_email_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  recipientEmail: text("recipient_email").notNull(),
  status: text("status").notNull().default('sent'),
  messageId: text("message_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // 'invoice_send' = original invoice email; 'reminder_send' = automated reminder.
  // Filters in getInvoiceEmailStatuses() must use type = 'invoice_send' so reminder
  // sends do not falsely mark an invoice as sent_current.
  type: text("type").notNull().default('invoice_send'),
}, (table) => [
  index("invoice_email_logs_organization_id_idx").on(table.organizationId),
  index("invoice_email_logs_invoice_id_idx").on(table.invoiceId),
  index("invoice_email_logs_invoice_sent_at_idx").on(table.invoiceId, table.sentAt),
  index("invoice_email_logs_org_invoice_idx").on(table.organizationId, table.invoiceId),
  index("invoice_email_logs_type_idx").on(table.organizationId, table.type, table.sentAt),
]);

export const insertInvoiceEmailLogSchema = createInsertSchema(invoiceEmailLogs).omit({
  id: true,
  createdAt: true,
}).extend({
  status: z.enum(['sent', 'failed']).default('sent'),
  type: z.enum(['invoice_send', 'reminder_send']).default('invoice_send'),
  sentAt: z.preprocess((val) => val ? new Date(val as any) : new Date(), z.date()),
});

export type InsertInvoiceEmailLog = z.infer<typeof insertInvoiceEmailLogSchema>;
export type InvoiceEmailLog = typeof invoiceEmailLogs.$inferSelect;

export const invoiceReminderLogs = pgTable("invoice_reminder_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  reminderNumber: integer("reminder_number").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  // Added in migration 0039
  status: text("status").notNull().default('sent'), // 'sent' | 'failed'
  recipientEmail: text("recipient_email"),
  messageId: text("message_id"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("invoice_reminder_logs_invoice_sent_at_idx").on(table.invoiceId, table.sentAt),
  index("invoice_reminder_logs_org_sent_at_idx").on(table.organizationId, table.sentAt),
  index("invoice_reminder_logs_status_idx").on(table.organizationId, table.invoiceId, table.status),
]);

export const insertInvoiceReminderLogSchema = createInsertSchema(invoiceReminderLogs).omit({
  id: true,
  createdAt: true,
}).extend({
  reminderNumber: z.number().int().positive(),
  sentAt: z.preprocess((val) => val ? new Date(val as any) : new Date(), z.date()),
  status: z.enum(['sent', 'failed']).default('sent'),
  recipientEmail: z.string().optional().nullable(),
  messageId: z.string().optional().nullable(),
  failureReason: z.string().optional().nullable(),
});

export type InsertInvoiceReminderLog = z.infer<typeof insertInvoiceReminderLogSchema>;
export type InvoiceReminderLog = typeof invoiceReminderLogs.$inferSelect;

export const invoiceReminderSettings = pgTable("invoice_reminder_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  enabled: boolean("enabled").notNull().default(false),
  firstReminderDaysAfterDue: integer("first_reminder_days_after_due"),
  repeatIntervalDays: integer("repeat_interval_days"),
  maxReminders: integer("max_reminders"),
  // Added in migration 0038
  sendCopyToInternalEmail: boolean("send_copy_to_internal_email").notNull().default(false),
  internalCopyEmail: text("internal_copy_email"),
  pauseForManualBillingCustomers: boolean("pause_for_manual_billing_customers").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("invoice_reminder_settings_organization_id_uidx").on(table.organizationId),
]);

export const insertInvoiceReminderSettingsSchema = createInsertSchema(invoiceReminderSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  enabled: z.boolean().optional().default(false),
  firstReminderDaysAfterDue: z.number().int().optional().nullable(),
  repeatIntervalDays: z.number().int().optional().nullable(),
  maxReminders: z.number().int().optional().nullable(),
  sendCopyToInternalEmail: z.boolean().optional().default(false),
  internalCopyEmail: z.string().email().optional().nullable(),
  pauseForManualBillingCustomers: z.boolean().optional().default(false),
});

export const updateInvoiceReminderSettingsSchema = insertInvoiceReminderSettingsSchema.partial();
export type InsertInvoiceReminderSettings = z.infer<typeof insertInvoiceReminderSettingsSchema>;
export type UpdateInvoiceReminderSettings = z.infer<typeof updateInvoiceReminderSettingsSchema>;
export type InvoiceReminderSettings = typeof invoiceReminderSettings.$inferSelect;

// Invoice Line Items snapshot table
export const invoiceLineItems = pgTable("invoice_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  orderLineItemId: varchar("order_line_item_id").references(() => orderLineItems.id, { onDelete: 'set null' }),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: 'restrict' }),
  productVariantId: varchar("product_variant_id").references(() => productVariants.id, { onDelete: 'set null' }),
  productType: varchar("product_type", { length: 50 }).notNull().default('wide_roll'),
  name: text("name"),
  sku: varchar("sku", { length: 100 }),
  description: text("description").notNull(),
  width: decimal("width", { precision: 10, scale: 2 }),
  height: decimal("height", { precision: 10, scale: 2 }),
  quantity: integer("quantity").notNull(),
  sqft: decimal("sqft", { precision: 10, scale: 2 }),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  lineTotalCents: integer("line_total_cents").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  specsJson: jsonb("specs_json").$type<Record<string, any>>(),
  // NEW: v2 canonical option selections (additive)
  optionSelectionsJson: jsonb("option_selections_json").$type<any>(),
  // Immutable bundle display snapshot (migration 0131).
  parentLineItemId: varchar("parent_line_item_id"),
  lineItemRole: lineItemRoleEnum("line_item_role").notNull().default("standalone"),
  childDisplayMode: lineItemChildDisplayModeEnum("child_display_mode").notNull().default("hidden"),
  parentPriceMode: lineItemParentPriceModeEnum("parent_price_mode").notNull().default("sum_children"),
  childCalculatedTotalCents: integer("child_calculated_total_cents"),
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
  index("invoice_line_items_parent_line_item_id_idx").on(table.parentLineItemId),
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
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  provider: varchar("provider", { length: 20 }).notNull().default('manual'), // manual | stripe | eps
  status: varchar("status", { length: 20 }).notNull().default('succeeded'), // pending | succeeded | failed | canceled | refunded
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
  currency: varchar("currency", { length: 8 }).notNull().default('USD'),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  providerTransactionId: text("provider_transaction_id"),
  providerIdempotencyKey: text("provider_idempotency_key"),
  epsPtk: text("eps_ptk"),
  epsHostedPaymentUrl: text("eps_hosted_payment_url"),
  epsMode: varchar("eps_mode", { length: 32 }),
  epsMethod: varchar("eps_method", { length: 32 }),
  epsAuthCode: text("eps_auth_code"),
  epsResponseCode: text("eps_response_code"),
  epsResponseMessage: text("eps_response_message"),
  epsApprovedAmountCents: integer("eps_approved_amount_cents"),
  epsTokenLast4: varchar("eps_token_last4", { length: 8 }),
  epsCardType: varchar("eps_card_type", { length: 32 }),
  succeededAt: timestamp("succeeded_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, any>>().default(sql`'{}'::jsonb`).notNull(),
  method: varchar("method", { length: 50 }).notNull().default('other'), // cash, check, credit_card, ach, other
  notes: text("notes"),
  note: text("note"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: 'restrict' }),
  externalAccountingId: varchar("external_accounting_id"),
  syncStatus: varchar("sync_status", { length: 50 }).notNull().default('pending'), // pending, synced, error, skipped
  syncError: text("sync_error"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  qbReconciledAt: timestamp("qb_reconciled_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("payments_organization_id_idx").on(table.organizationId),
  index("payments_invoice_id_idx").on(table.invoiceId),
  index("payments_provider_idx").on(table.provider),
  index("payments_status_idx").on(table.status),
  uniqueIndex("payments_org_stripe_payment_intent_id_uidx").on(table.organizationId, table.stripePaymentIntentId),
  uniqueIndex("payments_org_provider_transaction_id_uidx")
    .on(table.organizationId, table.provider, table.providerTransactionId)
    .where(sql`${table.providerTransactionId} IS NOT NULL`),
  uniqueIndex("payments_org_provider_idempotency_key_uidx")
    .on(table.organizationId, table.provider, table.providerIdempotencyKey)
    .where(sql`${table.providerIdempotencyKey} IS NOT NULL`),
  index("payments_eps_ptk_idx").on(table.organizationId, table.epsPtk),
  index("payments_method_idx").on(table.method),
  index("payments_created_by_user_id_idx").on(table.createdByUserId),
  index("payments_sync_status_idx").on(table.syncStatus),
]);

// Manual payment methods (non-Stripe). NOTE: Terms are not a payment method.
export const manualPaymentMethodSchema = z.enum(['cash', 'check', 'credit_card', 'wire', 'bank_transfer', 'ach', 'other']);
export type ManualPaymentMethod = z.infer<typeof manualPaymentMethodSchema>;

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  syncedAt: true,
  organizationId: true,
}).extend({
  amount: z.coerce.number().positive(),
  provider: z.enum(['manual','stripe','eps']).default('manual'),
  status: z.enum(['pending','succeeded','failed','canceled','refunded','voided','captured']).default('succeeded'),
  currency: z.string().min(1).max(8).default('USD'),
  method: z.enum(['cash','check','wire','bank_transfer','credit_card','ach','other']).default('other'),
  notes: z.string().optional().nullable(),
  syncStatus: z.enum(['pending','synced','error','skipped']).default('pending'),
  qbReconciledAt: z.preprocess((val) => {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'string') return new Date(val);
    return val;
  }, z.date().nullable().optional()),
});

export const updatePaymentSchema = insertPaymentSchema.partial().extend({
  id: z.string(),
});

export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type UpdatePayment = z.infer<typeof updatePaymentSchema>;
export type Payment = typeof payments.$inferSelect;

export const paymentProviderSchema = z.enum(['none', 'stripe', 'eps']);
export const epsPaymentModeSchema = z.enum(['hosted_cnp', 'token_cnp', 'card_present', 'ach', 'gift_card']);

export const organizationPaymentSettings = pgTable("organization_payment_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  provider: varchar("provider", { length: 20 }).notNull().default('none'),
  epsEnabled: boolean("eps_enabled").notNull().default(false),
  epsAccountNumber: text("eps_account_number"),
  epsApiKey: text("eps_api_key"),
  epsCnpBaseUrl: text("eps_cnp_base_url").notNull().default('https://postransactions.com/cnp'),
  epsCardPresentBaseUrl: text("eps_card_present_base_url").notNull().default('https://postransactions.com/connet'),
  epsAchBaseUrl: text("eps_ach_base_url").notNull().default('https://postransactions.com/ach'),
  epsGiftBaseUrl: text("eps_gift_base_url").notNull().default('https://postransactions.com/gift'),
  epsDeviceSerialNumber: text("eps_device_serial_number"),
  epsSupportedModes: jsonb("eps_supported_modes").$type<string[]>().default(sql`'["hosted_cnp"]'::jsonb`).notNull(),
  epsMode: varchar("eps_mode", { length: 8 }).notNull().default("test"),
  epsTestAccountNumber: text("eps_test_account_number"),
  epsTestEncryptedApiKey: text("eps_test_encrypted_api_key"),
  epsTestEncryptionKeyId: text("eps_test_encryption_key_id"),
  epsTestBaseUrl: text("eps_test_base_url").notNull().default('https://postransactions.com/cnp'),
  epsLiveAccountNumber: text("eps_live_account_number"),
  epsLiveEncryptedApiKey: text("eps_live_encrypted_api_key"),
  epsLiveEncryptionKeyId: text("eps_live_encryption_key_id"),
  epsLiveBaseUrl: text("eps_live_base_url").notNull().default('https://postransactions.com/cnp'),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("organization_payment_settings_org_uidx").on(table.organizationId),
  index("organization_payment_settings_provider_idx").on(table.provider),
]);

export const insertOrganizationPaymentSettingsSchema = createInsertSchema(organizationPaymentSettings).omit({
  id: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  provider: paymentProviderSchema.default('none'),
  epsEnabled: z.boolean().default(false),
  epsAccountNumber: z.string().trim().max(100).optional().nullable(),
  epsApiKey: z.string().trim().max(500).optional().nullable(),
  epsCnpBaseUrl: z.string().url().optional(),
  epsCardPresentBaseUrl: z.string().url().optional(),
  epsAchBaseUrl: z.string().url().optional(),
  epsGiftBaseUrl: z.string().url().optional(),
  epsDeviceSerialNumber: z.string().trim().max(100).optional().nullable(),
  epsSupportedModes: z.array(epsPaymentModeSchema).default(['hosted_cnp']),
});

export const updateOrganizationPaymentSettingsSchema = insertOrganizationPaymentSettingsSchema.partial().extend({
  epsApiKey: z.string().trim().max(500).optional().nullable(),
});

export type OrganizationPaymentSettings = typeof organizationPaymentSettings.$inferSelect;
export type InsertOrganizationPaymentSettings = z.infer<typeof insertOrganizationPaymentSettingsSchema>;
export type UpdateOrganizationPaymentSettings = z.infer<typeof updateOrganizationPaymentSettingsSchema>;

// Stripe/Webhook events (idempotency + audit trail)
export const paymentWebhookEvents = pgTable("payment_webhook_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: varchar("provider", { length: 20 }).notNull(), // stripe
  eventId: text("event_id").notNull(),
  type: text("type").notNull(),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: 'set null' }),
  status: varchar("status", { length: 20 }).notNull().default('received'), // received | processed | error
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  payload: jsonb("payload").$type<Record<string, any>>().notNull(),
  error: text("error"),
}, (table) => [
  uniqueIndex("payment_webhook_events_provider_event_id_uidx").on(table.provider, table.eventId),
  index("payment_webhook_events_org_id_idx").on(table.organizationId),
  index("payment_webhook_events_received_at_idx").on(table.receivedAt),
  index("payment_webhook_events_status_idx").on(table.status),
]);

export const insertPaymentWebhookEventSchema = createInsertSchema(paymentWebhookEvents).omit({
  id: true,
  receivedAt: true,
  processedAt: true,
});

export type InsertPaymentWebhookEvent = z.infer<typeof insertPaymentWebhookEventSchema>;
export type PaymentWebhookEvent = typeof paymentWebhookEvents.$inferSelect;

// -------------------- Shipping & Fulfillment --------------------

export const shipmentStatusSchema = z.enum(['DRAFT', 'SHIPPED', 'VOIDED']);
export const shipmentScopeSchema = z.enum(['SINGLE_ORDER', 'MULTI_ORDER']);
export const pickupTicketStatusSchema = z.enum(['DRAFT', 'READY_FOR_PICKUP', 'PICKED_UP', 'VOIDED']);
export const outboundNotificationChannelSchema = z.enum(['email', 'sms']);
export const outboundNotificationStatusSchema = z.enum(['PENDING', 'SENT', 'FAILED']);
export const outboundNotificationRelatedTypeSchema = z.enum(['PICKUP_TICKET']);
export const fulfillmentEntityTypeSchema = z.enum(['SHIPMENT', 'PICKUP_TICKET', 'ORDER']);
export const fulfillmentEventTypeSchema = z.enum([
  'SHIPMENT_CREATED',
  'SHIPMENT_UPDATED',
  'SHIPMENT_SHIPPED',
  'SHIPMENT_VOIDED',
  'FULFILLMENT_READY',
  'FULFILLMENT_NOTE',
  'FULFILLMENT_AUTO_ARCHIVED',
  'FULFILLMENT_CHECKLIST_ITEM_UPDATED',
  'FULFILLMENT_CHECKLIST_VERIFIED',
  'FULFILLMENT_UNREADY',
  'PICKUP_READY',
  'PICKUP_PICKED_UP',
  'PICKUP_VOIDED',
  'NOTIFICATION_SENT',
  'NOTIFICATION_FAILED',
]);

// Shipments table (legacy + v1 fulfillment architecture)
export const shipments = pgTable("shipments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").references(() => orders.id, { onDelete: 'cascade' }), // legacy compatibility
  status: varchar("status", { length: 20 }).notNull().default('DRAFT'), // DRAFT | SHIPPED | VOIDED
  scope: varchar("scope", { length: 20 }).notNull().default('SINGLE_ORDER'), // SINGLE_ORDER | MULTI_ORDER
  primaryOrderId: varchar("primary_order_id").references(() => orders.id, { onDelete: 'set null' }),
  carrier: varchar("carrier", { length: 100 }), // UPS/FedEx/USPS/Freight/LocalDelivery (raw string)
  serviceLevel: text("service_level"),
  trackingNumber: varchar("tracking_number", { length: 255 }),
  carrierShipmentId: text("carrier_shipment_id"),
  labelStorageKey: text("label_storage_key"),
  carrierLastStatus: text("carrier_last_status"),
  carrierRawResponse: jsonb("carrier_raw_response").$type<Record<string, any>>().default(sql`'{}'::jsonb`).notNull(),
  // Migration 0055 creates this as Postgres DATE, not timestamp.
  shipDate: date("ship_date", { mode: "date" }),
  shipmentReference: varchar("shipment_reference", { length: 80 }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }), // legacy timestamp
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  boxCount: integer("box_count"),
  weightLbs: decimal("weight_lbs", { precision: 10, scale: 2 }),
  dimLengthIn: decimal("dim_length_in", { precision: 10, scale: 2 }),
  dimWidthIn: decimal("dim_width_in", { precision: 10, scale: 2 }),
  dimHeightIn: decimal("dim_height_in", { precision: 10, scale: 2 }),
  internalNotes: text("internal_notes"),
  notes: text("notes"),
  externalShippingId: varchar("external_shipping_id"), // ShipStation / carrier API ID
  syncStatus: varchar("sync_status", { length: 50 }).notNull().default('pending'), // pending, synced, error, skipped
  syncError: text("sync_error"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("shipments_organization_id_idx").on(table.organizationId),
  index("shipments_org_status_idx").on(table.organizationId, table.status),
  index("shipments_order_id_idx").on(table.orderId),
  index("shipments_primary_order_id_idx").on(table.primaryOrderId),
  index("shipments_carrier_idx").on(table.carrier),
  index("shipments_tracking_number_idx").on(table.trackingNumber),
  uniqueIndex("shipments_org_reference_uidx").on(table.organizationId, table.shipmentReference),
  index("shipments_sync_status_idx").on(table.syncStatus),
]);

export const insertShipmentSchema = createInsertSchema(shipments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  syncedAt: true,
  organizationId: true,
}).extend({
  carrier: z.string().min(1),
  status: shipmentStatusSchema.optional(),
  scope: shipmentScopeSchema.optional(),
  trackingNumber: z.string().optional().nullable(),
  serviceLevel: z.string().optional().nullable(),
  shipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  boxCount: z.coerce.number().int().min(0).optional().nullable(),
  weightLbs: z.coerce.number().min(0).optional().nullable(),
  dimLengthIn: z.coerce.number().min(0).optional().nullable(),
  dimWidthIn: z.coerce.number().min(0).optional().nullable(),
  dimHeightIn: z.coerce.number().min(0).optional().nullable(),
  internalNotes: z.string().optional().nullable(),
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

// Shipment <-> Order join (multi-order shipments)
export const shipmentOrders = pgTable("shipment_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  shipmentId: varchar("shipment_id").notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("shipment_orders_shipment_order_uidx").on(table.shipmentId, table.orderId),
  index("shipment_orders_org_idx").on(table.organizationId),
  index("shipment_orders_shipment_idx").on(table.shipmentId),
  index("shipment_orders_order_idx").on(table.orderId),
]);

export const insertShipmentOrderSchema = createInsertSchema(shipmentOrders).omit({
  id: true,
  createdAt: true,
});

export type InsertShipmentOrder = z.infer<typeof insertShipmentOrderSchema>;
export type ShipmentOrder = typeof shipmentOrders.$inferSelect;

// Per-line-item partial shipment quantities
export const shipmentItems = pgTable("shipment_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  shipmentId: varchar("shipment_id").notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  packageId: varchar("package_id"),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  orderLineItemId: varchar("order_line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),
  quantity: integer("quantity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("shipment_items_org_order_idx").on(table.organizationId, table.orderId),
  index("shipment_items_org_line_item_idx").on(table.organizationId, table.orderLineItemId),
  index("shipment_items_shipment_idx").on(table.shipmentId),
  index("shipment_items_package_idx").on(table.packageId),
]);

export const insertShipmentItemSchema = createInsertSchema(shipmentItems).omit({
  id: true,
  createdAt: true,
}).extend({
  quantity: z.coerce.number().int().positive(),
});

export type InsertShipmentItem = z.infer<typeof insertShipmentItemSchema>;
export type ShipmentItem = typeof shipmentItems.$inferSelect;

export const shipmentPackages = pgTable("shipment_packages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  shipmentId: varchar("shipment_id").notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  ordinal: integer("ordinal").notNull(),
  packageReference: varchar("package_reference", { length: 100 }).notNull(),
  weightLbs: decimal("weight_lbs", { precision: 10, scale: 2 }),
  dimLengthIn: decimal("dim_length_in", { precision: 10, scale: 2 }),
  dimWidthIn: decimal("dim_width_in", { precision: 10, scale: 2 }),
  dimHeightIn: decimal("dim_height_in", { precision: 10, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("shipment_packages_shipment_ordinal_uidx").on(table.shipmentId, table.ordinal),
  uniqueIndex("shipment_packages_org_reference_uidx").on(table.organizationId, table.packageReference),
  index("shipment_packages_org_shipment_idx").on(table.organizationId, table.shipmentId),
]);

export const pickupTickets = pgTable("pickup_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  status: varchar("status", { length: 32 }).notNull().default('DRAFT'),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
  stagingLocation: text("staging_location"),
  pickupNotes: text("pickup_notes"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("pickup_tickets_order_uidx").on(table.orderId),
  index("pickup_tickets_org_status_idx").on(table.organizationId, table.status),
  index("pickup_tickets_org_order_idx").on(table.organizationId, table.orderId),
]);

export const insertPickupTicketSchema = createInsertSchema(pickupTickets).omit({
  id: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: pickupTicketStatusSchema.optional(),
});

export const updatePickupTicketSchema = insertPickupTicketSchema.partial().extend({
  id: z.string(),
});

export type InsertPickupTicket = z.infer<typeof insertPickupTicketSchema>;
export type UpdatePickupTicket = z.infer<typeof updatePickupTicketSchema>;
export type PickupTicket = typeof pickupTickets.$inferSelect;

/** Immutable record of a customer collection. A ticket is the current pickup
 * workflow state; handoffs preserve every partial collection. */
export const pickupHandoffs = pgTable("pickup_handoffs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  pickupTicketId: varchar("pickup_ticket_id").notNull().references(() => pickupTickets.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  handedOffByUserId: varchar("handed_off_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  /** Client supplied replay key; nullable for historical handoffs. */
  clientRequestId: varchar("client_request_id", { length: 128 }),
  notes: text("notes"),
  handedOffAt: timestamp("handed_off_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("pickup_handoffs_org_order_idx").on(table.organizationId, table.orderId),
  index("pickup_handoffs_ticket_idx").on(table.pickupTicketId),
  uniqueIndex("pickup_handoffs_ticket_request_uidx").on(table.organizationId, table.pickupTicketId, table.clientRequestId).where(sql`${table.clientRequestId} IS NOT NULL`),
]);

/** Per-line quantities for one immutable pickup handoff. */
export const pickupHandoffItems = pgTable("pickup_handoff_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  pickupHandoffId: varchar("pickup_handoff_id").notNull().references(() => pickupHandoffs.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  orderLineItemId: varchar("order_line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),
  quantity: integer("quantity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("pickup_handoff_items_org_line_idx").on(table.organizationId, table.orderLineItemId),
  index("pickup_handoff_items_handoff_idx").on(table.pickupHandoffId),
]);

export const insertPickupHandoffSchema = createInsertSchema(pickupHandoffs).omit({ id: true, organizationId: true, createdAt: true });
export const insertPickupHandoffItemSchema = createInsertSchema(pickupHandoffItems).omit({ id: true, organizationId: true, createdAt: true }).extend({ quantity: z.coerce.number().int().positive() });
export type PickupHandoff = typeof pickupHandoffs.$inferSelect;
export type PickupHandoffItem = typeof pickupHandoffItems.$inferSelect;

export const outboundNotifications = pgTable("outbound_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  relatedType: varchar("related_type", { length: 40 }).notNull(),
  relatedId: varchar("related_id").notNull(),
  channel: varchar("channel", { length: 20 }).notNull(),
  toAddress: text("to_address").notNull(),
  status: varchar("status", { length: 20 }).notNull().default('PENDING'),
  provider: text("provider"),
  providerMessageId: text("provider_message_id"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (table) => [
  index("outbound_notifications_org_status_idx").on(table.organizationId, table.status),
  index("outbound_notifications_related_idx").on(table.relatedType, table.relatedId),
]);

export const insertOutboundNotificationSchema = createInsertSchema(outboundNotifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  relatedType: outboundNotificationRelatedTypeSchema,
  channel: outboundNotificationChannelSchema,
  status: outboundNotificationStatusSchema.default('PENDING'),
});

export type InsertOutboundNotification = z.infer<typeof insertOutboundNotificationSchema>;
export type OutboundNotification = typeof outboundNotifications.$inferSelect;

export const fulfillmentEvents = pgTable("fulfillment_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: 'set null' }),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  entityId: varchar("entity_id").notNull(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, any>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("fulfillment_events_org_entity_created_idx").on(table.organizationId, table.entityType, table.entityId, table.createdAt),
  index("fulfillment_events_org_event_created_idx").on(table.organizationId, table.eventType, table.createdAt),
]);

export const insertFulfillmentEventSchema = createInsertSchema(fulfillmentEvents).omit({
  id: true,
  createdAt: true,
}).extend({
  entityType: fulfillmentEntityTypeSchema,
  eventType: fulfillmentEventTypeSchema,
});

export type InsertFulfillmentEvent = z.infer<typeof insertFulfillmentEventSchema>;
export type FulfillmentEvent = typeof fulfillmentEvents.$inferSelect;

export const fulfillmentChecklistItems = pgTable("fulfillment_checklist_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  lineItemId: varchar("line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),
  checked: boolean("checked").notNull().default(false),
  // Strict mode uses checked; simple mode records the precise packed quantity.
  fulfilledQuantity: integer("fulfilled_quantity").notNull().default(0),
  checkedByUserId: varchar("checked_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("fulfillment_checklist_items_org_order_line_uidx").on(table.organizationId, table.orderId, table.lineItemId),
  index("fulfillment_checklist_items_org_order_idx").on(table.organizationId, table.orderId),
  index("fulfillment_checklist_items_org_line_idx").on(table.organizationId, table.lineItemId),
  index("fulfillment_checklist_items_org_checked_idx").on(table.organizationId, table.checked),
]);

export const insertFulfillmentChecklistItemSchema = createInsertSchema(fulfillmentChecklistItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFulfillmentChecklistItem = z.infer<typeof insertFulfillmentChecklistItemSchema>;
export type FulfillmentChecklistItem = typeof fulfillmentChecklistItems.$inferSelect;

/**
 * Fulfillment-owned physical availability. This is deliberately mutable state:
 * immutable shipment and pickup handoff records remain the source of truth for
 * what left the building.
 */
export const fulfillmentReadyQuantities = pgTable("fulfillment_ready_quantities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  orderLineItemId: varchar("order_line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),
  readyWaitingQuantity: integer("ready_waiting_quantity").notNull().default(0),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("fulfillment_ready_quantities_org_order_line_uidx").on(table.organizationId, table.orderId, table.orderLineItemId),
  index("fulfillment_ready_quantities_org_order_idx").on(table.organizationId, table.orderId),
  index("fulfillment_ready_quantities_org_line_idx").on(table.organizationId, table.orderLineItemId),
]);

export type FulfillmentReadyQuantity = typeof fulfillmentReadyQuantities.$inferSelect;

// Append-only job notes & status log tables (no duplicate jobs table)
export const jobNotes = pgTable('job_notes', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }), // Migration 0014 - direct tenant filtering
  jobId: varchar('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  userId: varchar('user_id').references(() => users.id, { onDelete: 'set null' }),
  noteText: text('note_text').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('job_notes_organization_id_idx').on(table.organizationId, table.createdAt), // Migration 0014
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
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }), // Migration 0014 - direct tenant filtering
  jobId: varchar('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  oldStatusKey: varchar('old_status_key', { length: 50 }),
  newStatusKey: varchar('new_status_key', { length: 50 }).notNull(),
  userId: varchar('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('job_status_log_organization_id_idx').on(table.organizationId, table.createdAt), // Migration 0014
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
export const jobStatuses = pgTable("job_statuses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  key: varchar("key", { length: 50 }).notNull().unique(),  // SINGLE, UNIQUE VERSION
  label: varchar("label", { length: 100 }).notNull(),
  position: integer("position").notNull(),
  badgeVariant: varchar("badge_variant", { length: 50 }).default("default"),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  jobStatusesOrganizationIdIdx: index("job_statuses_organization_id_idx").on(table.organizationId),
  jobStatusesPositionIdx:       index("job_statuses_position_idx").on(table.position),
  jobStatusesKeyIdx:            index("job_statuses_key_idx").on(table.key),
  jobStatusesIsDefaultIdx:      index("job_statuses_is_default_idx").on(table.isDefault),
}));

export const insertJobStatusSchema = createInsertSchema(jobStatuses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
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
export const fileSideEnum = pgEnum('file_side', ['front', 'back', 'both', 'na']);

// Order Attachments table - files uploaded by customers or staff
// EXTENDED with artwork metadata (role, side, isPrimary, thumbnailUrl, orderLineItemId)
export const orderAttachments = pgTable("order_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  orderLineItemId: varchar("order_line_item_id").references(() => orderLineItems.id, { onDelete: 'cascade' }), // NEW: Per-line-item attachment
  quoteId: varchar("quote_id").references(() => quotes.id, { onDelete: 'set null' }), // Track if uploaded during quote checkout
  fileRecordId: varchar("file_record_id").references((): AnyPgColumn => fileRecords.id, { onDelete: 'set null' }),
  uploadedByUserId: varchar("uploaded_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  uploadedByName: varchar("uploaded_by_name", { length: 255 }), // Snapshot
  // Legacy mirror fields (nullable; canonical source of truth is fileRecordId)
  fileName: varchar("file_name", { length: 500 }).notNull(),
  fileUrl: text("file_url"), // legacy storage key or external URL
  fileSize: integer("file_size"), // bytes
  mimeType: varchar("mime_type", { length: 100 }),
  description: text("description"),
  // NEW: Enhanced file storage fields
  originalFilename: varchar("original_filename", { length: 500 }), // Exact client-provided name
  storedFilename: varchar("stored_filename", { length: 500 }), // Sanitized disk filename
  relativePath: text("relative_path"), // Path relative to storage root
  storageProvider: storageProviderEnum("storage_provider").default('local'), // local, s3, gcs, etc.
  extension: varchar("extension", { length: 20 }), // File extension without dot
  sizeBytes: integer("size_bytes"), // File size in bytes
  checksum: varchar("checksum", { length: 64 }), // SHA256 or MD5 hash
  // Canonical production instruction for this order-line/file relationship.
  // Front/Back entries with the same group share a single finished quantity.
  productionQuantity: integer("production_quantity"),
  productionGroupId: varchar("production_group_id", { length: 128 }),
  // Thumbnail support (legacy fields kept for backward compatibility)
  thumbnailRelativePath: text("thumbnail_relative_path"),
  thumbnailGeneratedAt: timestamp("thumbnail_generated_at"),
  // Thumbnail scaffolding fields (migration 0011)
  thumbStatus: thumbStatusEnum("thumb_status").default('uploaded'),
  thumbKey: text("thumb_key"), // Storage key for small thumbnail (e.g., 320x320)
  previewKey: text("preview_key"), // Storage key for medium preview (e.g., 1600x1600)
  thumbError: text("thumb_error"), // Error message if thumbnail generation failed
  // Artwork metadata fields
  role: fileRoleEnum("role").default('other'), // artwork, proof, reference, etc.
  side: fileSideEnum("side").default('na'), // front, back, or n/a
  isPrimary: boolean("is_primary").default(false).notNull(), // Primary artwork for this side/role
  thumbnailUrl: text("thumbnail_url"), // Optional thumbnail for quick preview (legacy GCS)
  customerVisible: boolean("customer_visible").default(false).notNull(),
  portalFileCategory: varchar("portal_file_category", { length: 64 }),
  portalDisplayName: varchar("portal_display_name", { length: 500 }),
  portalDescription: text("portal_description"),
  portalVisibilityUpdatedAt: timestamp("portal_visibility_updated_at"),
  portalVisibilityUpdatedBy: varchar("portal_visibility_updated_by").references(() => users.id, { onDelete: 'set null' }),
  customerUploadReviewStatus: varchar("customer_upload_review_status", { length: 32 }),
  customerUploadReviewedByUserId: varchar("customer_upload_reviewed_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  customerUploadReviewedAt: timestamp("customer_upload_reviewed_at"),
  customerUploadReviewNote: text("customer_upload_review_note"),
  customerUploadPromotionType: varchar("customer_upload_promotion_type", { length: 32 }),
  customerUploadPromotedByUserId: varchar("customer_upload_promoted_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  customerUploadPromotedAt: timestamp("customer_upload_promoted_at"),
  customerUploadAssignedToOrderLineItemId: varchar("customer_upload_assigned_to_order_line_item_id").references(() => orderLineItems.id, { onDelete: 'set null' }),
  customerUploadAssignmentType: varchar("customer_upload_assignment_type", { length: 32 }),
  customerUploadAssignedByUserId: varchar("customer_upload_assigned_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  customerUploadAssignedAt: timestamp("customer_upload_assigned_at"),
  customerUploadAssignmentNote: text("customer_upload_assignment_note"),
  customerUploadArtworkSelectionType: varchar("customer_upload_artwork_selection_type", { length: 32 }),
  customerUploadArtworkSelectedByUserId: varchar("customer_upload_artwork_selected_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  customerUploadArtworkSelectedAt: timestamp("customer_upload_artwork_selected_at"),
  customerUploadArtworkSelectionNote: text("customer_upload_artwork_selection_note"),
  customerUploadPrimaryCandidateSide: fileSideEnum("customer_upload_primary_candidate_side"),
  customerUploadPrimaryCandidateByUserId: varchar("customer_upload_primary_candidate_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  customerUploadPrimaryCandidateAt: timestamp("customer_upload_primary_candidate_at"),
  customerUploadPrimaryCandidateNote: text("customer_upload_primary_candidate_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("order_attachments_order_id_idx").on(table.orderId),
  index("order_attachments_order_line_item_id_idx").on(table.orderLineItemId),
  index("order_attachments_quote_id_idx").on(table.quoteId),
  index("order_attachments_file_record_id_idx").on(table.fileRecordId),
  index("order_attachments_production_group_idx").on(table.orderLineItemId, table.productionGroupId),
  index("order_attachments_role_idx").on(table.role),
  index("order_attachments_thumb_status_idx").on(table.thumbStatus),
  index("order_attachments_portal_visible_idx").on(table.orderId, table.customerVisible),
  index("order_attachments_customer_upload_review_idx").on(table.orderId, table.customerUploadReviewStatus),
  index("order_attachments_customer_upload_promotion_idx").on(table.orderId, table.customerUploadPromotionType),
  index("order_attachments_customer_upload_assignment_idx").on(table.orderId, table.customerUploadAssignedToOrderLineItemId),
  index("order_attachments_customer_upload_artwork_selection_idx").on(table.orderId, table.customerUploadArtworkSelectionType),
  index("order_attachments_customer_upload_primary_candidate_idx").on(table.orderId, table.customerUploadPrimaryCandidateSide),
  uniqueIndex("order_attachments_customer_upload_primary_candidate_line_side_uidx")
    .on(table.orderLineItemId, table.customerUploadPrimaryCandidateSide)
    .where(sql`${table.customerUploadPrimaryCandidateSide} IS NOT NULL`),
]);

export const insertOrderAttachmentSchema = createInsertSchema(orderAttachments).omit({
  id: true,
  createdAt: true,
}).extend({
  role: z.enum(['artwork', 'proof', 'reference', 'customer_po', 'setup', 'output', 'other']).default('other'),
  side: z.enum(['front', 'back', 'both', 'na']).default('na'),
  isPrimary: z.boolean().default(false),
});

export const updateOrderAttachmentSchema = insertOrderAttachmentSchema.pick({
  role: true,
  side: true,
  isPrimary: true,
  description: true,
  customerVisible: true,
  portalFileCategory: true,
  portalDisplayName: true,
  portalDescription: true,
}).partial();

export type InsertOrderAttachment = z.infer<typeof insertOrderAttachmentSchema>;
export type UpdateOrderAttachment = z.infer<typeof updateOrderAttachmentSchema>;
export type OrderAttachment = typeof orderAttachments.$inferSelect;

// Job Files table - links files to production jobs
export const jobFiles = pgTable("job_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }), // Migration 0014 - direct tenant filtering
  orderId: varchar("order_id").references(() => orders.id, { onDelete: 'cascade' }), // Migration 0014 - direct order reference
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  fileId: varchar("file_id").notNull().references(() => orderAttachments.id, { onDelete: 'cascade' }), // Link to order attachment
  role: fileRoleEnum("role").default('artwork'), // production_art, setup_reference, output
  attachedByUserId: varchar("attached_by_user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("job_files_organization_id_idx").on(table.organizationId, table.createdAt), // Migration 0014
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
  internalNotes: many(orderInternalNotes),
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
  designCostSummary: one(lineItemDesignCostSummaries, {
    fields: [orderLineItems.id],
    references: [lineItemDesignCostSummaries.lineItemId],
  }),
  notes: many(orderLineItemNotes),
  jobs: many(jobs),
}));

export const lineItemDesignCostSummariesRelations = relations(lineItemDesignCostSummaries, ({ one }) => ({
  order: one(orders, {
    fields: [lineItemDesignCostSummaries.orderId],
    references: [orders.id],
  }),
  lineItem: one(orderLineItems, {
    fields: [lineItemDesignCostSummaries.lineItemId],
    references: [orderLineItems.id],
  }),
}));

export const orderInternalNotesRelations = relations(orderInternalNotes, ({ one }) => ({
  order: one(orders, {
    fields: [orderInternalNotes.orderId],
    references: [orders.id],
  }),
  createdByUser: one(users, {
    fields: [orderInternalNotes.createdByUserId],
    references: [users.id],
  }),
}));

export const orderLineItemNotesRelations = relations(orderLineItemNotes, ({ one }) => ({
  order: one(orders, {
    fields: [orderLineItemNotes.orderId],
    references: [orders.id],
  }),
  lineItem: one(orderLineItems, {
    fields: [orderLineItemNotes.lineItemId],
    references: [orderLineItems.id],
  }),
  createdByUser: one(users, {
    fields: [orderLineItemNotes.createdByUserId],
    references: [users.id],
  }),
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
  orderLineItemId: varchar("order_line_item_id").references(() => orderLineItems.id, { onDelete: 'set null' }),
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
  index("order_audit_log_order_line_item_id_idx").on(table.orderLineItemId),
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
  category: varchar("category", { length: 100 }), // optional category for grouping
  // Retained temporarily as migration evidence only. New operational paths use the explicit fields below.
  unitOfMeasure: varchar("unit_of_measure", { length: 50 }),
  materialForm: varchar("material_form", { length: 50 }).$type<(typeof MATERIAL_FORMS)[number]>(),
  inventoryUnit: varchar("inventory_unit", { length: 50 }),
  // Compatibility-only persistence. Material APIs, forms, imports, and organization copy do not expose or write sell pricing.
  // PBV2 remains the owner of customer sell units and pricing until these columns can be retired in a future migration.
  sellPriceUnit: varchar("sell_price_unit", { length: 50 }),
  wholesalePriceUnit: varchar("wholesale_price_unit", { length: 50 }),
  // Compatibility-safe column name. Its business meaning is the vendor purchase unit.
  vendorCostUnit: varchar("vendor_cost_unit", { length: 50 }),
  consumptionUnit: varchar("consumption_unit", { length: 50 }),
  weightValue: decimal("weight_value", { precision: 12, scale: 6 }),
  weightUnit: varchar("weight_unit", { length: 20 }).$type<(typeof MATERIAL_WEIGHT_UNITS)[number]>(),
  weightBasis: varchar("weight_basis", { length: 30 }).$type<(typeof MATERIAL_WEIGHT_BASES)[number]>(),
  weightOzPerBasis: decimal("weight_oz_per_basis", { precision: 12, scale: 6 }),
  width: decimal("width", { precision: 10, scale: 2 }), // nullable for width dimension (sheet width or roll width)
  height: decimal("height", { precision: 10, scale: 2 }), // nullable for height dimension (sheet only)
  thickness: decimal("thickness", { precision: 10, scale: 4 }), // nullable for thickness
  thicknessUnit: varchar("thickness_unit", { length: 20 }), // in, mm, mil, gauge
  color: varchar("color", { length: 100 }), // nullable color specification
  costPerUnit: decimal("cost_per_unit", { precision: 10, scale: 4 }).notNull(),
  // Tiered pricing support
  wholesaleBaseRate: decimal("wholesale_base_rate", { precision: 10, scale: 4 }),
  wholesaleMinCharge: decimal("wholesale_min_charge", { precision: 10, scale: 2 }),
  retailBaseRate: decimal("retail_base_rate", { precision: 10, scale: 4 }),
  retailMinCharge: decimal("retail_min_charge", { precision: 10, scale: 2 }),
  stockQuantity: decimal("stock_quantity", { precision: 14, scale: 6 }).notNull().default("0"),
  minStockAlert: decimal("min_stock_alert", { precision: 10, scale: 2 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true), // whether material is active/available
  vendorId: varchar("vendor_id"), // legacy placeholder
  preferredVendorId: varchar("preferred_vendor_id").references(() => vendors.id, { onDelete: 'set null' }),
  preferredVendorName: varchar("preferred_vendor_name", { length: 255 }),
  vendorSku: varchar("vendor_sku", { length: 150 }),
  // Compatibility-safe column name. Its business meaning is the vendor purchase price.
  vendorCostPerUnit: decimal("vendor_cost_per_unit", { precision: 10, scale: 4 }),
  inventoryUnitsPerPurchaseUnit: decimal("inventory_units_per_purchase_unit", { precision: 14, scale: 6 }),
  minimumPurchaseQuantity: decimal("minimum_purchase_quantity", { precision: 14, scale: 6 }),
  vendorProductUrl: text("vendor_product_url"),
  vendorNotes: text("vendor_notes"),
  vendorLastPriceCents: integer("vendor_last_price_cents"),
  vendorLastPriceUpdatedAt: timestamp("vendor_last_price_updated_at"),
  specsJson: jsonb("specs_json").$type<Record<string, any>>(), // router/ink/material metadata
  // Roll-specific fields (only used when type === 'roll')
  rollLengthFt: decimal("roll_length_ft", { precision: 10, scale: 2 }), // total roll length in feet
  costPerRoll: decimal("cost_per_roll", { precision: 10, scale: 4 }), // vendor cost per roll
  edgeWasteInPerSide: decimal("edge_waste_in_per_side", { precision: 10, scale: 2 }), // edge waste per side in inches
  leadWasteFt: decimal("lead_waste_ft", { precision: 10, scale: 2 }).default("0"), // lead waste in feet
  tailWasteFt: decimal("tail_waste_ft", { precision: 10, scale: 2 }).default("0"), // tail waste in feet
  aiParsingDescription: text("ai_parsing_description"),
  aiParsingDescriptionLinkedToDescription: boolean("ai_parsing_description_linked_to_description").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("materials_organization_id_idx").on(table.organizationId),
  index("materials_type_idx").on(table.type),
  index("materials_sku_idx").on(table.sku),
  index("materials_stock_quantity_idx").on(table.stockQuantity),
  index("materials_preferred_vendor_id_idx").on(table.preferredVendorId),
]);

export const materialProductLinks = pgTable("material_product_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  materialId: varchar("material_id").notNull().references(() => materials.id, { onDelete: 'cascade' }),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  removedAt: timestamp("removed_at"),
}, (table) => [
  index("material_product_links_org_material_idx").on(table.organizationId, table.materialId),
  index("material_product_links_org_product_idx").on(table.organizationId, table.productId),
  uniqueIndex("material_product_links_org_material_product_uidx").on(table.organizationId, table.materialId, table.productId),
]);

const canonicalMaterialUnitInput = (value: unknown) => {
  if (value === "" || value === undefined || value === null) return value;
  return normalizeMaterialUnit(value) ?? value;
};
const materialUnitSchema = z.preprocess(canonicalMaterialUnitInput, z.enum(MATERIAL_INVENTORY_UNITS));
const materialFormSchema = z.enum(MATERIAL_FORMS);
const materialWeightUnitSchema = z.enum(MATERIAL_WEIGHT_UNITS);
const materialWeightBasisSchema = z.enum(MATERIAL_WEIGHT_BASES);
const optionalMaterialUnitSchema = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : canonicalMaterialUnitInput(v)),
  z.enum(MATERIAL_INVENTORY_UNITS).optional().nullable()
);
const optionalMaterialPurchaseUnitSchema = z.preprocess(
  (v) => {
    if (v === "" || v === undefined) return undefined;
    if (v === null) return null;
    return normalizeMaterialPurchaseUnit(v) ?? v;
  },
  z.enum(MATERIAL_PURCHASE_UNITS).optional().nullable()
);
const optionalMaterialWeightUnitSchema = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  materialWeightUnitSchema.optional().nullable()
);
const optionalMaterialWeightBasisSchema = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  materialWeightBasisSchema.optional().nullable()
);
const optionalTrimmedMaterialTextSchema = (maxLength?: number) =>
  z.preprocess(
    (v) => {
      if (typeof v !== "string") return v == null ? undefined : v;
      const trimmed = v.trim();
      return trimmed ? trimmed : null;
    },
    (maxLength ? z.string().max(maxLength) : z.string()).optional().nullable()
  );
const optionalMaterialVendorUrlSchema = z.any().transform((value, ctx) => {
  if (value === undefined) return undefined;
  const result = normalizeMaterialVendorProductUrl(value);
  if (!result.ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.message,
    });
    return z.NEVER;
  }
  return result.value;
});
const optionalMaterialDateSchema = z.any().transform((value, ctx) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enter a valid date.",
    });
    return z.NEVER;
  }
  return date;
});

const materialBaseSchema = createInsertSchema(materials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
}).extend({
  // `type` is retained for older records and integrations. `materialForm` is the explicit physical form.
  type: z.enum(["sheet", "roll", "ink", "consumable", "liquid", "each", "bulk_weight"]).optional(),
  unitOfMeasure: z.never().optional(),
  materialForm: materialFormSchema,
  inventoryUnit: materialUnitSchema,
  sellPriceUnit: z.never().optional(),
  wholesalePriceUnit: z.never().optional(),
  vendorCostUnit: optionalMaterialPurchaseUnitSchema,
  consumptionUnit: materialUnitSchema,
  weightValue: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    z.coerce.number().positive().optional().nullable()
  ),
  weightUnit: optionalMaterialWeightUnitSchema,
  weightBasis: optionalMaterialWeightBasisSchema,
  weightOzPerBasis: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    z.coerce.number().positive().optional().nullable()
  ),
  thicknessUnit: z.enum(["in", "mm", "mil", "gauge"]).optional().nullable(),
  costPerUnit: z.coerce.number().nonnegative(),
  // Numeric/decimal fields: accept strings from forms, treat "" and NaN as undefined.
  width: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    z.coerce.number().nonnegative().optional().nullable()
  ),
  height: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    z.coerce.number().nonnegative().optional().nullable()
  ),
  thickness: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    z.coerce.number().nonnegative().optional().nullable()
  ),
  preferredVendorName: optionalTrimmedMaterialTextSchema(255),
  vendorSku: optionalTrimmedMaterialTextSchema(150),
  vendorProductUrl: optionalMaterialVendorUrlSchema,
  vendorNotes: optionalTrimmedMaterialTextSchema(),
  vendorLastPriceCents: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? null : v),
    z.coerce.number().int().nonnegative().optional().nullable()
  ),
  vendorLastPriceUpdatedAt: optionalMaterialDateSchema,
  vendorCostPerUnit: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    z.coerce.number().nonnegative().optional().nullable()
  ),
  inventoryUnitsPerPurchaseUnit: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    z.coerce.number().positive().optional().nullable()
  ),
  minimumPurchaseQuantity: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    z.coerce.number().positive().optional().nullable()
  ),
  wholesaleBaseRate: z.never().optional(),
  wholesaleMinCharge: z.never().optional(),
  retailBaseRate: z.never().optional(),
  retailMinCharge: z.never().optional(),
  stockQuantity: z.coerce.number().nonnegative().default(0),
  minStockAlert: z.coerce.number().nonnegative().default(0),
  // Roll-specific fields
  rollLengthFt: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    z.coerce.number().positive().optional().nullable()
  ),
  costPerRoll: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    z.coerce.number().positive().optional().nullable()
  ),
  edgeWasteInPerSide: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    z.coerce.number().nonnegative().optional().nullable()
  ),
  leadWasteFt: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    z.coerce.number().nonnegative().default(0).optional().nullable()
  ),
  tailWasteFt: z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    z.coerce.number().nonnegative().default(0).optional().nullable()
  ),
  aiParsingDescription: optionalAiParsingDescriptionSchema,
  aiParsingDescriptionLinkedToDescription: z.boolean().default(false),
  linkedProductIds: z.array(z.string().trim().min(1)).optional(),
});

export const insertMaterialSchema = materialBaseSchema.superRefine((data, ctx) => {
  if (data.materialForm === "liquid" && (data.inventoryUnit !== "milliliter" || data.consumptionUnit !== "milliliter")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inventoryUnit"], message: "Liquid materials must use milliliters for inventory and consumption in this phase." });
  }
  if (data.materialForm === "each" && (data.inventoryUnit !== "each" || data.consumptionUnit !== "each")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inventoryUnit"], message: "Each materials must use each for inventory and consumption." });
  }
  if (data.materialForm === "bulk_weight" && (data.inventoryUnit !== "pound" || data.consumptionUnit !== "pound")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inventoryUnit"], message: "Bulk weight materials must use pounds for inventory and consumption in this phase." });
  }
  if (data.materialForm === "sheet" && !((data.inventoryUnit === "sheet" || data.inventoryUnit === "square_foot") && (data.consumptionUnit === "sheet" || data.consumptionUnit === "square_foot"))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inventoryUnit"], message: "Sheet materials must use sheet or square feet with configured dimensions." });
  }
  if (data.materialForm !== "roll") return;

  if (data.inventoryUnit !== "square_foot" && data.inventoryUnit !== "linear_foot") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inventoryUnit"], message: "Roll inventory must use square feet or linear feet." });
  }
  if (data.consumptionUnit !== "square_foot" && data.consumptionUnit !== "linear_foot") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["consumptionUnit"], message: "Roll consumption must use square feet or linear feet." });
  }

  const width = (data as any).width;
  const rollLengthFt = (data as any).rollLengthFt;
  const costPerRoll = (data as any).costPerRoll;

  const isPos = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;

  if (!isPos(width)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["width"],
      message: "Roll width is required",
    });
  }
  if (!isPos(rollLengthFt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rollLengthFt"],
      message: "Roll length is required",
    });
  }
  if (!isPos(costPerRoll)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["costPerRoll"],
      message: "Vendor roll cost is required",
    });
  }
  const capacity = calculateUsableRollCapacity({
    width,
    rollLengthFt,
    edgeWasteInPerSide: (data as any).edgeWasteInPerSide,
    leadWasteFt: (data as any).leadWasteFt,
    tailWasteFt: (data as any).tailWasteFt,
  });
  if (!capacity.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["width"], message: capacity.message });
  }
});

export const updateMaterialSchema = materialBaseSchema.partial();

export type InsertMaterial = z.infer<typeof insertMaterialSchema>;
export type UpdateMaterial = z.infer<typeof updateMaterialSchema>;
export type Material = typeof materials.$inferSelect;
export type MaterialProductLink = typeof materialProductLinks.$inferSelect;

// ============================================================
// ROLL MATERIAL DERIVED VALUES HELPER
// ============================================================

/**
 * Calculate derived values for roll materials (gross sqft, usable sqft, cost per sqft)
 * These are computed from the stored fields, not persisted in the database.
 */
export interface RollDerivedValues {
  grossSqftPerRoll: number;
  usableWidthIn: number;
  usableLengthFt: number;
  usableSqftPerRoll: number;
  costPerSqft: number;
}

export function calculateRollDerivedValues(
  rollWidthIn: number,
  rollLengthFt: number,
  costPerRoll: number,
  edgeWasteInPerSide: number = 0,
  leadWasteFt: number = 0,
  tailWasteFt: number = 0
): RollDerivedValues {
  const grossSqftPerRoll = (rollWidthIn / 12) * rollLengthFt;
  const usableWidthIn = Math.max(0, rollWidthIn - 2 * edgeWasteInPerSide);
  const usableLengthFt = Math.max(0, rollLengthFt - leadWasteFt - tailWasteFt);
  const usableSqftPerRoll = (usableWidthIn / 12) * usableLengthFt;
  const costPerSqft = usableSqftPerRoll > 0 ? costPerRoll / usableSqftPerRoll : 0;

  return {
    grossSqftPerRoll: parseFloat(grossSqftPerRoll.toFixed(2)),
    usableWidthIn: parseFloat(usableWidthIn.toFixed(2)),
    usableLengthFt: parseFloat(usableLengthFt.toFixed(2)),
    usableSqftPerRoll: parseFloat(usableSqftPerRoll.toFixed(2)),
    costPerSqft: parseFloat(costPerSqft.toFixed(4)),
  };
}

// Inventory Adjustments table - logs all inventory changes
export const materialReorderRequests = pgTable("material_reorder_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  materialId: varchar("material_id").notNull().references(() => materials.id, { onDelete: 'cascade' }),
  vendorId: varchar("vendor_id").references(() => vendors.id, { onDelete: 'set null' }),
  status: varchar("status", { length: 20 }).notNull().default("requested"),
  requestedQuantity: decimal("requested_quantity", { precision: 10, scale: 2 }).notNull(),
  receivedQuantity: decimal("received_quantity", { precision: 10, scale: 2 }),
  currentStockQuantity: decimal("current_stock_quantity", { precision: 10, scale: 2 }),
  minStockAlert: decimal("min_stock_alert", { precision: 10, scale: 2 }),
  notes: text("notes"),
  requestedByUserId: varchar("requested_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  orderedByUserId: varchar("ordered_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  orderedAt: timestamp("ordered_at", { withTimezone: true }),
  receivedByUserId: varchar("received_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  cancelledByUserId: varchar("cancelled_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("material_reorder_requests_org_idx").on(table.organizationId),
  index("material_reorder_requests_material_idx").on(table.materialId),
  index("material_reorder_requests_status_idx").on(table.status),
  index("material_reorder_requests_vendor_idx").on(table.vendorId),
  index("material_reorder_requests_requested_at_idx").on(table.requestedAt),
]);

export const insertMaterialReorderRequestSchema = createInsertSchema(materialReorderRequests).omit({
  id: true,
  organizationId: true,
  status: true,
  requestedByUserId: true,
  requestedAt: true,
  orderedByUserId: true,
  orderedAt: true,
  receivedByUserId: true,
  receivedAt: true,
  cancelledByUserId: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  receivedQuantity: true,
}).extend({
  requestedQuantity: z.coerce.number().positive(),
  currentStockQuantity: z.coerce.number().optional().nullable(),
  minStockAlert: z.coerce.number().optional().nullable(),
  vendorId: z.string().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export const updateMaterialReorderRequestSchema = createInsertSchema(materialReorderRequests).omit({
  id: true,
  organizationId: true,
  materialId: true,
  requestedByUserId: true,
  requestedAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(materialReorderRequestStatusValues),
  requestedQuantity: z.coerce.number().positive().optional(),
  receivedQuantity: z.coerce.number().positive().optional().nullable(),
  currentStockQuantity: z.coerce.number().optional().nullable(),
  minStockAlert: z.coerce.number().optional().nullable(),
  vendorId: z.string().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
}).partial();

export type InsertMaterialReorderRequest = z.infer<typeof insertMaterialReorderRequestSchema>;
export type UpdateMaterialReorderRequest = z.infer<typeof updateMaterialReorderRequestSchema>;
export type MaterialReorderRequest = typeof materialReorderRequests.$inferSelect;

export const inventoryAdjustments = pgTable("inventory_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: 'cascade' }),
  materialId: varchar("material_id").notNull().references(() => materials.id, { onDelete: 'cascade' }),
  movementType: varchar("movement_type", { length: 20 }).notNull().default("adjustment"),
  type: varchar("type", { length: 50 }).notNull(), // manual_increase, manual_decrease, waste, shrinkage, job_usage
  quantityChange: decimal("quantity_change", { precision: 14, scale: 6 }).notNull(), // positive or negative
  quantityBefore: decimal("quantity_before", { precision: 14, scale: 6 }),
  quantityAfter: decimal("quantity_after", { precision: 14, scale: 6 }),
  reason: text("reason"),
  notes: text("notes"),
  orderId: varchar("order_id").references(() => orders.id, { onDelete: 'set null' }), // nullable, for job usage tracking
  reorderRequestId: varchar("reorder_request_id").references(() => materialReorderRequests.id, { onDelete: 'set null' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("inventory_adjustments_organization_id_idx").on(table.organizationId),
  index("inventory_adjustments_material_id_idx").on(table.materialId),
  index("inventory_adjustments_movement_type_idx").on(table.movementType),
  index("inventory_adjustments_type_idx").on(table.type),
  index("inventory_adjustments_order_id_idx").on(table.orderId),
  index("inventory_adjustments_reorder_request_id_idx").on(table.reorderRequestId),
  index("inventory_adjustments_created_at_idx").on(table.createdAt),
]);

export const insertInventoryAdjustmentSchema = createInsertSchema(inventoryAdjustments).omit({
  id: true,
  createdAt: true,
}).extend({
  movementType: z.enum(inventoryMovementTypeValues).default("adjustment"),
  type: z.enum(["manual_increase", "manual_decrease", "waste", "shrinkage", "job_usage", "purchase_receipt"]),
  quantityChange: z.coerce.number(),
  quantityBefore: z.coerce.number().optional().nullable(),
  quantityAfter: z.coerce.number().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  reorderRequestId: z.string().optional().nullable(),
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
  salesRepName: varchar('sales_rep_name', { length: 255 }),
  salesRepEmail: varchar('sales_rep_email', { length: 255 }),
  salesRepPhone: varchar('sales_rep_phone', { length: 50 }),
  website: varchar('website', { length: 255 }),
  notes: text('notes'),
  additionalContactInfo: text('additional_contact_info'),
  paymentTerms: varchar('payment_terms', { length: 50 }).notNull().default('due_on_receipt'),
  defaultLeadTimeDays: integer('default_lead_time_days'),
  leadTimeText: varchar('lead_time_text', { length: 120 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('vendors_organization_id_idx').on(table.organizationId),
  index('vendors_name_idx').on(table.name),
  index('vendors_is_active_idx').on(table.isActive)
]);

const normalizeOptionalVendorString = (value: unknown) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

export const insertVendorSchema = createInsertSchema(vendors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
}).extend({
  email: z.preprocess(normalizeOptionalVendorString, z.string().email().optional()),
  phone: z.preprocess(normalizeOptionalVendorString, z.string().max(50).optional()),
  website: z.preprocess(
    (value) => {
      const normalized = normalizeOptionalWebsite(value);
      return normalized ?? normalizeOptionalVendorString(value);
    },
    z.string().max(255).url('Website must be a valid domain or URL').optional(),
  ),
  notes: z.preprocess(normalizeOptionalVendorString, z.string().optional()),
  paymentTerms: z.enum(['due_on_receipt','net_15','net_30','net_45','custom']).default('due_on_receipt'),
  defaultLeadTimeDays: z.number().int().positive().optional(),
  leadTimeText: z.preprocess(normalizeOptionalVendorString, z.string().max(120).optional()),
  salesRepName: z.preprocess(normalizeOptionalVendorString, z.string().max(255).optional()),
  salesRepEmail: z.preprocess(normalizeOptionalVendorString, z.string().email().optional()),
  salesRepPhone: z.preprocess(normalizeOptionalVendorString, z.string().max(50).optional()),
  additionalContactInfo: z.preprocess(normalizeOptionalVendorString, z.string().optional()),
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
  relatedOrderId: varchar('related_order_id').references(() => orders.id, { onDelete: 'set null' }),
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
  index('purchase_orders_related_order_id_idx').on(table.relatedOrderId),
  index('purchase_orders_status_idx').on(table.status),
  index('purchase_orders_issue_date_idx').on(table.issueDate),
  uniqueIndex('purchase_orders_org_po_number_unique').on(table.organizationId, table.poNumber),
]);

export const purchaseOrderLineItems = pgTable('purchase_order_line_items', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  purchaseOrderId: varchar('purchase_order_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  materialId: varchar('material_id').references(() => materials.id, { onDelete: 'set null' }),
  description: varchar('description', { length: 255 }).notNull(),
  vendorSku: varchar('vendor_sku', { length: 150 }),
  quantityOrdered: decimal('quantity_ordered', { precision: 10, scale: 2 }).notNull(),
  quantityReceived: decimal('quantity_received', { precision: 10, scale: 2 }).notNull().default('0'),
  // Snapshot of the Material purchase conversion at PO creation. Receipts use
  // this instead of mutable Material configuration.
  inventoryUnitsPerPurchaseUnit: decimal('inventory_units_per_purchase_unit', { precision: 14, scale: 6 }).notNull().default('1'),
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
  inventoryUnitsPerPurchaseUnit: z.coerce.number().positive().default(1),
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
  organizationId: true,
}).extend({
  issueDate: z.string().or(z.coerce.date()),
  expectedDate: z.string().optional().or(z.coerce.date().optional()),
  lineItems: z.array(insertPurchaseOrderLineItemSchema).min(1),
});
export const updatePurchaseOrderSchema = insertPurchaseOrderSchema.partial().extend({
  status: z.enum(['draft','sent','issued','partially_received','received','cancelled','closed']).optional(),
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
  quantityUsed: decimal("quantity_used", { precision: 14, scale: 6 }).notNull(),
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

// ============================================================
// INVENTORY RESERVATIONS (Order intent; no purchasing yet)
// ============================================================

export const inventoryReservations = pgTable("inventory_reservations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),

  orderLineItemId: varchar("order_line_item_id").references(() => orderLineItems.id, { onDelete: 'set null' }),

  sourceType: text("source_type").notNull(), // PBV2_MATERIAL | PBV2_COMPONENT | MANUAL
  sourceKey: text("source_key").notNull(), // skuRef or productId
  uom: text("uom").notNull(),
  qty: decimal("qty", { precision: 14, scale: 6 }).notNull(),

  status: text("status").notNull().default('RESERVED'), // RESERVED | RELEASED

  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("inventory_reservations_org_id_idx").on(table.organizationId),
  index("inventory_reservations_order_id_idx").on(table.orderId),
  index("inventory_reservations_org_order_source_status_idx").on(
    table.organizationId,
    table.orderId,
    table.sourceKey,
    table.uom,
    table.status,
  ),
]);

export const insertInventoryReservationSchema = createInsertSchema(inventoryReservations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(["RESERVED", "RELEASED"]).default("RESERVED"),
  sourceType: z.enum(["PBV2_MATERIAL", "PBV2_COMPONENT", "MANUAL"]),
  sourceKey: z.string().min(1),
  uom: z.string().min(1),
  qty: z.coerce.number().positive(),
});

export type InsertInventoryReservation = z.infer<typeof insertInventoryReservationSchema>;
export type InventoryReservation = typeof inventoryReservations.$inferSelect;

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
  emailLogs: many(invoiceEmailLogs),
  reminderLogs: many(invoiceReminderLogs),
  lineItems: many(invoiceLineItems),
  payments: many(payments),
}));

export const invoiceEmailLogsRelations = relations(invoiceEmailLogs, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceEmailLogs.invoiceId],
    references: [invoices.id],
  }),
}));

export const invoiceReminderLogsRelations = relations(invoiceReminderLogs, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceReminderLogs.invoiceId],
    references: [invoices.id],
  }),
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

export const shipmentsRelations = relations(shipments, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [shipments.organizationId],
    references: [organizations.id],
  }),
  order: one(orders, {
    fields: [shipments.orderId],
    references: [orders.id],
  }),
  primaryOrder: one(orders, {
    fields: [shipments.primaryOrderId],
    references: [orders.id],
  }),
  createdByUser: one(users, {
    fields: [shipments.createdByUserId],
    references: [users.id],
  }),
  shipmentOrders: many(shipmentOrders),
  shipmentItems: many(shipmentItems),
}));

export const shipmentOrdersRelations = relations(shipmentOrders, ({ one }) => ({
  organization: one(organizations, {
    fields: [shipmentOrders.organizationId],
    references: [organizations.id],
  }),
  shipment: one(shipments, {
    fields: [shipmentOrders.shipmentId],
    references: [shipments.id],
  }),
  order: one(orders, {
    fields: [shipmentOrders.orderId],
    references: [orders.id],
  }),
}));

export const shipmentItemsRelations = relations(shipmentItems, ({ one }) => ({
  organization: one(organizations, {
    fields: [shipmentItems.organizationId],
    references: [organizations.id],
  }),
  shipment: one(shipments, {
    fields: [shipmentItems.shipmentId],
    references: [shipments.id],
  }),
  order: one(orders, {
    fields: [shipmentItems.orderId],
    references: [orders.id],
  }),
  orderLineItem: one(orderLineItems, {
    fields: [shipmentItems.orderLineItemId],
    references: [orderLineItems.id],
  }),
}));

export const pickupTicketsRelations = relations(pickupTickets, ({ one }) => ({
  organization: one(organizations, {
    fields: [pickupTickets.organizationId],
    references: [organizations.id],
  }),
  order: one(orders, {
    fields: [pickupTickets.orderId],
    references: [orders.id],
  }),
  createdByUser: one(users, {
    fields: [pickupTickets.createdByUserId],
    references: [users.id],
  }),
}));

export const outboundNotificationsRelations = relations(outboundNotifications, ({ one }) => ({
  organization: one(organizations, {
    fields: [outboundNotifications.organizationId],
    references: [organizations.id],
  }),
}));

export const fulfillmentEventsRelations = relations(fulfillmentEvents, ({ one }) => ({
  organization: one(organizations, {
    fields: [fulfillmentEvents.organizationId],
    references: [organizations.id],
  }),
  actorUser: one(users, {
    fields: [fulfillmentEvents.actorUserId],
    references: [users.id],
  }),
}));

// Inventory management relations
export const materialsRelations = relations(materials, ({ many }) => ({
  adjustments: many(inventoryAdjustments),
  orderUsages: many(orderMaterialUsage),
  reorderRequests: many(materialReorderRequests),
  productLinks: many(materialProductLinks),
}));

export const materialProductLinksRelations = relations(materialProductLinks, ({ one }) => ({
  organization: one(organizations, {
    fields: [materialProductLinks.organizationId],
    references: [organizations.id],
  }),
  material: one(materials, {
    fields: [materialProductLinks.materialId],
    references: [materials.id],
  }),
  product: one(products, {
    fields: [materialProductLinks.productId],
    references: [products.id],
  }),
}));

export const inventoryAdjustmentsRelations = relations(inventoryAdjustments, ({ one }) => ({
  organization: one(organizations, {
    fields: [inventoryAdjustments.organizationId],
    references: [organizations.id],
  }),
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
  reorderRequest: one(materialReorderRequests, {
    fields: [inventoryAdjustments.reorderRequestId],
    references: [materialReorderRequests.id],
  }),
}));

export const materialReorderRequestsRelations = relations(materialReorderRequests, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [materialReorderRequests.organizationId],
    references: [organizations.id],
  }),
  material: one(materials, {
    fields: [materialReorderRequests.materialId],
    references: [materials.id],
  }),
  vendor: one(vendors, {
    fields: [materialReorderRequests.vendorId],
    references: [vendors.id],
  }),
  requestedByUser: one(users, {
    fields: [materialReorderRequests.requestedByUserId],
    references: [users.id],
  }),
  orderedByUser: one(users, {
    fields: [materialReorderRequests.orderedByUserId],
    references: [users.id],
  }),
  receivedByUser: one(users, {
    fields: [materialReorderRequests.receivedByUserId],
    references: [users.id],
  }),
  cancelledByUser: one(users, {
    fields: [materialReorderRequests.cancelledByUserId],
    references: [users.id],
  }),
  adjustments: many(inventoryAdjustments),
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

// ==================== Generic Integration Connections ====================
// Non-secret per-organization integration identifiers (e.g., Stripe Connect account ids).
// NOTE: Do NOT store tenant secret keys here.

export const integrationConnections = pgTable('integration_connections', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 32 }).notNull(), // e.g. 'stripe'
  externalAccountId: varchar('external_account_id', { length: 128 }), // e.g. stripeAccountId (acct_...)
  status: varchar('status', { length: 20 }).notNull().default('disconnected'), // connected | disconnected | error
  mode: varchar('mode', { length: 10 }).notNull().default('test'), // test | live
  lastError: text('last_error'),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('integration_connections_org_provider_uidx').on(table.organizationId, table.provider),
  index('integration_connections_provider_external_account_id_idx').on(table.provider, table.externalAccountId),
]);

export type IntegrationConnection = typeof integrationConnections.$inferSelect;
export type InsertIntegrationConnection = typeof integrationConnections.$inferInsert;

// Quote List Notes (list-only annotations, always editable regardless of quote lock)
export const quoteListNotes = pgTable('quote_list_notes', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  quoteId: varchar('quote_id').notNull().references(() => quotes.id, { onDelete: 'cascade' }),
  listLabel: text('list_label'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: varchar('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
}, (table) => [
  index('quote_list_notes_org_idx').on(table.organizationId),
  index('quote_list_notes_quote_idx').on(table.quoteId),
  uniqueIndex('quote_list_notes_unique').on(table.organizationId, table.quoteId),
]);

// List Settings (column visibility, order, custom labels, date format per user/org)
export const listSettings = pgTable('list_settings', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: varchar('user_id').references(() => users.id, { onDelete: 'cascade' }),
  listKey: varchar('list_key').notNull(), // e.g. 'internalQuotesList'
  settingsJson: jsonb('settings_json').$type<{
    columnLabels?: Record<string, string>;
    columnOrder?: string[];
    columnVisible?: Record<string, boolean>;
    dateFormat?: string; // 'MM/DD/YY', 'DD/MM/YY', 'MMM D, YYYY', etc.
  }>().notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('list_settings_org_user_idx').on(table.organizationId, table.userId),
  index('list_settings_list_key_idx').on(table.listKey),
  uniqueIndex('list_settings_unique').on(table.organizationId, table.userId, table.listKey),
]);

export type QuoteListNote = typeof quoteListNotes.$inferSelect;
export type InsertQuoteListNote = typeof quoteListNotes.$inferInsert;
export type ListSettings = typeof listSettings.$inferSelect;
export type InsertListSettings = typeof listSettings.$inferInsert;

// Order List Notes (list-only annotations for Orders list, always editable)
export const orderListNotes = pgTable('order_list_notes', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  listLabel: text('list_label'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: varchar('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
}, (table) => [
  index('order_list_notes_org_idx').on(table.organizationId),
  index('order_list_notes_order_idx').on(table.orderId),
  uniqueIndex('order_list_notes_unique').on(table.organizationId, table.orderId),
]);

export type OrderListNote = typeof orderListNotes.$inferSelect;
export type InsertOrderListNote = typeof orderListNotes.$inferInsert;
// ============================================================
// CANONICAL ASSET PIPELINE (Migration 0013)
// Unified file management for quotes, orders, invoices, and future modules
// ============================================================

// Asset status enum
export const assetStatusEnum = pgEnum('asset_status', ['uploaded', 'analyzed', 'prepress_ready', 'prepress_failed']);

// Asset preview status enum
export const assetPreviewStatusEnum = pgEnum('asset_preview_status', ['pending', 'ready', 'failed']);

// Asset variant kind enum
export const assetVariantKindEnum = pgEnum('asset_variant_kind', ['thumb', 'preview', 'prepress_normalized', 'prepress_report']);

// Asset variant status enum
export const assetVariantStatusEnum = pgEnum('asset_variant_status', ['pending', 'ready', 'failed']);

// Asset link parent type enum
export const assetLinkParentTypeEnum = pgEnum('asset_link_parent_type', ['quote_line_item', 'order', 'order_line_item', 'invoice', 'note']);

// Asset link role enum
export const assetLinkRoleEnum = pgEnum('asset_link_role', ['primary', 'attachment', 'proof', 'reference', 'other']);

// Assets table: Canonical file records
export const assets = pgTable('assets', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  fileRecordId: varchar('file_record_id').references((): AnyPgColumn => fileRecords.id, { onDelete: 'set null' }),
  fileKey: text('file_key'), // legacy original locator; canonical source of truth is fileRecordId
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  sha256: text('sha256'), // Optional: for future deduplication
  status: assetStatusEnum('status').notNull().default('uploaded'),
  previewKey: text('preview_key'), // thumbs/org_<orgId>/asset/<assetId>/preview.jpg
  thumbKey: text('thumb_key'), // thumbs/org_<orgId>/asset/<assetId>/thumb.jpg
  previewStatus: assetPreviewStatusEnum('preview_status').notNull().default('pending'),
  previewError: text('preview_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('assets_org_id_idx').on(table.organizationId),
  index('assets_org_asset_idx').on(table.organizationId, table.id),
  index('assets_file_record_id_idx').on(table.fileRecordId),
  index('assets_file_key_idx').on(table.fileKey),
  index('assets_preview_status_idx').on(table.organizationId, table.previewStatus),
]);

// Asset variants table: Derived files
export const assetVariants = pgTable('asset_variants', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  assetId: varchar('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  kind: assetVariantKindEnum('kind').notNull(),
  key: text('key').notNull(), // Storage key for this variant
  status: assetVariantStatusEnum('status').notNull().default('pending'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('asset_variants_org_id_idx').on(table.organizationId),
  index('asset_variants_asset_id_idx').on(table.assetId),
  index('asset_variants_org_asset_idx').on(table.organizationId, table.assetId),
  index('asset_variants_status_idx').on(table.organizationId, table.status),
  uniqueIndex('asset_variants_unique').on(table.assetId, table.kind),
]);

// Asset links table: Connects assets to consumers
export const assetLinks = pgTable('asset_links', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  assetId: varchar('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  parentType: assetLinkParentTypeEnum('parent_type').notNull(),
  parentId: varchar('parent_id').notNull(),
  role: assetLinkRoleEnum('role').notNull().default('other'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('asset_links_org_id_idx').on(table.organizationId),
  index('asset_links_asset_id_idx').on(table.assetId),
  index('asset_links_parent_idx').on(table.organizationId, table.parentType, table.parentId),
  index('asset_links_org_parent_role_idx').on(table.organizationId, table.parentType, table.parentId, table.role),
]);

// Zod schemas for assets
export const insertAssetSchema = createInsertSchema(assets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateAssetSchema = insertAssetSchema.partial();

export type Asset = typeof assets.$inferSelect;
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type UpdateAsset = z.infer<typeof updateAssetSchema>;

// Zod schemas for asset variants
export const insertAssetVariantSchema = createInsertSchema(assetVariants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateAssetVariantSchema = insertAssetVariantSchema.partial();

export type AssetVariant = typeof assetVariants.$inferSelect;
export type InsertAssetVariant = z.infer<typeof insertAssetVariantSchema>;
export type UpdateAssetVariant = z.infer<typeof updateAssetVariantSchema>;

// Zod schemas for asset links
export const insertAssetLinkSchema = createInsertSchema(assetLinks).omit({
  id: true,
  createdAt: true,
});

export type AssetLink = typeof assetLinks.$inferSelect;
export type InsertAssetLink = z.infer<typeof insertAssetLinkSchema>;

// Relations for assets
export const assetsRelations = relations(assets, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [assets.organizationId],
    references: [organizations.id],
  }),
  variants: many(assetVariants),
  links: many(assetLinks),
}));

export const assetVariantsRelations = relations(assetVariants, ({ one }) => ({
  asset: one(assets, {
    fields: [assetVariants.assetId],
    references: [assets.id],
  }),
  organization: one(organizations, {
    fields: [assetVariants.organizationId],
    references: [organizations.id],
  }),
}));

export const assetLinksRelations = relations(assetLinks, ({ one }) => ({
  asset: one(assets, {
    fields: [assetLinks.assetId],
    references: [assets.id],
  }),
  organization: one(organizations, {
    fields: [assetLinks.organizationId],
    references: [organizations.id],
  }),
}));

// ============================================================
// BUG REPORTS — org-scoped user-submitted bug reports
// ============================================================
export type BugReportScreenshotAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  storagePath: string;
  displayOrder: number;
};

export const bugReports = pgTable("bug_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  referenceNumber: text("reference_number").notNull().default(sql`NULL`),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  createdByEmail: text("created_by_email").notNull(),
  type: text("type").notNull().default('bug'), // 'bug' | 'feature'
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: text("severity").notNull(), // 'low' | 'medium' | 'high' | 'critical'
  url: text("url").notNull(),
  userAgent: text("user_agent").notNull(),
  screenWidth: integer("screen_width"),
  screenHeight: integer("screen_height"),
  screenshotUrl: text("screenshot_url"), // DEPRECATED: use screenshotUrls instead
  screenshotUrls: text("screenshot_urls").array().notNull().default(sql`'{}'::text[]`),
  screenshotAttachments: jsonb("screenshot_attachments").$type<BugReportScreenshotAttachment[]>().notNull().default(sql`'[]'::jsonb`),
  status: text("status").notNull().default('open'), // 'open' | 'in_review' | 'resolved' | 'closed'
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("bug_reports_reference_number_uidx").on(table.referenceNumber),
  index("bug_reports_reference_number_idx").on(table.referenceNumber),
  index("bug_reports_org_created_at_idx").on(table.orgId, table.createdAt),
  index("bug_reports_org_severity_idx").on(table.orgId, table.severity),
  index("bug_reports_org_status_idx").on(table.orgId, table.status),
]);

export type BugReport = typeof bugReports.$inferSelect;
export type InsertBugReport = typeof bugReports.$inferInsert;

// ============================================================
// PRODUCT PLANNING - dev/admin-only planning backlog
// ============================================================
export const productPlanningWorkItemTypeValues = [
  "bug",
  "feature",
  "enhancement",
  "epic",
  "task",
  "technical_debt",
  "research",
] as const;

export const productPlanningStatusValues = [
  "idea",
  "backlog",
  "planned",
  "ready",
  "in_progress",
  "testing",
  "dev_validation",
  "main_validation",
  "released",
  "archived",
] as const;

export const productPlanningPriorityValues = ["critical", "high", "medium", "low"] as const;
export const productPlanningBusinessValueValues = ["very_high", "high", "medium", "low"] as const;
export const productPlanningComplexityValues = ["small", "medium", "large", "massive"] as const;
export const productPlanningPhaseValues = ["go_live", "v1_1", "v1_5", "v2_0", "future", "research"] as const;
export const productPlanningSourceTypeValues = ["manual", "csv_import", "bug_report"] as const;
export const productPlanningImportStatusValues = ["pending", "completed", "completed_with_errors", "failed"] as const;
export const productPlanningDependencyTypeValues = ["blocks", "requires", "relates_to"] as const;
export const productPlanningReleaseStatusValues = ["planned", "in_progress", "released", "archived"] as const;
export const productPlanningAiSuggestionTypeValues = [
  "priority",
  "business_value",
  "complexity",
  "phase",
  "module",
  "work_item_type",
  "parent_epic",
  "duplicate_candidate",
  "release_recommendation",
  "implementation_notes",
] as const;
export const productPlanningAiSuggestionStatusValues = ["pending", "accepted", "rejected"] as const;
export const productPlanningAiAnalysisTypeValues = [
  "backlog_analysis",
  "roadmap_analysis",
  "epic_suggestions",
  "go_live_readiness",
] as const;
export const productPlanningAiAnalysisSourceValues = ["live_ai", "rule_based_fallback"] as const;

export const productPlanningReleases = pgTable("product_planning_releases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  targetDate: date("target_date"),
  status: text("status").$type<typeof productPlanningReleaseStatusValues[number]>().notNull().default("planned"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("product_planning_releases_org_name_uidx")
    .on(table.organizationId, sql`lower(${table.name})`)
    .where(sql`${table.archivedAt} IS NULL`),
  index("product_planning_releases_org_status_idx").on(table.organizationId, table.status),
  index("product_planning_releases_org_target_date_idx").on(table.organizationId, table.targetDate),
]);

export const productPlanningWorkItems = pgTable("product_planning_work_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  reference: text("reference").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  workItemType: text("work_item_type").$type<typeof productPlanningWorkItemTypeValues[number]>().notNull().default("feature"),
  planningStatus: text("planning_status").$type<typeof productPlanningStatusValues[number]>().notNull().default("backlog"),
  priority: text("priority").$type<typeof productPlanningPriorityValues[number]>().notNull().default("medium"),
  businessValue: text("business_value").$type<typeof productPlanningBusinessValueValues[number]>(),
  complexity: text("complexity").$type<typeof productPlanningComplexityValues[number]>(),
  phase: text("phase").$type<typeof productPlanningPhaseValues[number]>(),
  module: text("module"),
  submodule: text("submodule"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  sortOrder: integer("sort_order"),
  roadmapOrder: integer("roadmap_order"),
  parentId: varchar("parent_id").references((): AnyPgColumn => productPlanningWorkItems.id, { onDelete: "set null" }),
  sourceType: text("source_type").$type<typeof productPlanningSourceTypeValues[number]>(),
  sourceBugReportId: varchar("source_bug_report_id").references(() => bugReports.id, { onDelete: "restrict" }),
  sourceReference: text("source_reference"),
  importedBatchId: varchar("imported_batch_id").references((): AnyPgColumn => productPlanningImportBatches.id, { onDelete: "set null" }),
  requestedBy: text("requested_by"),
  ownerUserId: varchar("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  dueDate: date("due_date"),
  releaseTarget: text("release_target"),
  releaseId: varchar("release_id").references(() => productPlanningReleases.id, { onDelete: "set null" }),
  userImpact: integer("user_impact"),
  revenueImpact: integer("revenue_impact"),
  operationalImpact: integer("operational_impact"),
  riskReduction: integer("risk_reduction"),
  confidence: integer("confidence"),
  priorityScore: integer("priority_score"),
  priorityScoreExplanation: jsonb("priority_score_explanation").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  notes: text("notes"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("product_planning_work_items_org_reference_uidx").on(table.organizationId, table.reference),
  uniqueIndex("product_planning_work_items_org_source_bug_uidx")
    .on(table.organizationId, table.sourceBugReportId)
    .where(sql`${table.sourceBugReportId} IS NOT NULL`),
  index("product_planning_work_items_org_status_idx").on(table.organizationId, table.planningStatus),
  index("product_planning_work_items_org_priority_idx").on(table.organizationId, table.priority),
  index("product_planning_work_items_org_type_idx").on(table.organizationId, table.workItemType),
  index("product_planning_work_items_org_phase_idx").on(table.organizationId, table.phase),
  index("product_planning_work_items_source_bug_idx").on(table.sourceBugReportId),
  index("product_planning_work_items_org_release_idx").on(table.organizationId, table.releaseId),
  index("product_planning_work_items_org_priority_score_idx").on(table.organizationId, table.priorityScore),
]);

export const productPlanningImportBatches = pgTable("product_planning_import_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  filename: text("filename"),
  rowCount: integer("row_count").notNull().default(0),
  importedCount: integer("imported_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  status: text("status").$type<typeof productPlanningImportStatusValues[number]>().notNull().default("pending"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("product_planning_import_batches_org_created_idx").on(table.organizationId, table.createdAt),
  index("product_planning_import_batches_org_status_idx").on(table.organizationId, table.status),
]);

export const productPlanningEvents = pgTable("product_planning_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workItemId: varchar("work_item_id").notNull().references(() => productPlanningWorkItems.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  message: text("message"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("product_planning_events_org_work_item_idx").on(table.organizationId, table.workItemId, table.createdAt),
  index("product_planning_events_org_type_created_idx").on(table.organizationId, table.eventType, table.createdAt),
]);

export const productPlanningAiSuggestions = pgTable("product_planning_ai_suggestions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workItemId: varchar("work_item_id").references(() => productPlanningWorkItems.id, { onDelete: "cascade" }),
  suggestionType: text("suggestion_type").$type<typeof productPlanningAiSuggestionTypeValues[number]>().notNull(),
  currentValue: text("current_value"),
  suggestedValue: text("suggested_value"),
  confidence: decimal("confidence", { precision: 5, scale: 2 }),
  reasoning: text("reasoning"),
  status: text("status").$type<typeof productPlanningAiSuggestionStatusValues[number]>().notNull().default("pending"),
  createdByAi: boolean("created_by_ai").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (table) => [
  index("product_planning_ai_suggestions_org_idx").on(table.organizationId),
  index("product_planning_ai_suggestions_work_item_idx").on(table.workItemId),
  index("product_planning_ai_suggestions_type_idx").on(table.suggestionType),
  index("product_planning_ai_suggestions_status_idx").on(table.status),
  index("product_planning_ai_suggestions_org_work_item_idx").on(table.organizationId, table.workItemId, table.status, table.createdAt),
  index("product_planning_ai_suggestions_org_type_status_idx").on(table.organizationId, table.suggestionType, table.status, table.createdAt),
]);

export const productPlanningAiAnalyses = pgTable("product_planning_ai_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  analysisType: text("analysis_type").$type<typeof productPlanningAiAnalysisTypeValues[number]>().notNull(),
  source: text("source").$type<typeof productPlanningAiAnalysisSourceValues[number]>().notNull(),
  fallbackReason: text("fallback_reason"),
  results: jsonb("results").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  generatedByUserId: varchar("generated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("product_planning_ai_analyses_org_type_generated_idx").on(table.organizationId, table.analysisType, table.generatedAt),
  index("product_planning_ai_analyses_org_source_idx").on(table.organizationId, table.source),
]);

export const productPlanningDependencies = pgTable("product_planning_dependencies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workItemId: varchar("work_item_id").notNull().references(() => productPlanningWorkItems.id, { onDelete: "cascade" }),
  dependsOnWorkItemId: varchar("depends_on_work_item_id").notNull().references(() => productPlanningWorkItems.id, { onDelete: "cascade" }),
  dependencyType: text("dependency_type").$type<typeof productPlanningDependencyTypeValues[number]>().notNull().default("requires"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("product_planning_dependencies_unique_idx").on(table.organizationId, table.workItemId, table.dependsOnWorkItemId, table.dependencyType),
  index("product_planning_dependencies_org_work_item_idx").on(table.organizationId, table.workItemId),
  index("product_planning_dependencies_org_depends_on_idx").on(table.organizationId, table.dependsOnWorkItemId),
]);

export const insertProductPlanningWorkItemSchema = createInsertSchema(productPlanningWorkItems, {
  workItemType: z.enum(productPlanningWorkItemTypeValues),
  planningStatus: z.enum(productPlanningStatusValues),
  priority: z.enum(productPlanningPriorityValues),
  businessValue: z.enum(productPlanningBusinessValueValues).optional().nullable(),
  complexity: z.enum(productPlanningComplexityValues).optional().nullable(),
  phase: z.enum(productPlanningPhaseValues).optional().nullable(),
  sourceType: z.enum(productPlanningSourceTypeValues).optional().nullable(),
  priorityScoreExplanation: z.record(z.string(), z.unknown()).optional(),
}).omit({
  id: true,
  reference: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
});

export const insertProductPlanningReleaseSchema = createInsertSchema(productPlanningReleases, {
  status: z.enum(productPlanningReleaseStatusValues),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
});

export const insertProductPlanningDependencySchema = createInsertSchema(productPlanningDependencies, {
  dependencyType: z.enum(productPlanningDependencyTypeValues),
}).omit({
  id: true,
  createdAt: true,
});

export const insertProductPlanningAiSuggestionSchema = createInsertSchema(productPlanningAiSuggestions, {
  suggestionType: z.enum(productPlanningAiSuggestionTypeValues),
  status: z.enum(productPlanningAiSuggestionStatusValues),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  reviewedAt: true,
});

export const updateProductPlanningWorkItemSchema = insertProductPlanningWorkItemSchema.partial().omit({
  organizationId: true,
  createdByUserId: true,
  sourceBugReportId: true,
  importedBatchId: true,
});

export type ProductPlanningWorkItem = typeof productPlanningWorkItems.$inferSelect;
export type InsertProductPlanningWorkItem = typeof productPlanningWorkItems.$inferInsert;
export type ProductPlanningRelease = typeof productPlanningReleases.$inferSelect;
export type InsertProductPlanningRelease = typeof productPlanningReleases.$inferInsert;
export type ProductPlanningDependency = typeof productPlanningDependencies.$inferSelect;
export type InsertProductPlanningDependency = typeof productPlanningDependencies.$inferInsert;
export type ProductPlanningAiSuggestion = typeof productPlanningAiSuggestions.$inferSelect;
export type InsertProductPlanningAiSuggestion = typeof productPlanningAiSuggestions.$inferInsert;
export type ProductPlanningAiAnalysis = typeof productPlanningAiAnalyses.$inferSelect;
export type InsertProductPlanningAiAnalysis = typeof productPlanningAiAnalyses.$inferInsert;
export type ProductPlanningImportBatch = typeof productPlanningImportBatches.$inferSelect;
export type InsertProductPlanningImportBatch = typeof productPlanningImportBatches.$inferInsert;
export type ProductPlanningEvent = typeof productPlanningEvents.$inferSelect;
export type InsertProductPlanningEvent = typeof productPlanningEvents.$inferInsert;

// ============================================================
// FEEDBACK AI REVIEWS - advisory org-scoped AI review history
// ============================================================
export const feedbackAiReviews = pgTable("feedback_ai_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  bugReportId: varchar("bug_report_id").notNull().references(() => bugReports.id, { onDelete: "cascade" }),
  reviewKind: text("review_kind").$type<AiReviewKind>().notNull().default("bug_review"),
  status: text("status").$type<AiReviewStatus>().notNull().default("pending"),
  isCurrent: boolean("is_current").notNull().default(true),
  requestedByUserId: varchar("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  requestedByEmail: text("requested_by_email").notNull(),
  provider: text("provider"),
  model: text("model"),
  providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>(),
  promptVersion: text("prompt_version").notNull(),
  inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  result: jsonb("result").$type<BugAiReviewResult>(),
  summary: text("summary"),
  severityAssessment: text("severity_assessment").$type<AiSeverityLevel>(),
  businessImpact: text("business_impact").$type<AiSeverityLevel>(),
  urgency: text("urgency").$type<AiSeverityLevel>(),
  implementationPriority: text("implementation_priority").$type<AiSeverityLevel>(),
  workflowImpact: text("workflow_impact").$type<WorkflowImpact>(),
  revenueRisk: text("revenue_risk").$type<RevenueRisk>(),
  suggestedOwner: text("suggested_owner").$type<SuggestedOwner>(),
  confidence: decimal("confidence", { precision: 4, scale: 3 }),
  validationErrors: jsonb("validation_errors").$type<unknown>(),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("feedback_ai_reviews_org_bug_current_idx").on(table.orgId, table.bugReportId, table.isCurrent),
  index("feedback_ai_reviews_org_status_created_idx").on(table.orgId, table.status, table.createdAt),
  index("feedback_ai_reviews_org_kind_created_idx").on(table.orgId, table.reviewKind, table.createdAt),
  index("feedback_ai_reviews_org_suggested_owner_idx").on(table.orgId, table.suggestedOwner),
  index("feedback_ai_reviews_org_workflow_impact_idx").on(table.orgId, table.workflowImpact),
  index("feedback_ai_reviews_org_revenue_risk_idx").on(table.orgId, table.revenueRisk),
  uniqueIndex("feedback_ai_reviews_one_current_bug_review_uidx")
    .on(table.orgId, table.bugReportId, table.reviewKind)
    .where(sql`${table.isCurrent} = true`),
]);

export const insertFeedbackAiReviewSchema = createInsertSchema(feedbackAiReviews, {
  reviewKind: z.enum(aiReviewKindValues),
  status: z.enum(aiReviewStatusValues),
  severityAssessment: z.enum(aiSeverityLevelValues).optional().nullable(),
  businessImpact: z.enum(aiSeverityLevelValues).optional().nullable(),
  urgency: z.enum(aiSeverityLevelValues).optional().nullable(),
  implementationPriority: z.enum(aiSeverityLevelValues).optional().nullable(),
  workflowImpact: z.enum(workflowImpactValues).optional().nullable(),
  revenueRisk: z.enum(revenueRiskValues).optional().nullable(),
  suggestedOwner: z.enum(suggestedOwnerValues).optional().nullable(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type FeedbackAiReview = typeof feedbackAiReviews.$inferSelect;
export type InsertFeedbackAiReview = typeof feedbackAiReviews.$inferInsert;

// ============================================================
// FEEDBACK AI TRIAGE BRIEFS - advisory collection-level planning history
// ============================================================
export const feedbackAiTriageBriefs = pgTable("feedback_ai_triage_briefs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  requestedByUserId: varchar("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  requestedByEmail: text("requested_by_email").notNull(),
  filtersSnapshot: jsonb("filters_snapshot").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  reportSnapshot: jsonb("report_snapshot").notNull().default(sql`'[]'::jsonb`),
  provider: text("provider"),
  model: text("model"),
  mode: text("mode"),
  promptVersion: text("prompt_version").notNull(),
  result: jsonb("result").$type<AiTriageBriefResult>(),
  summary: text("summary"),
  topRisks: jsonb("top_risks"),
  topFeatures: jsonb("top_features"),
  recommendedPriorities: jsonb("recommended_priorities"),
  duplicateSignals: jsonb("duplicate_signals"),
  workflowRisks: jsonb("workflow_risks"),
  revenueRisks: jsonb("revenue_risks"),
  unknowns: jsonb("unknowns"),
  confidence: decimal("confidence", { precision: 5, scale: 3 }),
  providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>(),
  usageMetadata: jsonb("usage_metadata").$type<Record<string, unknown>>(),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("feedback_ai_triage_briefs_org_status_created_idx").on(table.orgId, table.status, table.createdAt),
  index("feedback_ai_triage_briefs_org_created_idx").on(table.orgId, table.createdAt),
]);

export const insertFeedbackAiTriageBriefSchema = createInsertSchema(feedbackAiTriageBriefs, {
  status: z.enum(triageBriefStatusValues),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type FeedbackAiTriageBrief = typeof feedbackAiTriageBriefs.$inferSelect;
export type InsertFeedbackAiTriageBrief = typeof feedbackAiTriageBriefs.$inferInsert;

// ============================================================
// AI FOUNDATION - org-scoped provider settings and usage
// ============================================================
export const organizationAiSettings = pgTable("organization_ai_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  mode: text("mode").$type<AiMode>().notNull().default("disabled"),
  provider: text("provider").$type<AiProvider>(),
  model: text("model"),
  encryptedApiKey: text("encrypted_api_key"),
  apiKeyLast4: varchar("api_key_last4", { length: 8 }),
  encryptionKeyId: text("encryption_key_id"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  bugReviewEnabled: boolean("bug_review_enabled").notNull().default(false),
  triageBriefEnabled: boolean("triage_brief_enabled").notNull().default(false),
  featureReviewEnabled: boolean("feature_review_enabled").notNull().default(false),
  duplicateDetectionEnabled: boolean("duplicate_detection_enabled").notNull().default(false),
  orderParsingEnabled: boolean("order_parsing_enabled").notNull().default(false),
  emailProcessingEnabled: boolean("email_processing_enabled").notNull().default(false),
  customerSupportEnabled: boolean("customer_support_enabled").notNull().default(false),
  inventoryRecommendationsEnabled: boolean("inventory_recommendations_enabled").notNull().default(false),
  productionAssistanceEnabled: boolean("production_assistance_enabled").notNull().default(false),
  assistantEnabled: boolean("assistant_enabled").notNull().default(true),
  monthlyUsageLimit: integer("monthly_usage_limit"),
  includedMonthlyCreditsCents: integer("included_monthly_credits_cents"),
  overageEnabled: boolean("overage_enabled").notNull().default(false),
  billingMetadata: jsonb("billing_metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("organization_ai_settings_org_uidx").on(table.orgId),
  index("organization_ai_settings_mode_idx").on(table.mode),
  index("organization_ai_settings_provider_idx").on(table.provider),
]);

export const insertOrganizationAiSettingsSchema = createInsertSchema(organizationAiSettings, {
  mode: z.enum(aiModeValues),
  provider: z.enum(aiProviderValues).optional().nullable(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateOrganizationAiSettingsSchema = insertOrganizationAiSettingsSchema.partial().omit({
  orgId: true,
  encryptedApiKey: true,
  apiKeyLast4: true,
  encryptionKeyId: true,
});

export type OrganizationAiSettings = typeof organizationAiSettings.$inferSelect;
export type InsertOrganizationAiSettings = typeof organizationAiSettings.$inferInsert;
export type UpdateOrganizationAiSettings = z.infer<typeof updateOrganizationAiSettingsSchema>;

export const aiUsage = pgTable("ai_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  feature: text("feature").$type<AiFeature>().notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  requestCount: integer("request_count").notNull().default(1),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
  costCurrency: text("cost_currency").notNull().default("USD"),
  pricingSnapshot: jsonb("pricing_snapshot").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  mode: text("mode").notNull(),
  source: text("source").notNull().default("server"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_usage_org_feature_created_idx").on(table.orgId, table.feature, table.createdAt),
  index("ai_usage_org_provider_created_idx").on(table.orgId, table.provider, table.createdAt),
  index("ai_usage_org_created_idx").on(table.orgId, table.createdAt),
]);

export const insertAiUsageSchema = createInsertSchema(aiUsage, {
  feature: z.enum(aiFeatureValues),
}).omit({
  id: true,
  createdAt: true,
}).superRefine((data, ctx) => {
  if (data.mode !== "printershero_managed") {
    return;
  }

  const snapshot = data.pricingSnapshot;
  const hasManagedBillingBasis = snapshot
    && typeof snapshot === "object"
    && !Array.isArray(snapshot)
    && "basis" in snapshot
    && "currency" in snapshot
    && "provider" in snapshot
    && "model" in snapshot;

  if (!hasManagedBillingBasis) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pricingSnapshot"],
      message: "Printers Hero managed AI usage requires a pricing snapshot with billing basis.",
    });
  }
});

export type AiUsage = typeof aiUsage.$inferSelect;
export type InsertAiUsage = typeof aiUsage.$inferInsert;

// Assistant platform foundation: tenant-scoped internal workspace records.
export const aiConversations = pgTable("ai_conversations", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 240 }).notNull().default("New conversation"),
  status: text("status").$type<AssistantConversationStatus>().notNull().default("active"),
  lastMessagePreview: varchar("last_message_preview", { length: 240 }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_conversations_org_user_activity_idx").on(table.orgId, table.userId, table.lastActivityAt),
  index("ai_conversations_org_status_activity_idx").on(table.orgId, table.status, table.lastActivityAt),
]);

export const aiTurns = pgTable("ai_turns", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status").$type<AssistantTurnStatus>().notNull().default("pending"),
  clientRequestId: varchar("client_request_id", { length: 128 }),
  correlationId: varchar("correlation_id", { length: 128 }).notNull(),
  provider: varchar("provider", { length: 80 }),
  model: varchar("model", { length: 160 }),
  mode: varchar("mode", { length: 64 }),
  promptVersion: varchar("prompt_version", { length: 64 }),
  errorCode: varchar("error_code", { length: 120 }),
  errorMessage: varchar("error_message", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_turns_org_conversation_created_idx").on(table.orgId, table.conversationId, table.createdAt),
  index("ai_turns_org_status_created_idx").on(table.orgId, table.status, table.createdAt),
  index("ai_turns_correlation_id_idx").on(table.correlationId),
]);

export const aiMessages = pgTable("ai_messages", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  turnId: varchar("turn_id").references(() => aiTurns.id, { onDelete: "cascade" }),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  role: text("role").$type<AssistantMessageRole>().notNull(),
  sequence: integer("sequence").notNull(),
  content: text("content").notNull(),
  contentFormat: varchar("content_format", { length: 32 }).notNull().default("plain_text"),
  structuredCards: jsonb("structured_cards").$type<AssistantStructuredCard[]>().notNull().default(sql.raw("'[]'::jsonb")),
  provider: varchar("provider", { length: 80 }),
  model: varchar("model", { length: 160 }),
  correlationId: varchar("correlation_id", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ai_messages_conversation_sequence_uidx").on(table.conversationId, table.sequence),
  index("ai_messages_org_conversation_created_idx").on(table.orgId, table.conversationId, table.createdAt),
  index("ai_messages_turn_id_idx").on(table.turnId),
]);

export const aiContextSnapshots = pgTable("ai_context_snapshots", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  turnId: varchar("turn_id").notNull().references(() => aiTurns.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  contextVersion: varchar("context_version", { length: 32 }).notNull(),
  sanitizedContext: jsonb("sanitized_context").$type<AssistantContextEnvelope>().notNull(),
  contextHash: varchar("context_hash", { length: 128 }).notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_context_snapshots_org_conversation_created_idx").on(table.orgId, table.conversationId, table.createdAt),
  index("ai_context_snapshots_turn_id_idx").on(table.turnId),
]);

/** Safe operator working context. This is not a second business source of
 * truth: it stores only task identity, summaries, references, and state while
 * canonical product/command records retain all authoritative mutation data. */
export const aiOperatorTasks = pgTable("ai_operator_tasks", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  domain: varchar("domain", { length: 80 }),
  goal: varchar("goal", { length: 2000 }).notNull(),
  workingSummary: varchar("working_summary", { length: 2000 }),
  entityReferences: jsonb("entity_references").$type<Array<{ type: string; id: string; label?: string }>>().notNull().default(sql.raw("'[]'::jsonb")),
  missingInformation: jsonb("missing_information").$type<string[]>().notNull().default(sql.raw("'[]'::jsonb")),
  semanticChanges: jsonb("semantic_changes").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  confirmationState: varchar("confirmation_state", { length: 64 }).notNull().default("none"),
  status: varchar("status", { length: 64 }).notNull().default("active"),
  canonicalProductIntentProposalId: varchar("canonical_product_intent_proposal_id", { length: 120 }),
  lastObservationSummary: varchar("last_observation_summary", { length: 2000 }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_operator_tasks_org_conversation_status_idx").on(table.orgId, table.conversationId, table.status, table.updatedAt),
  index("ai_operator_tasks_org_user_updated_idx").on(table.orgId, table.userId, table.updatedAt),
]);

export const aiToolExecutions = pgTable("ai_tool_executions", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  turnId: varchar("turn_id").notNull().references(() => aiTurns.id, { onDelete: "cascade" }),
  toolName: varchar("tool_name", { length: 120 }).notNull(),
  toolVersion: varchar("tool_version", { length: 64 }).notNull(),
  status: text("status").$type<(typeof assistantToolExecutionStatusValues)[number]>().notNull().default("not_run"),
  redactedArguments: jsonb("redacted_arguments").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  redactedResult: jsonb("redacted_result").$type<Record<string, unknown>>(),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull().default(sql.raw("'[]'::jsonb")),
  correlationId: varchar("correlation_id", { length: 128 }).notNull(),
  errorCode: varchar("error_code", { length: 120 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("ai_tool_executions_org_turn_created_idx").on(table.orgId, table.turnId, table.createdAt),
  index("ai_tool_executions_org_status_created_idx").on(table.orgId, table.status, table.createdAt),
  index("ai_tool_executions_correlation_id_idx").on(table.correlationId),
]);

export const aiAuditEvents = pgTable("ai_audit_events", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").references(() => aiConversations.id, { onDelete: "set null" }),
  turnId: varchar("turn_id").references(() => aiTurns.id, { onDelete: "set null" }),
  toolExecutionId: varchar("tool_execution_id").references(() => aiToolExecutions.id, { onDelete: "set null" }),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  sourceAuditLogId: varchar("source_audit_log_id").references(() => auditLogs.id, { onDelete: "set null" }),
  eventType: varchar("event_type", { length: 120 }).notNull(),
  status: varchar("status", { length: 64 }).notNull(),
  inputHash: varchar("input_hash", { length: 128 }),
  correlationId: varchar("correlation_id", { length: 128 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_audit_events_org_created_idx").on(table.orgId, table.createdAt),
  index("ai_audit_events_org_conversation_created_idx").on(table.orgId, table.conversationId, table.createdAt),
  index("ai_audit_events_turn_id_idx").on(table.turnId),
  index("ai_audit_events_correlation_id_idx").on(table.correlationId),
]);

// Stage 3: durable, server-authoritative action-planning safety records.
// They model proposed work only; command implementations remain code-defined.
export const aiExecutionPlans = pgTable("ai_execution_plans", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  turnId: varchar("turn_id").references(() => aiTurns.id, { onDelete: "set null" }),
  contextSnapshotId: varchar("context_snapshot_id").references(() => aiContextSnapshots.id, { onDelete: "set null" }),
  action: varchar("action", { length: 120 }).notNull(),
  commandVersion: varchar("command_version", { length: 64 }).notNull(),
  sanitizedArguments: jsonb("sanitized_arguments").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  planHash: varchar("plan_hash", { length: 128 }).notNull(),
  contextHash: varchar("context_hash", { length: 128 }).notNull(),
  permissionSnapshot: jsonb("permission_snapshot").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  policyVersion: varchar("policy_version", { length: 64 }).notNull(),
  riskLevel: varchar("risk_level", { length: 32 }).notNull(),
  affectedEntities: jsonb("affected_entities").$type<Array<Record<string, unknown>>>().notNull().default(sql.raw("'[]'::jsonb")),
  expectedFingerprints: jsonb("expected_fingerprints").$type<Array<Record<string, unknown>>>().notNull().default(sql.raw("'[]'::jsonb")),
  preview: jsonb("preview").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  sideEffects: jsonb("side_effects").$type<Array<Record<string, unknown>>>().notNull().default(sql.raw("'[]'::jsonb")),
  status: text("status").$type<AssistantExecutionPlanStatus>().notNull().default("draft"),
  planVersion: integer("plan_version").notNull().default(1),
  environment: varchar("environment", { length: 64 }).notNull(),
  failureSummary: varchar("failure_summary", { length: 1000 }),
  partialFailure: jsonb("partial_failure").$type<Record<string, unknown> | null>(),
  undoMetadata: jsonb("undo_metadata").$type<Record<string, unknown> | null>(),
  correlationId: varchar("correlation_id", { length: 128 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  expiredAt: timestamp("expired_at", { withTimezone: true }),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_execution_plans_org_user_created_idx").on(table.orgId, table.userId, table.createdAt),
  index("ai_execution_plans_org_conversation_created_idx").on(table.orgId, table.conversationId, table.createdAt),
  index("ai_execution_plans_org_status_expires_idx").on(table.orgId, table.status, table.expiresAt),
  index("ai_execution_plans_correlation_id_idx").on(table.correlationId),
]);

/**
 * A bounded, reviewable parent scope for several independently planned
 * commands. Child plans remain the authoritative command records; this table
 * records only the explicit composition and its one user-facing GO.
 */
export const aiCompositeExecutionPlans = pgTable("ai_composite_execution_plans", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  contextHash: varchar("context_hash", { length: 128 }).notNull(),
  compositeFingerprint: varchar("composite_fingerprint", { length: 128 }).notNull(),
  operations: jsonb("operations").$type<Array<Record<string, unknown>>>().notNull().default(sql.raw("'[]'::jsonb")),
  status: varchar("status", { length: 32 }).notNull().default("preview_ready"),
  planVersion: integer("plan_version").notNull().default(1),
  result: jsonb("result").$type<Record<string, unknown> | null>(),
  correlationId: varchar("correlation_id", { length: 128 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_composite_execution_plans_org_user_created_idx").on(table.orgId, table.userId, table.createdAt),
  index("ai_composite_execution_plans_org_conversation_status_idx").on(table.orgId, table.conversationId, table.status),
  index("ai_composite_execution_plans_correlation_id_idx").on(table.correlationId),
]);

export const aiConfirmations = pgTable("ai_confirmations", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  planId: varchar("plan_id").references(() => aiExecutionPlans.id, { onDelete: "cascade" }),
  compositePlanId: varchar("composite_plan_id").references(() => aiCompositeExecutionPlans.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("issued"),
  confirmationMethod: varchar("confirmation_method", { length: 64 }).notNull().default("dedicated_api"),
  requestCorrelationId: varchar("request_correlation_id", { length: 128 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  invalidatedReason: varchar("invalidated_reason", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ai_confirmations_token_hash_uidx").on(table.tokenHash),
  index("ai_confirmations_org_user_plan_idx").on(table.orgId, table.userId, table.planId),
  index("ai_confirmations_plan_expires_idx").on(table.planId, table.expiresAt),
  index("ai_confirmations_composite_plan_expires_idx").on(table.compositePlanId, table.expiresAt),
]);

export const aiExecutionSteps = pgTable("ai_execution_steps", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  planId: varchar("plan_id").notNull().references(() => aiExecutionPlans.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  commandName: varchar("command_name", { length: 120 }).notNull(),
  commandVersion: varchar("command_version", { length: 64 }).notNull(),
  status: text("status").$type<(typeof assistantExecutionStepStatusValues)[number]>().notNull().default("pending"),
  sanitizedInput: jsonb("sanitized_input").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  resultSummary: jsonb("result_summary").$type<Record<string, unknown> | null>(),
  errorCode: varchar("error_code", { length: 120 }),
  domainAuditReferences: jsonb("domain_audit_references").$type<string[]>().notNull().default(sql.raw("'[]'::jsonb")),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ai_execution_steps_plan_sequence_uidx").on(table.planId, table.sequence),
  index("ai_execution_steps_org_plan_status_idx").on(table.orgId, table.planId, table.status),
]);

export const aiIdempotencyRecords = pgTable("ai_idempotency_records", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: varchar("actor_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  commandName: varchar("command_name", { length: 120 }).notNull(),
  commandVersion: varchar("command_version", { length: 64 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  planId: varchar("plan_id").notNull().references(() => aiExecutionPlans.id, { onDelete: "cascade" }),
  requestHash: varchar("request_hash", { length: 128 }).notNull(),
  status: text("status").$type<(typeof assistantIdempotencyStatusValues)[number]>().notNull().default("locked"),
  resultReference: varchar("result_reference", { length: 128 }),
  resultSummary: jsonb("result_summary").$type<Record<string, unknown> | null>(),
  errorReference: varchar("error_reference", { length: 128 }),
  lockedAt: timestamp("locked_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ai_idempotency_records_scope_key_uidx").on(table.orgId, table.actorUserId, table.commandName, table.commandVersion, table.idempotencyKey),
  index("ai_idempotency_records_org_plan_idx").on(table.orgId, table.planId),
  index("ai_idempotency_records_status_expiry_idx").on(table.status, table.expiresAt),
]);

export const insertAiConversationSchema = createInsertSchema(aiConversations, {
  status: z.enum(assistantConversationStatusValues),
}).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAiTurnSchema = createInsertSchema(aiTurns, {
  status: z.enum(assistantTurnStatusValues),
}).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAiMessageSchema = createInsertSchema(aiMessages, {
  role: z.enum(assistantMessageRoleValues),
}).omit({ id: true, createdAt: true });
export const insertAiContextSnapshotSchema = createInsertSchema(aiContextSnapshots).omit({ id: true, createdAt: true });
export const insertAiToolExecutionSchema = createInsertSchema(aiToolExecutions, {
  status: z.enum(assistantToolExecutionStatusValues),
}).omit({ id: true, createdAt: true });
export const insertAiAuditEventSchema = createInsertSchema(aiAuditEvents).omit({ id: true, createdAt: true });
export const insertAiExecutionPlanSchema = createInsertSchema(aiExecutionPlans).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAiConfirmationSchema = createInsertSchema(aiConfirmations).omit({ id: true, createdAt: true });
export const insertAiExecutionStepSchema = createInsertSchema(aiExecutionSteps).omit({ id: true, createdAt: true });
export const insertAiIdempotencyRecordSchema = createInsertSchema(aiIdempotencyRecords).omit({ id: true, createdAt: true });

export type AiConversation = typeof aiConversations.$inferSelect;
export type InsertAiConversation = typeof aiConversations.$inferInsert;
export type AiTurn = typeof aiTurns.$inferSelect;
export type InsertAiTurn = typeof aiTurns.$inferInsert;
export type AiMessage = typeof aiMessages.$inferSelect;
export type InsertAiMessage = typeof aiMessages.$inferInsert;
export type AiContextSnapshot = typeof aiContextSnapshots.$inferSelect;
export type InsertAiContextSnapshot = typeof aiContextSnapshots.$inferInsert;
export type AiToolExecution = typeof aiToolExecutions.$inferSelect;
export type InsertAiToolExecution = typeof aiToolExecutions.$inferInsert;
export type AiAuditEvent = typeof aiAuditEvents.$inferSelect;
export type InsertAiAuditEvent = typeof aiAuditEvents.$inferInsert;
export type AiExecutionPlan = typeof aiExecutionPlans.$inferSelect;
export type InsertAiExecutionPlan = typeof aiExecutionPlans.$inferInsert;
export type AiConfirmation = typeof aiConfirmations.$inferSelect;
export type InsertAiConfirmation = typeof aiConfirmations.$inferInsert;
export type AiExecutionStep = typeof aiExecutionSteps.$inferSelect;
export type InsertAiExecutionStep = typeof aiExecutionSteps.$inferInsert;
export type AiIdempotencyRecord = typeof aiIdempotencyRecords.$inferSelect;
export type InsertAiIdempotencyRecord = typeof aiIdempotencyRecords.$inferInsert;

// ──────────────────────────────────────────────────────────────────────────────
// BUG REPORT NOTES — admin-only internal notes per bug report
// ──────────────────────────────────────────────────────────────────────────────
export const bugReportNotes = pgTable("bug_report_notes", {
  id:                varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bugReportId:       varchar("bug_report_id").notNull().references(() => bugReports.id, { onDelete: 'cascade' }),
  orgId:             varchar("org_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdByUserId:   varchar("created_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  createdByEmail:    text("created_by_email").notNull(),
  note:              text("note").notNull(),
  createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("bug_report_notes_bug_id_idx").on(table.bugReportId, table.createdAt),
  index("bug_report_notes_org_idx").on(table.orgId),
]);

export type BugReportNote = typeof bugReportNotes.$inferSelect;
export type InsertBugReportNote = typeof bugReportNotes.$inferInsert;

// ============================================================
// MANUAL PREPRESS PRODUCTION WORKFLOW
// ============================================================

// Prepress session status enum
export const prepressSessionStatusEnum = pgEnum('prepress_session_status', ['active', 'complete']);

// Line item file role enum
export const lineItemFileRoleEnum = pgEnum('line_item_file_role', ['original', 'final', 'reference']);

// Line item file status enum
export const lineItemFileStatusEnum = pgEnum('line_item_file_status', ['active', 'superseded', 'retired']);

/**
 * Prepress Sessions - Manual prepress workflow tracking
 * One ACTIVE session per line item at a time
 */
export const prepressSessions = pgTable("prepress_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  lineItemId: varchar("line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),
  status: prepressSessionStatusEnum("status").notNull().default('active'),
  
  // Session ownership and locking
  startedByUserId: varchar("started_by_user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  lockOwnerUserId: varchar("lock_owner_user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  
  // Session notes and issue tracking
  notesText: text("notes_text"),
  issueFlag: boolean("issue_flag").notNull().default(false),
  issueType: text("issue_type"),
  
  // Completion tracking
  completedByUserId: varchar("completed_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  
  // Timestamps
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("prepress_sessions_org_idx").on(table.organizationId),
  index("prepress_sessions_order_idx").on(table.orderId),
  index("prepress_sessions_line_item_idx").on(table.lineItemId),
  index("prepress_sessions_status_idx").on(table.status),
  index("prepress_sessions_lock_owner_idx").on(table.lockOwnerUserId),
]);

/**
 * Line Item Files - File attachments for line items (originals, finals, references)
 * Supports multiple files per line item with versioning via supersedes
 */
export const lineItemFiles = pgTable("line_item_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  lineItemId: varchar("line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),
  productionRunId: varchar("production_run_id").references((): AnyPgColumn => productionRuns.id, { onDelete: 'set null' }),
  prepressSessionId: varchar("prepress_session_id").references(() => prepressSessions.id, { onDelete: 'set null' }),
  fileRecordId: varchar("file_record_id").references((): AnyPgColumn => fileRecords.id, { onDelete: 'set null' }),
  
  // File metadata
  role: lineItemFileRoleEnum("role").notNull(), // original | final | reference
  status: lineItemFileStatusEnum("status").notNull().default('active'), // active | superseded | retired
  tag: text("tag"), // Front/Back/Panel/etc
  // Allocation copied from the authoritative production-artwork relationship
  // when final art is promoted. This preserves the instruction if output
  // bytes differ from the original upload.
  productionQuantity: integer("production_quantity"),
  productionGroupId: varchar("production_group_id", { length: 128 }),
  productionArtworkSourceType: varchar("production_artwork_source_type", { length: 64 }),
  sourceFileId: varchar("source_file_id").references((): any => lineItemFiles.id, { onDelete: 'set null' }),
  sourceOrderAttachmentId: varchar("source_order_attachment_id").references(() => orderAttachments.id, { onDelete: 'set null' }),
  sourceArtworkSide: fileSideEnum("source_artwork_side"),
  
  // Storage information
  storageBucket: varchar("storage_bucket", { length: 255 }),
  storagePath: text("storage_path").notNull(),
  storageKey: text("storage_key"), // Alternative to bucket+path for some providers
  originalFilename: varchar("original_filename", { length: 512 }).notNull(),
  mimeType: varchar("mime_type", { length: 255 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  
  // Versioning
  supersedesFileId: varchar("supersedes_file_id").references((): any => lineItemFiles.id, { onDelete: 'set null' }),
  
  // Audit
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("line_item_files_org_idx").on(table.organizationId),
  index("line_item_files_order_idx").on(table.orderId),
  index("line_item_files_line_item_idx").on(table.lineItemId),
  index("line_item_files_production_run_idx").on(table.productionRunId),
  index("line_item_files_file_record_idx").on(table.fileRecordId),
  index("line_item_files_session_idx").on(table.prepressSessionId),
  index("line_item_files_role_status_idx").on(table.role, table.status),
  index("line_item_files_supersedes_idx").on(table.supersedesFileId),
  index("line_item_files_source_file_idx").on(table.sourceFileId),
  index("line_item_files_source_attachment_idx").on(table.sourceOrderAttachmentId),
  uniqueIndex("line_item_files_active_promoted_source_uidx")
    .on(table.organizationId, table.lineItemId, table.role, table.status, table.tag, table.sourceArtworkSide, table.sourceFileId, table.sourceOrderAttachmentId)
    .where(sql`production_artwork_source_type = 'customer_artwork_promotion' AND role = 'final' AND status = 'active'`),
]);

export const lineItemProofVersionStatusEnum = pgEnum('line_item_proof_version_status', [
  'draft',
  'awaiting_response',
  'approved',
  'rejected',
  'revision_requested',
  'cancelled',
  'superseded',
]);

export const lineItemProofResponseDecisionEnum = pgEnum('line_item_proof_response_decision', [
  'approved',
  'rejected',
  'revision_requested',
]);

export const lineItemProofVersions = pgTable("line_item_proof_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  lineItemId: varchar("line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),
  proofFileId: varchar("proof_file_id").notNull().references(() => orderAttachments.id, { onDelete: 'restrict' }),
  versionNumber: integer("version_number").notNull(),
  status: lineItemProofVersionStatusEnum("status").notNull().default('draft'),
  internalNotes: text("internal_notes"),
  customerMessage: text("customer_message"),
  customerVisibleDisclaimer: text("customer_visible_disclaimer"),
  sentToName: varchar("sent_to_name", { length: 255 }),
  sentToEmail: varchar("sent_to_email", { length: 255 }),
  sentByUserId: varchar("sent_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("line_item_proof_versions_org_idx").on(table.organizationId),
  index("line_item_proof_versions_order_idx").on(table.orderId),
  index("line_item_proof_versions_line_item_idx").on(table.lineItemId),
  index("line_item_proof_versions_status_idx").on(table.status),
  index("line_item_proof_versions_proof_file_idx").on(table.proofFileId),
  uniqueIndex("line_item_proof_versions_line_item_version_uidx").on(table.lineItemId, table.versionNumber),
]);

export const localBridgeAgentStatusEnum = pgEnum("local_bridge_agent_status", ["pending", "active", "disabled", "revoked"]);
export const localFileDestinationTypeEnum = pgEnum("local_file_destination_type", ["customer_art_folder", "onyx_hot_folder_future"]);
export const localFileCopyJobStatusEnum = pgEnum("local_file_copy_job_status", ["pending", "claimed", "succeeded", "failed", "canceled"]);
export const localBridgeAgents = pgTable("local_bridge_agents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`), organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(), status: localBridgeAgentStatusEnum("status").notNull().default("pending"), tokenHash: varchar("token_hash", { length: 128 }).notNull(),
  machineLabel: varchar("machine_label", { length: 255 }), agentVersion: varchar("agent_version", { length: 64 }), lastSeenAt: timestamp("last_seen_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// Stage 19G: authoritative batch/child state is separate from generic plans.
// A plan describes one confirmed action; these records retain row payloads,
// retry state, and tenant-scoped history without relying on message text.
export const aiProductDraftBatches = pgTable("ai_product_draft_batches", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  planId: varchar("plan_id").references(() => aiExecutionPlans.id, { onDelete: "set null" }),
  conversationId: varchar("conversation_id").references(() => aiConversations.id, { onDelete: "set null" }),
  sourceTurnId: varchar("source_turn_id").references(() => aiTurns.id, { onDelete: "set null" }),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  commandName: varchar("command_name", { length: 120 }).notNull(),
  commandVersion: varchar("command_version", { length: 64 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  sourceFormat: varchar("source_format", { length: 32 }).notNull(),
  sharedDefaults: jsonb("shared_defaults").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  sourceMetadata: jsonb("source_metadata").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  fingerprint: varchar("fingerprint", { length: 128 }).notNull(),
  proposalStatus: varchar("proposal_status", { length: 32 }).notNull().default("proposed"),
  executionStatus: varchar("execution_status", { length: 32 }).notNull().default("proposed"),
  submittedCount: integer("submitted_count").notNull(), includedCount: integer("included_count").notNull(), excludedCount: integer("excluded_count").notNull().default(0),
  correlationId: varchar("correlation_id", { length: 128 }), idempotencyKey: varchar("idempotency_key", { length: 160 }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }), startedAt: timestamp("started_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("ai_product_draft_batches_org_created_idx").on(table.orgId, table.createdAt), index("ai_product_draft_batches_org_conversation_created_idx").on(table.orgId, table.conversationId, table.createdAt), index("ai_product_draft_batches_org_status_created_idx").on(table.orgId, table.executionStatus, table.createdAt)]);

export const aiProductDraftBatchRows = pgTable("ai_product_draft_batch_rows", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  batchId: varchar("batch_id").notNull().references(() => aiProductDraftBatches.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceRowNumber: integer("source_row_number").notNull(), sourceRowLabel: varchar("source_row_label", { length: 255 }), productName: varchar("product_name", { length: 255 }).notNull(),
  resolvedPayload: jsonb("resolved_payload").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")), provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  fingerprint: varchar("fingerprint", { length: 128 }).notNull(), idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  executionState: varchar("execution_state", { length: 32 }).notNull().default("pending"), productId: varchar("product_id").references(() => products.id, { onDelete: "set null" }), readinessResult: jsonb("readiness_result").$type<Record<string, unknown> | null>(),
  attemptCount: integer("attempt_count").notNull().default(0), lastErrorCode: varchar("last_error_code", { length: 120 }), lastErrorMessage: varchar("last_error_message", { length: 1000 }), retryable: boolean("retryable").notNull().default(false),
  startedAt: timestamp("started_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("ai_product_draft_batch_rows_batch_source_row_uidx").on(table.batchId, table.sourceRowNumber), uniqueIndex("ai_product_draft_batch_rows_org_idempotency_uidx").on(table.orgId, table.idempotencyKey), index("ai_product_draft_batch_rows_org_batch_state_idx").on(table.orgId, table.batchId, table.executionState)]);

// Stage 19H deliberately uses separate storage from draft creation batches.
// An update proposal is an immutable, confirmation-bound description of
// mutations to existing product drafts; it must never be confused with a
// product-creation intake row.
export const aiProductDraftBulkUpdates = pgTable("ai_product_draft_bulk_updates", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  planId: varchar("plan_id").references(() => aiExecutionPlans.id, { onDelete: "set null" }),
  conversationId: varchar("conversation_id").references(() => aiConversations.id, { onDelete: "set null" }),
  sourceTurnId: varchar("source_turn_id").references(() => aiTurns.id, { onDelete: "set null" }),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  sourceBatchId: varchar("source_batch_id").references(() => aiProductDraftBatches.id, { onDelete: "set null" }),
  commandName: varchar("command_name", { length: 120 }).notNull(), commandVersion: varchar("command_version", { length: 64 }).notNull(),
  selectionDescription: varchar("selection_description", { length: 1000 }).notNull(),
  sharedPatch: jsonb("shared_patch").$type<Record<string, unknown>>().notNull(), overrides: jsonb("overrides").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  fingerprint: varchar("fingerprint", { length: 128 }).notNull(), proposalStatus: varchar("proposal_status", { length: 32 }).notNull().default("proposed"), confirmationStatus: varchar("confirmation_status", { length: 32 }).notNull().default("pending"), executionStatus: varchar("execution_status", { length: 32 }).notNull().default("proposed"),
  targetCount: integer("target_count").notNull(), eligibleCount: integer("eligible_count").notNull(), noChangeCount: integer("no_change_count").notNull().default(0), blockedCount: integer("blocked_count").notNull().default(0),
  correlationId: varchar("correlation_id", { length: 128 }), idempotencyKey: varchar("idempotency_key", { length: 160 }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }), startedAt: timestamp("started_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("ai_product_draft_bulk_updates_org_created_idx").on(table.orgId, table.createdAt), index("ai_product_draft_bulk_updates_org_status_created_idx").on(table.orgId, table.executionStatus, table.createdAt), index("ai_product_draft_bulk_updates_org_conversation_created_idx").on(table.orgId, table.conversationId, table.createdAt)]);

export const aiProductDraftBulkUpdateRows = pgTable("ai_product_draft_bulk_update_rows", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")), bulkUpdateId: varchar("bulk_update_id").notNull().references(() => aiProductDraftBulkUpdates.id, { onDelete: "cascade" }), orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceOrder: integer("source_order").notNull(), productId: varchar("product_id").notNull().references(() => products.id, { onDelete: "restrict" }), sessionId: varchar("session_id", { length: 128 }).notNull(), productName: varchar("product_name", { length: 255 }).notNull(), category: varchar("category", { length: 100 }),
  beforeSnapshot: jsonb("before_snapshot").$type<Record<string, unknown>>().notNull(), beforeFingerprint: varchar("before_fingerprint", { length: 128 }).notNull(), patch: jsonb("patch").$type<Record<string, unknown>>().notNull(), patchDomain: varchar("patch_domain", { length: 32 }).notNull(), provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")), fingerprint: varchar("fingerprint", { length: 128 }).notNull(), idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  eligibilityState: varchar("eligibility_state", { length: 32 }).notNull(), executionState: varchar("execution_state", { length: 32 }).notNull().default("pending"), attemptCount: integer("attempt_count").notNull().default(0), warnings: jsonb("warnings").$type<string[]>().notNull().default(sql.raw("'[]'::jsonb")), readinessBefore: jsonb("readiness_before").$type<Record<string, unknown> | null>(), readinessAfter: jsonb("readiness_after").$type<Record<string, unknown> | null>(), afterSnapshot: jsonb("after_snapshot").$type<Record<string, unknown> | null>(), lastErrorCode: varchar("last_error_code", { length: 120 }), lastErrorMessage: varchar("last_error_message", { length: 1000 }), retryable: boolean("retryable").notNull().default(false), lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("ai_product_draft_bulk_update_rows_bulk_source_uidx").on(table.bulkUpdateId, table.sourceOrder), uniqueIndex("ai_product_draft_bulk_update_rows_org_idempotency_uidx").on(table.orgId, table.idempotencyKey), index("ai_product_draft_bulk_update_rows_org_bulk_state_idx").on(table.orgId, table.bulkUpdateId, table.executionState)]);

// Stage 19J: active or inactive product pricing changes use the same durable
// parent/child model. Rows retain the exact confirmed values so execution and
// rollback never rerun a broad selector or recalculate a relative operation.
export const aiProductPricingChangeSets = pgTable("ai_product_pricing_change_sets", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  planId: varchar("plan_id").references(() => aiExecutionPlans.id, { onDelete: "set null" }),
  conversationId: varchar("conversation_id").references(() => aiConversations.id, { onDelete: "set null" }),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  commandName: varchar("command_name", { length: 120 }).notNull(), commandVersion: varchar("command_version", { length: 64 }).notNull(),
  requestSummary: varchar("request_summary", { length: 1000 }).notNull(), selector: jsonb("selector").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")), operation: jsonb("operation").$type<Record<string, unknown>>().notNull(), fingerprint: varchar("fingerprint", { length: 128 }).notNull(),
  proposalStatus: varchar("proposal_status", { length: 32 }).notNull().default("proposed"), confirmationStatus: varchar("confirmation_status", { length: 32 }).notNull().default("pending"), executionStatus: varchar("execution_status", { length: 32 }).notNull().default("proposed"),
  targetCount: integer("target_count").notNull(), eligibleCount: integer("eligible_count").notNull(), excludedCount: integer("excluded_count").notNull().default(0), succeededCount: integer("succeeded_count").notNull().default(0), failedCount: integer("failed_count").notNull().default(0), conflictedCount: integer("conflicted_count").notNull().default(0),
  idempotencyKey: varchar("idempotency_key", { length: 160 }), correlationId: varchar("correlation_id", { length: 128 }), confirmedAt: timestamp("confirmed_at", { withTimezone: true }), executedAt: timestamp("executed_at", { withTimezone: true }),
  rollbackStatus: varchar("rollback_status", { length: 32 }).notNull().default("available"), rollbackPlanId: varchar("rollback_plan_id").references(() => aiExecutionPlans.id, { onDelete: "set null" }), rollbackedAt: timestamp("rollbacked_at", { withTimezone: true }), rollbackActorUserId: varchar("rollback_actor_user_id").references(() => users.id, { onDelete: "set null" }), failureSummary: varchar("failure_summary", { length: 1000 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("ai_product_pricing_change_sets_org_created_idx").on(table.orgId, table.createdAt), index("ai_product_pricing_change_sets_org_status_idx").on(table.orgId, table.executionStatus, table.createdAt)]);

export const aiProductPricingChangeSetRows = pgTable("ai_product_pricing_change_set_rows", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")), changeSetId: varchar("change_set_id").notNull().references(() => aiProductPricingChangeSets.id, { onDelete: "cascade" }), orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), sourceOrder: integer("source_order").notNull(),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: "restrict" }), productName: varchar("product_name", { length: 255 }).notNull(), activeSnapshot: boolean("active_snapshot").notNull(), activeTreeVersionId: varchar("active_tree_version_id"),
  beforeValues: jsonb("before_values").$type<Record<string, unknown>>().notNull(), proposedValues: jsonb("proposed_values").$type<Record<string, unknown>>().notNull(), executedValues: jsonb("executed_values").$type<Record<string, unknown> | null>(), sourceFingerprint: varchar("source_fingerprint", { length: 128 }).notNull(), executionState: varchar("execution_state", { length: 32 }).notNull().default("pending"), exclusionReason: varchar("exclusion_reason", { length: 1000 }), failureReason: varchar("failure_reason", { length: 1000 }), attemptCount: integer("attempt_count").notNull().default(0),
  rollbackState: varchar("rollback_state", { length: 32 }).notNull().default("not_requested"), rollbackAttemptCount: integer("rollback_attempt_count").notNull().default(0), rollbackConflictReason: varchar("rollback_conflict_reason", { length: 1000 }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("ai_product_pricing_change_set_rows_change_source_uidx").on(table.changeSetId, table.sourceOrder), index("ai_product_pricing_change_set_rows_org_change_state_idx").on(table.orgId, table.changeSetId, table.executionState), index("ai_product_pricing_change_set_rows_org_product_idx").on(table.orgId, table.productId)]);

export const aiConfigurableProductProposals = pgTable("ai_configurable_product_proposals", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")), orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), conversationId: varchar("conversation_id").references(() => aiConversations.id, { onDelete: "set null" }), actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }), specification: jsonb("specification").$type<Record<string, unknown>>().notNull(), fingerprint: varchar("fingerprint", { length: 128 }).notNull(), status: varchar("status", { length: 32 }).notNull().default("proposed"), createdProductId: varchar("created_product_id").references(() => products.id, { onDelete: "set null" }), createdPbv2TreeVersionId: varchar("created_pbv2_tree_version_id").references(() => pbv2TreeVersions.id, { onDelete: "set null" }), idempotencyKey: varchar("idempotency_key", { length: 160 }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("ai_configurable_product_proposals_org_conversation_uidx").on(table.orgId, table.conversationId), index("ai_configurable_product_proposals_org_status_idx").on(table.orgId, table.status, table.createdAt)]);
export const localFileDestinations = pgTable("local_file_destinations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`), organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), customerId: varchar("customer_id").references(() => customers.id, { onDelete: "cascade" }), destinationType: localFileDestinationTypeEnum("destination_type").notNull().default("customer_art_folder"), localPath: text("local_path").notNull(), enabled: boolean("enabled").notNull().default(true), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export const localFileCopyJobs = pgTable("local_file_copy_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`), organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), destinationId: varchar("destination_id").notNull().references(() => localFileDestinations.id, { onDelete: "cascade" }), sourceFileId: varchar("source_file_id").notNull().references(() => lineItemFiles.id, { onDelete: "restrict" }), orderId: varchar("order_id").references(() => orders.id, { onDelete: "set null" }), orderLineItemId: varchar("order_line_item_id").references(() => orderLineItems.id, { onDelete: "set null" }), customerId: varchar("customer_id").references(() => customers.id, { onDelete: "set null" }), status: localFileCopyJobStatusEnum("status").notNull().default("pending"), attempts: integer("attempts").notNull().default(0), lastError: text("last_error"), claimedByAgentId: varchar("claimed_by_agent_id").references(() => localBridgeAgents.id, { onDelete: "set null" }), claimedAt: timestamp("claimed_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }), nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }), outputFilename: varchar("output_filename", { length: 512 }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Durable membership for proof packages. The primary line_item_id on
 * line_item_proof_versions is retained for backwards compatibility and for
 * naming/version sequencing; this table is authoritative for every line item
 * covered by the customer approval artifact.
 */
export const proofVersionLineItems = pgTable("proof_version_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  proofVersionId: varchar("proof_version_id").notNull().references(() => lineItemProofVersions.id, { onDelete: 'cascade' }),
  lineItemId: varchar("line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),
  sortOrder: integer("sort_order").notNull().default(0),
  lineItemLabelSnapshot: text("line_item_label_snapshot"),
  displaySizeSnapshot: text("display_size_snapshot"),
  quantitySnapshot: decimal("quantity_snapshot", { precision: 12, scale: 3 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("proof_version_line_items_org_idx").on(table.organizationId),
  index("proof_version_line_items_order_idx").on(table.orderId),
  index("proof_version_line_items_line_item_idx").on(table.lineItemId),
  index("proof_version_line_items_version_idx").on(table.proofVersionId),
  uniqueIndex("proof_version_line_items_version_line_uidx").on(table.proofVersionId, table.lineItemId),
]);

export const lineItemProofApprovals = pgTable("line_item_proof_approvals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  lineItemId: varchar("line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),
  proofVersionId: varchar("proof_version_id").notNull().references(() => lineItemProofVersions.id, { onDelete: 'cascade' }),
  decision: lineItemProofResponseDecisionEnum("decision").notNull(),
  responseNotes: text("response_notes"),
  responderUserId: varchar("responder_user_id").references(() => users.id, { onDelete: 'set null' }),
  responderName: varchar("responder_name", { length: 255 }),
  responderEmail: varchar("responder_email", { length: 255 }),
  responderSource: varchar("responder_source", { length: 50 }).notNull().default('internal'),
  respondedAt: timestamp("responded_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("line_item_proof_approvals_org_idx").on(table.organizationId),
  index("line_item_proof_approvals_order_idx").on(table.orderId),
  index("line_item_proof_approvals_line_item_idx").on(table.lineItemId),
  index("line_item_proof_approvals_decision_idx").on(table.decision),
  uniqueIndex("line_item_proof_approvals_version_uidx").on(table.proofVersionId),
]);

export const lineItemProofManualApprovalOverrides = pgTable("line_item_proof_manual_approval_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  lineItemId: varchar("line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),
  proofVersionId: varchar("proof_version_id").notNull().references(() => lineItemProofVersions.id, { onDelete: 'cascade' }),
  source: varchar("source", { length: 50 }).notNull().default('manual_override'),
  overrideReason: text("override_reason").notNull(),
  internalNote: text("internal_note"),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: 'set null' }),
  actorName: varchar("actor_name", { length: 255 }),
  actorEmail: varchar("actor_email", { length: 255 }),
  overriddenAt: timestamp("overridden_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("line_item_proof_manual_approval_overrides_org_idx").on(table.organizationId),
  index("line_item_proof_manual_approval_overrides_order_idx").on(table.orderId),
  index("line_item_proof_manual_approval_overrides_line_item_idx").on(table.lineItemId),
  index("line_item_proof_manual_approval_overrides_created_at_idx").on(table.createdAt),
  uniqueIndex("line_item_proof_manual_approval_overrides_version_uidx").on(table.proofVersionId),
]);

export const proofAccessTokens = pgTable("proof_access_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  lineItemId: varchar("line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'cascade' }),
  proofVersionId: varchar("proof_version_id").notNull().references(() => lineItemProofVersions.id, { onDelete: 'cascade' }),
  token: varchar("token", { length: 128 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  createdBy: varchar("created_by", { length: 255 }).notNull(),
}, (table) => [
  index("proof_access_tokens_org_idx").on(table.organizationId),
  index("proof_access_tokens_line_item_idx").on(table.lineItemId),
  index("proof_access_tokens_proof_version_idx").on(table.proofVersionId),
  index("proof_access_tokens_expires_at_idx").on(table.expiresAt),
  uniqueIndex("proof_access_tokens_token_uidx").on(table.token),
]);

// Zod schemas
export const insertPrepressSessionSchema = createInsertSchema(prepressSessions).omit({
  id: true,
  startedAt: true,
  completedAt: true,
  updatedAt: true,
});

export const updatePrepressSessionSchema = insertPrepressSessionSchema.partial().extend({
  id: z.string(),
});

export const insertLineItemFileSchema = createInsertSchema(lineItemFiles);

export const updateLineItemFileSchema = insertLineItemFileSchema.partial().extend({
  id: z.string(),
});

export const insertLineItemProofVersionSchema = createInsertSchema(lineItemProofVersions).omit({
  id: true,
  versionNumber: true,
  sentAt: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Server-only resolution lifecycle for an analytical report that cannot safely
 * choose between multiple customer accounts. The candidate JSON intentionally
 * keeps the canonical company ID private to the browser; only the persistence
 * and continuation layers may inspect it.
 */
export const aiReportEntityResolutionStatusValues = [
  "awaiting_entity_resolution",
  "resolved",
  "resuming",
  "resumed",
  "expired",
  "cancelled",
  "failed",
] as const;
export type AiReportEntityResolutionStatus = (typeof aiReportEntityResolutionStatusValues)[number];

export const aiReportEntityResolutions = pgTable("ai_report_entity_resolutions", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  sourceTurnId: varchar("source_turn_id").notNull().references(() => aiTurns.id, { onDelete: "cascade" }),
  sourceMessageId: varchar("source_message_id").references(() => aiMessages.id, { onDelete: "set null" }),
  contextSnapshotId: varchar("context_snapshot_id").references(() => aiContextSnapshots.id, { onDelete: "set null" }),
  resolverVersion: varchar("resolver_version", { length: 64 }).notNull(),
  analyticalPlanVersion: varchar("analytical_plan_version", { length: 64 }).notNull(),
  originalUserRequest: text("original_user_request").notNull(),
  unresolvedCustomerReference: text("unresolved_customer_reference").notNull(),
  validatedPlanJson: jsonb("validated_plan_json").$type<Record<string, unknown>>().notNull(),
  originalContextJson: jsonb("original_context_json").$type<Record<string, unknown>>().notNull(),
  candidateSetJson: jsonb("candidate_set_json").$type<Array<Record<string, unknown>>>().notNull(),
  selectedCandidateId: varchar("selected_candidate_id", { length: 128 }),
  selectedCompanyId: varchar("selected_company_id"),
  status: text("status").$type<AiReportEntityResolutionStatus>().notNull().default("awaiting_entity_resolution"),
  version: integer("version").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resumedAt: timestamp("resumed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  failureCode: varchar("failure_code", { length: 120 }),
  continuationResultReference: varchar("continuation_result_reference", { length: 128 }),
  continuationResultJson: jsonb("continuation_result_json").$type<Record<string, unknown> | null>(),
}, (table) => [
  index("ai_report_entity_resolutions_expiry_idx").on(table.expiresAt),
  index("ai_report_entity_resolutions_active_lookup_idx").on(table.organizationId, table.userId, table.conversationId, table.status, table.expiresAt),
]);

/** Persisted, validated analytical artifacts. They store a generated data
 * snapshot and declarative report definition, never SQL or executable code. */
export const aiReports = pgTable("ai_reports", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").references(() => aiConversations.id, { onDelete: "set null" }),
  sourceTurnId: varchar("source_turn_id").references(() => aiTurns.id, { onDelete: "set null" }),
  title: varchar("title", { length: 240 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 32 }).notNull().default("ready"),
  reportType: varchar("report_type", { length: 80 }).notNull().default("analytical"),
  audience: varchar("audience", { length: 32 }).notNull().default("private"),
  definitionJson: jsonb("definition_json").$type<ReportDefinition>().notNull(),
  queryPlanJson: jsonb("query_plan_json").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  dataSnapshotJson: jsonb("data_snapshot_json").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  snapshotMetadata: jsonb("snapshot_metadata").$type<Record<string, unknown>>().notNull().default(sql.raw("'{}'::jsonb")),
  dataSnapshotAt: timestamp("data_snapshot_at", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_reports_org_status_updated_idx").on(table.organizationId, table.status, table.updatedAt),
  index("ai_reports_org_owner_updated_idx").on(table.organizationId, table.ownerUserId, table.updatedAt),
]);

export const aiReportVersions = pgTable("ai_report_versions", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  reportId: varchar("report_id").notNull().references(() => aiReports.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  definitionJson: jsonb("definition_json").$type<ReportDefinition>().notNull(),
  dataSnapshotJson: jsonb("data_snapshot_json").$type<Record<string, unknown>>().notNull(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  changeSummary: varchar("change_summary", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ai_report_versions_report_version_uidx").on(table.reportId, table.versionNumber),
  index("ai_report_versions_org_report_created_idx").on(table.organizationId, table.reportId, table.createdAt),
]);

export const aiReportShares = pgTable("ai_report_shares", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  reportId: varchar("report_id").notNull().references(() => aiReports.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 128 }).notNull(),
  audience: varchar("audience", { length: 32 }).notNull().default("customer_safe"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  downloadAllowed: boolean("download_allowed").notNull().default(false),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ai_report_shares_token_hash_uidx").on(table.tokenHash),
  index("ai_report_shares_org_report_idx").on(table.organizationId, table.reportId),
  index("ai_report_shares_expires_at_idx").on(table.expiresAt),
]);

/** Privacy-preserving access audit for a public report share. The raw token,
 * IP address, and browser identifier are never persisted here. */
export const aiReportViews = pgTable("ai_report_views", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  reportId: varchar("report_id").notNull().references(() => aiReports.id, { onDelete: "cascade" }),
  shareId: varchar("share_id").notNull().references(() => aiReportShares.id, { onDelete: "cascade" }),
  viewedAt: timestamp("viewed_at", { withTimezone: true }).defaultNow().notNull(),
  viewerHash: varchar("viewer_hash", { length: 128 }),
}, (table) => [
  index("ai_report_views_org_report_viewed_idx").on(table.organizationId, table.reportId, table.viewedAt),
  index("ai_report_views_share_viewed_idx").on(table.shareId, table.viewedAt),
]);

/**
 * Versioned, non-executable System Guide content. A null organization ID is
 * curated global PrintersHero knowledge; repositories must always select it
 * together with (or instead of) the caller's explicit organization scope.
 */
export const aiKnowledgeDocuments = pgTable("ai_knowledge_documents", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 180 }).notNull(),
  title: varchar("title", { length: 240 }).notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  summary: text("summary"),
  sourceType: varchar("source_type", { length: 64 }).notNull(),
  sourcePath: varchar("source_path", { length: 500 }),
  sourceVersion: varchar("source_version", { length: 80 }).notNull(),
  contentHash: varchar("content_hash", { length: 128 }).notNull(),
  content: text("content").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  audience: varchar("audience", { length: 32 }).notNull().default("staff"),
  permissionTags: jsonb("permission_tags").$type<string[]>().notNull().default(sql.raw("'[]'::jsonb")),
  routePatterns: jsonb("route_patterns").$type<string[]>().notNull().default(sql.raw("'[]'::jsonb")),
  entityTypes: jsonb("entity_types").$type<string[]>().notNull().default(sql.raw("'[]'::jsonb")),
  featureTags: jsonb("feature_tags").$type<string[]>().notNull().default(sql.raw("'[]'::jsonb")),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
  replacedByDocumentId: varchar("replaced_by_document_id").references((): AnyPgColumn => aiKnowledgeDocuments.id, { onDelete: "set null" }),
  indexedAt: timestamp("indexed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_knowledge_documents_scope_status_category_idx").on(table.organizationId, table.status, table.category, table.updatedAt),
  index("ai_knowledge_documents_source_path_idx").on(table.sourceType, table.sourcePath),
]);

/** Deterministic chunks used by bounded PostgreSQL lexical retrieval. */
export const aiKnowledgeChunks = pgTable("ai_knowledge_chunks", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  documentId: varchar("document_id").notNull().references(() => aiKnowledgeDocuments.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  headingPath: text("heading_path"),
  content: text("content").notNull(),
  contentHash: varchar("content_hash", { length: 128 }).notNull(),
  tokenEstimate: integer("token_estimate").notNull().default(0),
  embeddingModel: varchar("embedding_model", { length: 160 }),
  embeddingVersion: varchar("embedding_version", { length: 80 }),
  // Generated tsvector is deliberately queried through sql in the repository.
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ai_knowledge_chunks_document_index_uidx").on(table.documentId, table.chunkIndex),
  index("ai_knowledge_chunks_document_idx").on(table.documentId, table.chunkIndex),
]);

export const aiKnowledgeSyncRuns = pgTable("ai_knowledge_sync_runs", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  sourceType: varchar("source_type", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("running"),
  dryRun: boolean("dry_run").notNull().default(false),
  sourceVersion: varchar("source_version", { length: 80 }),
  documentsDiscovered: integer("documents_discovered").notNull().default(0),
  documentsCreated: integer("documents_created").notNull().default(0),
  documentsUpdated: integer("documents_updated").notNull().default(0),
  documentsDeprecated: integer("documents_deprecated").notNull().default(0),
  chunksWritten: integer("chunks_written").notNull().default(0),
  errorSummary: varchar("error_summary", { length: 1000 }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_knowledge_sync_runs_scope_started_idx").on(table.organizationId, table.startedAt),
]);

export const aiKnowledgeFeedback = pgTable("ai_knowledge_feedback", {
  id: varchar("id").primaryKey().default(sql.raw("gen_random_uuid()")),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  conversationId: varchar("conversation_id").references(() => aiConversations.id, { onDelete: "set null" }),
  documentIds: jsonb("document_ids").$type<string[]>().notNull().default(sql.raw("'[]'::jsonb")),
  questionCategory: varchar("question_category", { length: 80 }),
  feedbackType: varchar("feedback_type", { length: 32 }).notNull(),
  comment: varchar("comment", { length: 2000 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_knowledge_feedback_org_created_idx").on(table.organizationId, table.createdAt),
  index("ai_knowledge_feedback_org_type_created_idx").on(table.organizationId, table.feedbackType, table.createdAt),
]);

export const insertProofVersionLineItemSchema = createInsertSchema(proofVersionLineItems).omit({
  id: true,
  createdAt: true,
});

export const updateLineItemProofVersionSchema = insertLineItemProofVersionSchema.partial().extend({
  id: z.string(),
});

export const insertLineItemProofApprovalSchema = createInsertSchema(lineItemProofApprovals).omit({
  id: true,
  respondedAt: true,
  createdAt: true,
});

export const updateLineItemProofApprovalSchema = insertLineItemProofApprovalSchema.partial().extend({
  id: z.string(),
});

export const insertLineItemProofManualApprovalOverrideSchema = createInsertSchema(lineItemProofManualApprovalOverrides).omit({
  id: true,
  source: true,
  overriddenAt: true,
  createdAt: true,
});

export const updateLineItemProofManualApprovalOverrideSchema = insertLineItemProofManualApprovalOverrideSchema.partial().extend({
  id: z.string(),
});

export const insertProofAccessTokenSchema = createInsertSchema(proofAccessTokens).omit({
  id: true,
  revokedAt: true,
  createdAt: true,
});

export const updateProofAccessTokenSchema = insertProofAccessTokenSchema.partial().extend({
  id: z.string(),
});

// Types
export type PrepressSession = typeof prepressSessions.$inferSelect;
export type InsertPrepressSession = z.infer<typeof insertPrepressSessionSchema>;
export type UpdatePrepressSession = z.infer<typeof updatePrepressSessionSchema>;

export type LineItemFile = typeof lineItemFiles.$inferSelect;
export type InsertLineItemFile = z.infer<typeof insertLineItemFileSchema>;
export type UpdateLineItemFile = z.infer<typeof updateLineItemFileSchema>;

export type LineItemProofVersion = typeof lineItemProofVersions.$inferSelect;
export type InsertLineItemProofVersion = z.infer<typeof insertLineItemProofVersionSchema>;
export type UpdateLineItemProofVersion = z.infer<typeof updateLineItemProofVersionSchema>;

export type ProofVersionLineItem = typeof proofVersionLineItems.$inferSelect;
export type InsertProofVersionLineItem = z.infer<typeof insertProofVersionLineItemSchema>;

export type LineItemProofApproval = typeof lineItemProofApprovals.$inferSelect;
export type InsertLineItemProofApproval = z.infer<typeof insertLineItemProofApprovalSchema>;
export type UpdateLineItemProofApproval = z.infer<typeof updateLineItemProofApprovalSchema>;

export type LineItemProofManualApprovalOverride = typeof lineItemProofManualApprovalOverrides.$inferSelect;
export type InsertLineItemProofManualApprovalOverride = z.infer<typeof insertLineItemProofManualApprovalOverrideSchema>;
export type UpdateLineItemProofManualApprovalOverride = z.infer<typeof updateLineItemProofManualApprovalOverrideSchema>;

export type ProofAccessToken = typeof proofAccessTokens.$inferSelect;
export type InsertProofAccessToken = z.infer<typeof insertProofAccessTokenSchema>;
export type UpdateProofAccessToken = z.infer<typeof updateProofAccessTokenSchema>;

// ============================================================
// TITANOS INBOUND ORDERS REVIEW QUEUE FOUNDATION
// ============================================================

export const inboundOrderSourceTypeValues = [
  "email",
  "customer_api",
  "webhook",
  "csv_import",
  "portal",
  "manual",
  "n8n",
  "zapier",
  "edi",
] as const;

export const inboundOrderSourceStatusValues = [
  "active",
  "paused",
  "disabled",
] as const;

export const inboundOrderSourceTrustLevelValues = [
  "manual_internal",
  "trusted_customer_api",
  "trusted_portal",
  "semi_trusted_email",
  "untrusted_public",
] as const;

export const inboundOrderRecordStatusValues = [
  "received",
  "processing",
  "needs_review",
  "waiting_on_customer",
  "ready",
  "approved",
  "submitted",
  "failed",
  "terminal",
  "ignored",
] as const;

export const inboundOrderLineItemStatusValues = [
  "extracted",
  "needs_review",
  "validated",
  "excluded",
] as const;

export const inboundOrderFileRoleValues = [
  "artwork",
  "po",
  "reference",
  "email_attachment",
  "csv",
  "source_payload",
  "other",
] as const;

export const inboundOrderFileStatusValues = [
  "uploaded",
  "scanning",
  "available",
  "quarantined",
  "rejected",
  "linked",
] as const;

export const inboundOrderWarningSeverityValues = [
  "info",
  "warning",
  "blocking",
] as const;

export const inboundOrderReviewItemStatusValues = [
  "open",
  "resolved",
  "ignored",
] as const;

export const inboundOrderDecisionFlagStatusValues = [
  "open",
  "accepted",
  "overridden",
  "dismissed",
] as const;

export const inboundOrderEventActorTypeValues = [
  "user",
  "system",
  "source",
  "automation",
] as const;

export const inboundOrderReviewSnapshotTypeValues = [
  "approval",
  "submission",
  "rejection",
  "customer_reply",
] as const;

export const inboundOrderParseAttemptStatusValues = [
  "success",
  "failed",
  "repaired",
  "fallback",
] as const;

export const inboundEmailIgnoreRuleTypeValues = [
  "sender_email_exact",
  "sender_domain",
  "subject_exact",
  "subject_contains",
] as const;

export const inboundEmailTrustRuleTypeValues = [
  "sender_email_exact",
  "sender_domain",
  "customer_contact_email",
  "customer_domain",
] as const;

export const inboundAttachmentClassificationRuleMatchTypeValues = [
  "filename_contains",
  "filename_starts_with",
  "filename_ends_with",
  "filename_exact",
  "mime_type",
] as const;

export const inboundAttachmentClassificationRuleClassificationValues = [
  "artwork",
  "purchase_order",
  "reference",
  "junk_signature",
  "ignore",
] as const;

export const inboundOrderSourceTypeSchema = z.enum(inboundOrderSourceTypeValues);
export const inboundOrderSourceStatusSchema = z.enum(inboundOrderSourceStatusValues);
export const inboundOrderSourceTrustLevelSchema = z.enum(inboundOrderSourceTrustLevelValues);
export const inboundOrderRecordStatusSchema = z.enum(inboundOrderRecordStatusValues);
export const inboundOrderLineItemStatusSchema = z.enum(inboundOrderLineItemStatusValues);
export const inboundOrderFileRoleSchema = z.enum(inboundOrderFileRoleValues);
export const inboundOrderFileStatusSchema = z.enum(inboundOrderFileStatusValues);
export const inboundOrderWarningSeveritySchema = z.enum(inboundOrderWarningSeverityValues);
export const inboundOrderReviewItemStatusSchema = z.enum(inboundOrderReviewItemStatusValues);
export const inboundOrderDecisionFlagStatusSchema = z.enum(inboundOrderDecisionFlagStatusValues);
export const inboundOrderEventActorTypeSchema = z.enum(inboundOrderEventActorTypeValues);
export const inboundOrderReviewSnapshotTypeSchema = z.enum(inboundOrderReviewSnapshotTypeValues);
export const inboundOrderParseAttemptStatusSchema = z.enum(inboundOrderParseAttemptStatusValues);
export const inboundEmailIgnoreRuleTypeSchema = z.enum(inboundEmailIgnoreRuleTypeValues);
export const inboundEmailTrustRuleTypeSchema = z.enum(inboundEmailTrustRuleTypeValues);
export const inboundAttachmentClassificationRuleMatchTypeSchema = z.enum(inboundAttachmentClassificationRuleMatchTypeValues);
export const inboundAttachmentClassificationRuleClassificationSchema = z.enum(inboundAttachmentClassificationRuleClassificationValues);

export type InboundOrderSourceType = (typeof inboundOrderSourceTypeValues)[number];
export type InboundOrderSourceStatus = (typeof inboundOrderSourceStatusValues)[number];
export type InboundOrderSourceTrustLevel = (typeof inboundOrderSourceTrustLevelValues)[number];
export type InboundOrderRecordStatus = (typeof inboundOrderRecordStatusValues)[number];
export type InboundOrderLineItemStatus = (typeof inboundOrderLineItemStatusValues)[number];
export type InboundOrderFileRole = (typeof inboundOrderFileRoleValues)[number];
export type InboundOrderFileStatus = (typeof inboundOrderFileStatusValues)[number];
export type InboundOrderWarningSeverity = (typeof inboundOrderWarningSeverityValues)[number];
export type InboundOrderReviewItemStatus = (typeof inboundOrderReviewItemStatusValues)[number];
export type InboundOrderDecisionFlagStatus = (typeof inboundOrderDecisionFlagStatusValues)[number];
export type InboundOrderEventActorType = (typeof inboundOrderEventActorTypeValues)[number];
export type InboundOrderReviewSnapshotType = (typeof inboundOrderReviewSnapshotTypeValues)[number];
export type InboundOrderParseAttemptStatus = (typeof inboundOrderParseAttemptStatusValues)[number];
export type InboundEmailIgnoreRuleType = (typeof inboundEmailIgnoreRuleTypeValues)[number];
export type InboundEmailTrustRuleType = (typeof inboundEmailTrustRuleTypeValues)[number];
export type InboundAttachmentClassificationRuleMatchType = (typeof inboundAttachmentClassificationRuleMatchTypeValues)[number];
export type InboundAttachmentClassificationRuleClassification = (typeof inboundAttachmentClassificationRuleClassificationValues)[number];

export const inboundOrderSourceTypeEnum = pgEnum("inbound_order_source_type", inboundOrderSourceTypeValues);
export const inboundOrderSourceStatusEnum = pgEnum("inbound_order_source_status", inboundOrderSourceStatusValues);
export const inboundOrderSourceTrustLevelEnum = pgEnum("inbound_order_source_trust_level", inboundOrderSourceTrustLevelValues);
export const inboundOrderRecordStatusEnum = pgEnum("inbound_order_record_status", inboundOrderRecordStatusValues);
export const inboundOrderLineItemStatusEnum = pgEnum("inbound_order_line_item_status", inboundOrderLineItemStatusValues);
export const inboundOrderFileRoleEnum = pgEnum("inbound_order_file_role", inboundOrderFileRoleValues);
export const inboundOrderFileStatusEnum = pgEnum("inbound_order_file_status", inboundOrderFileStatusValues);
export const inboundOrderWarningSeverityEnum = pgEnum("inbound_order_warning_severity", inboundOrderWarningSeverityValues);
export const inboundOrderReviewItemStatusEnum = pgEnum("inbound_order_review_item_status", inboundOrderReviewItemStatusValues);
export const inboundOrderDecisionFlagStatusEnum = pgEnum("inbound_order_decision_flag_status", inboundOrderDecisionFlagStatusValues);
export const inboundOrderEventActorTypeEnum = pgEnum("inbound_order_event_actor_type", inboundOrderEventActorTypeValues);
export const inboundOrderReviewSnapshotTypeEnum = pgEnum("inbound_order_review_snapshot_type", inboundOrderReviewSnapshotTypeValues);
export const inboundOrderParseAttemptStatusEnum = pgEnum("inbound_order_parse_attempt_status", inboundOrderParseAttemptStatusValues);
export const inboundAttachmentClassificationRuleMatchTypeEnum = pgEnum(
  "inbound_attachment_classification_rule_match_type",
  inboundAttachmentClassificationRuleMatchTypeValues,
);
export const inboundAttachmentClassificationRuleClassificationEnum = pgEnum(
  "inbound_attachment_classification_rule_classification",
  inboundAttachmentClassificationRuleClassificationValues,
);

export const inboundOrderSources = pgTable("inbound_order_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceType: inboundOrderSourceTypeEnum("source_type").notNull().default("manual"),
  name: varchar("name", { length: 255 }).notNull(),
  status: inboundOrderSourceStatusEnum("status").notNull().default("active"),
  sourceTrustLevel: inboundOrderSourceTrustLevelEnum("source_trust_level").notNull().default("manual_internal"),
  authMode: varchar("auth_mode", { length: 50 }).notNull().default("system"),
  externalAccountId: varchar("external_account_id", { length: 255 }),
  settingsJson: jsonb("settings_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("inbound_order_sources_org_type_idx").on(table.organizationId, table.sourceType),
  index("inbound_order_sources_org_status_idx").on(table.organizationId, table.status),
  index("inbound_order_sources_org_trust_idx").on(table.organizationId, table.sourceTrustLevel),
  uniqueIndex("inbound_order_sources_org_type_name_uidx").on(table.organizationId, table.sourceType, table.name),
]);

export const inboundEmailMailboxes = pgTable("inbound_email_mailboxes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceId: varchar("source_id").references(() => inboundOrderSources.id, { onDelete: "set null" }),
  provider: varchar("provider", { length: 50 }).notNull().default("gmail"),
  name: varchar("name", { length: 255 }).notNull(),
  emailAddress: varchar("email_address", { length: 255 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(true),
  authJson: jsonb("auth_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  settingsJson: jsonb("settings_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  lastPulledAt: timestamp("last_pulled_at", { withTimezone: true }),
  lastPullStatus: varchar("last_pull_status", { length: 50 }),
  lastPullError: text("last_pull_error"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("inbound_email_mailboxes_org_enabled_idx").on(table.organizationId, table.enabled),
  index("inbound_email_mailboxes_org_provider_idx").on(table.organizationId, table.provider),
  index("inbound_email_mailboxes_org_source_idx").on(table.organizationId, table.sourceId),
  uniqueIndex("inbound_email_mailboxes_org_email_uidx").on(table.organizationId, table.emailAddress),
]);

export const inboundEmailIgnoreRules = pgTable("inbound_email_ignore_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  ruleType: varchar("rule_type", { length: 50 }).$type<InboundEmailIgnoreRuleType>().notNull(),
  ruleValue: varchar("rule_value", { length: 500 }).notNull(),
  notes: text("notes"),
  matchCount: integer("match_count").notNull().default(0),
  lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("inbound_email_ignore_rules_org_enabled_idx").on(table.organizationId, table.enabled),
  index("inbound_email_ignore_rules_org_type_value_idx").on(table.organizationId, table.ruleType, table.ruleValue),
  uniqueIndex("inbound_email_ignore_rules_org_type_value_uidx").on(table.organizationId, table.ruleType, table.ruleValue),
]);

export const inboundEmailTrustRules = pgTable("inbound_email_trust_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  ruleType: varchar("rule_type", { length: 50 }).$type<InboundEmailTrustRuleType>().notNull(),
  ruleValue: varchar("rule_value", { length: 500 }).notNull(),
  notes: text("notes"),
  matchCount: integer("match_count").notNull().default(0),
  lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("inbound_email_trust_rules_org_enabled_idx").on(table.organizationId, table.enabled),
  index("inbound_email_trust_rules_org_type_value_idx").on(table.organizationId, table.ruleType, table.ruleValue),
  uniqueIndex("inbound_email_trust_rules_org_type_value_uidx").on(table.organizationId, table.ruleType, table.ruleValue),
]);

export const inboundAttachmentClassificationRules = pgTable("inbound_attachment_classification_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  customerId: varchar("customer_id").references(() => customers.id, { onDelete: "cascade" }),
  senderDomain: varchar("sender_domain", { length: 255 }),
  matchType: inboundAttachmentClassificationRuleMatchTypeEnum("match_type").notNull(),
  matchValue: text("match_value").notNull(),
  classification: inboundAttachmentClassificationRuleClassificationEnum("classification").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  matchCount: integer("match_count").notNull().default(0),
  lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("inbound_attachment_class_rules_org_enabled_idx").on(table.organizationId, table.enabled),
  index("inbound_attachment_class_rules_org_customer_idx").on(table.organizationId, table.customerId, table.enabled),
  index("inbound_attachment_class_rules_org_sender_domain_idx").on(table.organizationId, table.senderDomain, table.enabled),
  index("inbound_attachment_class_rules_org_match_idx").on(table.organizationId, table.matchType, table.matchValue),
]);

export const inboundOrderRecords = pgTable("inbound_order_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceId: varchar("source_id").references(() => inboundOrderSources.id, { onDelete: "set null" }),
  sourceType: inboundOrderSourceTypeEnum("source_type").notNull().default("manual"),
  sourceLabel: varchar("source_label", { length: 255 }),
  sourceTrustLevel: inboundOrderSourceTrustLevelEnum("source_trust_level").notNull().default("manual_internal"),
  sourceRecordId: varchar("source_record_id", { length: 255 }),
  sourceMessageId: varchar("source_message_id", { length: 255 }),
  status: inboundOrderRecordStatusEnum("status").notNull().default("received"),
  reviewOutcome: varchar("review_outcome", { length: 50 }),
  requiresHumanDecision: boolean("requires_human_decision").notNull().default(false),
  reviewRequiredReason: text("review_required_reason"),
  externalReference: varchar("external_reference", { length: 255 }),
  idempotencyKey: varchar("idempotency_key", { length: 255 }),
  payloadHash: varchar("payload_hash", { length: 128 }),
  rawPayloadJson: jsonb("raw_payload_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  normalizedPayloadJson: jsonb("normalized_payload_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  extractedCustomerJson: jsonb("extracted_customer_json").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  extractedOrderJson: jsonb("extracted_order_json").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  extractedShippingJson: jsonb("extracted_shipping_json").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  confidenceScore: decimal("confidence_score", { precision: 5, scale: 4 }),
  duplicateScore: decimal("duplicate_score", { precision: 5, scale: 4 }),
  matchedCustomerId: varchar("matched_customer_id").references(() => customers.id, { onDelete: "set null" }),
  matchedContactId: varchar("matched_contact_id").references(() => customerContacts.id, { onDelete: "set null" }),
  matchedQuoteId: varchar("matched_quote_id").references(() => quotes.id, { onDelete: "set null" }),
  matchedOrderId: varchar("matched_order_id").references(() => orders.id, { onDelete: "set null" }),
  createdQuoteId: varchar("created_quote_id").references(() => quotes.id, { onDelete: "set null" }),
  createdOrderId: varchar("created_order_id").references(() => orders.id, { onDelete: "set null" }),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  submittedByUserId: varchar("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  rejectedByUserId: varchar("rejected_by_user_id").references(() => users.id, { onDelete: "set null" }),
  rejectionReason: text("rejection_reason"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  parsedAt: timestamp("parsed_at", { withTimezone: true }),
  reviewStartedAt: timestamp("review_started_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("inbound_order_records_org_status_received_idx").on(table.organizationId, table.status, table.receivedAt),
  index("inbound_order_records_org_source_type_received_idx").on(table.organizationId, table.sourceType, table.receivedAt),
  index("inbound_order_records_org_assigned_status_idx").on(table.organizationId, table.assignedToUserId, table.status),
  index("inbound_order_records_org_source_idx").on(table.organizationId, table.sourceId),
  index("inbound_order_records_org_matched_customer_idx").on(table.organizationId, table.matchedCustomerId),
  index("inbound_order_records_org_created_quote_idx").on(table.organizationId, table.createdQuoteId),
  index("inbound_order_records_org_created_order_idx").on(table.organizationId, table.createdOrderId),
  index("inbound_order_records_org_payload_hash_idx").on(table.organizationId, table.payloadHash),
  index("inbound_order_records_org_external_ref_idx").on(table.organizationId, table.externalReference),
  uniqueIndex("inbound_order_records_org_source_idempotency_uidx").on(table.organizationId, table.sourceId, table.idempotencyKey),
]);

export const inboundOrderLineItems = pgTable("inbound_order_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  inboundRecordId: varchar("inbound_record_id").notNull().references(() => inboundOrderRecords.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  status: inboundOrderLineItemStatusEnum("status").notNull().default("extracted"),
  rawLineJson: jsonb("raw_line_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  normalizedLineJson: jsonb("normalized_line_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  productId: varchar("product_id").references(() => products.id, { onDelete: "set null" }),
  variantId: varchar("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
  productNameRaw: text("product_name_raw"),
  description: text("description"),
  width: decimal("width", { precision: 10, scale: 2 }),
  height: decimal("height", { precision: 10, scale: 2 }),
  quantity: integer("quantity"),
  optionSelectionsJson: jsonb("option_selections_json").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  pbv2TreeVersionId: varchar("pbv2_tree_version_id").references(() => pbv2TreeVersions.id, { onDelete: "set null" }),
  pricingPreviewJson: jsonb("pricing_preview_json").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  confidenceScore: decimal("confidence_score", { precision: 5, scale: 4 }),
  warningsJson: jsonb("warnings_json").$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'::jsonb`),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdQuoteLineItemId: varchar("created_quote_line_item_id").references(() => quoteLineItems.id, { onDelete: "set null" }),
  createdOrderLineItemId: varchar("created_order_line_item_id").references(() => orderLineItems.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("inbound_order_line_items_org_record_sort_idx").on(table.organizationId, table.inboundRecordId, table.sortOrder),
  index("inbound_order_line_items_org_product_idx").on(table.organizationId, table.productId),
  index("inbound_order_line_items_org_status_idx").on(table.organizationId, table.status),
]);

export const inboundOrderFiles = pgTable("inbound_order_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  inboundRecordId: varchar("inbound_record_id").notNull().references(() => inboundOrderRecords.id, { onDelete: "cascade" }),
  inboundLineItemId: varchar("inbound_line_item_id").references(() => inboundOrderLineItems.id, { onDelete: "set null" }),
  fileRecordId: varchar("file_record_id").references(() => fileRecords.id, { onDelete: "set null" }),
  sourceFilename: varchar("source_filename", { length: 512 }),
  role: inboundOrderFileRoleEnum("role").notNull().default("other"),
  mimeType: varchar("mime_type", { length: 255 }),
  sizeBytes: integer("size_bytes"),
  checksum: varchar("checksum", { length: 128 }),
  status: inboundOrderFileStatusEnum("status").notNull().default("uploaded"),
  providerAttachmentId: text("provider_attachment_id"),
  providerMessageId: text("provider_message_id"),
  contentDisposition: varchar("content_disposition", { length: 100 }),
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  reviewNotes: text("review_notes"),
  createdQuoteAttachmentId: varchar("created_quote_attachment_id").references(() => quoteAttachments.id, { onDelete: "set null" }),
  createdOrderAttachmentId: varchar("created_order_attachment_id").references(() => orderAttachments.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("inbound_order_files_org_record_idx").on(table.organizationId, table.inboundRecordId),
  index("inbound_order_files_org_line_item_idx").on(table.organizationId, table.inboundLineItemId),
  index("inbound_order_files_org_file_record_idx").on(table.organizationId, table.fileRecordId),
  index("inbound_order_files_org_status_idx").on(table.organizationId, table.status),
  index("inbound_order_files_org_checksum_idx").on(table.organizationId, table.checksum),
]);

export const inboundOrderWarnings = pgTable("inbound_order_warnings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  inboundRecordId: varchar("inbound_record_id").notNull().references(() => inboundOrderRecords.id, { onDelete: "cascade" }),
  inboundLineItemId: varchar("inbound_line_item_id").references(() => inboundOrderLineItems.id, { onDelete: "set null" }),
  severity: inboundOrderWarningSeverityEnum("severity").notNull().default("warning"),
  code: varchar("code", { length: 100 }).notNull(),
  message: text("message").notNull(),
  fieldPath: text("field_path"),
  status: inboundOrderReviewItemStatusEnum("status").notNull().default("open"),
  resolutionNote: text("resolution_note"),
  resolvedByUserId: varchar("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => [
  index("inbound_order_warnings_org_record_status_idx").on(table.organizationId, table.inboundRecordId, table.status),
  index("inbound_order_warnings_org_severity_status_idx").on(table.organizationId, table.severity, table.status),
  index("inbound_order_warnings_org_code_idx").on(table.organizationId, table.code),
  index("inbound_order_warnings_org_line_item_idx").on(table.organizationId, table.inboundLineItemId),
]);

export const inboundOrderDecisionFlags = pgTable("inbound_order_decision_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  inboundRecordId: varchar("inbound_record_id").notNull().references(() => inboundOrderRecords.id, { onDelete: "cascade" }),
  inboundLineItemId: varchar("inbound_line_item_id").references(() => inboundOrderLineItems.id, { onDelete: "set null" }),
  flagType: varchar("flag_type", { length: 100 }).notNull(),
  fieldPath: text("field_path"),
  summary: text("summary").notNull(),
  suggestedValueJson: jsonb("suggested_value_json").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  candidateValuesJson: jsonb("candidate_values_json").$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'::jsonb`),
  confidenceScore: decimal("confidence_score", { precision: 5, scale: 4 }),
  status: inboundOrderDecisionFlagStatusEnum("status").notNull().default("open"),
  decisionValueJson: jsonb("decision_value_json").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  decisionNote: text("decision_note"),
  decidedByUserId: varchar("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (table) => [
  index("inbound_order_decision_flags_org_record_status_idx").on(table.organizationId, table.inboundRecordId, table.status),
  index("inbound_order_decision_flags_org_type_status_idx").on(table.organizationId, table.flagType, table.status),
  index("inbound_order_decision_flags_org_confidence_idx").on(table.organizationId, table.confidenceScore),
  index("inbound_order_decision_flags_org_line_item_idx").on(table.organizationId, table.inboundLineItemId),
]);

export const inboundOrderEvents = pgTable("inbound_order_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  inboundRecordId: varchar("inbound_record_id").notNull().references(() => inboundOrderRecords.id, { onDelete: "cascade" }),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorType: inboundOrderEventActorTypeEnum("actor_type").notNull().default("system"),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  fromStatus: inboundOrderRecordStatusEnum("from_status"),
  toStatus: inboundOrderRecordStatusEnum("to_status"),
  message: text("message"),
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("inbound_order_events_org_record_created_idx").on(table.organizationId, table.inboundRecordId, table.createdAt),
  index("inbound_order_events_org_type_created_idx").on(table.organizationId, table.eventType, table.createdAt),
]);

export const inboundOrderReviewSnapshots = pgTable("inbound_order_review_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  inboundRecordId: varchar("inbound_record_id").notNull().references(() => inboundOrderRecords.id, { onDelete: "cascade" }),
  snapshotType: inboundOrderReviewSnapshotTypeEnum("snapshot_type").notNull(),
  snapshotVersion: integer("snapshot_version").notNull().default(1),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("inbound_order_review_snapshots_org_record_created_idx").on(table.organizationId, table.inboundRecordId, table.createdAt),
  index("inbound_order_review_snapshots_org_type_created_idx").on(table.organizationId, table.snapshotType, table.createdAt),
]);

export const inboundOrderParseAttempts = pgTable("inbound_order_parse_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  inboundOrderRecordId: varchar("inbound_order_record_id").notNull().references(() => inboundOrderRecords.id, { onDelete: "cascade" }),
  status: inboundOrderParseAttemptStatusEnum("status").notNull(),
  provider: varchar("provider", { length: 100 }),
  model: varchar("model", { length: 160 }),
  rawPromptHash: varchar("raw_prompt_hash", { length: 128 }),
  rawResponse: jsonb("raw_response").$type<Record<string, unknown> | null>(),
  repairedResponse: jsonb("repaired_response").$type<Record<string, unknown> | null>(),
  parsedDraft: jsonb("parsed_draft").$type<Record<string, unknown> | null>(),
  confidence: integer("confidence"),
  warnings: jsonb("warnings").$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'::jsonb`),
  errors: jsonb("errors").$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("inbound_order_parse_attempts_org_record_created_idx").on(table.organizationId, table.inboundOrderRecordId, table.createdAt),
  index("inbound_order_parse_attempts_org_status_created_idx").on(table.organizationId, table.status, table.createdAt),
]);

export const inboundOrderSourcesRelations = relations(inboundOrderSources, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [inboundOrderSources.organizationId],
    references: [organizations.id],
  }),
  records: many(inboundOrderRecords),
}));

export const inboundOrderRecordsRelations = relations(inboundOrderRecords, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [inboundOrderRecords.organizationId],
    references: [organizations.id],
  }),
  source: one(inboundOrderSources, {
    fields: [inboundOrderRecords.sourceId],
    references: [inboundOrderSources.id],
  }),
  lineItems: many(inboundOrderLineItems),
  files: many(inboundOrderFiles),
  warnings: many(inboundOrderWarnings),
  decisionFlags: many(inboundOrderDecisionFlags),
  events: many(inboundOrderEvents),
  reviewSnapshots: many(inboundOrderReviewSnapshots),
  parseAttempts: many(inboundOrderParseAttempts),
}));

export const inboundOrderLineItemsRelations = relations(inboundOrderLineItems, ({ one, many }) => ({
  record: one(inboundOrderRecords, {
    fields: [inboundOrderLineItems.inboundRecordId],
    references: [inboundOrderRecords.id],
  }),
  product: one(products, {
    fields: [inboundOrderLineItems.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [inboundOrderLineItems.variantId],
    references: [productVariants.id],
  }),
  files: many(inboundOrderFiles),
  warnings: many(inboundOrderWarnings),
  decisionFlags: many(inboundOrderDecisionFlags),
}));

export const inboundOrderFilesRelations = relations(inboundOrderFiles, ({ one }) => ({
  record: one(inboundOrderRecords, {
    fields: [inboundOrderFiles.inboundRecordId],
    references: [inboundOrderRecords.id],
  }),
  lineItem: one(inboundOrderLineItems, {
    fields: [inboundOrderFiles.inboundLineItemId],
    references: [inboundOrderLineItems.id],
  }),
  fileRecord: one(fileRecords, {
    fields: [inboundOrderFiles.fileRecordId],
    references: [fileRecords.id],
  }),
}));

export const inboundOrderWarningsRelations = relations(inboundOrderWarnings, ({ one }) => ({
  record: one(inboundOrderRecords, {
    fields: [inboundOrderWarnings.inboundRecordId],
    references: [inboundOrderRecords.id],
  }),
  lineItem: one(inboundOrderLineItems, {
    fields: [inboundOrderWarnings.inboundLineItemId],
    references: [inboundOrderLineItems.id],
  }),
}));

export const inboundOrderDecisionFlagsRelations = relations(inboundOrderDecisionFlags, ({ one }) => ({
  record: one(inboundOrderRecords, {
    fields: [inboundOrderDecisionFlags.inboundRecordId],
    references: [inboundOrderRecords.id],
  }),
  lineItem: one(inboundOrderLineItems, {
    fields: [inboundOrderDecisionFlags.inboundLineItemId],
    references: [inboundOrderLineItems.id],
  }),
}));

export const inboundOrderEventsRelations = relations(inboundOrderEvents, ({ one }) => ({
  record: one(inboundOrderRecords, {
    fields: [inboundOrderEvents.inboundRecordId],
    references: [inboundOrderRecords.id],
  }),
}));

export const inboundOrderReviewSnapshotsRelations = relations(inboundOrderReviewSnapshots, ({ one }) => ({
  record: one(inboundOrderRecords, {
    fields: [inboundOrderReviewSnapshots.inboundRecordId],
    references: [inboundOrderRecords.id],
  }),
}));

export const inboundOrderParseAttemptsRelations = relations(inboundOrderParseAttempts, ({ one }) => ({
  record: one(inboundOrderRecords, {
    fields: [inboundOrderParseAttempts.inboundOrderRecordId],
    references: [inboundOrderRecords.id],
  }),
}));

export const insertInboundOrderSourceSchema = createInsertSchema(inboundOrderSources).omit({
  id: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  sourceType: inboundOrderSourceTypeSchema.default("manual"),
  status: inboundOrderSourceStatusSchema.default("active"),
  sourceTrustLevel: inboundOrderSourceTrustLevelSchema.default("manual_internal"),
});

export const updateInboundOrderSourceSchema = insertInboundOrderSourceSchema.partial().extend({
  id: z.string(),
});

export const insertInboundEmailMailboxSchema = createInsertSchema(inboundEmailMailboxes).omit({
  id: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  provider: z.enum(["gmail"]).default("gmail"),
  name: z.string().trim().min(1).max(255),
  emailAddress: z.string().email(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(true),
});

export const updateInboundEmailMailboxSchema = insertInboundEmailMailboxSchema.partial().extend({
  id: z.string(),
});

export const insertInboundEmailIgnoreRuleSchema = createInsertSchema(inboundEmailIgnoreRules).omit({
  id: true,
  organizationId: true,
  matchCount: true,
  lastMatchedAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  enabled: z.boolean().default(true),
  ruleType: inboundEmailIgnoreRuleTypeSchema,
  ruleValue: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const updateInboundEmailIgnoreRuleSchema = insertInboundEmailIgnoreRuleSchema.partial().extend({
  id: z.string(),
});

export const insertInboundEmailTrustRuleSchema = createInsertSchema(inboundEmailTrustRules).omit({
  id: true,
  organizationId: true,
  matchCount: true,
  lastMatchedAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  enabled: z.boolean().default(true),
  ruleType: inboundEmailTrustRuleTypeSchema,
  ruleValue: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const updateInboundEmailTrustRuleSchema = insertInboundEmailTrustRuleSchema.partial().extend({
  id: z.string(),
});

export const insertInboundAttachmentClassificationRuleSchema = createInsertSchema(inboundAttachmentClassificationRules).omit({
  id: true,
  organizationId: true,
  matchCount: true,
  lastMatchedAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  enabled: z.boolean().default(true),
  customerId: z.string().trim().min(1).optional().nullable(),
  senderDomain: z.string().trim().min(1).max(255).optional().nullable(),
  matchType: inboundAttachmentClassificationRuleMatchTypeSchema,
  matchValue: z.string().trim().min(1).max(500),
  classification: inboundAttachmentClassificationRuleClassificationSchema,
});

export const updateInboundAttachmentClassificationRuleSchema = insertInboundAttachmentClassificationRuleSchema.partial().extend({
  id: z.string(),
});

export const insertInboundOrderRecordSchema = createInsertSchema(inboundOrderRecords).omit({
  id: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  sourceType: inboundOrderSourceTypeSchema.default("manual"),
  sourceTrustLevel: inboundOrderSourceTrustLevelSchema.default("manual_internal"),
  status: inboundOrderRecordStatusSchema.default("received"),
  requiresHumanDecision: z.boolean().default(false),
});

export const updateInboundOrderRecordSchema = insertInboundOrderRecordSchema.partial().extend({
  id: z.string(),
});

export const insertInboundOrderLineItemSchema = createInsertSchema(inboundOrderLineItems).omit({
  id: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  sortOrder: z.coerce.number().int().default(0),
  status: inboundOrderLineItemStatusSchema.default("extracted"),
  width: z.coerce.number().positive().optional().nullable(),
  height: z.coerce.number().positive().optional().nullable(),
  quantity: z.coerce.number().int().positive().optional().nullable(),
});

export const updateInboundOrderLineItemSchema = insertInboundOrderLineItemSchema.partial().extend({
  id: z.string(),
});

export const insertInboundOrderFileSchema = createInsertSchema(inboundOrderFiles).omit({
  id: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  role: inboundOrderFileRoleSchema.default("other"),
  status: inboundOrderFileStatusSchema.default("uploaded"),
});

export const updateInboundOrderFileSchema = insertInboundOrderFileSchema.partial().extend({
  id: z.string(),
});

export const insertInboundOrderWarningSchema = createInsertSchema(inboundOrderWarnings).omit({
  id: true,
  organizationId: true,
  createdAt: true,
  resolvedAt: true,
}).extend({
  severity: inboundOrderWarningSeveritySchema.default("warning"),
  status: inboundOrderReviewItemStatusSchema.default("open"),
});

export const updateInboundOrderWarningSchema = insertInboundOrderWarningSchema.partial().extend({
  id: z.string(),
});

export const insertInboundOrderDecisionFlagSchema = createInsertSchema(inboundOrderDecisionFlags).omit({
  id: true,
  organizationId: true,
  createdAt: true,
  decidedAt: true,
}).extend({
  status: inboundOrderDecisionFlagStatusSchema.default("open"),
});

export const updateInboundOrderDecisionFlagSchema = insertInboundOrderDecisionFlagSchema.partial().extend({
  id: z.string(),
});

export const insertInboundOrderEventSchema = createInsertSchema(inboundOrderEvents).omit({
  id: true,
  organizationId: true,
  createdAt: true,
}).extend({
  actorType: inboundOrderEventActorTypeSchema.default("system"),
  fromStatus: inboundOrderRecordStatusSchema.optional().nullable(),
  toStatus: inboundOrderRecordStatusSchema.optional().nullable(),
});

export const updateInboundOrderEventSchema = insertInboundOrderEventSchema.partial().extend({
  id: z.string(),
});

export const insertInboundOrderReviewSnapshotSchema = createInsertSchema(inboundOrderReviewSnapshots).omit({
  id: true,
  organizationId: true,
  createdAt: true,
}).extend({
  snapshotType: inboundOrderReviewSnapshotTypeSchema,
  snapshotVersion: z.coerce.number().int().positive().default(1),
});

export const updateInboundOrderReviewSnapshotSchema = insertInboundOrderReviewSnapshotSchema.partial().extend({
  id: z.string(),
});

export const insertInboundOrderParseAttemptSchema = createInsertSchema(inboundOrderParseAttempts).omit({
  id: true,
  organizationId: true,
  createdAt: true,
}).extend({
  status: inboundOrderParseAttemptStatusSchema,
  confidence: z.coerce.number().int().min(0).max(100).optional().nullable(),
  warnings: z.array(z.record(z.unknown())).default([]),
  errors: z.array(z.record(z.unknown())).default([]),
});

export const updateInboundOrderParseAttemptSchema = insertInboundOrderParseAttemptSchema.partial().extend({
  id: z.string(),
});

export type SelectInboundOrderSource = typeof inboundOrderSources.$inferSelect;
export type InsertInboundOrderSource = z.infer<typeof insertInboundOrderSourceSchema>;
export type UpdateInboundOrderSource = z.infer<typeof updateInboundOrderSourceSchema>;
export type InboundOrderSource = SelectInboundOrderSource;

export type SelectInboundEmailMailbox = typeof inboundEmailMailboxes.$inferSelect;
export type InsertInboundEmailMailbox = z.infer<typeof insertInboundEmailMailboxSchema>;
export type UpdateInboundEmailMailbox = z.infer<typeof updateInboundEmailMailboxSchema>;
export type InboundEmailMailbox = SelectInboundEmailMailbox;

export type SelectInboundEmailIgnoreRule = typeof inboundEmailIgnoreRules.$inferSelect;
export type InsertInboundEmailIgnoreRule = z.infer<typeof insertInboundEmailIgnoreRuleSchema>;
export type UpdateInboundEmailIgnoreRule = z.infer<typeof updateInboundEmailIgnoreRuleSchema>;
export type InboundEmailIgnoreRule = SelectInboundEmailIgnoreRule;

export type SelectInboundEmailTrustRule = typeof inboundEmailTrustRules.$inferSelect;
export type InsertInboundEmailTrustRule = z.infer<typeof insertInboundEmailTrustRuleSchema>;
export type UpdateInboundEmailTrustRule = z.infer<typeof updateInboundEmailTrustRuleSchema>;
export type InboundEmailTrustRule = SelectInboundEmailTrustRule;

export type SelectInboundAttachmentClassificationRule = typeof inboundAttachmentClassificationRules.$inferSelect;
export type InsertInboundAttachmentClassificationRule = z.infer<typeof insertInboundAttachmentClassificationRuleSchema>;
export type UpdateInboundAttachmentClassificationRule = z.infer<typeof updateInboundAttachmentClassificationRuleSchema>;
export type InboundAttachmentClassificationRule = SelectInboundAttachmentClassificationRule;

export type SelectInboundOrderRecord = typeof inboundOrderRecords.$inferSelect;
export type InsertInboundOrderRecord = z.infer<typeof insertInboundOrderRecordSchema>;
export type UpdateInboundOrderRecord = z.infer<typeof updateInboundOrderRecordSchema>;
export type InboundOrderRecord = SelectInboundOrderRecord;

export type SelectInboundOrderLineItem = typeof inboundOrderLineItems.$inferSelect;
export type InsertInboundOrderLineItem = z.infer<typeof insertInboundOrderLineItemSchema>;
export type UpdateInboundOrderLineItem = z.infer<typeof updateInboundOrderLineItemSchema>;
export type InboundOrderLineItem = SelectInboundOrderLineItem;

export type SelectInboundOrderFile = typeof inboundOrderFiles.$inferSelect;
export type InsertInboundOrderFile = z.infer<typeof insertInboundOrderFileSchema>;
export type UpdateInboundOrderFile = z.infer<typeof updateInboundOrderFileSchema>;
export type InboundOrderFile = SelectInboundOrderFile;

export type SelectInboundOrderWarning = typeof inboundOrderWarnings.$inferSelect;
export type InsertInboundOrderWarning = z.infer<typeof insertInboundOrderWarningSchema>;
export type UpdateInboundOrderWarning = z.infer<typeof updateInboundOrderWarningSchema>;
export type InboundOrderWarning = SelectInboundOrderWarning;

export type SelectInboundOrderDecisionFlag = typeof inboundOrderDecisionFlags.$inferSelect;
export type InsertInboundOrderDecisionFlag = z.infer<typeof insertInboundOrderDecisionFlagSchema>;
export type UpdateInboundOrderDecisionFlag = z.infer<typeof updateInboundOrderDecisionFlagSchema>;
export type InboundOrderDecisionFlag = SelectInboundOrderDecisionFlag;

export type SelectInboundOrderEvent = typeof inboundOrderEvents.$inferSelect;
export type InsertInboundOrderEvent = z.infer<typeof insertInboundOrderEventSchema>;
export type UpdateInboundOrderEvent = z.infer<typeof updateInboundOrderEventSchema>;
export type InboundOrderEvent = SelectInboundOrderEvent;

export type SelectInboundOrderReviewSnapshot = typeof inboundOrderReviewSnapshots.$inferSelect;
export type InsertInboundOrderReviewSnapshot = z.infer<typeof insertInboundOrderReviewSnapshotSchema>;
export type UpdateInboundOrderReviewSnapshot = z.infer<typeof updateInboundOrderReviewSnapshotSchema>;
export type InboundOrderReviewSnapshot = SelectInboundOrderReviewSnapshot;

export type SelectInboundOrderParseAttempt = typeof inboundOrderParseAttempts.$inferSelect;
export type InsertInboundOrderParseAttempt = z.infer<typeof insertInboundOrderParseAttemptSchema>;
export type UpdateInboundOrderParseAttempt = z.infer<typeof updateInboundOrderParseAttemptSchema>;
export type InboundOrderParseAttempt = SelectInboundOrderParseAttempt;

// ============================================================
// REPRINT REQUESTS
// ============================================================

export const reprintRequests = pgTable("reprint_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  lineItemId: varchar("line_item_id").notNull().references(() => orderLineItems.id, { onDelete: 'restrict' }),
  fileId: varchar("file_id").references(() => lineItemFiles.id, { onDelete: 'set null' }),
  filename: text("filename").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull(),
  units: text("units").notNull(),
  reason: text("reason").notNull(),
  noPrintsCompletedYet: boolean("no_prints_completed_yet").notNull().default(false),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  status: text("status").notNull().default('open'),
}, (table) => [
  index("reprint_requests_org_idx").on(table.organizationId),
  index("reprint_requests_line_item_idx").on(table.lineItemId),
  index("reprint_requests_status_idx").on(table.status),
  index("reprint_requests_org_status_idx").on(table.organizationId, table.status),
]);

export type ReprintRequest = typeof reprintRequests.$inferSelect;
export const insertReprintRequestSchema = createInsertSchema(reprintRequests)
  .omit({ id: true, createdAt: true })
  .extend({
    filename: z.string().trim().min(1, "Filename required").max(512),
    quantity: z.coerce.number().positive("Quantity must be greater than 0"),
    units: z.string().trim().min(1, "Units required").max(64),
    reason: z.string().trim().min(1, "Reason required").max(2000),
    noPrintsCompletedYet: z.boolean().optional().default(false),
    fileId: z.string().optional(),
    status: z.enum(["open", "acknowledged", "closed"]).optional().default("open"),
  });

// ============================================================
// PREPRESS TABLES (imported from server/prepress/schema.ts)
// ============================================================
// Re-export prepress tables so they're available in db.query
export {
  prepressJobs,
  prepressFindings,
  prepressFixLogs,
  prepressJobStatusEnum,
  prepressJobModeEnum,
  prepressFindingTypeEnum,
  prepressFixTypeEnum,
  insertPrepressJobSchema,
  selectPrepressJobSchema,
  insertPrepressFindingSchema,
  insertPrepressFixLogSchema,
  issueCountsSchema,
  prepressReportSummarySchema,
  prepressOutputManifestSchema,
  prepressErrorSchema,
  type PrepressJob,
  type InsertPrepressJob,
  type PrepressJobStatus,
  type PrepressJobMode,
  type PrepressFinding,
  type InsertPrepressFinding,
  type PrepressFixLog,
  type InsertPrepressFixLog,
  type PrepressReportSummary,
  type PrepressOutputManifest,
  type PrepressError,
} from "../server/prepress/schema";
