/**
 * fulfillment.routes.ts
 *
 * Fulfillment and shipment routes extracted from server/routes.ts.
 *
 * Routes:
 *   GET    /api/fulfillment/queue
 *   POST   /api/fulfillment/shipments
 *   GET    /api/fulfillment/shipments/:shipmentId
 *   PATCH  /api/fulfillment/shipments/:shipmentId
 *   POST   /api/fulfillment/shipments/:shipmentId/mark-shipped
 *   POST   /api/fulfillment/shipments/:shipmentId/void
 *   POST   /api/fulfillment/pickup/:orderId
 *   POST   /api/fulfillment/pickup/:ticketId/ready
 *   POST   /api/fulfillment/pickup/:ticketId/picked-up
 *   GET    /api/orders/:id/shipments
 *   POST   /api/orders/:id/shipments           (legacy — blocked 409)
 *   PATCH  /api/shipments/:id                  (legacy — blocked 409)
 *   DELETE /api/shipments/:id                  (legacy — blocked 409)
 *   PATCH  /api/orders/:id/fulfillment-status
 *   POST   /api/orders/:id/send-shipping-email
 *
 * Placement: server/routes/fulfillment.routes.ts
 * Registered by: server/routes.ts via registerFulfillmentRoutes
 */

import type { Express } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { orders } from "@shared/schema";
import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import { storage } from "../storage";
import { updateOrderFulfillmentStatus, sendShipmentEmail } from "../fulfillmentService";
import {
  createShipmentSchema as createFulfillmentShipmentSchema,
  fulfillmentChecklistItemSchema,
  fulfillmentReadyQuantityAdjustmentSchema,
  fulfillmentOrderIdSchema,
  fulfillmentNoteSchema,
  listQueueQuerySchema,
  patchShipmentSchema as patchFulfillmentShipmentSchema,
  pickupReadySchema,
  pickupHandoffSchema,
} from "../services/fulfillment/schemas";
import { FulfillmentHttpError } from "../services/fulfillment/types";
import { canonicalFulfillmentOperations } from "../services/fulfillment/canonicalFulfillmentOperations";

// Handles both Replit auth (claims.sub) and local auth (id) formats
const getUserId = (user: any): string | undefined => user?.claims?.sub || user?.id;

function fulfillmentFailureResponse(error: any, fallbackMessage: string, fallbackCode: string) {
  const message = error?.message ? `${fallbackMessage}: ${error.message}` : fallbackMessage;
  return {
    success: false,
    message,
    code: error?.code || fallbackCode,
    detail: error?.detail,
    constraint: error?.constraint,
  };
}

