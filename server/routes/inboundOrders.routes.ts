/**
 * inboundOrders.routes.ts
 *
 * Internal TitanOS Inbound Orders Review Queue routes.
 * These endpoints manage intake/review artifacts, matching, immutable snapshots,
 * and quote draft conversion. Order conversion, production, and automation stay out of scope here.
 */

import type { Express } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  inboundOrderListQuerySchema,
  inboundOrderReviewDraftSaveSchema,
  inboundOrderStatusUpdateSchema,
  manualInboundOrderCreateSchema,
  normalizeInboundOrderStatusForStorage,
} from "@shared/inboundOrdersApi";
import {
  InboundOrderReviewDraftValidationError,
  InboundOrderTransitionError,
  inboundOrderService,
} from "../services/inboundOrders/InboundOrderService";
import { inboundOrderParsingService } from "../services/inboundOrders/InboundOrderParsingService";
import { getRequestOrganizationId } from "../tenantContext";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

const jsonObjectSchema = z.record(z.unknown());

const legacyManualInboundOrderCreateSchema = z.object({
  sourceId: z.string().trim().min(1).optional().nullable(),
  sourceLabel: z.string().trim().min(1).max(255).optional().nullable(),
  sourceRecordId: z.string().trim().min(1).max(255).optional().nullable(),
  sourceMessageId: z.string().trim().min(1).max(255).optional().nullable(),
  externalReference: z.string().trim().min(1).max(255).optional().nullable(),
  idempotencyKey: z.string().trim().min(1).max(255).optional().nullable(),
  payloadHash: z.string().trim().min(1).max(128).optional().nullable(),
  rawPayloadJson: jsonObjectSchema.optional().default({}),
  normalizedPayloadJson: jsonObjectSchema.optional().default({}),
  extractedCustomerJson: jsonObjectSchema.optional().nullable(),
  extractedOrderJson: jsonObjectSchema.optional().nullable(),
  extractedShippingJson: jsonObjectSchema.optional().nullable(),
  requiresHumanDecision: z.boolean().optional().default(false),
  reviewRequiredReason: z.string().trim().min(1).max(2000).optional().nullable(),
});

function isMissingInboundSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("inbound_order")
    && (
      message.includes("does not exist")
      || message.includes("relation")
      || message.includes("type")
      || message.includes("column")
    )
  );
}

function sendInboundSchemaUnavailable(res: any) {
  return res.status(503).json({
    success: false,
    message: "Inbound order tables are not available yet. Run the inbound orders migration before using this queue.",
  });
}

const reviewActionSchema = z.object({
  note: z.string().trim().min(1).max(2000).optional().nullable(),
});

const reviewDraftSnapshotSchema = z.object({
  customerDraft: jsonObjectSchema.default({}),
  contactDraft: jsonObjectSchema.default({}),
  orderNotes: z.string().trim().max(10000).optional().nullable(),
  desiredOutputType: z.string().trim().max(255).optional().nullable(),
  lineItemDrafts: z.array(jsonObjectSchema).max(250).default([]),
  staffNotes: z.string().trim().max(10000).optional().nullable(),
  metadata: jsonObjectSchema.default({}),
});

const lineItemProductMatchSchema = z.object({
  productId: z.string().trim().min(1),
  variantId: z.string().trim().min(1).optional().nullable(),
  optionSelectionsJson: jsonObjectSchema.optional().nullable(),
  staffNote: z.string().trim().max(2000).optional().nullable(),
});

const warningResolutionSchema = z.object({
  status: z.enum(["resolved", "ignored"]).default("resolved"),
  resolutionNote: z.string().trim().max(2000).optional().nullable(),
});

const decisionFlagResolutionSchema = z.object({
  status: z.enum(["accepted", "overridden", "dismissed"]).default("accepted"),
  decisionValueJson: jsonObjectSchema.optional().nullable(),
  decisionNote: z.string().trim().max(2000).optional().nullable(),
});

const inboundCustomerSearchQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const inboundContactSearchQuerySchema = z.object({
  customerId: z.string().trim().min(1),
  search: z.string().trim().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const customerMatchSchema = z.object({
  customerId: z.string().trim().min(1),
  contactId: z.string().trim().min(1).optional().nullable(),
  staffNote: z.string().trim().max(2000).optional().nullable(),
});

export function registerInboundOrderRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    assertInternalUser: (req: any, res: any) => boolean;
    inboundOrderService?: typeof inboundOrderService;
    inboundOrderParsingService?: typeof inboundOrderParsingService;
  },
): void {
  const { isAuthenticated, tenantContext, assertInternalUser } = middleware;
  const service = middleware.inboundOrderService ?? inboundOrderService;
  const parsingService = middleware.inboundOrderParsingService ?? inboundOrderParsingService;

  app.get("/api/inbound-orders", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const filters = inboundOrderListQuerySchema.parse(req.query);
      const result = await service.listInboundOrders({
        organizationId,
        filters,
      });

      res.json({
        success: true,
        data: result.records,
        summary: result.summary,
        pagination: {
          limit: filters.limit,
          offset: filters.offset,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error listing inbound orders:", error);
      res.status(500).json({ message: "Failed to list inbound orders" });
    }
  });

  app.get("/api/inbound-orders/customer-search", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const query = inboundCustomerSearchQuerySchema.parse(req.query);
      const customers = await service.searchCustomers({
        organizationId,
        search: query.search ?? null,
        limit: query.limit,
      });

      res.json({ success: true, data: customers });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      console.error("Error searching inbound customer matches:", error);
      res.status(500).json({ message: "Failed to search inbound customer matches" });
    }
  });

  app.get("/api/inbound-orders/contact-search", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const query = inboundContactSearchQuerySchema.parse(req.query);
      const contacts = await service.searchCustomerContacts({
        organizationId,
        customerId: query.customerId,
        search: query.search ?? null,
        limit: query.limit,
      });

      res.json({ success: true, data: contacts });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error searching inbound contact matches:", error);
      res.status(500).json({ message: "Failed to search inbound contact matches" });
    }
  });

  app.get("/api/inbound-orders/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const detail = await service.getInboundOrder({
        organizationId,
        inboundRecordId: String(req.params.id),
      });

      if (!detail) {
        return res.status(404).json({ message: "Inbound order record not found" });
      }

      res.json({ success: true, data: detail });
    } catch (error) {
      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error fetching inbound order detail:", error);
      res.status(500).json({ message: "Failed to fetch inbound order detail" });
    }
  });

  app.patch("/api/inbound-orders/:id/status", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = inboundOrderStatusUpdateSchema.parse(req.body ?? {});
      const detail = await service.updateInboundOrderStatus({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
        status: normalizeInboundOrderStatusForStorage(input.status),
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error updating inbound order status:", error);
      res.status(500).json({ message: "Failed to update inbound order status" });
    }
  });

  app.post("/api/inbound-orders/:id/parse", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const result = await parsingService.parseInboundOrderRecord({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error parsing inbound order:", error);
      res.status(500).json({ message: "Failed to parse inbound order" });
    }
  });

  app.get("/api/inbound-orders/:id/parse-attempts", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const attempts = await parsingService.listParseAttempts({
        organizationId,
        inboundRecordId: String(req.params.id),
      });

      res.json({ success: true, data: attempts });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error listing inbound order parse attempts:", error);
      res.status(500).json({ message: "Failed to list inbound order parse attempts" });
    }
  });

  app.get("/api/inbound-orders/:id/draft-preview", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const preview = await parsingService.getDraftPreview({
        organizationId,
        inboundRecordId: String(req.params.id),
      });

      res.json({ success: true, data: preview });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error loading inbound order draft preview:", error);
      res.status(500).json({ message: "Failed to load inbound order draft preview" });
    }
  });

  app.get("/api/inbound-orders/:id/review-draft", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const draft = await service.getReviewDraft({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
      });

      res.json({ success: true, data: draft });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error loading inbound order review draft:", error);
      res.status(500).json({ message: "Failed to load inbound order review draft" });
    }
  });

  app.put("/api/inbound-orders/:id/review-draft", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const draftInput = inboundOrderReviewDraftSaveSchema.parse(req.body ?? {});
      const draft = await service.saveReviewDraft({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
        draft: draftInput,
      });

      res.json({ success: true, data: draft });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error saving inbound order review draft:", error);
      res.status(500).json({ message: "Failed to save inbound order review draft" });
    }
  });

  app.post("/api/inbound-orders/:id/review-draft/mark-ready", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const draft = await service.markReviewDraftReady({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
      });

      res.json({ success: true, data: draft });
    } catch (error) {
      if (error instanceof InboundOrderReviewDraftValidationError) {
        return res.status(error.statusCode).json({ message: error.message, errors: error.errors });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error marking inbound order review draft ready:", error);
      res.status(500).json({ message: "Failed to mark inbound order review draft ready" });
    }
  });

  app.post("/api/inbound-orders/:id/review-draft/reopen", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const draft = await service.reopenReviewDraft({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
      });

      res.json({ success: true, data: draft });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error reopening inbound order review draft:", error);
      res.status(500).json({ message: "Failed to reopen inbound order review draft" });
    }
  });

  const handleReviewAction = (
    action: "mark-reviewed" | "needs-clarification" | "reject" | "reopen",
  ) => async (req: any, res: any) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = reviewActionSchema.parse(req.body ?? {});
      const detail = await service.applyReviewAction({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
        action,
        note: input.note,
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error(`Error applying inbound order review action ${action}:`, error);
      res.status(500).json({ message: "Failed to update inbound order review state" });
    }
  };

  app.post(
    "/api/inbound-orders/:id/mark-reviewed",
    isAuthenticated,
    tenantContext,
    handleReviewAction("mark-reviewed"),
  );

  app.post(
    "/api/inbound-orders/:id/needs-clarification",
    isAuthenticated,
    tenantContext,
    handleReviewAction("needs-clarification"),
  );

  app.post(
    "/api/inbound-orders/:id/reject",
    isAuthenticated,
    tenantContext,
    handleReviewAction("reject"),
  );

  app.post(
    "/api/inbound-orders/:id/reopen",
    isAuthenticated,
    tenantContext,
    handleReviewAction("reopen"),
  );

  app.post("/api/inbound-orders/:id/review-snapshot", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const draftInput = reviewDraftSnapshotSchema.parse(req.body ?? {});
      const detail = await service.saveReviewSnapshot({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
        draft: {
          ...draftInput,
          orderNotes: draftInput.orderNotes ?? null,
          desiredOutputType: draftInput.desiredOutputType ?? null,
          staffNotes: draftInput.staffNotes ?? null,
        },
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error saving inbound order review snapshot:", error);
      res.status(500).json({ message: "Failed to save inbound order review snapshot" });
    }
  });

  app.get("/api/inbound-orders/:id/quote-draft-preview", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const preview = await service.getQuoteDraftPreview({
        organizationId,
        inboundRecordId: String(req.params.id),
      });

      res.json({ success: true, data: preview });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error loading inbound order quote draft preview:", error);
      res.status(500).json({ message: "Failed to load inbound order quote draft preview" });
    }
  });

  app.post("/api/inbound-orders/:id/match-customer", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = customerMatchSchema.parse(req.body ?? {});
      const detail = await service.matchCustomer({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
        customerId: input.customerId,
        contactId: input.contactId ?? null,
        staffNote: input.staffNote ?? null,
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error matching inbound customer:", error);
      res.status(500).json({ message: "Failed to match inbound customer" });
    }
  });

  app.post("/api/inbound-orders/:id/line-items/:lineItemId/match-product", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = lineItemProductMatchSchema.parse(req.body ?? {});
      const detail = await service.matchLineItemProduct({
        organizationId,
        inboundRecordId: String(req.params.id),
        lineItemId: String(req.params.lineItemId),
        actorUserId,
        productId: input.productId,
        variantId: input.variantId ?? null,
        optionSelectionsJson: input.optionSelectionsJson ?? {},
        staffNote: input.staffNote ?? null,
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error matching inbound line item product:", error);
      res.status(500).json({ message: "Failed to match inbound line item product" });
    }
  });

  app.post("/api/inbound-orders/:id/warnings/:warningId/resolve", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = warningResolutionSchema.parse(req.body ?? {});
      const detail = await service.resolveWarning({
        organizationId,
        inboundRecordId: String(req.params.id),
        warningId: String(req.params.warningId),
        actorUserId,
        status: input.status,
        resolutionNote: input.resolutionNote ?? null,
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error resolving inbound warning:", error);
      res.status(500).json({ message: "Failed to resolve inbound warning" });
    }
  });

  app.post("/api/inbound-orders/:id/decision-flags/:flagId/resolve", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const input = decisionFlagResolutionSchema.parse(req.body ?? {});
      const detail = await service.resolveDecisionFlag({
        organizationId,
        inboundRecordId: String(req.params.id),
        flagId: String(req.params.flagId),
        actorUserId,
        status: input.status,
        decisionValueJson: input.decisionValueJson ?? {},
        decisionNote: input.decisionNote ?? null,
      });

      res.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error resolving inbound decision flag:", error);
      res.status(500).json({ message: "Failed to resolve inbound decision flag" });
    }
  });

  app.post("/api/inbound-orders/:id/create-quote-draft", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      res.status(409).json({
        success: false,
        message: "Inbound Orders Phase 1 is review-only. Draft conversion is not enabled yet.",
      });
    } catch (error) {
      if (error instanceof InboundOrderTransitionError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      console.error("Error creating quote draft from inbound order:", error);
      res.status(500).json({ message: "Failed to create quote draft from inbound order" });
    }
  });

  app.post("/api/inbound-orders/manual", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ error: "User ID not found" });

      const parsed = manualInboundOrderCreateSchema.safeParse(req.body);
      const legacyParsed = parsed.success
        ? null
        : legacyManualInboundOrderCreateSchema.safeParse(req.body);

      const created = parsed.success
        ? await service.createManualInboundOrder({
          organizationId,
          actorUserId,
          ...parsed.data,
        })
        : legacyParsed?.success
          ? await service.createManualRecord({
            organizationId,
            actorUserId,
            ...legacyParsed.data,
          })
          : null;

      if (!created) {
        const validationError = parsed.success ? null : parsed.error;
        return res.status(400).json({
          message: validationError ? fromZodError(validationError).message : "Invalid manual inbound order payload",
        });
      }

      res.status(201).json({ success: true, data: created });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      if (isMissingInboundSchemaError(error)) {
        return sendInboundSchemaUnavailable(res);
      }

      console.error("Error creating manual inbound order:", error);
      res.status(500).json({ message: "Failed to create manual inbound order" });
    }
  });
}
