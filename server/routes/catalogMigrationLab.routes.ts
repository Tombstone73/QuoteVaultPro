import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { catalogMigrationLabAnalyzerRequestSchema, type CatalogMigrationLabAnalyzerRequest } from "@shared/catalogMigrationLabSchemas";
import {
  productIntakeAnswersPatchRequestSchema,
  productIntakeSessionListQuerySchema,
  productIntakeWizardAnalyzeRequestSchema,
  type ProductIntakeWizardAnalyzeRequest,
} from "@shared/productIntakeWizardSchemas";
import { materials, pbv2OptionGroupTemplates } from "@shared/schema";
import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import {
  analyzeCatalogMigrationSource,
  CATALOG_MIGRATION_LAB_MAX_SOURCE_BYTES,
  type CatalogMigrationLabReferenceData,
} from "../services/catalogMigrationLab/analyzer";
import {
  generateProductIntakeBrief,
  type ProductIntakeTemplateReference,
} from "../services/productIntakeWizard/productIntakeBriefService";
import {
  createDbProductIntakeSessionStore,
  ProductIntakeSessionError,
  type ProductIntakeSessionStore,
} from "../services/productIntakeWizard/productIntakeSessionService";
import type { AiProviderAdapter } from "../services/ai/providers/AiProviderAdapter";

type RouteMiddleware = {
  isAuthenticated: (req: Request, res: Response, next: NextFunction) => void;
  tenantContext: (req: Request, res: Response, next: NextFunction) => void;
  assertInternalUser: (req: Request, res: Response) => boolean;
  getReferenceData?: (organizationId: string) => Promise<ProductIntakeReferenceData>;
  productIntakeAiProvider?: AiProviderAdapter | null;
  productIntakeSessionStore?: ProductIntakeSessionStore;
};

type ProductIntakeReferenceData = CatalogMigrationLabReferenceData & {
  templates?: ProductIntakeTemplateReference[];
};

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function canAccessCatalogMigrationLab(req: Request): boolean {
  const user = req.user as any;
  if (user?.isPlatformAdmin || user?.isPlatformDeveloper) return true;
  const role = String((req as any).orgRole ?? (req as any).actorOrgRole ?? user?.role ?? "").toLowerCase();
  return role === "owner" || role === "admin";
}

function requireCatalogMigrationLabAccess(req: Request, res: Response): boolean {
  if (!canAccessCatalogMigrationLab(req)) {
    res.status(403).json({
      success: false,
      message: "Access denied. Catalog Migration Lab requires admin or platform access.",
    });
    return false;
  }
  return true;
}

function requestPayloadSize(input: CatalogMigrationLabAnalyzerRequest): number {
  if (typeof input.jsonText === "string") return byteLength(input.jsonText);
  return byteLength(JSON.stringify(input.sourceJson) ?? "null");
}

function intakePayloadSize(input: ProductIntakeWizardAnalyzeRequest): number {
  if (input.sourceType === "text_description") return byteLength(input.description ?? "");
  if (input.analyzerRequest) return requestPayloadSize(input.analyzerRequest);
  if (typeof input.jsonText === "string") return byteLength(input.jsonText);
  return byteLength(JSON.stringify(input.sourceJson) ?? "null");
}

function requestUserId(req: Request): string | null {
  const user = req.user as any;
  return user?.id ?? user?.claims?.sub ?? null;
}

function handleProductIntakeRouteError(error: any, res: Response, fallbackMessage: string) {
  if (error instanceof SyntaxError) {
    return res.status(400).json({
      success: false,
      message: "Uploaded content is not valid JSON.",
      errorCode: "MALFORMED_JSON",
    });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      message: error.errors[0]?.message ?? fallbackMessage,
      errorCode: "UNKNOWN_SOURCE_SHAPE",
    });
  }
  if (error instanceof ProductIntakeSessionError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      errorCode: error.errorCode,
    });
  }
  return null;
}

async function loadReferenceData(organizationId: string): Promise<ProductIntakeReferenceData> {
  const materialRows = await db
    .select({
      id: materials.id,
      sku: materials.sku,
      name: materials.name,
    })
    .from(materials)
    .where(eq(materials.organizationId, organizationId));

  const templateRows = await db
    .select({
      id: pbv2OptionGroupTemplates.id,
      name: pbv2OptionGroupTemplates.name,
      slug: pbv2OptionGroupTemplates.slug,
      category: pbv2OptionGroupTemplates.category,
      tags: pbv2OptionGroupTemplates.tags,
      workflowMetadata: pbv2OptionGroupTemplates.workflowMetadata,
      templateTree: pbv2OptionGroupTemplates.templateTree,
    })
    .from(pbv2OptionGroupTemplates)
    .where(eq(pbv2OptionGroupTemplates.state, "active"));

  return {
    materials: materialRows,
    templates: templateRows.map((template) => ({
      id: template.id,
      name: template.name,
      slug: template.slug,
      category: template.category,
      tags: Array.isArray(template.tags) ? template.tags : [],
      workflowMetadata: template.workflowMetadata ?? {},
      templateTree: template.templateTree ?? {},
    })),
  };
}

