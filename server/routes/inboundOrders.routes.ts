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
  inboundOrderRecordStatusSchema,
  inboundOrderSourceTypeSchema,
} from "@shared/schema";
import {
  InboundOrderTransitionError,
  inboundOrderService,
} from "../services/inboundOrders/InboundOrderService";
import { getRequestOrganizationId } from "../tenantContext";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

const inboundOrderListQuerySchema = z.object({
  status: inboundOrderRecordStatusSchema.optional(),
  statusGroup: z.enum(["needs_review", "waiting", "ready", "converted", "rejected"]).optional(),
  reviewOutcome: z.string().trim().min(1).max(100).optional(),
  sourceType: inboundOrderSourceTypeSchema.optional(),
  sourceId: z.string().trim().min(1).optional(),
  assignedToUserId: z.string().trim().min(1).optional(),
  hasWarnings: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  hasDecisionFlags: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  converted: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  linkedQuoteStatus: z.enum(["draft", "pending_approval", "pending", "active", "canceled"]).optional(),
  search: z.string().trim().min(1).max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const jsonObjectSchema = z.record(z.unknown());

const manualInboundOrderCreateSchema = z.object({
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
  },
): void {
  const { isAuthenticated, tenantContext, assertInternalUser } = middleware;

  app.get("/api/inbound-orders", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const filters = inboundOrderListQuerySchema.parse(req.query);
      const result = await inboundOrderService.listRecords({
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
      const customers = await inboundOrderService.searchCustomers({
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
      const contacts = await inboundOrderService.searchCustomerContacts({
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

      const detail = await inboundOrderService.getDetail({
        organizationId,
        inboundRecordId: String(req.params.id),
      });

      if (!detail) {
        return res.status(404).json({ message: "Inbound order record not found" });
      }

      res.json({ success: true, data: detail });
    } catch (error) {
      console.error("Error fetching inbound order detail:", error);
      res.status(500).json({ message: "Failed to fetch inbound order detail" });
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
      const detail = await inboundOrderService.applyReviewAction({
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
      const detail = await inboundOrderService.saveReviewSnapshot({
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

      const preview = await inboundOrderService.getQuoteDraftPreview({
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
      const detail = await inboundOrderService.matchCustomer({
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
      const detail = await inboundOrderService.matchLineItemProduct({
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
      const detail = await inboundOrderService.resolveWarning({
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
      const detail = await inboundOrderService.resolveDecisionFlag({
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

      const result = await inboundOrderService.createQuoteDraftFromInbound({
        organizationId,
        inboundRecordId: String(req.params.id),
        actorUserId,
      });

      res.status(result.quote.alreadyConverted ? 200 : 201).json({ success: true, data: result });
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

      const input = manualInboundOrderCreateSchema.parse(req.body);
      const created = await inboundOrderService.createManualRecord({
        organizationId,
        actorUserId,
        ...input,
      });

      res.status(201).json({ success: true, data: created });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }

      console.error("Error creating manual inbound order:", error);
      res.status(500).json({ message: "Failed to create manual inbound order" });
    }
  });
}