export function registerFulfillmentRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
  },
): void {
  const { isAuthenticated, tenantContext } = middleware;

  // ===== SHIPMENT & FULFILLMENT ROUTES =====

  // Fulfillment Queue Dashboard (backend-only; UI wiring follows separately)
  app.get('/api/fulfillment/queue', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const parsed = listQueueQuerySchema.parse(req.query || {});

      const data = await canonicalFulfillmentOperations.listQueue(organizationId, {
        type: parsed.type,
        status: parsed.status,
        showArchived: parsed.showArchived,
        overdueOnly: parsed.overdueOnly,
        search: parsed.search,
        printer: parsed.printer,
        page: parsed.page,
        pageSize: parsed.pageSize,
        sortBy: parsed.sortBy,
        sortDirection: parsed.sortDirection,
      });

      return res.json({ success: true, data: { rows: data.rows, total: data.total } });
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        return res.status(400).json({ success: false, message: 'Invalid query params', code: 'VALIDATION_ERROR' });
      }
      if (error instanceof FulfillmentHttpError) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      }
      console.error('[fulfillment] queue error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch fulfillment queue' });
    }
  });

  app.get('/api/fulfillment/orders/:orderId', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: 'Missing organization context' });
      const orderId = fulfillmentOrderIdSchema.parse(req.params.orderId);
      const actorOrgRole = req.orgRole || (req.user as any)?.orgRole || (req.user as any)?.role || null;
      const data = await canonicalFulfillmentOperations.getOrderDetail(organizationId, orderId, actorOrgRole);
      return res.json({ success: true, data });
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        return res.status(400).json({ success: false, message: 'Invalid order ID', code: 'VALIDATION_ERROR' });
      }
      if (error instanceof FulfillmentHttpError) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      }
      console.error('[fulfillment] order detail error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch fulfillment detail' });
    }
  });

  app.post('/api/fulfillment/orders/:orderId/ready', isAuthenticated, tenantContext, async (req: any, res) => {
    // This whole-order transition cannot represent partial physical readiness.
    // The fulfillment workspace is intentionally the single writer for its
    // line-level ready pool.
    return res.status(409).json({ success: false, message: 'Use the line-level ready quantity workflow.', code: 'FULFILLMENT_READY_QUANTITY_WORKFLOW_REQUIRED' });
  });

  app.post('/api/fulfillment/orders/:orderId/ready-for-pickup', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: 'Missing organization context' });
      const actorUserId = getUserId(req.user) || null;
      const actorUserRole = req.orgRole || (req.user as any)?.orgRole || (req.user as any)?.role || null;
      const parsed = pickupReadySchema.parse(req.body || {});
      const data = await canonicalFulfillmentOperations.markOrderReadyForPickup(organizationId, req.params.orderId, parsed, actorUserId, actorUserRole);
      return res.json({ success: true, data, message: 'Pickup marked ready' });
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        return res.status(400).json({ success: false, message: 'Invalid pickup ready payload', code: 'VALIDATION_ERROR' });
      }
      if (error instanceof FulfillmentHttpError) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      }
      console.error('[fulfillment] order pickup ready error:', error);
      return res.status(500).json(fulfillmentFailureResponse(
        error,
        'Failed to mark pickup ready',
        'FULFILLMENT_PICKUP_READY_FAILED',
      ));
    }
  });

  app.post('/api/fulfillment/orders/:orderId/ready-quantities', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: 'Missing organization context' });
      const parsed = fulfillmentReadyQuantityAdjustmentSchema.parse(req.body || {});
      const actorUserId = getUserId(req.user) || null;
      const actorOrgRole = req.orgRole || (req.user as any)?.orgRole || (req.user as any)?.role || null;
      const data = await canonicalFulfillmentOperations.adjustReadyQuantities(organizationId, req.params.orderId, parsed, actorUserId, actorOrgRole);
      return res.json({ success: true, data, message: 'Fulfillment ready quantities updated' });
    } catch (error: any) {
      if (error?.name === 'ZodError') return res.status(400).json({ success: false, message: 'Invalid ready quantity payload', code: 'VALIDATION_ERROR' });
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      console.error('[fulfillment] ready quantity error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update fulfillment ready quantities', code: 'FULFILLMENT_READY_QUANTITY_FAILED' });
    }
  });

  app.post('/api/fulfillment/orders/:orderId/reconcile-billing', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(400).json({ success: false, message: 'Organization context is required' });
      if (!['owner', 'admin', 'manager'].includes(String(req.actorOrgRole ?? req.orgRole ?? '').toLowerCase())) {
        return res.status(403).json({ success: false, message: 'Manager, Admin, or Owner role required' });
      }
      const data = await canonicalFulfillmentOperations.reconcileTerminalBilling(organizationId, req.params.orderId, getUserId(req.user) || null);
      return res.json({ success: true, data });
    } catch (error: any) {
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      console.error('[fulfillment] billing reconciliation error:', error);
      return res.status(500).json({ success: false, message: 'Failed to reconcile fulfillment billing' });
    }
  });

  app.post('/api/fulfillment/orders/:orderId/note', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: 'Missing organization context' });
      const parsed = fulfillmentNoteSchema.parse(req.body || {});
      const actorUserId = getUserId(req.user) || null;
      const data = await canonicalFulfillmentOperations.addOrderNote(organizationId, req.params.orderId, parsed.note, actorUserId);
      return res.json({ success: true, data, message: 'Fulfillment note added' });
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        return res.status(400).json({ success: false, message: 'Invalid fulfillment note', code: 'VALIDATION_ERROR' });
      }
      if (error instanceof FulfillmentHttpError) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      }
      console.error('[fulfillment] note error:', error);
      return res.status(500).json({ success: false, message: 'Failed to add fulfillment note' });
    }
  });

  app.post('/api/fulfillment/orders/:orderId/unready', isAuthenticated, tenantContext, async (req: any, res) => {
    // A status-only reversal would leave mutable readiness and immutable
    // handoff history contradictory. Use a negative line-level adjustment.
    return res.status(409).json({ success: false, message: 'Use the line-level ready quantity workflow.', code: 'FULFILLMENT_READY_QUANTITY_WORKFLOW_REQUIRED' });
  });

  app.patch('/api/fulfillment/orders/:orderId/checklist/:lineItemId', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: 'Missing organization context' });
      const parsed = fulfillmentChecklistItemSchema.parse(req.body || {});
      const actorUserId = getUserId(req.user) || null;
      const data = await canonicalFulfillmentOperations.updateChecklistItem(
        organizationId,
        req.params.orderId,
        req.params.lineItemId,
        parsed,
        actorUserId,
      );
      return res.json({ success: true, data, message: 'Fulfillment checklist updated' });
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        const message = error?.issues?.[0]?.message || 'Invalid fulfillment checklist payload';
        return res.status(400).json({ success: false, message, code: 'VALIDATION_ERROR' });
      }
      if (error instanceof FulfillmentHttpError) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      }
      console.error('[fulfillment] checklist update error:', error);
      return res.status(500).json(fulfillmentFailureResponse(
        error,
        'Failed to update fulfillment checklist',
        'FULFILLMENT_CHECKLIST_UPDATE_FAILED',
      ));
    }
  });

  app.post('/api/fulfillment/shipments', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) || null;
      const parsed = createFulfillmentShipmentSchema.parse(req.body || {});

      const shipment = await canonicalFulfillmentOperations.createShipment(organizationId, {
        scope: parsed.scope,
        orderIds: parsed.orderIds,
        primaryOrderId: parsed.primaryOrderId,
        actorUserId,
      });

      return res.json({ success: true, data: { shipmentId: shipment.id, shipment } });
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        return res.status(400).json({ success: false, message: 'Invalid shipment payload', code: 'VALIDATION_ERROR' });
      }
      if (error instanceof FulfillmentHttpError) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      }
      console.error('[fulfillment] create shipment error:', error);
      return res.status(500).json({ success: false, message: 'Failed to create shipment' });
    }
  });

  app.get('/api/fulfillment/shipments/:shipmentId', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const shipment = await canonicalFulfillmentOperations.getShipment(organizationId, req.params.shipmentId);

      if (!shipment) {
        return res.status(404).json({ success: false, message: 'Shipment not found', code: 'NOT_FOUND' });
      }

      return res.json({ success: true, data: shipment });
    } catch (error) {
      console.error('[fulfillment] get shipment error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch shipment' });
    }
  });

  app.patch('/api/fulfillment/shipments/:shipmentId', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) || null;
      const parsed = patchFulfillmentShipmentSchema.parse(req.body || {});

      const shipment = await canonicalFulfillmentOperations.patchShipment(organizationId, req.params.shipmentId, {
        carrier: parsed.carrier,
        serviceLevel: parsed.serviceLevel,
        trackingNumber: parsed.trackingNumber,
        shipDate: parsed.shipDate,
        boxCount: parsed.boxCount,
        weight: parsed.weight,
        dims: parsed.dims,
        internalNotes: parsed.internalNotes,
        shipmentItems: parsed.shipmentItems,
        packages: parsed.packages,
        actorUserId,
      });

      return res.json({ success: true, data: shipment });
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        return res.status(400).json({ success: false, message: error?.issues?.[0]?.message || 'Invalid shipment patch payload', code: 'VALIDATION_ERROR' });
      }
      if (error instanceof FulfillmentHttpError) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      }
      console.error('[fulfillment] patch shipment error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update shipment' });
    }
  });

  app.post('/api/fulfillment/shipments/:shipmentId/packages', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) || null;
      const parsed = z.object({
        weightLbs: z.coerce.number().min(0).optional().nullable(),
        dims: z.object({ length: z.coerce.number().min(0).optional().nullable(), width: z.coerce.number().min(0).optional().nullable(), height: z.coerce.number().min(0).optional().nullable() }).optional(),
        notes: z.string().max(2000).optional().nullable(),
      }).parse(req.body || {});
      const shipmentPackage = await canonicalFulfillmentOperations.createShipmentPackage(organizationId, req.params.shipmentId, { ...parsed, actorUserId });
      return res.status(201).json({ success: true, data: shipmentPackage });
    } catch (error: any) {
      if (error?.name === 'ZodError') return res.status(400).json({ success: false, message: 'Invalid package payload', code: 'VALIDATION_ERROR' });
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      console.error('[fulfillment] create shipment package error:', error);
      return res.status(500).json({ success: false, message: 'Failed to create shipment package' });
    }
  });

  app.delete('/api/fulfillment/shipments/:shipmentId/packages/:packageId', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const deleted = await canonicalFulfillmentOperations.deleteShipmentPackage(getRequestOrganizationId(req), req.params.shipmentId, req.params.packageId, getUserId(req.user) || null);
      return res.json({ success: true, data: deleted });
    } catch (error: any) {
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      console.error('[fulfillment] delete shipment package error:', error);
      return res.status(500).json({ success: false, message: 'Failed to delete shipment package' });
    }
  });

  app.post('/api/fulfillment/shipments/:shipmentId/mark-shipped', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) || null;

      const shipment = await canonicalFulfillmentOperations.markShipmentShipped(organizationId, req.params.shipmentId, actorUserId);
      return res.json({ success: true, data: shipment });
    } catch (error: any) {
      if (error instanceof FulfillmentHttpError) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      }
      console.error('[fulfillment] mark shipped error:', error);
      return res.status(500).json(fulfillmentFailureResponse(
        error,
        'Failed to mark shipment shipped',
        'FULFILLMENT_MARK_SHIPPED_FAILED',
      ));
    }
  });

  app.post('/api/fulfillment/shipments/:shipmentId/void', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) || null;

      const shipment = await canonicalFulfillmentOperations.voidShipment(organizationId, req.params.shipmentId, actorUserId);
      return res.json({ success: true, data: shipment });
    } catch (error: any) {
      if (error instanceof FulfillmentHttpError) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      }
      console.error('[fulfillment] void shipment error:', error);
      return res.status(500).json({ success: false, message: 'Failed to void shipment' });
    }
  });

  app.post('/api/fulfillment/pickup/:orderId', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) || null;

      const ticket = await canonicalFulfillmentOperations.createOrGetPickupTicket(organizationId, req.params.orderId, actorUserId);
      return res.json({ success: true, data: ticket });
    } catch (error: any) {
      if (error instanceof FulfillmentHttpError) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      }
      console.error('[fulfillment] create pickup ticket error:', error);
      return res.status(500).json({ success: false, message: 'Failed to create pickup ticket' });
    }
  });

  app.post('/api/fulfillment/pickup/:ticketId/ready', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) || null;
      const actorUserRole = req.orgRole || (req.user as any)?.orgRole || (req.user as any)?.role || null;
      const parsed = pickupReadySchema.parse(req.body || {});

      const result = await canonicalFulfillmentOperations.markPickupReady(organizationId, req.params.ticketId, parsed, actorUserId, actorUserRole);
      return res.json({
        success: true,
        data: {
          ticket: result.ticket,
          notification: result.notification,
        },
      });
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        return res.status(400).json({ success: false, message: 'Invalid pickup ready payload', code: 'VALIDATION_ERROR' });
      }
      if (error instanceof FulfillmentHttpError) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      }
      console.error('[fulfillment] mark pickup ready error:', error);
      return res.status(500).json({ success: false, message: 'Failed to mark pickup ready' });
    }
  });

  app.post('/api/fulfillment/pickup/:ticketId/picked-up', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) || null;

      const ticket = await canonicalFulfillmentOperations.markPickupPickedUp(organizationId, req.params.ticketId, actorUserId);
      return res.json({ success: true, data: ticket });
    } catch (error: any) {
      if (error instanceof FulfillmentHttpError) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      }
      console.error('[fulfillment] mark pickup picked-up error:', error);
      return res.status(500).json({ success: false, message: 'Failed to mark pickup picked-up' });
    }
  });

  app.post('/api/fulfillment/pickup/:ticketId/handoffs', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const parsed = pickupHandoffSchema.parse(req.body || {});
      const idempotencyHeader = String(req.get('Idempotency-Key') || '').trim();
      const handoff = pickupHandoffSchema.parse({
        ...parsed,
        clientRequestId: idempotencyHeader || parsed.clientRequestId,
      });
      const data = await canonicalFulfillmentOperations.recordPickupHandoff(organizationId, req.params.ticketId, handoff, getUserId(req.user) || null);
      return res.json({ success: true, data, message: data.terminal ? 'Pickup completed' : 'Partial pickup recorded' });
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        const issues = Array.isArray(error.issues)
          ? error.issues.map((issue: any) => ({ path: issue.path, code: issue.code, message: issue.message }))
          : [];
        console.warn('[fulfillment] invalid pickup handoff payload', { ticketId: req.params.ticketId, issues });
        return res.status(400).json({ success: false, message: 'Invalid pickup handoff payload', code: 'VALIDATION_ERROR' });
      }
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      console.error('[fulfillment] record pickup handoff error:', error);
      return res.status(500).json({ success: false, message: 'Failed to record pickup handoff' });
    }
  });

  // Get all shipments for an order
  app.get('/api/orders/:id/shipments', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const shipmentList = await storage.getShipmentsByOrder(organizationId, req.params.id);
      res.json({ success: true, data: shipmentList });
    } catch (error) {
      console.error('Error fetching shipments:', error);
      res.status(500).json({ error: 'Failed to fetch shipments' });
    }
  });

  // Legacy shipment mutation path is intentionally blocked during fulfillment contract tightening.
  app.post('/api/orders/:id/shipments', isAuthenticated, tenantContext, async (_req: any, res) => {
    return res.status(409).json({
      success: false,
      code: 'FULFILLMENT_V2_REQUIRED',
      message: 'Legacy shipment creation is disabled. Use the Fulfillment workspace shipment flow.',
    });
  });

  app.patch('/api/shipments/:id', isAuthenticated, tenantContext, async (_req: any, res) => {
    return res.status(409).json({
      success: false,
      code: 'FULFILLMENT_V2_REQUIRED',
      message: 'Legacy shipment editing is disabled. Use the Fulfillment workspace shipment flow.',
    });
  });

  app.delete('/api/shipments/:id', isAuthenticated, tenantContext, async (_req: any, res) => {
    return res.status(409).json({
      success: false,
      code: 'FULFILLMENT_V2_REQUIRED',
      message: 'Legacy shipment deletion is disabled. Use the Fulfillment workspace shipment flow.',
    });
  });

  // Manually update order fulfillment status (override auto-status - manager+ only)
  app.patch('/api/orders/:id/fulfillment-status', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);

      if (!['owner', 'admin', 'manager'].includes(String(req.actorOrgRole ?? req.orgRole ?? '').toLowerCase())) {
        return res.status(403).json({ error: 'Manager, Admin, or Owner role required' });
      }

      const [order] = await db
        .select({
          id: orders.id,
          state: orders.state,
        })
        .from(orders)
        .where(and(eq(orders.id, req.params.id), eq(orders.organizationId, organizationId)))
        .limit(1);

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      if (order.state === 'production_complete') {
        return res.status(409).json({
          error: 'Manual fulfillment status overrides are disabled for fulfillment-managed orders. Use shipment or pickup actions.',
          code: 'FULFILLMENT_ARTIFACT_SYNC_REQUIRED',
        });
      }

      const { status } = req.body;

      if (!['pending', 'packed', 'shipped', 'delivered'].includes(status)) {
        return res.status(400).json({ error: 'Invalid fulfillment status' });
      }
      if (['shipped', 'delivered'].includes(status)) {
        return res.status(409).json({
          error: 'Terminal fulfillment status must be recorded through shipment or pickup actions.',
          code: 'FULFILLMENT_TERMINAL_ACTION_REQUIRED',
        });
      }

      await updateOrderFulfillmentStatus(organizationId, req.params.id, status);

      res.json({ success: true, message: 'Fulfillment status updated successfully' });
    } catch (error) {
      console.error('Error updating fulfillment status:', error);
      res.status(500).json({ error: 'Failed to update fulfillment status' });
    }
  });

  // Send shipment notification email
  app.post('/api/orders/:id/send-shipping-email', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(400).json({ error: 'Organization context is required' });
      if (!['owner', 'admin', 'manager'].includes(String(req.actorOrgRole ?? req.orgRole ?? '').toLowerCase())) {
        return res.status(403).json({ error: 'Manager, Admin, or Owner role required' });
      }
      const orderId = req.params.id;
      const { shipmentId, subject, customMessage } = req.body;

      if (!shipmentId) {
        return res.status(400).json({ error: 'shipmentId is required' });
      }

      await sendShipmentEmail(organizationId, orderId, shipmentId.toString(), subject, customMessage);
      res.json({ success: true, message: 'Shipment email sent successfully' });
    } catch (error) {
      console.error('Error sending shipment email:', error);
      res.status(500).json({ error: 'Failed to send shipment email' });
    }
  });
}
