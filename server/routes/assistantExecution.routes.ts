import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import {
  assistantCancelExecutionPlanRequestSchema,
  assistantConfirmationRequestSchema,
  assistantCreateExecutionPlanRequestSchema,
  type AssistantExecutionPlan,
} from "@shared/assistantContracts";
import { getRequestOrganizationId } from "../tenantContext";
import { DrizzleAssistantExecutionRepository } from "../storage/assistantExecution.repo";
import { ExecutionPlanError, ExecutionPlanningService } from "../services/assistant/execution";
import type { ExecutionActorScope, ExecutionPlanRecord } from "../services/assistant/execution/types";

function userId(req: Request): string | null {
  const user = req.user as { id?: unknown; claims?: { sub?: unknown } } | undefined;
  const id = user?.claims?.sub ?? user?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function scope(req: Request): ExecutionActorScope {
  const id = userId(req);
  if (!id) throw new ExecutionPlanError("AUTH_REQUIRED", "Unauthorized.");
  const internal = ["owner", "admin", "manager", "member"].includes(String(req.orgRole ?? "").toLowerCase());
  return {
    organizationId: getRequestOrganizationId(req), userId: id,
    permissions: internal ? ["assistant.internal_staff", "catalog.read"] : [],
    environment: process.env.NODE_ENV || "development",
  };
}

function planDto(plan: ExecutionPlanRecord, executionStarted = false): AssistantExecutionPlan {
  const status = plan.status as AssistantExecutionPlan["status"];
  const cancellationAvailable = ["draft", "resolving", "awaiting_input", "preview_ready", "awaiting_confirmation", "confirmed"].includes(status);
  return {
    id: plan.id, conversationId: plan.conversationId, turnId: plan.turnId ?? null, action: plan.normalizedAction,
    commandVersion: plan.commandVersion, status, riskLevel: plan.riskLevel as AssistantExecutionPlan["riskLevel"],
    planVersion: plan.version, contextVersion: "v1", preview: {
      title: plan.preview.title, summary: plan.preview.summary,
      affectedEntities: plan.affectedRecords.map((record) => ({ entityType: record.entityType as any, entityId: record.entityId, label: `${record.entityType} ${record.entityId}` })),
      sideEffects: plan.preview.sideEffects.map((description) => ({ label: "Planned side effect", description, affectedRecordCount: plan.affectedRecords.length, reversible: false })),
      undo: { available: false, label: null, expiresAt: null },
    },
    missingInformation: (plan.preview.missingInformation ?? []).map((label) => ({ field: label, label, description: label })),
    // The normal runtime has no command adapters. The route never declares a
    // plan executable based on browser state or a model proposal.
    executable: false, confirmationAvailable: false, cancellationAvailable,
    expiresAt: plan.expiresAt.toISOString(), staleReason: plan.status === "invalidated" ? (plan.failureSummary ?? "Plan inputs changed.") : null,
    failureSummary: plan.failureSummary ?? null, steps: [], correlationId: plan.correlationId,
    createdAt: plan.createdAt.toISOString(), updatedAt: plan.updatedAt.toISOString(),
  };
}

function safeError(res: Response, error: unknown) {
  if (error instanceof ExecutionPlanError) {
    const notFound = error.code === "PLAN_NOT_FOUND";
    const code = notFound ? "plan_not_found" : error.code === "PLAN_EXPIRED" ? "confirmation_expired"
      : error.code === "PERMISSION_CHANGED" ? "plan_permission_changed"
        : error.code === "CONTEXT_CHANGED" ? "plan_stale" : "plan_transition_invalid";
    return res.status(notFound ? 404 : 409).json({ error: { code, message: notFound ? "Plan not found." : error.message, retryable: false } });
  }
  if (error instanceof z.ZodError) return res.status(400).json({ error: { code: "context_invalid", message: error.errors.map((issue) => issue.message).join("; "), retryable: false } });
  console.error("[Assistant execution] Route failed:", error);
  return res.status(500).json({ error: { code: "turn_failed", message: "Assistant execution request failed.", retryable: true } });
}

export interface AssistantExecutionRouteDependencies {
  service?: ExecutionPlanningService;
}

const emptyProductionExecutionRegistry = {
  get: () => undefined,
  list: () => [],
};

export function registerAssistantExecutionRoutes(app: Express, middleware: { isAuthenticated: RequestHandler; tenantContext: RequestHandler }, dependencies: AssistantExecutionRouteDependencies = {}): void {
  const service = dependencies.service ?? new ExecutionPlanningService(new DrizzleAssistantExecutionRepository(), emptyProductionExecutionRegistry);
  const guarded = [middleware.isAuthenticated, middleware.tenantContext];

  app.post("/api/assistant/conversations/:conversationId/plans", ...guarded, async (req, res) => {
    try {
      assistantCreateExecutionPlanRequestSchema.parse(req.body ?? {});
      // The browser supplies no executable command name. Stage 3 has no
      // production command definition from which a server-side action could be resolved.
      throw new ExecutionPlanError("COMMAND_NOT_REGISTERED", "Production write commands are not enabled yet.");
    } catch (error) { return safeError(res, error); }
  });

  app.get("/api/assistant/plans/:planId", ...guarded, async (req, res) => {
    try { return res.json({ success: true, data: planDto(await service.getPlan(scope(req), req.params.planId)) }); }
    catch (error) { return safeError(res, error); }
  });
  app.get("/api/assistant/plans/:planId/status", ...guarded, async (req, res) => {
    try { return res.json({ success: true, data: planDto(await service.getPlan(scope(req), req.params.planId)) }); }
    catch (error) { return safeError(res, error); }
  });
  app.post("/api/assistant/plans/:planId/cancel", ...guarded, async (req, res) => {
    try {
      const input = assistantCancelExecutionPlanRequestSchema.parse(req.body ?? {});
      return res.json({ success: true, data: planDto(await service.cancelPlan(scope(req), req.params.planId, input.expectedPlanVersion)) });
    } catch (error) { return safeError(res, error); }
  });
  app.post("/api/assistant/plans/:planId/confirmation", ...guarded, async (req, res) => {
    try {
      const input = assistantConfirmationRequestSchema.parse(req.body ?? {});
      const result = await service.confirmAndExecute(scope(req), { planId: req.params.planId, expectedVersion: input.expectedPlanVersion, token: input.confirmationToken, context: input.context });
      return res.json({ success: true, data: { plan: planDto(result.plan, Boolean(result.result)), accepted: true, executionStarted: Boolean(result.result) } });
    } catch (error) { return safeError(res, error); }
  });
}
