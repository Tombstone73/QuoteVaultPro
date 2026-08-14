import type { Express } from "express";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import { pbv2OptionGroupTemplates } from "@shared/schema";
import {
  cloneTemplateIntoTree,
  extractOptionGroupTemplateTree,
  validateOptionGroupTemplateTree,
  type OptionGroupTemplateValidationError,
} from "@shared/pbv2/optionGroupTemplates";
import { sanitizePbv2PricingMatrix } from "@shared/pbv2/pricingMatrixSanitizer";

type RouteDeps = {
  isAuthenticated: any;
  tenantContext: any;
  isAdmin: any;
};

const metadataSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  category: z.string().min(1).max(120).optional(),
  slug: z.string().min(1).max(180).optional(),
  description: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string()).optional(),
  difficultyLevel: z.string().max(80).nullable().optional(),
  recommendedProductTypes: z.array(z.string()).optional(),
  recommendedIndustries: z.array(z.string()).optional(),
  recommendedPairings: z.array(z.string()).optional(),
  compatibilityMetadata: z.record(z.unknown()).optional(),
  workflowMetadata: z.record(z.unknown()).optional(),
  pricingMetadata: z.record(z.unknown()).optional(),
  intentMetadata: z.record(z.unknown()).optional(),
  previewConfig: z.record(z.unknown()).optional(),
});

const fromGroupSchema = metadataSchema.extend({
  treeJson: z.record(z.unknown()),
  groupId: z.string().min(1),
  name: z.string().min(1).max(160),
  category: z.string().min(1).max(120),
});

const patchSchema = metadataSchema.extend({
  templateTree: z.record(z.unknown()).optional(),
});

const cloneSchema = z.object({
  currentTreeJson: z.record(z.unknown()).default({}),
  importInstanceId: z.string().min(1).max(120).optional(),
});

function success(res: any, data: unknown, message?: string, status = 200) {
  return res.status(status).json({ success: true, data, message });
}

function failure(res: any, status: number, message: string, errors?: unknown) {
  return res.status(status).json({ success: false, message, errors });
}

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180) || "template";
}

function arrayOrEmpty(value: string[] | undefined): string[] {
  return Array.isArray(value) ? value.map((entry) => entry.trim()).filter(Boolean) : [];
}

function metadataToInsert(parsed: z.infer<typeof metadataSchema>) {
  return {
    ...(parsed.name !== undefined ? { name: parsed.name } : {}),
    ...(parsed.category !== undefined ? { category: parsed.category } : {}),
    ...(parsed.slug !== undefined ? { slug: slugify(parsed.slug) } : {}),
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    ...(parsed.tags !== undefined ? { tags: arrayOrEmpty(parsed.tags) } : {}),
    ...(parsed.difficultyLevel !== undefined ? { difficultyLevel: parsed.difficultyLevel } : {}),
    ...(parsed.recommendedProductTypes !== undefined ? { recommendedProductTypes: arrayOrEmpty(parsed.recommendedProductTypes) } : {}),
    ...(parsed.recommendedIndustries !== undefined ? { recommendedIndustries: arrayOrEmpty(parsed.recommendedIndustries) } : {}),
    ...(parsed.recommendedPairings !== undefined ? { recommendedPairings: arrayOrEmpty(parsed.recommendedPairings) } : {}),
    ...(parsed.compatibilityMetadata !== undefined ? { compatibilityMetadata: parsed.compatibilityMetadata } : {}),
    ...(parsed.workflowMetadata !== undefined ? { workflowMetadata: parsed.workflowMetadata } : {}),
    ...(parsed.pricingMetadata !== undefined ? { pricingMetadata: parsed.pricingMetadata } : {}),
    ...(parsed.intentMetadata !== undefined ? { intentMetadata: parsed.intentMetadata } : {}),
    ...(parsed.previewConfig !== undefined ? { previewConfig: parsed.previewConfig } : {}),
  };
}

