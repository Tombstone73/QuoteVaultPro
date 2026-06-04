import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import {
  auditLogs,
  bugReports,
  productPlanningAiSuggestions,
  productPlanningAiSuggestionTypeValues,
  productPlanningBusinessValueValues,
  productPlanningComplexityValues,
  productPlanningDependencies,
  productPlanningDependencyTypeValues,
  productPlanningEvents,
  productPlanningImportBatches,
  productPlanningPhaseValues,
  productPlanningPriorityValues,
  productPlanningReleases,
  productPlanningReleaseStatusValues,
  productPlanningSourceTypeValues,
  productPlanningStatusValues,
  productPlanningWorkItems,
  productPlanningWorkItemTypeValues,
} from "@shared/schema";
import {
  parseProductPlanningCsv,
  type ProductPlanningImportMappedRow,
} from "../services/productPlanningCsv";
import { wouldCreateProductPlanningDependencyCycle } from "../services/productPlanningDependencies";
import { validateProductPlanningParent } from "../services/productPlanningHierarchy";
import { calculateProductPlanningPriorityScore } from "../services/productPlanningPriority";
import {
  findSimilarProductPlanningItems,
  generateBacklogAnalysis,
  generateBugPlanningSummary,
  generateEpicDiscoverySuggestions,
  generateImplementationNotesSuggestion,
  generateImportCleanupSuggestions,
  generateProductPlanningAiReviewSuggestions,
  generateRoadmapAnalysis,
  generateRoadmapGroupingSuggestions,
  type ProductPlanningAiSuggestionDraft,
} from "../services/productPlanningAi";

type DbExecutor = typeof db | any;

const listQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  workItemType: z.enum(productPlanningWorkItemTypeValues).optional(),
  planningStatus: z.enum(productPlanningStatusValues).optional(),
  priority: z.enum(productPlanningPriorityValues).optional(),
  module: z.string().trim().max(255).optional(),
  phase: z.enum(productPlanningPhaseValues).optional(),
  sourceType: z.enum(productPlanningSourceTypeValues).optional(),
  ownerUserId: z.string().trim().max(255).optional(),
  releaseId: z.string().trim().max(255).optional(),
  importedBatchId: z.string().trim().max(255).optional(),
  includeArchived: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "priority", "priorityScore", "reference", "module", "phase", "roadmapOrder", "sortOrder"]).default("updatedAt"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(250).default(100),
});

const nullableString = z.preprocess(
  (value) => {
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed ? trimmed : null;
  },
  z.string().max(10000).nullable(),
);

const tagsSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      return value.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean);
    }
    return [];
  },
  z.array(z.string().trim().min(1).max(80)).max(20),
);

const scoreMetricSchema = z.preprocess(
  (value) => {
    if (value == null || value === "") return null;
    return Number(value);
  },
  z.number().int().min(1).max(5).nullable(),
);

const createWorkItemSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: nullableString.optional(),
  workItemType: z.enum(productPlanningWorkItemTypeValues).default("feature"),
  planningStatus: z.enum(productPlanningStatusValues).default("backlog"),
  priority: z.enum(productPlanningPriorityValues).default("medium"),
  businessValue: z.enum(productPlanningBusinessValueValues).nullable().optional(),
  complexity: z.enum(productPlanningComplexityValues).nullable().optional(),
  phase: z.enum(productPlanningPhaseValues).nullable().optional(),
  module: nullableString.optional(),
  submodule: nullableString.optional(),
  tags: tagsSchema.optional(),
  sortOrder: z.number().int().nullable().optional(),
  roadmapOrder: z.number().int().nullable().optional(),
  parentId: nullableString.optional(),
  sourceType: z.enum(productPlanningSourceTypeValues).nullable().optional(),
  sourceReference: nullableString.optional(),
  requestedBy: nullableString.optional(),
  ownerUserId: nullableString.optional(),
  dueDate: nullableString.optional(),
  releaseTarget: nullableString.optional(),
  releaseId: nullableString.optional(),
  userImpact: scoreMetricSchema.optional(),
  revenueImpact: scoreMetricSchema.optional(),
  operationalImpact: scoreMetricSchema.optional(),
  riskReduction: scoreMetricSchema.optional(),
  confidence: scoreMetricSchema.optional(),
  notes: nullableString.optional(),
});

const updateWorkItemSchema = createWorkItemSchema.partial();

const csvPreviewSchema = z.object({
  csv: z.string().min(1),
  filename: z.string().trim().max(255).optional().nullable(),
});

const csvCommitSchema = csvPreviewSchema.extend({
  allowDuplicates: z.boolean().optional().default(false),
  rows: z.array(z.unknown()).optional(),
});

const moveStatusSchema = z.object({
  planningStatus: z.enum(productPlanningStatusValues),
  sortOrder: z.number().int().nullable().optional(),
});

const movePhaseSchema = z.object({
  phase: z.enum(productPlanningPhaseValues).nullable(),
  roadmapOrder: z.number().int().nullable().optional(),
});

const reorderSchema = z.object({
  items: z.array(z.object({
    id: z.string().trim().min(1),
    sortOrder: z.number().int().nullable().optional(),
    roadmapOrder: z.number().int().nullable().optional(),
    planningStatus: z.enum(productPlanningStatusValues).optional(),
    phase: z.enum(productPlanningPhaseValues).nullable().optional(),
  })).min(1).max(250),
});

const createReleaseSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: nullableString.optional(),
  targetDate: nullableString.optional(),
  status: z.enum(productPlanningReleaseStatusValues).default("planned"),
});

const updateReleaseSchema = createReleaseSchema.partial();

const createDependencySchema = z.object({
  dependsOnWorkItemId: z.string().trim().min(1),
  dependencyType: z.enum(productPlanningDependencyTypeValues).default("requires"),
});

const createAiSuggestionSchema = z.object({
  workItemId: z.string().trim().min(1).nullable().optional(),
  suggestionType: z.enum(productPlanningAiSuggestionTypeValues),
  currentValue: z.unknown().optional(),
  suggestedValue: z.unknown().optional(),
  confidence: z.coerce.number().int().min(0).max(100).nullable().optional(),
  reasoning: z.string().trim().max(10000).nullable().optional(),
});

const createFromBugSummarySchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(10000),
  priority: z.enum(productPlanningPriorityValues),
  module: nullableString.optional(),
});

function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

function canAccessProductPlanning(req: Request): boolean {
  const user = req.user as any;
  if (user?.isPlatformAdmin || user?.isPlatformDeveloper) return true;
  const orgRole = ((req as any).orgRole ?? (req as any).actorOrgRole ?? user?.role ?? "").toLowerCase();
  return orgRole === "owner" || orgRole === "admin";
}

function requireProductPlanningAccess(req: Request, res: Response): boolean {
  if (!canAccessProductPlanning(req)) {
    res.status(403).json({
      success: false,
      message: "Access denied. Product Planning requires developer or admin access.",
    });
    return false;
  }
  return true;
}

async function allocateProductPlanningReference(
  organizationId: string,
  executor: DbExecutor = db,
): Promise<string> {
  const result = await executor.execute(sql`
    INSERT INTO global_variables (
      id,
      organization_id,
      name,
      value,
      description,
      category,
      is_active,
      created_at,
      updated_at
    )
    VALUES (
      gen_random_uuid(),
      ${organizationId},
      'product_planning_next_reference',
      '2',
      'Next Product Planning reference number',
      'numbering',
      true,
      NOW(),
      NOW()
    )
    ON CONFLICT (organization_id, name) DO UPDATE
    SET
      value = (
        CASE
          WHEN global_variables.value ~ '^[0-9]+$' THEN global_variables.value::integer
          ELSE 1
        END + 1
      )::text,
      updated_at = NOW()
    RETURNING (value::integer - 1) AS number_core
  `);

  const rows = Array.isArray(result) ? result : ((result as any)?.rows ?? []);
  const numberCore = Math.floor(Number(rows[0]?.number_core ?? rows[0]?.numberCore));
  if (!Number.isFinite(numberCore) || numberCore < 1) {
    throw new Error("Failed to allocate Product Planning reference");
  }
  return `PP-${String(numberCore).padStart(4, "0")}`;
}

async function recordPlanningEvent(params: {
  organizationId: string;
  workItemId: string;
  eventType: string;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
  actorUserId?: string | null;
  executor?: DbExecutor;
}) {
  const executor = params.executor ?? db;
  await executor.insert(productPlanningEvents).values({
    organizationId: params.organizationId,
    workItemId: params.workItemId,
    eventType: params.eventType,
    message: params.message ?? null,
    metadata: params.metadata ?? null,
    createdByUserId: params.actorUserId ?? null,
  });
}

async function recordProductPlanningAudit(params: {
  organizationId: string;
  actorUserId?: string | null;
  actionType: string;
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  description: string;
  newValues?: Record<string, unknown> | null;
}) {
  await db.insert(auditLogs).values({
    organizationId: params.organizationId,
    userId: params.actorUserId ?? null,
    actionType: params.actionType,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    entityName: params.entityName ?? null,
    description: params.description,
    newValues: params.newValues ?? null,
  });
}

function toWorkItemInsert(input: z.infer<typeof createWorkItemSchema>, organizationId: string, actorUserId: string | null, reference: string) {
  const score = calculateProductPlanningPriorityScore(input);
  return {
    organizationId,
    reference,
    title: input.title,
    description: input.description ?? null,
    workItemType: input.workItemType ?? "feature",
    planningStatus: input.planningStatus ?? "backlog",
    priority: input.priority ?? "medium",
    businessValue: input.businessValue ?? null,
    complexity: input.complexity ?? null,
    phase: input.phase ?? null,
    module: input.module ?? null,
    submodule: input.submodule ?? null,
    tags: input.tags ?? [],
    sortOrder: input.sortOrder ?? null,
    roadmapOrder: input.roadmapOrder ?? null,
    parentId: input.parentId ?? null,
    sourceType: input.sourceType ?? "manual",
    sourceReference: input.sourceReference ?? null,
    requestedBy: input.requestedBy ?? null,
    ownerUserId: input.ownerUserId ?? null,
    dueDate: input.dueDate ?? null,
    releaseTarget: input.releaseTarget ?? null,
    releaseId: input.releaseId ?? null,
    userImpact: input.userImpact ?? null,
    revenueImpact: input.revenueImpact ?? null,
    operationalImpact: input.operationalImpact ?? null,
    riskReduction: input.riskReduction ?? null,
    confidence: input.confidence ?? null,
    priorityScore: score.priorityScore,
    priorityScoreExplanation: score.priorityScoreExplanation,
    notes: input.notes ?? null,
    createdByUserId: actorUserId,
    updatedByUserId: actorUserId,
  };
}

