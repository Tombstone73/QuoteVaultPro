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

import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import { documentEmailRecipientInputSchema, parseDocumentEmailRecipients } from "@shared/documentEmailRecipients";
import { actualPurchaseCostSchema, purchaseQuantity } from "@shared/purchaseOrderWorkflow";
import { buildOrderCreationFingerprint } from "./helpers/orderCreationIdempotency.helpers";
import { getInvoiceEmailDeliveryFailureKind } from "../services/invoiceEmailDeliveryFailure";
import { purchaseOrderPdfFilename } from "../lib/purchaseOrderPdf";
import { emailService } from "../emailService";
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

const purchaseOrderEmailSchema = z.object({
  revision: z.number().int().nonnegative(),
  recipients: documentEmailRecipientInputSchema,
  subject: z.string().trim().min(1).max(250).refine(value => !/[\r\n]/.test(value), "Subject must be one line."),
  message: z.string().trim().max(10000),
});

function purchaseOrderActor(req: Request) {
  const user = req.user as { id?: string; email?: string; firstName?: string; lastName?: string } | undefined;
  const userId = getUserId(user);
  if (!userId) throw Object.assign(new Error('Sign in to manage purchase orders.'), { statusCode: 401 });
  return { userId, userName: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email, ipAddress: req.ip, userAgent: req.get('user-agent') };
}

function purchaseOrderFailure(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return res.status(400).json({ success: false, error: [issue?.path.join('.'), issue?.message].filter(Boolean).join(': ') });
  }
  const failure = error as { statusCode?: number; code?: string; message?: string } | null;
  if (failure?.statusCode) return res.status(failure.statusCode).json({ success: false, code: failure.code, error: failure.message });
  console.error('[PURCHASE ORDER]', error);
  return res.status(500).json({ success: false, error: 'The purchase order operation could not be confirmed. Reload its saved state before retrying.' });
}

