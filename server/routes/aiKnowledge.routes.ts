import path from "node:path";
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { getRequestOrganizationId } from "../tenantContext";
import { DrizzleAssistantKnowledgeRepository } from "../storage/assistantKnowledge.repo";

function userId(req: any): string | null { return req.user?.claims?.sub ?? req.user?.id ?? null; }

export function registerAiKnowledgeRoutes(app: Express, dependencies: { isAuthenticated: RequestHandler; tenantContext: RequestHandler; requireOrgOwnerAdmin: RequestHandler }) {
  const repository = new DrizzleAssistantKnowledgeRepository();
  app.get("/api/ai/knowledge", dependencies.isAuthenticated, dependencies.tenantContext, dependencies.requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const query = z.object({ category: z.string().max(80).optional(), status: z.enum(["draft", "active", "deprecated", "inactive"]).optional(), scope: z.enum(["all", "global", "organization"]).optional() }).parse(req.query);
      const [data, status] = await Promise.all([repository.listDocuments({ organizationId, ...query }), repository.status(organizationId)]);
      return res.json({ data, status });
    } catch (error: any) { return res.status(400).json({ message: error?.message ?? "Unable to load knowledge" }); }
  });
  app.get("/api/ai/knowledge/search", dependencies.isAuthenticated, dependencies.tenantContext, dependencies.requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const query = z.object({ q: z.string().min(2).max(1000), category: z.string().max(80).optional(), route: z.string().max(240).optional(), entityType: z.string().max(120).optional(), limit: z.coerce.number().int().min(1).max(12).optional() }).parse(req.query);
      return res.json({ data: await repository.search({ organizationId, query: query.q, category: query.category, route: query.route, entityType: query.entityType, limit: query.limit ?? 6 }) });
    } catch (error: any) { return res.status(400).json({ message: error?.message ?? "Unable to search knowledge" }); }
  });
  app.post("/api/ai/knowledge/sync", dependencies.isAuthenticated, dependencies.tenantContext, dependencies.requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const parsed = z.object({ dryRun: z.boolean().default(false) }).parse(req.body ?? {});
      const result = await repository.syncCuratedCorpus(path.resolve(process.cwd(), "docs", "knowledge"), { dryRun: parsed.dryRun, actorUserId: userId(req) });
      return res.json({ data: result });
    } catch (error: any) { return res.status(400).json({ message: error?.message ?? "Knowledge synchronization failed" }); }
  });
  app.post("/api/ai/knowledge/feedback", dependencies.isAuthenticated, dependencies.tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const body = z.object({ documentIds: z.array(z.string().min(1)).max(10).default([]), feedbackType: z.enum(["helpful", "not_helpful", "outdated", "incorrect"]), questionCategory: z.string().max(80).nullable().optional(), comment: z.string().max(2000).nullable().optional(), conversationId: z.string().min(1).nullable().optional() }).parse(req.body ?? {});
      await repository.recordFeedback({ organizationId, userId: userId(req), ...body });
      return res.json({ success: true });
    } catch (error: any) { return res.status(400).json({ message: error?.message ?? "Unable to save knowledge feedback" }); }
  });
}