function workItemValuesFromCsvRow(
  row: ProductPlanningImportMappedRow,
  organizationId: string,
  actorUserId: string | null,
  reference: string,
  batchId: string,
) {
  const warningNote = row.warnings.length ? `Import warnings:\n${row.warnings.map((warning) => `- ${warning}`).join("\n")}` : "";
  return {
    organizationId,
    reference,
    title: row.title,
    description: row.description,
    workItemType: row.workItemType,
    planningStatus: row.planningStatus,
    priority: row.priority,
    businessValue: row.businessValue,
    complexity: row.complexity,
    phase: row.phase,
    module: row.module,
    submodule: row.submodule,
    tags: row.tags,
    sourceType: "csv_import" as const,
    sourceReference: row.sourceReference,
    importedBatchId: batchId,
    requestedBy: row.requestedBy,
    notes: [row.notes, warningNote].filter(Boolean).join("\n\n") || null,
    createdByUserId: actorUserId,
    updatedByUserId: actorUserId,
  };
}

async function findDuplicateByTitleModule(organizationId: string, title: string, moduleName: string | null) {
  const conditions = [
    eq(productPlanningWorkItems.organizationId, organizationId),
    isNull(productPlanningWorkItems.archivedAt),
    sql`lower(${productPlanningWorkItems.title}) = lower(${title})`,
  ];

  if (moduleName) {
    conditions.push(sql`lower(coalesce(${productPlanningWorkItems.module}, '')) = lower(${moduleName})`);
  } else {
    conditions.push(sql`${productPlanningWorkItems.module} IS NULL`);
  }

  const [existing] = await db
    .select({ id: productPlanningWorkItems.id, reference: productPlanningWorkItems.reference, title: productPlanningWorkItems.title })
    .from(productPlanningWorkItems)
    .where(and(...conditions))
    .limit(1);

  return existing ?? null;
}

function priorityFromBugSeverity(severity: string): "critical" | "high" | "medium" | "low" {
  if (severity === "critical") return "critical";
  if (severity === "high") return "high";
  if (severity === "low") return "low";
  return "medium";
}

function orderExpression(sortBy: z.infer<typeof listQuerySchema>["sortBy"], sortDirection: "asc" | "desc") {
  if (sortBy === "priority") {
    const expr = sql`CASE ${productPlanningWorkItems.priority}
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
      ELSE 5
    END`;
    return sortDirection === "asc" ? asc(expr) : desc(expr);
  }

  const column = {
    createdAt: productPlanningWorkItems.createdAt,
    updatedAt: productPlanningWorkItems.updatedAt,
    reference: productPlanningWorkItems.reference,
    module: productPlanningWorkItems.module,
    phase: productPlanningWorkItems.phase,
    priorityScore: productPlanningWorkItems.priorityScore,
    roadmapOrder: productPlanningWorkItems.roadmapOrder,
    sortOrder: productPlanningWorkItems.sortOrder,
  }[sortBy];

  return sortDirection === "asc" ? asc(column) : desc(column);
}

async function validateReleaseForOrg(organizationId: string, releaseId: string | null | undefined, executor: DbExecutor = db) {
  if (!releaseId) return true;
  const [release] = await executor
    .select({ id: productPlanningReleases.id })
    .from(productPlanningReleases)
    .where(and(
      eq(productPlanningReleases.organizationId, organizationId),
      eq(productPlanningReleases.id, releaseId),
      isNull(productPlanningReleases.archivedAt),
    ))
    .limit(1);
  return Boolean(release);
}

function shouldRecalculatePriorityScore(input: Record<string, unknown>) {
  return ["businessValue", "complexity", "userImpact", "revenueImpact", "operationalImpact", "riskReduction", "confidence"]
    .some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

function patchedValue<T extends Record<string, unknown>, K extends keyof T>(patch: Partial<T>, existing: T, key: K) {
  return Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : existing[key];
}

function rowsFromExecute<T = any>(result: unknown): T[] {
  return Array.isArray(result) ? result as T[] : ((result as any)?.rows ?? []);
}

async function validateParentForOrg(
  organizationId: string,
  workItemId: string,
  parentId: string | null | undefined,
  executor: DbExecutor = db,
) {
  return validateProductPlanningParent({
    workItemId,
    parentId,
    lookup: async (id) => {
      const [row] = await executor
        .select({ id: productPlanningWorkItems.id, parentId: productPlanningWorkItems.parentId })
        .from(productPlanningWorkItems)
        .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.id, id)))
        .limit(1);
      return row ?? null;
    },
  });
}

async function getWorkItemForOrg(organizationId: string, id: string) {
  const [item] = await db
    .select()
    .from(productPlanningWorkItems)
    .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.id, id)))
    .limit(1);
  return item ?? null;
}

async function listAiCandidateWorkItems(organizationId: string) {
  return db
    .select()
    .from(productPlanningWorkItems)
    .where(and(
      eq(productPlanningWorkItems.organizationId, organizationId),
      isNull(productPlanningWorkItems.archivedAt),
      ne(productPlanningWorkItems.planningStatus, "archived"),
    ))
    .orderBy(desc(productPlanningWorkItems.updatedAt))
    .limit(250);
}

async function getWorkItemAiContext(organizationId: string, id: string) {
  const item = await getWorkItemForOrg(organizationId, id);
  if (!item) return null;
  const [dependsOn, blockedBy] = await Promise.all([
    db
      .select({ id: productPlanningDependencies.id })
      .from(productPlanningDependencies)
      .where(and(eq(productPlanningDependencies.organizationId, organizationId), eq(productPlanningDependencies.workItemId, id))),
    db
      .select({ id: productPlanningDependencies.id })
      .from(productPlanningDependencies)
      .where(and(eq(productPlanningDependencies.organizationId, organizationId), eq(productPlanningDependencies.dependsOnWorkItemId, id))),
  ]);
  return {
    ...item,
    dependencyCount: dependsOn.length,
    blockedByCount: blockedBy.length,
  };
}

async function persistAiSuggestions(
  organizationId: string,
  suggestions: ProductPlanningAiSuggestionDraft[],
): Promise<Array<typeof productPlanningAiSuggestions.$inferSelect>> {
  if (suggestions.length === 0) return [];
  const textValue = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  };
  return db
    .insert(productPlanningAiSuggestions)
    .values(suggestions.map((suggestion) => ({
      organizationId,
      workItemId: suggestion.workItemId ?? null,
      suggestionType: suggestion.suggestionType,
      currentValue: textValue(suggestion.currentValue),
      suggestedValue: textValue(suggestion.suggestedValue),
      confidence: String(suggestion.confidence),
      reasoning: suggestion.reasoning,
      status: "pending" as const,
      createdByAi: true,
    })))
    .returning();
}

function scalarSuggestedValue(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return scalarSuggestedValue(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) {
    return (value as any).value;
  }
  return value;
}

async function patchForAcceptedSuggestion(
  organizationId: string,
  workItemId: string | null,
  suggestion: typeof productPlanningAiSuggestions.$inferSelect,
): Promise<Record<string, unknown> | null> {
  if (!workItemId) return null;
  const suggested = scalarSuggestedValue(suggestion.suggestedValue);

  if (suggestion.suggestionType === "priority") return { priority: suggested };
  if (suggestion.suggestionType === "business_value") return { businessValue: suggested };
  if (suggestion.suggestionType === "complexity") return { complexity: suggested };
  if (suggestion.suggestionType === "phase") return { phase: suggested };
  if (suggestion.suggestionType === "module") return { module: suggested };
  if (suggestion.suggestionType === "work_item_type") return { workItemType: suggested };

  if (suggestion.suggestionType === "parent_epic") {
    const parsedValue = typeof suggestion.suggestedValue === "string"
      ? (() => { try { return JSON.parse(suggestion.suggestedValue); } catch { return null; } })()
      : suggestion.suggestedValue;
    const parentId = parsedValue && typeof parsedValue === "object"
      ? (parsedValue as any).id
      : null;
    if (!parentId || typeof parentId !== "string") return null;
    const validation = await validateParentForOrg(organizationId, workItemId, parentId);
    if (!validation.valid) {
      throw new Error(validation.message || "Suggested parent epic is not valid.");
    }
    return { parentId };
  }

  return null;
}

