import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import {
  bugReports,
  productPlanningBusinessValueValues,
  productPlanningComplexityValues,
  productPlanningEvents,
  productPlanningImportBatches,
  productPlanningPhaseValues,
  productPlanningPriorityValues,
  productPlanningSourceTypeValues,
  productPlanningStatusValues,
  productPlanningWorkItems,
  productPlanningWorkItemTypeValues,
} from "@shared/schema";
import {
  parseProductPlanningCsv,
  type ProductPlanningImportMappedRow,
} from "../services/productPlanningCsv";
import { validateProductPlanningParent } from "../services/productPlanningHierarchy";

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
  includeArchived: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "priority", "reference", "module", "phase", "roadmapOrder", "sortOrder"]).default("updatedAt"),
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

function toWorkItemInsert(input: z.infer<typeof createWorkItemSchema>, organizationId: string, actorUserId: string | null, reference: string) {
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
    roadmapOrder: productPlanningWorkItems.roadmapOrder,
    sortOrder: productPlanningWorkItems.sortOrder,
  }[sortBy];

  return sortDirection === "asc" ? asc(column) : desc(column);
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

export function registerProductPlanningRoutes(
  app: Express,
  middleware: {
    isAuthenticated: RequestHandler;
    tenantContext: RequestHandler;
    assertInternalUser: (req: any, res: any) => boolean;
  },
): void {
  const { isAuthenticated, tenantContext, assertInternalUser } = middleware;

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

      res.json({ success: true, data: { ...item, parent, children, events } });
    } catch (error) {
      console.error("[ProductPlanning] Detail failed:", error);
      res.status(500).json({ success: false, message: "Failed to fetch Product Planning work item." });
    }
  });

  app.post("/api/product-planning/work-items", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!assertInternalUser(req, res) || !requireProductPlanningAccess(req, res)) return;
      const input = createWorkItemSchema.parse(req.body ?? {});
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) ?? null;

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

      const updateValues = {
        ...input,
        tags: input.tags,
        updatedByUserId: actorUserId,
        updatedAt: new Date(),
      };
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