export function registerProcurementRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdminOrOwner: any;
  },
  sendEmail = emailService.sendEmail.bind(emailService),
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

  // New editors use distinct write URLs so a frontend-first rollout cannot
  // send versioned edits to an older backend that replaces every PO line.
  app.post(['/api/purchase-orders', '/api/purchase-orders/workflow'], isAuthenticated, tenantContext, isAdminOrOwner, async (req, res) => {
    try {
      const organizationId = getRequestOrganizationId(req)!;
      const actor = purchaseOrderActor(req);
      const data = insertPurchaseOrderSchema.parse(req.body);
      const created = await storage.createPurchaseOrder(organizationId, { ...data, createdByUserId: actor.userId }, actor);
      res.json({ success: true, data: created });
    } catch (error) {
      purchaseOrderFailure(res, error);
    }
  });

  app.patch(['/api/purchase-orders/:id', '/api/purchase-orders/:id/workflow'], isAuthenticated, tenantContext, isAdminOrOwner, async (req, res) => {
    try {
      const data = updatePurchaseOrderSchema.parse(req.body);
      const updated = await storage.updatePurchaseOrder(getRequestOrganizationId(req)!, req.params.id, data, purchaseOrderActor(req));
      res.json({ success: true, data: updated });
    } catch (error) {
      purchaseOrderFailure(res, error);
    }
  });

  app.delete('/api/purchase-orders/:id', isAuthenticated, tenantContext, isAdminOrOwner, async (req, res) => {
    try {
      await storage.deletePurchaseOrder(getRequestOrganizationId(req)!, req.params.id, purchaseOrderActor(req));
      res.json({ success: true });
    } catch (error) {
      purchaseOrderFailure(res, error);
    }
  });

  // The established /send action issues the agreement. Vendor email is a separate action.
  app.post(['/api/purchase-orders/:id/send', '/api/purchase-orders/:id/issue'], isAuthenticated, tenantContext, isAdminOrOwner, async (req, res) => {
    try {
      const { expectedVersion } = z.object({ expectedVersion: z.number().int().nonnegative() }).parse(req.body);
      const updated = await storage.sendPurchaseOrder(getRequestOrganizationId(req)!, req.params.id, expectedVersion, purchaseOrderActor(req));
      res.json({ success: true, data: updated });
    } catch (error) {
      purchaseOrderFailure(res, error);
    }
  });

  app.post(['/api/purchase-orders/:id/receive', '/api/purchase-orders/:id/receipts'], isAuthenticated, tenantContext, isAdminOrOwner, async (req, res) => {
    try {
      const { expectedVersion, items } = z.object({ expectedVersion: z.number().int().nonnegative(), items: z.array(z.object({
        lineItemId: z.string().min(1),
        quantityToReceive: purchaseQuantity,
        receivedDate: z.string().datetime({ offset: true }).transform(date => new Date(date)).optional(),
      })).min(1).max(500) }).parse(req.body);
      const updated = await storage.receivePurchaseOrderLines(getRequestOrganizationId(req)!, req.params.id, items, purchaseOrderActor(req), expectedVersion);
      res.json({ success: true, data: updated });
    } catch (error) {
      purchaseOrderFailure(res, error);
    }
  });

  app.post('/api/purchase-orders/:id/actual-costs', isAuthenticated, tenantContext, isAdminOrOwner, async (req, res) => {
    try {
      const data = actualPurchaseCostSchema.parse(req.body);
      const updated = await storage.recordPurchaseOrderActualCost(getRequestOrganizationId(req)!, req.params.id, data, purchaseOrderActor(req));
      res.json({ success: true, data: updated });
    } catch (error) {
      purchaseOrderFailure(res, error);
    }
  });

  app.post('/api/purchase-orders/:id/archive-current', isAuthenticated, tenantContext, isAdminOrOwner, async (req, res) => {
    try {
      const { expectedVersion } = z.object({ expectedVersion: z.number().int().nonnegative() }).parse(req.body);
      const updated = await storage.archiveCurrentPurchaseOrder(getRequestOrganizationId(req), req.params.id, expectedVersion, purchaseOrderActor(req));
      res.json({ success: true, data: updated });
    } catch (error) {
      purchaseOrderFailure(res, error);
    }
  });

  app.post('/api/purchase-orders/:id/acknowledge', isAuthenticated, tenantContext, isAdminOrOwner, async (req, res) => {
    try {
      const { revision, reference } = z.object({
        revision: z.number().int().nonnegative(), reference: z.string().trim().min(1).max(1000),
      }).parse(req.body);
      const saved = await storage.getPurchaseOrderRevision(getRequestOrganizationId(req)!, req.params.id, revision);
      if (saved.revision.source === 'legacy_capture' && saved.po.revision !== revision) {
        return res.status(400).json({ error: 'Select a verified issued revision or the current saved agreement.' });
      }
      await storage.recordPurchaseOrderActivity(saved.po, purchaseOrderActor(req), 'ACKNOWLEDGE', 'Recorded vendor acknowledgment for revision ' + revision, { revision, reference });
      res.json({ success: true });
    } catch (error) {
      purchaseOrderFailure(res, error);
    }
  });

  app.get('/api/purchase-orders/:id/revisions/:revision/pdf', isAuthenticated, tenantContext, async (req, res) => {
    try {
      const revision = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().safe()).parse(req.params.revision);
      const saved = await storage.getPurchaseOrderRevision(getRequestOrganizationId(req)!, req.params.id, revision);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="' + purchaseOrderPdfFilename(saved.po.poNumber, revision) + '"',
        'Cache-Control': 'private, no-store',
      }).send(saved.revision.pdfBytes);
    } catch (error) {
      purchaseOrderFailure(res, error);
    }
  });

  app.post('/api/purchase-orders/:id/email', isAuthenticated, tenantContext, isAdminOrOwner, async (req, res) => {
    try {
      const organizationId = getRequestOrganizationId(req)!;
      const actor = purchaseOrderActor(req);
      const key = z.string().uuid().parse(req.get('Idempotency-Key'));
      const draft = purchaseOrderEmailSchema.parse(req.body);
      const { recipients, errors, limitError } = parseDocumentEmailRecipients(draft.recipients);
      const recipientError = Object.values(errors)[0] ?? limitError;
      if (recipientError || !recipients.to.length) return res.status(400).json({ error: recipientError || 'Enter at least one To address.' });
      const fingerprint = createHash('sha256').update(buildOrderCreationFingerprint({ ...draft, recipients })).digest('hex');
      const request = { key, fingerprint, revision: draft.revision, recipients };
      const saved = await storage.getPurchaseOrderRevision(organizationId, req.params.id, draft.revision);
      if (!saved.revision.snapshot.vendor) return res.status(400).json({ error: 'Assign a vendor and save the agreement before sending.' });
      const claim = await storage.claimPurchaseOrderEmail(organizationId, req.params.id, actor, request);
      if (claim.providerMessageId) return res.json({ success: true, data: { providerMessageId: claim.providerMessageId } });

      let providerMessageId: string;
      try {
        const html = draft.message.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] ?? char);
        providerMessageId = await sendEmail(organizationId, {
          ...recipients, subject: draft.subject, text: draft.message, html: '<div style="white-space:pre-wrap">' + html + '</div>',
          attachments: [{ filename: purchaseOrderPdfFilename(saved.po.poNumber, draft.revision), content: saved.revision.pdfBytes, contentType: 'application/pdf' }],
        });
      } catch (error) {
        const uncertain = getInvoiceEmailDeliveryFailureKind(error) === 'needs_review';
        await storage.recordPurchaseOrderActivity(claim.po, actor, uncertain ? 'EMAIL_UNCONFIRMED' : 'EMAIL_FAILED',
          uncertain ? 'Gmail acceptance could not be confirmed' : 'Gmail email failed', request);
        return res.status(uncertain ? 409 : 422).json({
          error: uncertain ? 'Gmail acceptance could not be confirmed. Check Gmail Sent before retrying.' :
            'Gmail did not accept the email. Check the Gmail connection and try again.',
          retryable: !uncertain,
        });
      }
      await storage.recordPurchaseOrderActivity(claim.po, actor, 'EMAIL_ACCEPTED', 'Gmail accepted revision ' + draft.revision, { ...request, providerMessageId });
      res.json({ success: true, data: { providerMessageId } });
    } catch (error) {
      purchaseOrderFailure(res, error);
    }
  });
}