export function registerCatalogMigrationLabRoutes(app: Express, middleware: RouteMiddleware) {
  const getReferenceData = middleware.getReferenceData ?? loadReferenceData;
  const intakeSessionStore = middleware.productIntakeSessionStore ?? createDbProductIntakeSessionStore();

  app.post(
    "/api/admin/catalog-migration-lab/analyze",
    middleware.isAuthenticated,
    middleware.tenantContext,
    async (req: Request, res: Response) => {
      try {
        if (!middleware.assertInternalUser(req, res) || !requireCatalogMigrationLabAccess(req, res)) return;

        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) {
          return res.status(400).json({
            success: false,
            message: "Missing organization context.",
            errorCode: "UNKNOWN_SOURCE_SHAPE",
          });
        }

        const parsed = catalogMigrationLabAnalyzerRequestSchema.parse(req.body ?? {});
        const payloadSize = requestPayloadSize(parsed);
        if (payloadSize > CATALOG_MIGRATION_LAB_MAX_SOURCE_BYTES) {
          return res.status(413).json({
            success: false,
            message: "Catalog source JSON is too large for Phase 1 analyzer.",
            errorCode: "SOURCE_TOO_LARGE",
          });
        }

        const referenceData = await getReferenceData(organizationId);
        const data = analyzeCatalogMigrationSource(parsed, referenceData);

        return res.json({ success: true, data });
      } catch (error: any) {
        if (error instanceof SyntaxError) {
          return res.status(400).json({
            success: false,
            message: "Uploaded content is not valid JSON.",
            errorCode: "MALFORMED_JSON",
          });
        }
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            success: false,
            message: error.errors[0]?.message ?? "Invalid analyzer request.",
            errorCode: "UNKNOWN_SOURCE_SHAPE",
          });
        }
        if (error?.code === "SOURCE_TOO_LARGE") {
          return res.status(error.statusCode ?? 413).json({
            success: false,
            message: error.message,
            errorCode: "SOURCE_TOO_LARGE",
          });
        }

        console.error("[CatalogMigrationLab] Analysis failed:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to analyze catalog source.",
          errorCode: "UNKNOWN_SOURCE_SHAPE",
        });
      }
    },
  );

  app.post(
    "/api/admin/product-intake-wizard/analyze",
    middleware.isAuthenticated,
    middleware.tenantContext,
    async (req: Request, res: Response) => {
      try {
        if (!middleware.assertInternalUser(req, res) || !requireCatalogMigrationLabAccess(req, res)) return;

        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) {
          return res.status(400).json({
            success: false,
            message: "Missing organization context.",
            errorCode: "UNKNOWN_SOURCE_SHAPE",
          });
        }

        const parsed = productIntakeWizardAnalyzeRequestSchema.parse(req.body ?? {});
        const payloadSize = intakePayloadSize(parsed);
        if (payloadSize > CATALOG_MIGRATION_LAB_MAX_SOURCE_BYTES) {
          return res.status(413).json({
            success: false,
            message: "Product intake source is too large for Phase 1 analysis.",
            errorCode: "SOURCE_TOO_LARGE",
          });
        }

        const referenceData = await getReferenceData(organizationId);
        let analyzer = null;
        if (parsed.sourceType !== "text_description") {
          const analyzerRequest = parsed.analyzerRequest ?? catalogMigrationLabAnalyzerRequestSchema.parse({
            adapter: "infoflo-json",
            fileName: parsed.fileName,
            jsonText: parsed.jsonText,
            sourceJson: parsed.sourceJson,
          });
          analyzer = analyzeCatalogMigrationSource(analyzerRequest, referenceData);
        }

        const brief = await generateProductIntakeBrief({
          orgId: organizationId,
          request: parsed,
          analyzer,
          templates: referenceData.templates ?? [],
          provider: middleware.productIntakeAiProvider,
        });
        const intakeSession = await intakeSessionStore.createFromAnalysis({
          organizationId,
          userId: requestUserId(req),
          request: parsed,
          analyzer,
          brief,
        });

        return res.json({
          success: true,
          data: {
            workflow: {
              currentState: "REVIEW_READY",
              terminalState: "REVIEW_READY",
              catalogMutationAllowed: false,
            },
            analyzer,
            brief,
            sessionId: intakeSession.session.id,
            status: intakeSession.session.status,
            session: intakeSession.session,
            questions: intakeSession.questions,
            answers: intakeSession.answers,
            readiness: intakeSession.readiness,
          },
        });
      } catch (error: any) {
        const handled = handleProductIntakeRouteError(error, res, "Invalid product intake request.");
        if (handled) return handled;

        console.error("[ProductIntakeWizard] Analysis failed:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to generate Product Intake Brief.",
          errorCode: "UNKNOWN_SOURCE_SHAPE",
        });
      }
    },
  );

  app.get(
    "/api/admin/product-intake-wizard/sessions",
    middleware.isAuthenticated,
    middleware.tenantContext,
    async (req: Request, res: Response) => {
      try {
        if (!middleware.assertInternalUser(req, res) || !requireCatalogMigrationLabAccess(req, res)) return;
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) {
          return res.status(400).json({ success: false, message: "Missing organization context.", errorCode: "UNKNOWN_SOURCE_SHAPE" });
        }

        const filters = productIntakeSessionListQuerySchema.parse(req.query ?? {});
        const sessions = await intakeSessionStore.listSessions(organizationId, filters);
        return res.json({ success: true, data: { sessions } });
      } catch (error: any) {
        const handled = handleProductIntakeRouteError(error, res, "Invalid intake session filters.");
        if (handled) return handled;
        console.error("[ProductIntakeWizard] Session list failed:", error);
        return res.status(500).json({ success: false, message: "Failed to load Product Intake sessions.", errorCode: "UNKNOWN_SOURCE_SHAPE" });
      }
    },
  );

  app.get(
    "/api/admin/product-intake-wizard/sessions/:id",
    middleware.isAuthenticated,
    middleware.tenantContext,
    async (req: Request, res: Response) => {
      try {
        if (!middleware.assertInternalUser(req, res) || !requireCatalogMigrationLabAccess(req, res)) return;
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) {
          return res.status(400).json({ success: false, message: "Missing organization context.", errorCode: "UNKNOWN_SOURCE_SHAPE" });
        }

        const detail = await intakeSessionStore.getSessionDetail(organizationId, req.params.id);
        if (!detail) return res.status(404).json({ success: false, message: "Product Intake session not found.", errorCode: "SESSION_NOT_FOUND" });
        return res.json({ success: true, data: detail });
      } catch (error: any) {
        const handled = handleProductIntakeRouteError(error, res, "Invalid intake session request.");
        if (handled) return handled;
        console.error("[ProductIntakeWizard] Session detail failed:", error);
        return res.status(500).json({ success: false, message: "Failed to load Product Intake session.", errorCode: "UNKNOWN_SOURCE_SHAPE" });
      }
    },
  );

  app.patch(
    "/api/admin/product-intake-wizard/sessions/:id/answers",
    middleware.isAuthenticated,
    middleware.tenantContext,
    async (req: Request, res: Response) => {
      try {
        if (!middleware.assertInternalUser(req, res) || !requireCatalogMigrationLabAccess(req, res)) return;
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) {
          return res.status(400).json({ success: false, message: "Missing organization context.", errorCode: "UNKNOWN_SOURCE_SHAPE" });
        }

        const parsed = productIntakeAnswersPatchRequestSchema.parse(req.body ?? {});
        const detail = await intakeSessionStore.upsertAnswers({
          organizationId,
          sessionId: req.params.id,
          userId: requestUserId(req),
          answers: parsed.answers,
        });
        if (!detail) return res.status(404).json({ success: false, message: "Product Intake session not found.", errorCode: "SESSION_NOT_FOUND" });
        return res.json({ success: true, data: detail });
      } catch (error: any) {
        const handled = handleProductIntakeRouteError(error, res, "Invalid Product Intake answers.");
        if (handled) return handled;
        console.error("[ProductIntakeWizard] Answer save failed:", error);
        return res.status(500).json({ success: false, message: "Failed to save Product Intake answers.", errorCode: "UNKNOWN_SOURCE_SHAPE" });
      }
    },
  );

  app.post(
    "/api/admin/product-intake-wizard/sessions/:id/abandon",
    middleware.isAuthenticated,
    middleware.tenantContext,
    async (req: Request, res: Response) => {
      try {
        if (!middleware.assertInternalUser(req, res) || !requireCatalogMigrationLabAccess(req, res)) return;
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) {
          return res.status(400).json({ success: false, message: "Missing organization context.", errorCode: "UNKNOWN_SOURCE_SHAPE" });
        }

        const detail = await intakeSessionStore.abandonSession({
          organizationId,
          sessionId: req.params.id,
          userId: requestUserId(req),
        });
        if (!detail) return res.status(404).json({ success: false, message: "Product Intake session not found.", errorCode: "SESSION_NOT_FOUND" });
        return res.json({ success: true, data: detail });
      } catch (error: any) {
        const handled = handleProductIntakeRouteError(error, res, "Invalid Product Intake abandon request.");
        if (handled) return handled;
        console.error("[ProductIntakeWizard] Abandon failed:", error);
        return res.status(500).json({ success: false, message: "Failed to abandon Product Intake session.", errorCode: "UNKNOWN_SOURCE_SHAPE" });
      }
    },
  );
}
