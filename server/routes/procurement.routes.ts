/**
 * procurement.routes.ts
 *
 * Vendor and Purchase Order routes extracted from server/routes.ts.
 *
 * Routes:
 *   GET    /api/vendors
 *   GET    /api/vendors/:id
 *   POST   /api/vendors
 *   PATCH  /api/vendors/:id
 *   DELETE /api/vendors/:id
 *
 *   GET    /api/purchase-orders
 *   GET    /api/purchase-orders/:id
 *   POST   /api/purchase-orders
 *   PATCH  /api/purchase-orders/:id
 *   DELETE /api/purchase-orders/:id
 *   POST   /api/purchase-orders/:id/send
 *   POST   /api/purchase-orders/:id/receive
 *
 * Placement: server/routes/procurement.routes.ts
 * Registered by: server/routes.ts via registerProcurementRoutes
 */

import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import {
  insertVendorSchema,
  updateVendorSchema,
  insertPurchaseOrderSchema,
  updatePurchaseOrderSchema,
} from "@shared/schema";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

export function registerProcurementRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdminOrOwner: any;
  },
): void {
  const { isAuthenticated, tenantContext, isAdminOrOwner } = middleware;

  // =============================
  // Vendor Routes
  // =============================
  app.get('/api/vendors', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const { search, isActive, page, pageSize } = req.query;
      const vendors = await storage.getVendors(organizationId, {
        search: typeof search === 'string' ? search : undefined,
        isActive: typeof isActive === 'string' ? isActive === 'true' : undefined,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      });
      res.json({ success: true, data: vendors });
    } catch (error) {
      console.error('[VENDORS LIST] Error:', error);
      res.status(500).json({ error: 'Failed to fetch vendors' });
    }
  });

  app.get('/api/vendors/:id', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const vendor = await storage.getVendorById(organizationId, req.params.id);
      if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
      res.json({ success: true, data: vendor });
    } catch (error) {
      console.error('[VENDOR GET] Error:', error);
      res.status(500).json({ error: 'Failed to fetch vendor' });
    }
  });

  app.post('/api/vendors', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const parsed = insertVendorSchema.parse(req.body);
      const { organizationId: _orgId, ...vendorData } =
        parsed as typeof parsed & { organizationId?: string };
      const created = await storage.createVendor(organizationId, vendorData);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'CREATE',
        entityType: 'vendor',
        entityId: created.id,
        entityName: created.name,
        description: `Created vendor ${created.name}`,
        newValues: created,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: created });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid vendor data', details: error.errors });
      }
      console.error('[VENDOR CREATE] Error:', error);
      res.status(500).json({ error: 'Failed to create vendor' });
    }
  });

  app.patch('/api/vendors/:id', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const updates = updateVendorSchema.partial ? updateVendorSchema.partial().parse(req.body) : updateVendorSchema.parse(req.body);
      const existing = await storage.getVendorById(organizationId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Vendor not found' });
      const updated = await storage.updateVendor(organizationId, req.params.id, updates);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'UPDATE',
        entityType: 'vendor',
        entityId: updated.id,
        entityName: updated.name,
        description: `Updated vendor ${updated.name}`,
        oldValues: existing,
        newValues: updated,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid vendor update data', details: error.errors });
      }
      console.error('[VENDOR UPDATE] Error:', error);
      res.status(500).json({ error: 'Failed to update vendor' });
    }
  });

  app.delete('/api/vendors/:id', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const existing = await storage.getVendorById(organizationId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Vendor not found' });
      await storage.deleteVendor(organizationId, req.params.id);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'DELETE',
        entityType: 'vendor',
        entityId: existing.id,
        entityName: existing.name,
        description: `Deleted (or deactivated) vendor ${existing.name}`,
        oldValues: existing,
        newValues: null,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true });
    } catch (error) {
      console.error('[VENDOR DELETE] Error:', error);
      res.status(500).json({ error: 'Failed to delete vendor' });
    }
  });

  // =============================
  // Purchase Order Routes
  // =============================
  app.get('/api/purchase-orders', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const { vendorId, status, search, startDate, endDate } = req.query;
      const pos = await storage.getPurchaseOrders(organizationId, {
        vendorId: typeof vendorId === 'string' ? vendorId : undefined,
        status: typeof status === 'string' ? status : undefined,
        search: typeof search === 'string' ? search : undefined,
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
      });
      res.json({ success: true, data: pos });
    } catch (error) {
      console.error('[PO LIST] Error:', error);
      res.status(500).json({ error: 'Failed to fetch purchase orders' });
    }
  });

  app.get('/api/purchase-orders/related-orders/search', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: 'Missing organization context' });
      const query = typeof req.query.q === 'string' ? req.query.q : "";
      const limit = req.query.limit ? Number(req.query.limit) : 10;
      const recent = req.query.recent === 'true';
      const results = await storage.searchPurchaseOrderRelatedOrders(organizationId, { query, limit, recent });
      res.json({ success: true, data: results });
    } catch (error) {
      console.error('[PO RELATED ORDER SEARCH] Error:', error);
      res.status(500).json({ success: false, error: 'Failed to search related jobs/orders' });
    }
  });

  app.get('/api/purchase-orders/:id', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const po = await storage.getPurchaseOrderWithLines(organizationId, req.params.id);
      if (!po) return res.status(404).json({ error: 'Purchase order not found' });
      res.json({ success: true, data: po });
    } catch (error) {
      console.error('[PO GET] Error:', error);
      res.status(500).json({ error: 'Failed to fetch purchase order' });
    }
  });

  app.post('/api/purchase-orders', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const parsed = insertPurchaseOrderSchema.parse(req.body);
      const { organizationId: _orgId, ...poData } =
        parsed as typeof parsed & { organizationId?: string };
      const userId = getUserId(req.user);
      const created = await storage.createPurchaseOrder(organizationId, { ...poData, createdByUserId: userId! });
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'CREATE',
        entityType: 'purchase_order',
        entityId: created.id,
        entityName: created.poNumber,
        description: `Created PO ${created.poNumber}`,
        newValues: created,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: created });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        console.error('[PO CREATE] Zod validation error:', JSON.stringify(error.errors, null, 2));
        console.error('[PO CREATE] Request body:', JSON.stringify(req.body, null, 2));
        return res.status(400).json({ success: false, error: 'Invalid purchase order data', details: error.errors });
      }
      if (error.statusCode || error.code) {
        return res.status(error.statusCode || 400).json({ success: false, code: error.code || 'PURCHASE_ORDER_CREATE_INVALID', error: error.message });
      }
      console.error('[PO CREATE] Error:', error);
      res.status(500).json({ success: false, error: 'Failed to create purchase order' });
    }
  });

  app.patch('/api/purchase-orders/:id', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const updates = updatePurchaseOrderSchema.parse(req.body);
      const existing = await storage.getPurchaseOrderWithLines(organizationId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
      const updated = await storage.updatePurchaseOrder(organizationId, req.params.id, updates as any);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'UPDATE',
        entityType: 'purchase_order',
        entityId: updated.id,
        entityName: updated.poNumber,
        description: `Updated PO ${updated.poNumber}`,
        oldValues: existing,
        newValues: updated,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ success: false, error: 'Invalid purchase order update data', details: error.errors });
      }
      if (error.statusCode || error.code) {
        return res.status(error.statusCode || 400).json({ success: false, code: error.code || 'PURCHASE_ORDER_UPDATE_INVALID', error: error.message });
      }
      console.error('[PO UPDATE] Error:', error);
      res.status(500).json({ success: false, error: 'Failed to update purchase order' });
    }
  });

  app.delete('/api/purchase-orders/:id', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const existing = await storage.getPurchaseOrderWithLines(organizationId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
      await storage.deletePurchaseOrder(organizationId, req.params.id);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'DELETE',
        entityType: 'purchase_order',
        entityId: existing.id,
        entityName: existing.poNumber,
        description: `Deleted draft PO ${existing.poNumber}`,
        oldValues: existing,
        newValues: null,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true });
    } catch (error) {
      console.error('[PO DELETE] Error:', error);
      res.status(500).json({ error: 'Failed to delete purchase order' });
    }
  });

  app.post('/api/purchase-orders/:id/send', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const existing = await storage.getPurchaseOrderWithLines(organizationId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
      if (existing.status !== 'draft') return res.status(400).json({ success: false, error: 'Only draft POs can be issued' });
      const updated = await storage.sendPurchaseOrder(organizationId, req.params.id);
      const userId = getUserId(req.user);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'ISSUE',
        entityType: 'purchase_order',
        entityId: updated.id,
        entityName: updated.poNumber,
        description: `Issued PO ${updated.poNumber}`,
        oldValues: existing,
        newValues: updated,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('[PO SEND] Error:', error);
      res.status(500).json({ error: 'Failed to send purchase order' });
    }
  });

  app.post('/api/purchase-orders/:id/receive', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const itemsSchema = z.object({
        items: z.array(z.object({
          lineItemId: z.string(),
          quantityToReceive: z.number().positive(),
          receivedDate: z.string().optional(),
        }))
      });
      const parsed = itemsSchema.parse(req.body);
      const existing = await storage.getPurchaseOrderWithLines(organizationId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
      if (!['sent', 'issued', 'partially_received'].includes(existing.status)) return res.status(400).json({ error: 'Only issued POs can receive items' });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: 'User not authenticated' });
      const receiveItems = parsed.items.map(i => ({
        lineItemId: i.lineItemId,
        quantityToReceive: i.quantityToReceive,
        receivedDate: i.receivedDate ? new Date(i.receivedDate) : undefined,
      }));
      const updated = await storage.receivePurchaseOrderLines(organizationId, req.params.id, receiveItems, userId);
      const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'RECEIVE',
        entityType: 'purchase_order',
        entityId: updated.id,
        entityName: updated.poNumber,
        description: `Received items for PO ${updated.poNumber}`,
        oldValues: existing,
        newValues: updated,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Invalid receive data', details: error.errors });
      }
      console.error('[PO RECEIVE] Error:', error);
      res.status(500).json({ error: 'Failed to receive purchase order items' });
    }
  });
}
