/**
 * inboundOrders.routes.ts
 *
 * Internal TitanOS Inbound Orders Review Queue skeleton.
 * Chunk 2 intentionally includes only tenant-scoped list/detail and minimal
 * manual creation. File intake, warnings workflows, submission preview, and
 * submit-to-quote are later chunks.
 */

import type { Express } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  inboundOrderRecordStatusSchema,
  inboundOrderSourceTypeSchema,
} from "@shared/schema";
import { inboundOrderService } from "../services/inboundOrders/InboundOrderService";
import { getRequestOrganizationId } from "../tenantContext";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

const inboundOrderListQuerySchema = z.object({
  status: inboundOrderRecordStatusSchema.optional(),
  sourceType: inboundOrderSourceTypeSchema.optional(),
  assignedToUserId: z.string().trim().min(1).optional(),
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
      const records = await inboundOrderService.listRecords({
        organizationId,
        filters,
      });

      res.json({
        success: true,
        data: records,
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