export function registerProductPlanningRoutes(
  app: Express,
  middleware: {
    isAuthenticated: RequestHandler;
    tenantContext: RequestHandler;
    assertInternalUser: (req: any, res: any) => boolean;
  },
): void {
  const { isAuthenticated, tenantContext, assertInternalUser } = middleware;

  app.get("/api/product-planning/releases", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const includeArchived = req.query.includeArchived === "true";
      const conditions = [eq(productPlanningReleases.organizationId, organizationId)];
      if (!includeArchived) conditions.push(isNull(productPlanningReleases.archivedAt));

      const rows = await db
        .select()
        .from(productPlanningReleases)
        .where(and(...conditions))
        .orderBy(asc(productPlanningReleases.targetDate), asc(productPlanningReleases.createdAt))
        .limit(100);

      res.json({ success: true, data: rows });
    } catch (error) {
      console.error("[ProductPlanning] Release list failed:", error);
      res.status(500).json({ success: false, message: "Failed to list Product Planning releases." });
    }
  });

  app.post("/api/product-planning/releases", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const input = createReleaseSchema.parse(req.body ?? {});
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;

      const [release] = await db
        .insert(productPlanningReleases)
        .values({
          organizationId,
          name: input.name,
          description: input.description ?? null,
          targetDate: input.targetDate ?? null,
          status: input.status,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        })
        .returning();

      res.status(201).json({ success: true, data: release, message: "Product Planning release created." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: fromZodError(error).message });
      const err = error as any;
      if (err?.code === "23505") return res.status(409).json({ success: false, message: "A release with this name already exists." });
      console.error("[ProductPlanning] Release create failed:", error);
      res.status(500).json({ success: false, message: "Failed to create Product Planning release." });
    }
  });

  app.patch("/api/product-planning/releases/:id", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const input = updateReleaseSchema.parse(req.body ?? {});
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const id = String(req.params.id);
      const updateValues = {
        ...input,
        archivedAt: input.status === "archived" ? new Date() : undefined,
        updatedByUserId: actorUserId,
        updatedAt: new Date(),
      };
      Object.keys(updateValues).forEach((key) => {
        if ((updateValues as any)[key] === undefined) delete (updateValues as any)[key];
      });

      const [release] = await db
        .update(productPlanningReleases)
        .set(updateValues)
        .where(and(eq(productPlanningReleases.organizationId, organizationId), eq(productPlanningReleases.id, id)))
        .returning();

      if (!release) return res.status(404).json({ success: false, message: "Product Planning release not found." });
      res.json({ success: true, data: release, message: "Product Planning release updated." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: fromZodError(error).message });
      const err = error as any;
      if (err?.code === "23505") return res.status(409).json({ success: false, message: "A release with this name already exists." });
      console.error("[ProductPlanning] Release update failed:", error);
      res.status(500).json({ success: false, message: "Failed to update Product Planning release." });
    }
  });

  app.get("/api/product-planning/work-items", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      const query = listQuerySchema.parse(req.query);
      const conditions = [eq(productPlanningWorkItems.organizationId, organizationId)];

      if (!query.includeArchived) {
        conditions.push(isNull(productPlanningWorkItems.archivedAt));
        conditions.push(ne(productPlanningWorkItems.planningStatus, "archived"));
      }
      if (query.workItemType) conditions.push(eq(productPlanningWorkItems.workItemType, query.workItemType));
      if (query.planningStatus) conditions.push(eq(productPlanningWorkItems.planningStatus, query.planningStatus));
      if (query.priority) conditions.push(eq(productPlanningWorkItems.priority, query.priority));
      if (query.module) conditions.push(ilike(productPlanningWorkItems.module, `%${query.module}%`));
      if (query.phase) conditions.push(eq(productPlanningWorkItems.phase, query.phase));
      if (query.sourceType) conditions.push(eq(productPlanningWorkItems.sourceType, query.sourceType));
      if (query.ownerUserId) conditions.push(eq(productPlanningWorkItems.ownerUserId, query.ownerUserId));
      if (query.releaseId) conditions.push(eq(productPlanningWorkItems.releaseId, query.releaseId));
      if (query.importedBatchId) conditions.push(eq(productPlanningWorkItems.importedBatchId, query.importedBatchId));
      if (query.search) {
        const pattern = `%${query.search.replace(/[%_]/g, "\\$&")}%`;
        conditions.push(or(
          sql`${productPlanningWorkItems.reference} ILIKE ${pattern} ESCAPE '\'`,
          sql`${productPlanningWorkItems.title} ILIKE ${pattern} ESCAPE '\'`,
          sql`${productPlanningWorkItems.description} ILIKE ${pattern} ESCAPE '\'`,
          sql`${productPlanningWorkItems.module} ILIKE ${pattern} ESCAPE '\'`,
        )!);
      }

      const rows = await db
        .select()
        .from(productPlanningWorkItems)
        .where(and(...conditions))
        .orderBy(orderExpression(query.sortBy, query.sortDirection), desc(productPlanningWorkItems.updatedAt))
        .limit(query.limit);

      res.json({ success: true, data: rows });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: fromZodError(error).message });
      console.error("[ProductPlanning] List failed:", error);
      res.status(500).json({ success: false, message: "Failed to list Product Planning work items." });
    }
  });

  app.get("/api/product-planning/work-items/:id", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const id = String(req.params.id);

      const [item] = await db
        .select()
        .from(productPlanningWorkItems)
        .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.id, id)))
        .limit(1);

      if (!item) return res.status(404).json({ success: false, message: "Product Planning work item not found." });

      const events = await db
        .select()
        .from(productPlanningEvents)
        .where(and(eq(productPlanningEvents.organizationId, organizationId), eq(productPlanningEvents.workItemId, id)))
        .orderBy(desc(productPlanningEvents.createdAt))
        .limit(50);

      const parent = item.parentId
        ? await db
          .select({
            id: productPlanningWorkItems.id,
            reference: productPlanningWorkItems.reference,
            title: productPlanningWorkItems.title,
            workItemType: productPlanningWorkItems.workItemType,
            planningStatus: productPlanningWorkItems.planningStatus,
          })
          .from(productPlanningWorkItems)
          .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.id, item.parentId)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : null;

      const children = await db
        .select({
          id: productPlanningWorkItems.id,
          reference: productPlanningWorkItems.reference,
          title: productPlanningWorkItems.title,
          workItemType: productPlanningWorkItems.workItemType,
          planningStatus: productPlanningWorkItems.planningStatus,
          priority: productPlanningWorkItems.priority,
        })
        .from(productPlanningWorkItems)
        .where(and(
          eq(productPlanningWorkItems.organizationId, organizationId),
          eq(productPlanningWorkItems.parentId, id),
          isNull(productPlanningWorkItems.archivedAt),
        ))
        .orderBy(asc(productPlanningWorkItems.sortOrder), asc(productPlanningWorkItems.createdAt));

      const release = item.releaseId
        ? await db
          .select()
          .from(productPlanningReleases)
          .where(and(eq(productPlanningReleases.organizationId, organizationId), eq(productPlanningReleases.id, item.releaseId)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : null;

      const sourceBugReport = item.sourceBugReportId
        ? await db
          .select({
            id: bugReports.id,
            referenceNumber: bugReports.referenceNumber,
            title: bugReports.title,
            status: bugReports.status,
            severity: bugReports.severity,
          })
          .from(bugReports)
          .where(and(eq(bugReports.orgId, organizationId), eq(bugReports.id, item.sourceBugReportId)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : null;

      const importBatch = item.importedBatchId
        ? await db
          .select()
          .from(productPlanningImportBatches)
          .where(and(eq(productPlanningImportBatches.organizationId, organizationId), eq(productPlanningImportBatches.id, item.importedBatchId)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : null;

      const dependencies = await db
        .select()
        .from(productPlanningDependencies)
        .where(and(eq(productPlanningDependencies.organizationId, organizationId), eq(productPlanningDependencies.workItemId, id)))
        .orderBy(desc(productPlanningDependencies.createdAt));

      const blockedBy = await db
        .select()
        .from(productPlanningDependencies)
        .where(and(eq(productPlanningDependencies.organizationId, organizationId), eq(productPlanningDependencies.dependsOnWorkItemId, id)))
        .orderBy(desc(productPlanningDependencies.createdAt));

      const dependencyItemIds = Array.from(new Set([
        ...dependencies.map((dependency) => dependency.dependsOnWorkItemId),
        ...blockedBy.map((dependency) => dependency.workItemId),
      ]));
      const dependencyItems = dependencyItemIds.length
        ? await db
          .select({
            id: productPlanningWorkItems.id,
            reference: productPlanningWorkItems.reference,
            title: productPlanningWorkItems.title,
            workItemType: productPlanningWorkItems.workItemType,
            planningStatus: productPlanningWorkItems.planningStatus,
            priority: productPlanningWorkItems.priority,
          })
          .from(productPlanningWorkItems)
          .where(and(eq(productPlanningWorkItems.organizationId, organizationId), inArray(productPlanningWorkItems.id, dependencyItemIds)))
        : [];
      const dependencyItemById = new Map(dependencyItems.map((dependencyItem) => [dependencyItem.id, dependencyItem]));

      res.json({
        success: true,
        data: {
          ...item,
          parent,
          children,
          release,
          sourceBugReport,
          importBatch,
          dependencies: dependencies.map((dependency) => ({
            ...dependency,
            dependsOnWorkItem: dependencyItemById.get(dependency.dependsOnWorkItemId) ?? null,
          })),
          blockedBy: blockedBy.map((dependency) => ({
            ...dependency,
            workItem: dependencyItemById.get(dependency.workItemId) ?? null,
          })),
          events,
        },
      });
    } catch (error) {
      console.error("[ProductPlanning] Detail failed:", error);
      res.status(500).json({ success: false, message: "Failed to fetch Product Planning work item." });
    }
  });

  app.get("/api/product-planning/work-items/:id/ai-suggestions", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const id = String(req.params.id);
      const rows = await db
        .select()
        .from(productPlanningAiSuggestions)
        .where(and(eq(productPlanningAiSuggestions.organizationId, organizationId), eq(productPlanningAiSuggestions.workItemId, id)))
        .orderBy(desc(productPlanningAiSuggestions.createdAt))
        .limit(100);
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error("[ProductPlanning] AI suggestion list failed:", error);
      res.status(500).json({ success: false, message: "Failed to list Product Planning AI suggestions." });
    }
  });

  app.post("/api/product-planning/work-items/:id/ai-suggestions", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const id = String(req.params.id);
      const item = await getWorkItemForOrg(organizationId, id);
      if (!item) return res.status(404).json({ success: false, message: "Product Planning work item not found." });
      const input = createAiSuggestionSchema.parse({ ...(req.body ?? {}), workItemId: id });
      const [suggestion] = await persistAiSuggestions(organizationId, [{
        workItemId: id,
        suggestionType: input.suggestionType,
        currentValue: input.currentValue ?? null,
        suggestedValue: input.suggestedValue ?? null,
        confidence: input.confidence ?? 50,
        reasoning: input.reasoning ?? "Manual AI suggestion created for review.",
      }]);
      await recordPlanningEvent({
        organizationId,
        workItemId: id,
        eventType: "ai_suggestion_created",
        message: `AI suggestion created for ${item.reference}`,
        metadata: { suggestionId: suggestion.id, suggestionType: suggestion.suggestionType },
        actorUserId: getUserId(req.user) ?? null,
      });
      res.status(201).json({ success: true, data: suggestion, message: "AI suggestion created." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: fromZodError(error).message });
      console.error("[ProductPlanning] AI suggestion create failed:", error);
      res.status(500).json({ success: false, message: "Failed to create Product Planning AI suggestion." });
    }
  });

  app.post(["/api/product-planning/work-items/:id/ai/analyze", "/api/product-planning/work-items/:id/ai-review"], isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const id = String(req.params.id);
      const item = await getWorkItemAiContext(organizationId, id);
      if (!item) return res.status(404).json({ success: false, message: "Product Planning work item not found." });
      const candidates = await listAiCandidateWorkItems(organizationId);
      const drafts = generateProductPlanningAiReviewSuggestions(item, candidates);
      const suggestions = await persistAiSuggestions(organizationId, drafts);
      for (const suggestion of suggestions) {
        await recordPlanningEvent({
          organizationId,
          workItemId: id,
          eventType: "ai_suggestion_created",
          message: `AI suggested ${suggestion.suggestionType.replace(/_/g, " ")} for ${item.reference}`,
          metadata: { suggestionId: suggestion.id, confidence: suggestion.confidence },
          actorUserId: getUserId(req.user) ?? null,
        });
      }
      res.status(201).json({ success: true, data: suggestions, message: "AI review suggestions generated." });
    } catch (error) {
      console.error("[ProductPlanning] AI review failed:", error);
      res.status(500).json({ success: false, message: "Failed to generate Product Planning AI review." });
    }
  });

  app.post(["/api/product-planning/work-items/:id/find-duplicates", "/api/product-planning/work-items/:id/find-similar"], isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const id = String(req.params.id);
      const item = await getWorkItemForOrg(organizationId, id);
      if (!item) return res.status(404).json({ success: false, message: "Product Planning work item not found." });
      const candidates = await listAiCandidateWorkItems(organizationId);
      const similar = findSimilarProductPlanningItems(item, candidates, 8);
      const suggestions = await persistAiSuggestions(organizationId, similar.map((candidate) => ({
        workItemId: id,
        suggestionType: "duplicate_candidate",
        currentValue: { id: item.id, reference: item.reference, title: item.title },
        suggestedValue: {
          id: candidate.item.id,
          reference: candidate.item.reference,
          title: candidate.item.title,
          similarity: candidate.similarity,
        },
        confidence: candidate.similarity,
        reasoning: candidate.reasoning,
      })));
      await recordPlanningEvent({
        organizationId,
        workItemId: id,
        eventType: "ai_duplicate_reviewed",
        message: `AI reviewed possible duplicates for ${item.reference}`,
        metadata: { count: similar.length },
        actorUserId: getUserId(req.user) ?? null,
      });
      res.status(201).json({ success: true, data: { possibleDuplicates: similar, suggestions }, message: "Possible duplicates generated for review." });
    } catch (error) {
      console.error("[ProductPlanning] Similar item review failed:", error);
      res.status(500).json({ success: false, message: "Failed to find similar Product Planning items." });
    }
  });

  app.post("/api/product-planning/work-items/:id/generate-implementation-notes", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const id = String(req.params.id);
      const item = await getWorkItemForOrg(organizationId, id);
      if (!item) return res.status(404).json({ success: false, message: "Product Planning work item not found." });
      const [suggestion] = await persistAiSuggestions(organizationId, [generateImplementationNotesSuggestion(item)]);
      await recordPlanningEvent({
        organizationId,
        workItemId: id,
        eventType: "ai_implementation_notes_generated",
        message: `AI generated implementation notes for ${item.reference}`,
        metadata: { suggestionId: suggestion.id },
        actorUserId: getUserId(req.user) ?? null,
      });
      res.status(201).json({ success: true, data: suggestion, message: "Implementation notes suggestion generated." });
    } catch (error) {
      console.error("[ProductPlanning] Implementation notes generation failed:", error);
      res.status(500).json({ success: false, message: "Failed to generate implementation notes." });
    }
  });

  app.post("/api/product-planning/work-items/:id/suggest-epic", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const id = String(req.params.id);
      const actorUserId = getUserId(req.user) ?? null;
      const item = await getWorkItemForOrg(organizationId, id);
      if (!item) return res.status(404).json({ success: false, message: "Product Planning work item not found." });
      const candidates = await listAiCandidateWorkItems(organizationId);
      const existingEpic = candidates.find((candidate) =>
        candidate.workItemType === "epic" &&
        candidate.id !== id &&
        candidate.module &&
        item.module &&
        candidate.module.toLowerCase() === item.module.toLowerCase());
      const analysis = generateBacklogAnalysis(candidates);
      const suggestedGroup = analysis.epicGroups.find((group) =>
        group.relatedItems.some((related) => related.id === id));
      const drafts: ProductPlanningAiSuggestionDraft[] = [{
        workItemId: id,
        suggestionType: "parent_epic",
        currentValue: item.parentId ?? null,
        suggestedValue: existingEpic
          ? { id: existingEpic.id, reference: existingEpic.reference, title: existingEpic.title }
          : {
              epicName: suggestedGroup?.epicName ?? `${item.module || "Planning"} Improvements`,
              relatedItems: suggestedGroup?.relatedItems.map((related) => ({ id: related.id, reference: related.reference, title: related.title })) ?? [{ id: item.id, reference: item.reference, title: item.title }],
            },
        confidence: existingEpic ? 76 : suggestedGroup?.confidence ?? 62,
        reasoning: existingEpic
          ? `Found an existing epic in the same module: ${existingEpic.reference}.`
          : "Suggested a possible epic grouping from nearby backlog items. Review before creating or assigning an epic.",
      }];
      const suggestions = await persistAiSuggestions(organizationId, drafts);
      await recordPlanningEvent({
        organizationId,
        workItemId: id,
        eventType: "ai_suggestion_created",
        message: `AI suggested epic placement for ${item.reference}`,
        metadata: { suggestionId: suggestions[0]?.id ?? null },
        actorUserId,
      });
      res.status(201).json({ success: true, data: suggestions, message: "Epic suggestion generated." });
    } catch (error) {
      console.error("[ProductPlanning] Epic suggestion failed:", error);
      res.status(500).json({ success: false, message: "Failed to generate epic suggestion." });
    }
  });

  app.post("/api/product-planning/work-items/:id/suggest-roadmap-placement", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const id = String(req.params.id);
      const actorUserId = getUserId(req.user) ?? null;
      const item = await getWorkItemForOrg(organizationId, id);
      if (!item) return res.status(404).json({ success: false, message: "Product Planning work item not found." });
      const candidates = await listAiCandidateWorkItems(organizationId);
      const drafts = generateRoadmapGroupingSuggestions(candidates).filter((suggestion) => suggestion.workItemId === id);
      const suggestions = await persistAiSuggestions(organizationId, drafts.length > 0 ? drafts : [{
        workItemId: id,
        suggestionType: "release_recommendation",
        currentValue: item.releaseTarget ?? item.releaseId ?? null,
        suggestedValue: { releaseTarget: item.phase === "go_live" ? "Go Live" : "Review release target" },
        confidence: item.phase ? 66 : 55,
        reasoning: "No clear phase movement was detected, but release placement should be reviewed for sequencing.",
      }]);
      await recordPlanningEvent({
        organizationId,
        workItemId: id,
        eventType: "ai_roadmap_recommendation_generated",
        message: `AI suggested roadmap placement for ${item.reference}`,
        metadata: { suggestionIds: suggestions.map((suggestion) => suggestion.id) },
        actorUserId,
      });
      res.status(201).json({ success: true, data: suggestions, message: "Roadmap placement suggestion generated." });
    } catch (error) {
      console.error("[ProductPlanning] Roadmap placement suggestion failed:", error);
      res.status(500).json({ success: false, message: "Failed to generate roadmap placement suggestion." });
    }
  });

  app.post(["/api/product-planning/ai-suggestions/:suggestionId/accept", "/api/product-planning/work-items/:id/ai-suggestions/:suggestionId/accept"], isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const requestedWorkItemId = req.params.id ? String(req.params.id) : null;
      const suggestionId = String(req.params.suggestionId);

      const [suggestion] = await db
        .select()
        .from(productPlanningAiSuggestions)
        .where(and(
          eq(productPlanningAiSuggestions.organizationId, organizationId),
          eq(productPlanningAiSuggestions.id, suggestionId),
          eq(productPlanningAiSuggestions.status, "pending"),
        ))
        .limit(1);
      if (!suggestion) return res.status(404).json({ success: false, message: "Pending AI suggestion not found." });
      if (requestedWorkItemId && suggestion.workItemId !== requestedWorkItemId) {
        return res.status(404).json({ success: false, message: "Pending AI suggestion not found for this work item." });
      }

      const workItemId = suggestion.workItemId;
      const patch = await patchForAcceptedSuggestion(organizationId, workItemId, suggestion);
      const result = await db.transaction(async (tx) => {
        let updatedItem = null;
        if (patch) {
          const [currentItem] = await tx
            .select()
            .from(productPlanningWorkItems)
            .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.id, workItemId!)))
            .limit(1);
          if (!currentItem) throw new Error("Product Planning work item not found.");
          const updateValues: Record<string, unknown> = {
            ...patch,
            updatedByUserId: actorUserId,
            updatedAt: new Date(),
          };
          if (shouldRecalculatePriorityScore(updateValues)) {
            const scoreInput = {
              ...currentItem,
              ...updateValues,
              businessValue: patchedValue(updateValues, currentItem, "businessValue"),
              complexity: patchedValue(updateValues, currentItem, "complexity"),
              userImpact: patchedValue(updateValues, currentItem, "userImpact"),
              revenueImpact: patchedValue(updateValues, currentItem, "revenueImpact"),
              operationalImpact: patchedValue(updateValues, currentItem, "operationalImpact"),
              riskReduction: patchedValue(updateValues, currentItem, "riskReduction"),
              confidence: patchedValue(updateValues, currentItem, "confidence"),
            };
            const score = calculateProductPlanningPriorityScore(scoreInput);
            updateValues.priorityScore = score.priorityScore;
            updateValues.priorityScoreExplanation = score.priorityScoreExplanation;
          }
          const [row] = await tx
            .update(productPlanningWorkItems)
            .set(updateValues)
            .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.id, workItemId!)))
            .returning();
          updatedItem = row ?? null;
        }

        const [updatedSuggestion] = await tx
          .update(productPlanningAiSuggestions)
          .set({ status: "accepted", reviewedAt: new Date(), reviewedByUserId: actorUserId, updatedAt: new Date() })
          .where(and(eq(productPlanningAiSuggestions.organizationId, organizationId), eq(productPlanningAiSuggestions.id, suggestionId)))
          .returning();

        if (workItemId) {
          await recordPlanningEvent({
            organizationId,
            workItemId,
            eventType: "ai_suggestion_accepted",
            message: `Accepted AI suggestion: ${suggestion.suggestionType.replace(/_/g, " ")}`,
            metadata: { suggestionId, appliedPatch: patch ?? null },
            actorUserId,
            executor: tx,
          });
        }

        return { suggestion: updatedSuggestion, workItem: updatedItem };
      });

      res.json({ success: true, data: result, message: patch ? "AI suggestion accepted and applied." : "AI suggestion accepted for history." });
    } catch (error) {
      console.error("[ProductPlanning] AI suggestion accept failed:", error);
      res.status(500).json({ success: false, message: error instanceof Error ? error.message : "Failed to accept AI suggestion." });
    }
  });

  app.post(["/api/product-planning/ai-suggestions/:suggestionId/reject", "/api/product-planning/work-items/:id/ai-suggestions/:suggestionId/reject"], isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const requestedWorkItemId = req.params.id ? String(req.params.id) : null;
      const suggestionId = String(req.params.suggestionId);
      const conditions = [
        eq(productPlanningAiSuggestions.organizationId, organizationId),
        eq(productPlanningAiSuggestions.id, suggestionId),
        eq(productPlanningAiSuggestions.status, "pending"),
      ];
      if (requestedWorkItemId) conditions.push(eq(productPlanningAiSuggestions.workItemId, requestedWorkItemId));
      const [suggestion] = await db
        .update(productPlanningAiSuggestions)
        .set({ status: "rejected", reviewedAt: new Date(), reviewedByUserId: actorUserId, updatedAt: new Date() })
        .where(and(...conditions))
        .returning();
      if (!suggestion) return res.status(404).json({ success: false, message: "Pending AI suggestion not found." });
      if (suggestion.workItemId) {
        await recordPlanningEvent({
          organizationId,
          workItemId: suggestion.workItemId,
          eventType: "ai_suggestion_rejected",
          message: `Rejected AI suggestion: ${suggestion.suggestionType.replace(/_/g, " ")}`,
          metadata: { suggestionId },
          actorUserId,
        });
      }
      res.json({ success: true, data: suggestion, message: "AI suggestion rejected." });
    } catch (error) {
      console.error("[ProductPlanning] AI suggestion reject failed:", error);
      res.status(500).json({ success: false, message: "Failed to reject AI suggestion." });
    }
  });

  app.get("/api/product-planning/work-items/:id/dependencies", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const id = String(req.params.id);

      const deps = await db
        .select()
        .from(productPlanningDependencies)
        .where(and(eq(productPlanningDependencies.organizationId, organizationId), eq(productPlanningDependencies.workItemId, id)))
        .orderBy(desc(productPlanningDependencies.createdAt));

      const itemIds = Array.from(new Set(deps.flatMap((dep) => [dep.workItemId, dep.dependsOnWorkItemId])));
      const items = itemIds.length
        ? await db
          .select({
            id: productPlanningWorkItems.id,
            reference: productPlanningWorkItems.reference,
            title: productPlanningWorkItems.title,
            workItemType: productPlanningWorkItems.workItemType,
            planningStatus: productPlanningWorkItems.planningStatus,
            priority: productPlanningWorkItems.priority,
          })
          .from(productPlanningWorkItems)
          .where(and(eq(productPlanningWorkItems.organizationId, organizationId), inArray(productPlanningWorkItems.id, itemIds)))
        : [];
      const itemById = new Map(items.map((item) => [item.id, item]));

      res.json({
        success: true,
        data: deps.map((dep) => ({
          ...dep,
          workItem: itemById.get(dep.workItemId) ?? null,
          dependsOnWorkItem: itemById.get(dep.dependsOnWorkItemId) ?? null,
        })),
      });
    } catch (error) {
      console.error("[ProductPlanning] Dependency list failed:", error);
      res.status(500).json({ success: false, message: "Failed to list Product Planning dependencies." });
    }
  });

  app.post("/api/product-planning/work-items/:id/dependencies", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const input = createDependencySchema.parse(req.body ?? {});
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const id = String(req.params.id);

      if (id === input.dependsOnWorkItemId) {
        return res.status(400).json({ success: false, message: "A work item cannot depend on itself." });
      }

      const targetRows = await db
        .select({ id: productPlanningWorkItems.id })
        .from(productPlanningWorkItems)
        .where(and(eq(productPlanningWorkItems.organizationId, organizationId), inArray(productPlanningWorkItems.id, [id, input.dependsOnWorkItemId])));
      if (targetRows.length !== 2) {
        return res.status(404).json({ success: false, message: "Both Product Planning work items must exist in this organization." });
      }

      const createsCycle = await wouldCreateProductPlanningDependencyCycle({
        workItemId: id,
        dependsOnWorkItemId: input.dependsOnWorkItemId,
        lookupDependsOnIds: async (workItemId) => {
          const rows = await db
            .select({ dependsOnWorkItemId: productPlanningDependencies.dependsOnWorkItemId })
            .from(productPlanningDependencies)
            .where(and(eq(productPlanningDependencies.organizationId, organizationId), eq(productPlanningDependencies.workItemId, workItemId)));
          return rows.map((row) => row.dependsOnWorkItemId);
        },
      });
      if (createsCycle) {
        return res.status(400).json({ success: false, message: "Dependency would create a circular dependency chain." });
      }

      const [dependency] = await db
        .insert(productPlanningDependencies)
        .values({
          organizationId,
          workItemId: id,
          dependsOnWorkItemId: input.dependsOnWorkItemId,
          dependencyType: input.dependencyType,
          createdByUserId: actorUserId,
        })
        .returning();

      await recordPlanningEvent({
        organizationId,
        workItemId: id,
        eventType: "dependency_added",
        message: `Added ${input.dependencyType} dependency`,
        metadata: { dependsOnWorkItemId: input.dependsOnWorkItemId, dependencyType: input.dependencyType },
        actorUserId,
      });

      res.status(201).json({ success: true, data: dependency, message: "Product Planning dependency created." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: fromZodError(error).message });
      const err = error as any;
      if (err?.code === "23505") return res.status(409).json({ success: false, message: "This dependency already exists." });
      console.error("[ProductPlanning] Dependency create failed:", error);
      res.status(500).json({ success: false, message: "Failed to create Product Planning dependency." });
    }
  });

  app.delete("/api/product-planning/work-items/:id/dependencies/:dependencyId", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const id = String(req.params.id);
      const dependencyId = String(req.params.dependencyId);

      const [deleted] = await db
        .delete(productPlanningDependencies)
        .where(and(
          eq(productPlanningDependencies.organizationId, organizationId),
          eq(productPlanningDependencies.workItemId, id),
          eq(productPlanningDependencies.id, dependencyId),
        ))
        .returning();

      if (!deleted) return res.status(404).json({ success: false, message: "Product Planning dependency not found." });

      await recordPlanningEvent({
        organizationId,
        workItemId: id,
        eventType: "dependency_removed",
        message: "Removed dependency",
        metadata: { dependsOnWorkItemId: deleted.dependsOnWorkItemId, dependencyType: deleted.dependencyType },
        actorUserId,
      });

      res.json({ success: true, data: deleted, message: "Product Planning dependency removed." });
    } catch (error) {
      console.error("[ProductPlanning] Dependency delete failed:", error);
      res.status(500).json({ success: false, message: "Failed to remove Product Planning dependency." });
    }
  });

  app.post("/api/product-planning/work-items", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const input = createWorkItemSchema.parse(req.body ?? {});
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;

      if (input.releaseId && !(await validateReleaseForOrg(organizationId, input.releaseId))) {
        return res.status(400).json({ success: false, message: "Product Planning release not found." });
      }

      const created = await db.transaction(async (tx) => {
        const reference = await allocateProductPlanningReference(organizationId, tx);
        const [item] = await tx
          .insert(productPlanningWorkItems)
          .values(toWorkItemInsert(input, organizationId, actorUserId, reference))
          .returning();
        await recordPlanningEvent({
          organizationId,
          workItemId: item.id,
          eventType: "created",
          message: `Created ${item.reference}`,
          actorUserId,
          executor: tx,
        });
        return item;
      });

      res.status(201).json({ success: true, data: created, message: "Product Planning work item created." });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: "Validation failed", errors: error.flatten().fieldErrors });
      }
      console.error("[ProductPlanning] Create failed:", error);
      res.status(500).json({ success: false, message: "Failed to create Product Planning work item." });
    }
  });

  app.patch("/api/product-planning/work-items/:id", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const input = updateWorkItemSchema.parse(req.body ?? {});
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const id = String(req.params.id);

      const [existing] = await db
        .select()
        .from(productPlanningWorkItems)
        .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.id, id)))
        .limit(1);
      if (!existing) return res.status(404).json({ success: false, message: "Product Planning work item not found." });

      if (Object.prototype.hasOwnProperty.call(input, "parentId")) {
        const parentValidation = await validateParentForOrg(organizationId, id, input.parentId, db);
        if (!parentValidation.valid) {
          return res.status(400).json({ success: false, message: parentValidation.message });
        }
      }

      if (Object.prototype.hasOwnProperty.call(input, "releaseId") && input.releaseId && !(await validateReleaseForOrg(organizationId, input.releaseId))) {
        return res.status(400).json({ success: false, message: "Product Planning release not found." });
      }

      const updateValues = {
        ...input,
        tags: input.tags,
        updatedByUserId: actorUserId,
        updatedAt: new Date(),
      };
      if (shouldRecalculatePriorityScore(input)) {
        const score = calculateProductPlanningPriorityScore({
          businessValue: patchedValue(input, existing, "businessValue") as any,
          complexity: patchedValue(input, existing, "complexity") as any,
          userImpact: patchedValue(input, existing, "userImpact") as number | null,
          revenueImpact: patchedValue(input, existing, "revenueImpact") as number | null,
          operationalImpact: patchedValue(input, existing, "operationalImpact") as number | null,
          riskReduction: patchedValue(input, existing, "riskReduction") as number | null,
          confidence: patchedValue(input, existing, "confidence") as number | null,
        });
        Object.assign(updateValues, {
          priorityScore: score.priorityScore,
          priorityScoreExplanation: score.priorityScoreExplanation,
        });
      }
      Object.keys(updateValues).forEach((key) => {
        if ((updateValues as any)[key] === undefined) delete (updateValues as any)[key];
      });

      const [updated] = await db
        .update(productPlanningWorkItems)
        .set(updateValues)
        .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.id, id)))
        .returning();

      await recordPlanningEvent({
        organizationId,
        workItemId: id,
        eventType: existing.planningStatus !== updated.planningStatus ? "status_changed" : "updated",
        message: existing.planningStatus !== updated.planningStatus
          ? `Status changed from ${existing.planningStatus} to ${updated.planningStatus}`
          : `Updated ${updated.reference}`,
        metadata: { previousStatus: existing.planningStatus, nextStatus: updated.planningStatus },
        actorUserId,
      });

      res.json({ success: true, data: updated, message: "Product Planning work item updated." });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: "Validation failed", errors: error.flatten().fieldErrors });
      }
      console.error("[ProductPlanning] Update failed:", error);
      res.status(500).json({ success: false, message: "Failed to update Product Planning work item." });
    }
  });

  app.post("/api/product-planning/work-items/:id/archive", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const id = String(req.params.id);

      const [updated] = await db
        .update(productPlanningWorkItems)
        .set({
          planningStatus: "archived",
          archivedAt: new Date(),
          updatedAt: new Date(),
          updatedByUserId: actorUserId,
        })
        .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.id, id)))
        .returning();

      if (!updated) return res.status(404).json({ success: false, message: "Product Planning work item not found." });

      await recordPlanningEvent({
        organizationId,
        workItemId: id,
        eventType: "archived",
        message: `Archived ${updated.reference}`,
        actorUserId,
      });

      res.json({ success: true, data: updated, message: "Product Planning work item archived." });
    } catch (error) {
      console.error("[ProductPlanning] Archive failed:", error);
      res.status(500).json({ success: false, message: "Failed to archive Product Planning work item." });
    }
  });

  app.post("/api/product-planning/work-items/:id/move-status", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const input = moveStatusSchema.parse(req.body ?? {});
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const id = String(req.params.id);

      const [existing] = await db
        .select()
        .from(productPlanningWorkItems)
        .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.id, id)))
        .limit(1);
      if (!existing) return res.status(404).json({ success: false, message: "Product Planning work item not found." });

      const [updated] = await db
        .update(productPlanningWorkItems)
        .set({
          planningStatus: input.planningStatus,
          sortOrder: input.sortOrder ?? existing.sortOrder,
          archivedAt: input.planningStatus === "archived" ? (existing.archivedAt ?? new Date()) : existing.archivedAt,
          updatedAt: new Date(),
          updatedByUserId: actorUserId,
        })
        .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.id, id)))
        .returning();

      await recordPlanningEvent({
        organizationId,
        workItemId: id,
        eventType: "status_changed",
        message: `Status changed from ${existing.planningStatus} to ${updated.planningStatus}`,
        metadata: {
          previousStatus: existing.planningStatus,
          nextStatus: updated.planningStatus,
          previousSortOrder: existing.sortOrder,
          nextSortOrder: updated.sortOrder,
        },
        actorUserId,
      });

      res.json({ success: true, data: updated, message: "Product Planning status updated." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: fromZodError(error).message });
      console.error("[ProductPlanning] Move status failed:", error);
      res.status(500).json({ success: false, message: "Failed to move Product Planning work item status." });
    }
  });

  app.post("/api/product-planning/work-items/:id/move-phase", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const input = movePhaseSchema.parse(req.body ?? {});
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const id = String(req.params.id);

      const [existing] = await db
        .select()
        .from(productPlanningWorkItems)
        .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.id, id)))
        .limit(1);
      if (!existing) return res.status(404).json({ success: false, message: "Product Planning work item not found." });

      const [updated] = await db
        .update(productPlanningWorkItems)
        .set({
          phase: input.phase,
          roadmapOrder: input.roadmapOrder ?? existing.roadmapOrder,
          updatedAt: new Date(),
          updatedByUserId: actorUserId,
        })
        .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.id, id)))
        .returning();

      await recordPlanningEvent({
        organizationId,
        workItemId: id,
        eventType: "phase_changed",
        message: `Phase changed from ${existing.phase ?? "unassigned"} to ${updated.phase ?? "unassigned"}`,
        metadata: {
          previousPhase: existing.phase,
          nextPhase: updated.phase,
          previousRoadmapOrder: existing.roadmapOrder,
          nextRoadmapOrder: updated.roadmapOrder,
        },
        actorUserId,
      });

      res.json({ success: true, data: updated, message: "Product Planning phase updated." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: fromZodError(error).message });
      console.error("[ProductPlanning] Move phase failed:", error);
      res.status(500).json({ success: false, message: "Failed to move Product Planning work item phase." });
    }
  });

  app.post("/api/product-planning/work-items/reorder", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const input = reorderSchema.parse(req.body ?? {});
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const requestedIds = Array.from(new Set(input.items.map((item) => item.id)));
      const existingRows = await db
        .select({ id: productPlanningWorkItems.id })
        .from(productPlanningWorkItems)
        .where(and(eq(productPlanningWorkItems.organizationId, organizationId), inArray(productPlanningWorkItems.id, requestedIds)));
      const existingIds = new Set(existingRows.map((row) => row.id));
      const missingIds = requestedIds.filter((id) => !existingIds.has(id));
      if (missingIds.length > 0) {
        return res.status(404).json({
          success: false,
          message: "One or more Product Planning work items were not found.",
          data: { missingIds },
        });
      }

      const updated = await db.transaction(async (tx) => {
        const rows = [];
        for (const item of input.items) {
          const updateValues: Record<string, unknown> = {
            updatedAt: new Date(),
            updatedByUserId: actorUserId,
          };
          if (Object.prototype.hasOwnProperty.call(item, "sortOrder")) updateValues.sortOrder = item.sortOrder ?? null;
          if (Object.prototype.hasOwnProperty.call(item, "roadmapOrder")) updateValues.roadmapOrder = item.roadmapOrder ?? null;
          if (Object.prototype.hasOwnProperty.call(item, "planningStatus")) updateValues.planningStatus = item.planningStatus;
          if (Object.prototype.hasOwnProperty.call(item, "phase")) updateValues.phase = item.phase ?? null;

          const [row] = await tx
            .update(productPlanningWorkItems)
            .set(updateValues)
            .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.id, item.id)))
            .returning();
          if (row) {
            rows.push(row);
            await recordPlanningEvent({
              organizationId,
              workItemId: row.id,
              eventType: "reordered",
              message: `Reordered ${row.reference}`,
              metadata: {
                sortOrder: row.sortOrder,
                roadmapOrder: row.roadmapOrder,
                planningStatus: row.planningStatus,
                phase: row.phase,
              },
              actorUserId,
              executor: tx,
            });
          }
        }
        return rows;
      });

      res.json({ success: true, data: updated, message: "Product Planning work items reordered." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: fromZodError(error).message });
      console.error("[ProductPlanning] Reorder failed:", error);
      res.status(500).json({ success: false, message: "Failed to reorder Product Planning work items." });
    }
  });

  app.get("/api/product-planning/dashboard", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const openCondition = and(
        eq(productPlanningWorkItems.organizationId, organizationId),
        isNull(productPlanningWorkItems.archivedAt),
        ne(productPlanningWorkItems.planningStatus, "archived"),
      );

      const [summary] = await db
        .select({
          totalBacklogCount: sql<number>`count(*) filter (where ${productPlanningWorkItems.planningStatus} = 'backlog')::int`,
          criticalOpenBugCount: sql<number>`count(*) filter (where ${productPlanningWorkItems.workItemType} = 'bug' and ${productPlanningWorkItems.priority} = 'critical')::int`,
          highOpenBugCount: sql<number>`count(*) filter (where ${productPlanningWorkItems.workItemType} = 'bug' and ${productPlanningWorkItems.priority} = 'high')::int`,
          openBugCount: sql<number>`count(*) filter (where ${productPlanningWorkItems.workItemType} = 'bug')::int`,
          itemsInTesting: sql<number>`count(*) filter (where ${productPlanningWorkItems.planningStatus} = 'testing')::int`,
          itemsInDevValidation: sql<number>`count(*) filter (where ${productPlanningWorkItems.planningStatus} = 'dev_validation')::int`,
          itemsInMainValidation: sql<number>`count(*) filter (where ${productPlanningWorkItems.planningStatus} = 'main_validation')::int`,
        })
        .from(productPlanningWorkItems)
        .where(openCondition);

      const byStatus = await db
        .select({ key: productPlanningWorkItems.planningStatus, count: sql<number>`count(*)::int` })
        .from(productPlanningWorkItems)
        .where(openCondition)
        .groupBy(productPlanningWorkItems.planningStatus);

      const byPhase = await db
        .select({ key: productPlanningWorkItems.phase, count: sql<number>`count(*)::int` })
        .from(productPlanningWorkItems)
        .where(and(openCondition!, isNotNull(productPlanningWorkItems.phase)))
        .groupBy(productPlanningWorkItems.phase);

      const byModule = await db
        .select({ key: productPlanningWorkItems.module, count: sql<number>`count(*)::int` })
        .from(productPlanningWorkItems)
        .where(and(openCondition!, isNotNull(productPlanningWorkItems.module)))
        .groupBy(productPlanningWorkItems.module)
        .orderBy(desc(sql`count(*)`))
        .limit(12);

      const topPrioritizedFeatures = await db
        .select()
        .from(productPlanningWorkItems)
        .where(and(
          openCondition!,
          or(eq(productPlanningWorkItems.workItemType, "feature"), eq(productPlanningWorkItems.workItemType, "enhancement"), eq(productPlanningWorkItems.workItemType, "epic"))!,
        ))
        .orderBy(orderExpression("priority", "asc"), asc(productPlanningWorkItems.createdAt))
        .limit(8);

      const majorBugs = await db
        .select()
        .from(productPlanningWorkItems)
        .where(and(
          openCondition!,
          eq(productPlanningWorkItems.workItemType, "bug"),
          or(eq(productPlanningWorkItems.priority, "critical"), eq(productPlanningWorkItems.priority, "high"))!,
        ))
        .orderBy(orderExpression("priority", "asc"), asc(productPlanningWorkItems.createdAt))
        .limit(8);

      const topPriorityScoreFeatures = await db
        .select()
        .from(productPlanningWorkItems)
        .where(and(
          openCondition!,
          isNotNull(productPlanningWorkItems.priorityScore),
          or(eq(productPlanningWorkItems.workItemType, "feature"), eq(productPlanningWorkItems.workItemType, "enhancement"), eq(productPlanningWorkItems.workItemType, "epic"))!,
        ))
        .orderBy(desc(productPlanningWorkItems.priorityScore), orderExpression("priority", "asc"), asc(productPlanningWorkItems.createdAt))
        .limit(10);

      const majorBugsBlockingGoLive = await db
        .select()
        .from(productPlanningWorkItems)
        .where(and(
          openCondition!,
          eq(productPlanningWorkItems.workItemType, "bug"),
          eq(productPlanningWorkItems.phase, "go_live"),
          or(eq(productPlanningWorkItems.priority, "critical"), eq(productPlanningWorkItems.priority, "high"))!,
        ))
        .orderBy(orderExpression("priority", "asc"), asc(productPlanningWorkItems.createdAt))
        .limit(10);

      const stalledSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const itemsStalledInValidation = await db
        .select()
        .from(productPlanningWorkItems)
        .where(and(
          openCondition!,
          inArray(productPlanningWorkItems.planningStatus, ["testing", "dev_validation", "main_validation"]),
          sql`${productPlanningWorkItems.updatedAt} < ${stalledSince}`,
        ))
        .orderBy(asc(productPlanningWorkItems.updatedAt))
        .limit(10);

      const itemsWithUnresolvedDependencies = await db
        .select()
        .from(productPlanningWorkItems)
        .where(and(
          openCondition!,
          sql`EXISTS (
            SELECT 1
            FROM product_planning_dependencies dep
            INNER JOIN product_planning_work_items blocker
              ON blocker.id = dep.depends_on_work_item_id
             AND blocker.organization_id = dep.organization_id
            WHERE dep.organization_id = ${organizationId}
              AND dep.work_item_id = ${productPlanningWorkItems.id}
              AND blocker.archived_at IS NULL
              AND blocker.planning_status <> 'released'
          )`,
        ))
        .orderBy(orderExpression("priority", "asc"), asc(productPlanningWorkItems.createdAt))
        .limit(10);

      const [unresolvedDependencySummary] = await db
        .select({
          unresolvedDependencyCount: sql<number>`count(*)::int`,
        })
        .from(productPlanningWorkItems)
        .where(and(
          openCondition!,
          sql`EXISTS (
            SELECT 1
            FROM product_planning_dependencies dep
            INNER JOIN product_planning_work_items blocker
              ON blocker.id = dep.depends_on_work_item_id
             AND blocker.organization_id = dep.organization_id
            WHERE dep.organization_id = ${organizationId}
              AND dep.work_item_id = ${productPlanningWorkItems.id}
              AND blocker.archived_at IS NULL
              AND blocker.planning_status <> 'released'
          )`,
        ));

      const releaseProgress = rowsFromExecute(await db.execute(sql`
        SELECT
          r.id,
          r.name,
          r.status,
          r.target_date AS "targetDate",
          count(w.id)::int AS "totalCount",
          count(w.id) FILTER (WHERE w.planning_status = 'released')::int AS "releasedCount",
          count(w.id) FILTER (WHERE w.id IS NOT NULL AND w.archived_at IS NULL AND w.planning_status <> 'released')::int AS "openCount"
        FROM product_planning_releases r
        LEFT JOIN product_planning_work_items w
          ON w.release_id = r.id
         AND w.organization_id = r.organization_id
        WHERE r.organization_id = ${organizationId}
          AND r.archived_at IS NULL
        GROUP BY r.id, r.name, r.status, r.target_date, r.created_at
        ORDER BY r.target_date NULLS LAST, r.created_at
        LIMIT 8
      `));

      const [cleanupSummary] = rowsFromExecute<{
        missingModuleCount: number;
        missingPhaseCount: number;
        missingPriorityCount: number;
        orphanedEpicCount: number;
        unassignedReleaseCount: number;
      }>(await db.execute(sql`
        SELECT
          count(*) FILTER (WHERE module IS NULL OR btrim(module) = '')::int AS "missingModuleCount",
          count(*) FILTER (WHERE phase IS NULL)::int AS "missingPhaseCount",
          count(*) FILTER (WHERE priority IS NULL)::int AS "missingPriorityCount",
          count(*) FILTER (WHERE release_id IS NULL AND (release_target IS NULL OR btrim(release_target) = ''))::int AS "unassignedReleaseCount",
          count(*) FILTER (
            WHERE work_item_type = 'epic'
              AND NOT EXISTS (
                SELECT 1
                FROM product_planning_work_items child
                WHERE child.organization_id = product_planning_work_items.organization_id
                  AND child.parent_id = product_planning_work_items.id
                  AND child.archived_at IS NULL
              )
          )::int AS "orphanedEpicCount"
        FROM product_planning_work_items
        WHERE organization_id = ${organizationId}
          AND archived_at IS NULL
          AND planning_status <> 'archived'
      `));
      const [duplicateSummary] = rowsFromExecute<{ possibleDuplicateCount: number }>(await db.execute(sql`
        SELECT coalesce(sum(group_count), 0)::int AS "possibleDuplicateCount"
        FROM (
          SELECT count(*)::int AS group_count
          FROM product_planning_work_items
          WHERE organization_id = ${organizationId}
            AND archived_at IS NULL
            AND planning_status <> 'archived'
          GROUP BY lower(title), lower(coalesce(module, ''))
          HAVING count(*) > 1
        ) duplicate_groups
      `));
      const cleanupOpportunities = [
        {
          key: "possible_duplicates",
          label: "Possible duplicates",
          count: duplicateSummary?.possibleDuplicateCount ?? 0,
          href: "/product-planning/backlog?sortBy=updatedAt",
        },
        {
          key: "missing_modules",
          label: "Items missing modules",
          count: cleanupSummary?.missingModuleCount ?? 0,
          href: "/product-planning/backlog?module=",
        },
        {
          key: "missing_phases",
          label: "Items missing phases",
          count: cleanupSummary?.missingPhaseCount ?? 0,
          href: "/product-planning/backlog?sortBy=updatedAt",
        },
        {
          key: "missing_priorities",
          label: "Items missing priorities",
          count: cleanupSummary?.missingPriorityCount ?? 0,
          href: "/product-planning/backlog?sortBy=priority",
        },
        {
          key: "orphaned_epics",
          label: "Orphaned epics",
          count: cleanupSummary?.orphanedEpicCount ?? 0,
          href: "/product-planning/backlog?workItemType=epic",
        },
        {
          key: "unassigned_releases",
          label: "Unassigned releases",
          count: cleanupSummary?.unassignedReleaseCount ?? 0,
          href: "/product-planning/backlog?sortBy=updatedAt",
        },
      ];

      res.json({
        success: true,
        data: {
          totalBacklogCount: summary?.totalBacklogCount ?? 0,
          criticalOpenBugCount: summary?.criticalOpenBugCount ?? 0,
          highOpenBugCount: summary?.highOpenBugCount ?? 0,
          openBugCount: summary?.openBugCount ?? 0,
          itemsInTesting: summary?.itemsInTesting ?? 0,
          itemsInDevValidation: summary?.itemsInDevValidation ?? 0,
          itemsInMainValidation: summary?.itemsInMainValidation ?? 0,
          topPrioritizedFeatures,
          majorBugs,
          topPriorityScoreFeatures,
          majorBugsBlockingGoLive,
          releaseProgress,
          itemsStalledInValidation,
          itemsWithUnresolvedDependencies,
          unresolvedDependencyCount: unresolvedDependencySummary?.unresolvedDependencyCount ?? 0,
          byModuleWorkload: byModule,
          cleanupOpportunities,
          byStatus,
          byPhase,
          byModule,
        },
      });
    } catch (error) {
      console.error("[ProductPlanning] Dashboard failed:", error);
      res.status(500).json({ success: false, message: "Failed to load Product Planning dashboard." });
    }
  });

  app.post("/api/product-planning/roadmap/suggest-grouping", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const rows = await listAiCandidateWorkItems(organizationId);
      const drafts = generateRoadmapGroupingSuggestions(rows);
      const suggestions = await persistAiSuggestions(organizationId, drafts);
      for (const suggestion of suggestions) {
        if (!suggestion.workItemId) continue;
        await recordPlanningEvent({
          organizationId,
          workItemId: suggestion.workItemId,
          eventType: "ai_roadmap_recommendation_generated",
          message: "AI suggested roadmap grouping",
          metadata: { suggestionId: suggestion.id, suggestedValue: suggestion.suggestedValue },
          actorUserId,
        });
      }
      res.status(201).json({ success: true, data: suggestions, message: "Roadmap grouping suggestions generated." });
    } catch (error) {
      console.error("[ProductPlanning] Roadmap AI grouping failed:", error);
      res.status(500).json({ success: false, message: "Failed to generate roadmap suggestions." });
    }
  });

  app.post("/api/product-planning/ai/analyze-backlog", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const items = await listAiCandidateWorkItems(organizationId);
      const analysis = generateBacklogAnalysis(items);
      const suggestions = await persistAiSuggestions(organizationId, analysis.suggestions);
      await recordProductPlanningAudit({
        organizationId,
        actorUserId,
        actionType: "ai_backlog_analysis_generated",
        entityType: "product_planning_backlog",
        description: "AI backlog analysis generated for Product Planning.",
        newValues: {
          counts: analysis.counts,
          healthScore: analysis.healthScore,
          suggestionCount: suggestions.length,
          nextActions: analysis.nextActions,
        },
      });
      res.status(201).json({
        success: true,
        data: { ...analysis, suggestions },
        message: "Backlog analysis generated.",
      });
    } catch (error) {
      console.error("[ProductPlanning] Backlog AI analysis failed:", error);
      res.status(500).json({ success: false, message: "Failed to generate backlog analysis." });
    }
  });

  app.post("/api/product-planning/ai/suggest-epics", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const items = await listAiCandidateWorkItems(organizationId);
      const drafts = generateEpicDiscoverySuggestions(items);
      const suggestions = await persistAiSuggestions(organizationId, drafts);
      await recordProductPlanningAudit({
        organizationId,
        actorUserId,
        actionType: "ai_epic_suggestions_generated",
        entityType: "product_planning_backlog",
        description: "AI epic discovery suggestions generated for Product Planning.",
        newValues: { suggestionCount: suggestions.length },
      });
      res.status(201).json({ success: true, data: { suggestions }, message: "Epic suggestions generated." });
    } catch (error) {
      console.error("[ProductPlanning] Epic discovery failed:", error);
      res.status(500).json({ success: false, message: "Failed to generate epic suggestions." });
    }
  });

  app.post("/api/product-planning/ai/go-live-readiness", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const analysis = generateBacklogAnalysis(await listAiCandidateWorkItems(organizationId));
      await recordProductPlanningAudit({
        organizationId,
        actorUserId,
        actionType: "ai_go_live_readiness_generated",
        entityType: "product_planning_backlog",
        description: "AI go-live readiness analysis generated for Product Planning.",
        newValues: analysis.goLiveReadiness,
      });
      res.status(201).json({ success: true, data: analysis.goLiveReadiness, message: "Go-live readiness generated." });
    } catch (error) {
      console.error("[ProductPlanning] Go-live readiness failed:", error);
      res.status(500).json({ success: false, message: "Failed to generate go-live readiness." });
    }
  });

  app.post("/api/product-planning/ai/backlog-health", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const analysis = generateBacklogAnalysis(await listAiCandidateWorkItems(organizationId));
      const data = { healthScore: analysis.healthScore, issues: analysis.issues, suggestedFixes: analysis.nextActions, counts: analysis.counts };
      await recordProductPlanningAudit({
        organizationId,
        actorUserId,
        actionType: "ai_backlog_health_generated",
        entityType: "product_planning_backlog",
        description: "AI backlog health score generated for Product Planning.",
        newValues: data,
      });
      res.status(201).json({ success: true, data, message: "Backlog health generated." });
    } catch (error) {
      console.error("[ProductPlanning] Backlog health failed:", error);
      res.status(500).json({ success: false, message: "Failed to generate backlog health." });
    }
  });

  app.post("/api/product-planning/roadmap/analyze", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const analysis = generateRoadmapAnalysis(await listAiCandidateWorkItems(organizationId));
      const suggestions = await persistAiSuggestions(organizationId, analysis.suggestions);
      await recordProductPlanningAudit({
        organizationId,
        actorUserId,
        actionType: "ai_roadmap_analysis_generated",
        entityType: "product_planning_roadmap",
        description: "AI roadmap analysis generated for Product Planning.",
        newValues: { recommendations: analysis.recommendations, suggestionCount: suggestions.length },
      });
      res.status(201).json({ success: true, data: { recommendations: analysis.recommendations, suggestions }, message: "Roadmap analysis generated." });
    } catch (error) {
      console.error("[ProductPlanning] Roadmap analysis failed:", error);
      res.status(500).json({ success: false, message: "Failed to generate roadmap analysis." });
    }
  });

  app.post("/api/product-planning/import/csv/preview", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const { csv } = csvPreviewSchema.parse(req.body ?? {});
      const organizationId = getRequestOrganizationId(req);
      const preview = parseProductPlanningCsv(csv);
      const duplicateWarnings = [];

      for (const row of preview.validRows) {
        const duplicate = await findDuplicateByTitleModule(organizationId, row.title, row.module);
        if (duplicate) {
          duplicateWarnings.push({
            rowNumber: row.rowNumber,
            message: `Possible duplicate of ${duplicate.reference}: ${duplicate.title}`,
            existingWorkItemId: duplicate.id,
            existingReference: duplicate.reference,
          });
        }
      }

      res.json({ success: true, data: { ...preview, duplicateWarnings } });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: fromZodError(error).message });
      console.error("[ProductPlanning] CSV preview failed:", error);
      res.status(500).json({ success: false, message: "Failed to preview Product Planning CSV." });
    }
  });

  app.post("/api/product-planning/import/csv/ai-review", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const { csv } = csvPreviewSchema.parse(req.body ?? {});
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const preview = parseProductPlanningCsv(csv);
      const duplicateWarnings = [];

      for (const row of preview.validRows) {
        const duplicate = await findDuplicateByTitleModule(organizationId, row.title, row.module);
        if (duplicate) {
          duplicateWarnings.push({
            rowNumber: row.rowNumber,
            message: `Possible duplicate of ${duplicate.reference}: ${duplicate.title}`,
            existingWorkItemId: duplicate.id,
            existingReference: duplicate.reference,
          });
        }
      }

      const drafts = generateImportCleanupSuggestions({ mappedRows: preview.mappedRows, duplicateWarnings });
      const suggestions = await persistAiSuggestions(organizationId, drafts);
      await recordProductPlanningAudit({
        organizationId,
        actorUserId,
        actionType: "ai_import_review_generated",
        entityType: "product_planning_import_preview",
        description: "AI import cleanup review generated for Product Planning CSV preview.",
        newValues: {
          suggestionCount: suggestions.length,
          duplicateWarningCount: duplicateWarnings.length,
          parsedRowCount: preview.counts.parsed,
        },
      });
      res.status(201).json({
        success: true,
        data: { suggestions, counts: { suggestions: suggestions.length, duplicateWarnings: duplicateWarnings.length } },
        message: "Import cleanup suggestions generated.",
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: fromZodError(error).message });
      console.error("[ProductPlanning] Import AI review failed:", error);
      res.status(500).json({ success: false, message: "Failed to generate import cleanup suggestions." });
    }
  });

  app.post("/api/product-planning/imports/:batchId/analyze", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const batchId = String(req.params.batchId);
      const [batch] = await db
        .select()
        .from(productPlanningImportBatches)
        .where(and(eq(productPlanningImportBatches.organizationId, organizationId), eq(productPlanningImportBatches.id, batchId)))
        .limit(1);
      if (!batch) return res.status(404).json({ success: false, message: "Product Planning import batch not found." });
      const importedItems = await db
        .select()
        .from(productPlanningWorkItems)
        .where(and(
          eq(productPlanningWorkItems.organizationId, organizationId),
          eq(productPlanningWorkItems.importedBatchId, batchId),
          isNull(productPlanningWorkItems.archivedAt),
        ))
        .limit(250);
      const allItems = await listAiCandidateWorkItems(organizationId);
      const importedIds = new Set(importedItems.map((item) => item.id));
      const analysis = generateBacklogAnalysis(importedItems);
      const duplicateSuggestions = importedItems.flatMap((item) =>
        findSimilarProductPlanningItems(item, allItems.filter((candidate) => !importedIds.has(candidate.id)), 2).map((candidate) => ({
          workItemId: item.id,
          suggestionType: "duplicate_candidate" as const,
          currentValue: { id: item.id, reference: item.reference, title: item.title },
          suggestedValue: {
            id: candidate.item.id,
            reference: candidate.item.reference,
            title: candidate.item.title,
            similarity: candidate.similarity,
          },
          confidence: candidate.similarity,
          reasoning: candidate.reasoning,
        }))
      );
      const suggestions = await persistAiSuggestions(organizationId, [...analysis.suggestions, ...duplicateSuggestions].slice(0, 100));
      await recordProductPlanningAudit({
        organizationId,
        actorUserId,
        actionType: "ai_import_analysis_generated",
        entityType: "product_planning_import_batch",
        entityId: batchId,
        entityName: batch.filename ?? "CSV import",
        description: "AI imported backlog analysis generated for Product Planning.",
        newValues: { counts: analysis.counts, suggestionCount: suggestions.length },
      });
      res.status(201).json({ success: true, data: { ...analysis, suggestions }, message: "Imported backlog analysis generated." });
    } catch (error) {
      console.error("[ProductPlanning] Import batch analysis failed:", error);
      res.status(500).json({ success: false, message: "Failed to analyze imported backlog." });
    }
  });

  app.post("/api/product-planning/import/csv/commit", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const input = csvCommitSchema.parse(req.body ?? {});
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const preview = parseProductPlanningCsv(input.csv);

      const batch = await db.transaction(async (tx) => {
        const [createdBatch] = await tx
          .insert(productPlanningImportBatches)
          .values({
            organizationId,
            filename: input.filename ?? null,
            rowCount: preview.counts.parsed,
            status: "pending",
            createdByUserId: actorUserId,
          })
          .returning();

        let importedCount = 0;
        let skippedCount = preview.invalidRows.length;
        const importedItems = [];
        const skippedRows = preview.invalidRows.map((row) => ({
          rowNumber: row.rowNumber,
          title: row.title || null,
          reason: row.errors.join("; "),
        }));

        for (const row of preview.validRows) {
          if (!input.allowDuplicates) {
            const duplicate = await findDuplicateByTitleModule(organizationId, row.title, row.module);
            if (duplicate) {
              skippedCount++;
              skippedRows.push({
                rowNumber: row.rowNumber,
                title: row.title,
                reason: `Duplicate of ${duplicate.reference}`,
              });
              continue;
            }
          }

          const reference = await allocateProductPlanningReference(organizationId, tx);
          const [item] = await tx
            .insert(productPlanningWorkItems)
            .values(workItemValuesFromCsvRow(row, organizationId, actorUserId, reference, createdBatch.id))
            .returning();
          importedCount++;
          importedItems.push(item);
          await recordPlanningEvent({
            organizationId,
            workItemId: item.id,
            eventType: "imported_from_csv",
            message: `Imported ${item.reference} from CSV`,
            metadata: { rowNumber: row.rowNumber, sourceReference: row.sourceReference, warnings: row.warnings },
            actorUserId,
            executor: tx,
          });
        }

        const status = preview.invalidRows.length > 0 || skippedRows.length > 0 ? "completed_with_errors" : "completed";
        const [updatedBatch] = await tx
          .update(productPlanningImportBatches)
          .set({
            importedCount,
            skippedCount,
            errorCount: preview.invalidRows.length,
            status,
          })
          .where(eq(productPlanningImportBatches.id, createdBatch.id))
          .returning();

        return { batch: updatedBatch, importedItems, skippedRows };
      });

      res.status(201).json({ success: true, data: batch, message: "Product Planning CSV import completed." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: fromZodError(error).message });
      console.error("[ProductPlanning] CSV commit failed:", error);
      res.status(500).json({ success: false, message: "Failed to commit Product Planning CSV import." });
    }
  });

  app.get("/api/product-planning/imports", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const rows = await db
        .select()
        .from(productPlanningImportBatches)
        .where(eq(productPlanningImportBatches.organizationId, organizationId))
        .orderBy(desc(productPlanningImportBatches.createdAt))
        .limit(50);
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error("[ProductPlanning] Import history failed:", error);
      res.status(500).json({ success: false, message: "Failed to load Product Planning imports." });
    }
  });

  app.post("/api/bug-reports/:id/product-planning-summary", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const id = String(req.params.id);
      const [bugReport] = await db
        .select()
        .from(bugReports)
        .where(and(eq(bugReports.orgId, organizationId), eq(bugReports.id, id)))
        .limit(1);
      if (!bugReport) return res.status(404).json({ success: false, message: "Bug report not found." });

      const summary = generateBugPlanningSummary(bugReport);
      const [suggestion] = await persistAiSuggestions(organizationId, [{
        workItemId: null,
        suggestionType: "implementation_notes",
        currentValue: {
          bugReportId: bugReport.id,
          referenceNumber: bugReport.referenceNumber,
          title: bugReport.title,
          severity: bugReport.severity,
        },
        suggestedValue: summary,
        confidence: 74,
        reasoning: summary.reasoning,
      }]);

      res.status(201).json({ success: true, data: { summary, suggestion }, message: "Planning summary generated for review." });
    } catch (error) {
      console.error("[ProductPlanning] Bug summary generation failed:", error);
      res.status(500).json({ success: false, message: "Failed to generate Product Planning summary." });
    }
  });

  app.post("/api/bug-reports/:id/create-product-planning-from-summary", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const input = createFromBugSummarySchema.parse(req.body ?? {});
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const id = String(req.params.id);
      const [bugReport] = await db
        .select()
        .from(bugReports)
        .where(and(eq(bugReports.orgId, organizationId), eq(bugReports.id, id)))
        .limit(1);
      if (!bugReport) return res.status(404).json({ success: false, message: "Bug report not found." });

      const [existing] = await db
        .select()
        .from(productPlanningWorkItems)
        .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.sourceBugReportId, id)))
        .limit(1);
      if (existing) {
        return res.status(409).json({
          success: false,
          code: "BUG_REPORT_ALREADY_PUSHED",
          message: "This bug report is already in Product Planning.",
          data: existing,
        });
      }

      const created = await db.transaction(async (tx) => {
        const reference = await allocateProductPlanningReference(organizationId, tx);
        const [item] = await tx
          .insert(productPlanningWorkItems)
          .values({
            organizationId,
            reference,
            title: input.title,
            description: input.description,
            workItemType: "bug",
            planningStatus: "backlog",
            priority: input.priority,
            module: input.module ?? null,
            sourceType: "bug_report",
            sourceBugReportId: bugReport.id,
            sourceReference: bugReport.referenceNumber,
            requestedBy: bugReport.createdByEmail,
            notes: bugReport.url ? `Source page: ${bugReport.url}` : null,
            createdByUserId: actorUserId,
            updatedByUserId: actorUserId,
          })
          .returning();
        await recordPlanningEvent({
          organizationId,
          workItemId: item.id,
          eventType: "ai_summary_generated",
          message: `Created ${item.reference} from reviewed AI bug summary`,
          metadata: { bugReportId: bugReport.id, sourceReference: bugReport.referenceNumber },
          actorUserId,
          executor: tx,
        });
        await recordPlanningEvent({
          organizationId,
          workItemId: item.id,
          eventType: "pushed_from_bug_report",
          message: `Pushed from bug report ${bugReport.referenceNumber}`,
          metadata: { bugReportId: bugReport.id },
          actorUserId,
          executor: tx,
        });
        return item;
      });

      res.status(201).json({ success: true, data: created, message: "Product Planning item created from reviewed summary." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: fromZodError(error).message });
      console.error("[ProductPlanning] Create from bug summary failed:", error);
      res.status(500).json({ success: false, message: "Failed to create Product Planning item from summary." });
    }
  });

  app.post("/api/bug-reports/:id/push-to-product-planning", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;
      const id = String(req.params.id);

      const [bugReport] = await db
        .select()
        .from(bugReports)
        .where(and(eq(bugReports.orgId, organizationId), eq(bugReports.id, id)))
        .limit(1);

      if (!bugReport) return res.status(404).json({ success: false, message: "Bug report not found." });

      const [existing] = await db
        .select()
        .from(productPlanningWorkItems)
        .where(and(eq(productPlanningWorkItems.organizationId, organizationId), eq(productPlanningWorkItems.sourceBugReportId, id)))
        .limit(1);

      if (existing) {
        return res.status(409).json({
          success: false,
          code: "BUG_REPORT_ALREADY_PUSHED",
          message: "This bug report is already in Product Planning.",
          data: existing,
        });
      }

      const created = await db.transaction(async (tx) => {
        const reference = await allocateProductPlanningReference(organizationId, tx);
        const [item] = await tx
          .insert(productPlanningWorkItems)
          .values({
            organizationId,
            reference,
            title: bugReport.title,
            description: bugReport.description,
            workItemType: "bug",
            planningStatus: "backlog",
            priority: priorityFromBugSeverity(bugReport.severity),
            sourceType: "bug_report",
            sourceBugReportId: bugReport.id,
            sourceReference: bugReport.referenceNumber,
            requestedBy: bugReport.createdByEmail,
            notes: bugReport.url ? `Source page: ${bugReport.url}` : null,
            createdByUserId: actorUserId,
            updatedByUserId: actorUserId,
          })
          .returning();
        await recordPlanningEvent({
          organizationId,
          workItemId: item.id,
          eventType: "pushed_from_bug_report",
          message: `Pushed from bug report ${bugReport.referenceNumber}`,
          metadata: {
            bugReportId: bugReport.id,
            bugReportReference: bugReport.referenceNumber,
            severity: bugReport.severity,
            status: bugReport.status,
          },
          actorUserId,
          executor: tx,
        });
        return item;
      });

      res.status(201).json({ success: true, data: created, message: "Bug report pushed to Product Planning." });
    } catch (error) {
      const err = error as any;
      if (err?.code === "23505") {
        return res.status(409).json({ success: false, code: "PRODUCT_PLANNING_DUPLICATE", message: "A Product Planning item already exists for this source." });
      }
      console.error("[ProductPlanning] Bug report push failed:", error);
      res.status(500).json({ success: false, message: "Failed to push bug report to Product Planning." });
    }
  });
}