async function getAccessibleTemplate(id: string, organizationId: string) {
  const rows = await db
    .select()
    .from(pbv2OptionGroupTemplates)
    .where(
      and(
        eq(pbv2OptionGroupTemplates.id, id),
        or(
          eq(pbv2OptionGroupTemplates.isSystemTemplate, true),
          and(
            eq(pbv2OptionGroupTemplates.isSystemTemplate, false),
            eq(pbv2OptionGroupTemplates.organizationId, organizationId),
          ),
        ),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function makeUniqueOrgSlug(organizationId: string, baseSlug: string, ignoreId?: string): Promise<string> {
  let slug = slugify(baseSlug);
  let attempt = 2;
  while (true) {
    const rows = await db
      .select({ id: pbv2OptionGroupTemplates.id })
      .from(pbv2OptionGroupTemplates)
      .where(
        and(
          eq(pbv2OptionGroupTemplates.organizationId, organizationId),
          eq(pbv2OptionGroupTemplates.isSystemTemplate, false),
          eq(pbv2OptionGroupTemplates.slug, slug),
        ),
      )
      .limit(1);
    if (!rows[0] || rows[0].id === ignoreId) return slug;
    slug = `${slugify(baseSlug)}-${attempt++}`;
  }
}

function validationFailure(res: any, errors: OptionGroupTemplateValidationError[]) {
  return failure(res, 422, "Template tree is not self-contained.", errors);
}

export function registerPbv2OptionGroupTemplateRoutes(app: Express, { isAuthenticated, tenantContext, isAdmin }: RouteDeps) {
  app.get("/api/pbv2/option-group-templates", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const scope = String(req.query.scope ?? "all");
      const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

      const conditions: any[] = [eq(pbv2OptionGroupTemplates.state, "active")];
      if (scope === "system") {
        conditions.push(eq(pbv2OptionGroupTemplates.isSystemTemplate, true));
      } else if (scope === "organization") {
        conditions.push(
          and(
            eq(pbv2OptionGroupTemplates.isSystemTemplate, false),
            eq(pbv2OptionGroupTemplates.organizationId, organizationId),
          ),
        );
      } else {
        conditions.push(
          or(
            eq(pbv2OptionGroupTemplates.isSystemTemplate, true),
            and(
              eq(pbv2OptionGroupTemplates.isSystemTemplate, false),
              eq(pbv2OptionGroupTemplates.organizationId, organizationId),
            ),
          ),
        );
      }
      if (category) conditions.push(eq(pbv2OptionGroupTemplates.category, category));
      if (q) {
        const pattern = `%${q}%`;
        conditions.push(or(
          ilike(pbv2OptionGroupTemplates.name, pattern),
          ilike(pbv2OptionGroupTemplates.slug, pattern),
          ilike(pbv2OptionGroupTemplates.category, pattern),
          ilike(pbv2OptionGroupTemplates.description, pattern),
        ));
      }

      const templates = await db
        .select()
        .from(pbv2OptionGroupTemplates)
        .where(and(...conditions))
        .orderBy(desc(pbv2OptionGroupTemplates.isSystemTemplate), pbv2OptionGroupTemplates.category, pbv2OptionGroupTemplates.name);

      return success(res, { templates });
    } catch (error: any) {
      console.error("[pbv2-option-group-templates:list]", error);
      return failure(res, 500, "Failed to load option group templates.");
    }
  });

  app.get("/api/pbv2/option-group-templates/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const template = await getAccessibleTemplate(req.params.id, organizationId);
      if (!template || template.state !== "active") return failure(res, 404, "Template not found.");
      return success(res, { template });
    } catch (error: any) {
      console.error("[pbv2-option-group-templates:get]", error);
      return failure(res, 500, "Failed to load option group template.");
    }
  });

  app.post("/api/pbv2/option-group-templates/from-group", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const parsed = fromGroupSchema.safeParse(req.body);
      if (!parsed.success) return failure(res, 400, "Invalid template request.", parsed.error.flatten());

      const organizationId = getRequestOrganizationId(req);
      const extraction = extractOptionGroupTemplateTree(parsed.data.treeJson, parsed.data.groupId);
      if (!extraction.ok) return validationFailure(res, extraction.errors);

      const validation = validateOptionGroupTemplateTree(extraction.templateTree);
      if (!validation.ok) return validationFailure(res, validation.errors);

      const slug = await makeUniqueOrgSlug(organizationId, parsed.data.slug ?? parsed.data.name);
      const previewConfig = {
        ...(parsed.data.previewConfig ?? {}),
        ...(parsed.data.previewConfig?.usedFor ? {} : { usedFor: parsed.data.description ?? `Reusable ${parsed.data.name} option group.` }),
      };

      const inserted = await db
        .insert(pbv2OptionGroupTemplates)
        .values({
          organizationId,
          isSystemTemplate: false,
          state: "active",
          name: parsed.data.name,
          category: parsed.data.category,
          slug,
          description: parsed.data.description ?? null,
          tags: arrayOrEmpty(parsed.data.tags),
          difficultyLevel: parsed.data.difficultyLevel ?? null,
          recommendedProductTypes: arrayOrEmpty(parsed.data.recommendedProductTypes),
          recommendedIndustries: arrayOrEmpty(parsed.data.recommendedIndustries),
          recommendedPairings: arrayOrEmpty(parsed.data.recommendedPairings),
          compatibilityMetadata: parsed.data.compatibilityMetadata ?? {},
          workflowMetadata: parsed.data.workflowMetadata ?? {},
          pricingMetadata: parsed.data.pricingMetadata ?? {},
          intentMetadata: parsed.data.intentMetadata ?? {},
          previewConfig,
          templateTree: validation.templateTree,
          createdBy: getUserId(req.user) ?? null,
        })
        .returning();

      return success(res, { template: inserted[0] }, "Template saved.", 201);
    } catch (error: any) {
      console.error("[pbv2-option-group-templates:from-group]", error);
      return failure(res, 500, "Failed to save option group template.");
    }
  });

  app.patch("/api/pbv2/option-group-templates/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) return failure(res, 400, "Invalid template update.", parsed.error.flatten());

      const organizationId = getRequestOrganizationId(req);
      const template = await getAccessibleTemplate(req.params.id, organizationId);
      if (!template) return failure(res, 404, "Template not found.");
      if (template.isSystemTemplate) return failure(res, 403, "System templates are read-only.");

      let templateTree = parsed.data.templateTree;
      if (templateTree) {
        const validation = validateOptionGroupTemplateTree(templateTree);
        if (!validation.ok) return validationFailure(res, validation.errors);
        templateTree = validation.templateTree;
      }

      const updates: any = {
        ...metadataToInsert(parsed.data),
        ...(templateTree ? { templateTree } : {}),
        updatedAt: new Date(),
      };
      if (updates.slug) {
        updates.slug = await makeUniqueOrgSlug(organizationId, updates.slug, template.id);
      }

      const updated = await db
        .update(pbv2OptionGroupTemplates)
        .set(updates)
        .where(
          and(
            eq(pbv2OptionGroupTemplates.id, template.id),
            eq(pbv2OptionGroupTemplates.organizationId, organizationId),
            eq(pbv2OptionGroupTemplates.isSystemTemplate, false),
          ),
        )
        .returning();

      return success(res, { template: updated[0] }, "Template updated.");
    } catch (error: any) {
      console.error("[pbv2-option-group-templates:patch]", error);
      return failure(res, 500, "Failed to update option group template.");
    }
  });

  app.post("/api/pbv2/option-group-templates/:id/archive", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const template = await getAccessibleTemplate(req.params.id, organizationId);
      if (!template) return failure(res, 404, "Template not found.");
      if (template.isSystemTemplate) return failure(res, 403, "System templates cannot be archived by organization users.");

      const archived = await db
        .update(pbv2OptionGroupTemplates)
        .set({ state: "archived", archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(pbv2OptionGroupTemplates.id, template.id),
            eq(pbv2OptionGroupTemplates.organizationId, organizationId),
            eq(pbv2OptionGroupTemplates.isSystemTemplate, false),
          ),
        )
        .returning();

      return success(res, { template: archived[0] }, "Template archived.");
    } catch (error: any) {
      console.error("[pbv2-option-group-templates:archive]", error);
      return failure(res, 500, "Failed to archive option group template.");
    }
  });

  app.post("/api/pbv2/option-group-templates/:id/clone", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const parsed = cloneSchema.safeParse(req.body);
      if (!parsed.success) return failure(res, 400, "Invalid clone request.", parsed.error.flatten());

      const organizationId = getRequestOrganizationId(req);
      const template = await getAccessibleTemplate(req.params.id, organizationId);
      if (!template || template.state !== "active") return failure(res, 404, "Template not found.");

      const cloned = cloneTemplateIntoTree(parsed.data.currentTreeJson, template.templateTree, {
        importInstanceId: parsed.data.importInstanceId,
        sourceTemplateId: template.id,
      });
      if (!cloned.ok) return validationFailure(res, cloned.errors);

      const sanitized = sanitizePbv2PricingMatrix(cloned.tree).tree;
      return success(res, {
        treeJson: sanitized,
        importedGroupId: cloned.importedGroupId,
        idMap: cloned.idMap,
        selectionKeyMap: cloned.selectionKeyMap,
      }, "Template cloned into draft preview.");
    } catch (error: any) {
      console.error("[pbv2-option-group-templates:clone]", error);
      return failure(res, 500, "Failed to clone option group template.");
    }
  });
}
