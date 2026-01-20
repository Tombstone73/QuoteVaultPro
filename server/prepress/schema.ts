import { pgTable, varchar, text, bigint, uuid, timestamp, pgEnum, jsonb, index, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * Prepress Jobs Schema
 * 
 * Stateless prepress processor for PDF preflight checks and auto-fixes.
 * All inputs and outputs are TEMPORARY - no long-term file ownership.
 * 
 * State machine: queued → running → (succeeded | failed | cancelled)
 */

// Enums
export const prepressJobStatusEnum = pgEnum('prepress_job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
]);

export const prepressJobModeEnum = pgEnum('prepress_job_mode', [
  'check',
  'check_and_fix'
]);

// Finding types enum
export const prepressFindingTypeEnum = pgEnum('prepress_finding_type', [
  'missing_dpi',
  'spot_color_detected',
  'font_not_embedded',
  'low_resolution_image',
  'rgb_colorspace',
  'transparency_detected',
  'other'
]);

// Fix types enum
export const prepressFixTypeEnum = pgEnum('prepress_fix_type', [
  'rgb_to_cmyk',
  'normalize_dpi',
  'flatten_transparency',
  'embed_fonts',
  'remove_spot_color',
  'pdf_normalize',
  'other'
]);

// Table definition
export const prepressJobs = pgTable("prepress_jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Multi-tenant: REQUIRED when launched from TitanOS; nullable only for dev/standalone
  organizationId: varchar("organization_id"),
  
  // State machine
  status: prepressJobStatusEnum("status").notNull().default('queued'),
  mode: prepressJobModeEnum("mode").notNull().default('check'),
  
  // File metadata (NEVER store absolute paths - derive from jobId at runtime)
  originalFilename: varchar("original_filename", { length: 512 }).notNull(),
  contentType: varchar("content_type", { length: 255 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  
  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // TTL for cleanup
  
  // Results (populated on completion)
  reportSummary: jsonb("report_summary"), // { score, counts, pageCount }
  outputManifest: jsonb("output_manifest"), // { proof_png: true, fixed_pdf: true }
  error: jsonb("error"), // { message, code, details }
  
  // Progress tracking
  progressMessage: text("progress_message"),
}, (table) => [
  index("prepress_jobs_org_idx").on(table.organizationId),
  index("prepress_jobs_status_idx").on(table.status),
  index("prepress_jobs_created_at_idx").on(table.createdAt),
  index("prepress_jobs_expires_at_idx").on(table.expiresAt),
]);

// Zod schemas for validation
export const insertPrepressJobSchema = createInsertSchema(prepressJobs).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  reportSummary: true,
  outputManifest: true,
  error: true,
  progressMessage: true,
}).extend({
  status: z.enum(['queued']).default('queued'), // Jobs always start as queued
  mode: z.enum(['check', 'check_and_fix']).default('check'),
  organizationId: z.string().nullable().optional(),
  originalFilename: z.string().min(1).max(512),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  expiresAt: z.date(),
});

export const selectPrepressJobSchema = createSelectSchema(prepressJobs);

export type PrepressJob = z.infer<typeof selectPrepressJobSchema>;
export type InsertPrepressJob = z.infer<typeof insertPrepressJobSchema>;
export type PrepressJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type PrepressJobMode = 'check' | 'check_and_fix';

// Prepress Findings Table
export const prepressFindings = pgTable("prepress_findings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Multi-tenant + job linkage
  organizationId: varchar("organization_id").notNull(),
  prepressJobId: uuid("prepress_job_id").notNull().references(() => prepressJobs.id, { onDelete: 'cascade' }),
  
  // Finding details
  findingType: prepressFindingTypeEnum("finding_type").notNull(),
  severity: varchar("severity", { length: 20 }).notNull().default('info'), // blocker, warning, info
  message: text("message").notNull(),
  
  // Location context (optional)
  pageNumber: integer("page_number"),
  artboardName: varchar("artboard_name", { length: 255 }),
  objectReference: varchar("object_reference", { length: 255 }),
  
  // Spot color specific fields
  spotColorName: varchar("spot_color_name", { length: 255 }),
  colorModel: varchar("color_model", { length: 50 }),
  
  // DPI specific fields
  detectedDpi: integer("detected_dpi"),
  requiredDpi: integer("required_dpi"),
  
  // Generic metadata
  metadata: jsonb("metadata"),
  
  // Audit
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("prepress_findings_job_idx").on(table.prepressJobId),
  index("prepress_findings_org_idx").on(table.organizationId),
  index("prepress_findings_type_idx").on(table.findingType),
]);

// Prepress Fix Logs Table
export const prepressFixLogs = pgTable("prepress_fix_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Multi-tenant + job linkage
  organizationId: varchar("organization_id").notNull(),
  prepressJobId: uuid("prepress_job_id").notNull().references(() => prepressJobs.id, { onDelete: 'cascade' }),
  
  // Fix details
  fixType: prepressFixTypeEnum("fix_type").notNull(),
  description: text("description").notNull(),
  
  // Actor (nullable for automated fixes)
  fixedByUserId: varchar("fixed_by_user_id"),
  
  // Before/after snapshots
  beforeSnapshot: jsonb("before_snapshot"),
  afterSnapshot: jsonb("after_snapshot"),
  
  // Audit
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("prepress_fix_logs_job_idx").on(table.prepressJobId),
  index("prepress_fix_logs_org_idx").on(table.organizationId),
  index("prepress_fix_logs_user_idx").on(table.fixedByUserId),
]);

// Zod schemas for validation
export const insertPrepressFindingSchema = createInsertSchema(prepressFindings).omit({
  id: true,
  createdAt: true,
});

export const insertPrepressFixLogSchema = createInsertSchema(prepressFixLogs).omit({
  id: true,
  createdAt: true,
});

export type PrepressFinding = typeof prepressFindings.$inferSelect;
export type InsertPrepressFinding = z.infer<typeof insertPrepressFindingSchema>;
export type PrepressFixLog = typeof prepressFixLogs.$inferSelect;
export type InsertPrepressFixLog = z.infer<typeof insertPrepressFixLogSchema>;
