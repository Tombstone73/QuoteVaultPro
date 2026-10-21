import { fulfillmentHistoryNoteSchema } from "@shared/fulfillmentHistoryNote";
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
  pickupDetailsSchema,
  terminalFulfillmentReversalSchema,
} from "../services/fulfillment/schemas";
import { FulfillmentHttpError } from "../services/fulfillment/types";
import { canonicalFulfillmentOperations } from "../services/fulfillment/canonicalFulfillmentOperations";
import { methodChangeAccountingBlock } from "../services/fulfillment/methodChangePolicy";
import { shippingDocumentTypeSchema } from '@shared/shippingDocuments';
import { getUpsRates, UpsRateRejection, verifyUpsShipmentDestination } from '../services/ups/upsRates';
import { getOrganizationTimezone } from '../services/orderDueDateService';
import { organizationBusinessToday } from '../lib/orderDueDate';
import archiver from 'archiver';
import { buyUpsLabel, getUpsLabelHistory, readUpsLabelArchive, readUpsLabelEvidence, readUpsPackageLabel,
  recoverRecordedUpsPurchase, retireUpsSampleLabel, verifyUpsPackageLabelMapping, voidUpsLabel } from '../services/ups/upsLabels';
import { reportExternalUpsCancellation } from '../services/ups/upsLabels';
import { applyUpsRateToCustomerCharge, getUpsCustomerCharges } from '../services/ups/upsCharges';
import { getUpsProfitabilityReport, recordUpsCarrierAdjustment, upsProfitabilityCsv } from '../services/ups/upsProfitability';
import { completeUpsAuthorization, disconnectUps, startUpsAuthorization, upsConnectionStatus,
  upsEnvironmentMode, validUpsAuthorizationState, type UpsPendingAuthorization } from '../services/ups/upsConnection';

// Handles both Replit auth (claims.sub) and local auth (id) formats
const getUserId = (user: any): string | undefined => user?.claims?.sub || user?.id;

function requireTerminalFulfillmentReversalAuthority(req: any): void {
  const role = String(req.actorOrgRole ?? req.orgRole ?? req.user?.orgRole ?? req.user?.role ?? '').trim().toLowerCase();
  if (!['owner', 'admin'].includes(role)) {
    throw new FulfillmentHttpError(403, 'Organization Owner or Admin authority is required to reverse terminal fulfillment.', 'FULFILLMENT_TERMINAL_REVERSAL_FORBIDDEN');
  }
}

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
    requireOrgOwnerAdmin: any;
  },
): void {
  const { isAuthenticated, tenantContext, requireOrgOwnerAdmin } = middleware;

  app.get('/api/fulfillment/ups-environment', isAuthenticated, tenantContext, async (req: any, res) => {
    try { return res.json({ success: true, data: { mode: upsEnvironmentMode(),
      businessDate: organizationBusinessToday(new Date(), await getOrganizationTimezone(getRequestOrganizationId(req))) } }); }
    catch { return res.status(500).json({ success: false, message: 'Could not read the shop business date.' }); }
  });

  app.get('/api/integrations/ups/status', isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try { return res.json({ success: true, data: await upsConnectionStatus(getRequestOrganizationId(req)) }); }
    catch { return res.status(500).json({ success: false, message: 'Could not read UPS connection status.' }); }
  });
  app.post('/api/integrations/ups/connect', isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const { accountNumber } = z.object({ accountNumber: z.string().trim().min(6).max(10) }).strict().parse(req.body);
      const actorId = getUserId(req.user);
      if (!actorId || !req.session) return res.status(401).json({ success: false, message: 'Sign in again to connect UPS.' });
      const { url, pending } = startUpsAuthorization(getRequestOrganizationId(req), actorId, accountNumber);
      const callback = new URL(String(process.env.UPS_REDIRECT_URI));
      if (callback.host.toLowerCase() !== String(req.get('host') || '').toLowerCase()) return res.status(409).json({ success: false,
        code: 'UPS_CALLBACK_MISMATCH', message: 'UPS callback must point to this backend. Ask an administrator to register and configure its exact callback URL.' });
      req.session.upsPending = pending;
      return res.json({ success: true, data: { authorizeUrl: url } });
    }
    catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: 'Enter a valid UPS shipper/account number.' });
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      return res.status(500).json({ success: false, message: 'Could not connect UPS. Retry or check server configuration.' });
    }
  });
  app.get('/api/integrations/ups/callback', isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    const redirect = (result: string) => {
      const base = String(process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
      return res.redirect(`${base}/settings/shipping?ups=${result}`);
    };
    const pending = req.session?.upsPending as UpsPendingAuthorization | undefined;
    // A session-bound, single-use state binds UPS's callback to the initiating tenant and administrator.
    delete req.session?.upsPending;
    if (!validUpsAuthorizationState(pending, req.query.state, getRequestOrganizationId(req), getUserId(req.user) ?? '')) {
      return redirect('invalid_state');
    }
    if (req.query.error || typeof req.query.code !== 'string' || !req.query.code) return redirect('denied');
    try { await completeUpsAuthorization(pending, req.query.code); return redirect('connected'); }
    catch { return redirect('failed'); }
  });
  app.post('/api/integrations/ups/disconnect', isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try { return res.json({ success: true, data: await disconnectUps(getRequestOrganizationId(req)) }); }
    catch { return res.status(500).json({ success: false, message: 'Could not disconnect UPS.' }); }
  });
  const upsPackageSchema = z.object({ id: z.string().min(1), packagingType: z.enum(['02', '21']),
    weightLbs: z.number().positive(), lengthIn: z.number().positive(), widthIn: z.number().positive(), heightIn: z.number().positive() }).strict();
  app.post('/api/fulfillment/shipments/:shipmentId/ups-rates', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { packages } = z.object({ packages: z.array(upsPackageSchema).min(1).max(20) }).strict().parse(req.body);
      return res.json({ success: true, data: await getUpsRates(getRequestOrganizationId(req), req.params.shipmentId, packages) });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: 'Enter a supported package type and positive weight and dimensions for every package.', code: 'UPS_INVALID_PACKAGE' });
      if (error instanceof UpsRateRejection) return res.status(error.status).json({ success: false, message: error.message,
        code: error.code, providerCode: error.providerCode, providerDescription: error.providerDescription,
        requestReference: error.requestReference, affectedField: error.affectedField });
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      return res.status(500).json({ success: false, message: 'Could not retrieve UPS rates. Try again.' });
    }
  });
  app.post('/api/fulfillment/shipments/:shipmentId/ups-verify-address', isAuthenticated, tenantContext, async (req: any, res) => {
    try { return res.json({ success: true, data: await verifyUpsShipmentDestination(getRequestOrganizationId(req), req.params.shipmentId) }); }
    catch (error) {
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
      return res.status(503).json({ success: false, code: 'UPS_VERIFY_UNAVAILABLE', message: 'Address verification is unavailable. You can still request rates.' });
    }
  });
  app.get('/api/fulfillment/shipments/:shipmentId/ups-customer-charges', isAuthenticated, tenantContext, async (req: any, res) => {
    try { return res.json({ success: true, data: await getUpsCustomerCharges(getRequestOrganizationId(req), req.params.shipmentId) }); }
    catch (error) { return upsFailure(res, error, 'Could not load customer shipping charges.'); }
  });
  app.post('/api/fulfillment/shipments/:shipmentId/ups-customer-charge', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const input = z.object({ quoteId: z.string().uuid(), optionId: z.string().min(1).max(12),
        intent: z.enum(['default_if_unset', 'use_ups_rate']) }).strict().parse(req.body);
      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: 'Authentication required.' });
      return res.json({ success: true, data: await applyUpsRateToCustomerCharge({ ...input,
        organizationId: getRequestOrganizationId(req), shipmentId: req.params.shipmentId,
        actorUserId, actorOrgRole: req.actorOrgRole ?? req.orgRole ?? null }) });
    } catch (error) {
      const block = methodChangeAccountingBlock(error);
      if (block) return res.status(block.status).json({ success: false, code: block.code, message: block.message });
      return upsFailure(res, error, 'Could not change the customer shipping charge.');
    }
  });
  const upsPurchaseBody = z.object({ quoteId: z.string().uuid(), optionId: z.string().min(1).max(12) }).strict();
  const upsFailure = (res: any, error: unknown, fallback: string) => {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, code: 'UPS_INVALID_REQUEST', message: 'Select a current UPS rate.' });
    if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    const known = error as { statusCode?: number; code?: string; message?: string } | null;
    if (known?.statusCode === 409 && known.code) return res.status(409).json({ success: false, code: known.code, message: known.message || fallback });
    console.error('[ups-label] unexpected operation failure', error instanceof Error ? error.name : 'unknown');
    return res.status(500).json({ success: false, code: 'UPS_OPERATION_FAILED', message: fallback });
  };
  app.get('/api/fulfillment/shipments/:shipmentId/ups-labels', isAuthenticated, tenantContext, async (req: any, res) => {
    try { return res.json({ success: true, data: await getUpsLabelHistory(getRequestOrganizationId(req), req.params.shipmentId) }); }
    catch (error) { return upsFailure(res, error, 'Could not load UPS label history.'); }
  });
  app.post('/api/fulfillment/shipments/:shipmentId/ups-labels/purchase', isAuthenticated, tenantContext, async (req: any, res) => {
    try { const input = upsPurchaseBody.parse(req.body); return res.status(201).json({ success: true,
      data: await buyUpsLabel(getRequestOrganizationId(req), req.params.shipmentId, input, getUserId(req.user)) }); }
    catch (error) { return upsFailure(res, error, 'UPS label purchase needs investigation. Refresh the attempt history before taking another action.'); }
  });
  app.post('/api/fulfillment/shipments/:shipmentId/ups-labels/:purchaseId/map-packages', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const input = z.object({ assignments: z.array(z.object({ labelId: z.string().uuid(),
        packageId: z.string().uuid() }).strict()).min(2).max(100), operatorConfirmed: z.literal(true) }).strict().parse(req.body);
      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: 'Authentication required.' });
      return res.json({ success: true, data: await verifyUpsPackageLabelMapping(getRequestOrganizationId(req),
        req.params.shipmentId, req.params.purchaseId, actorUserId, input.assignments) });
    } catch (error) { return upsFailure(res, error, 'Could not verify UPS box labels.'); }
  });
  app.post('/api/fulfillment/shipments/:shipmentId/ups-labels/:purchaseId/recover', isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try { return res.json({ success: true, data: await recoverRecordedUpsPurchase(getRequestOrganizationId(req),
      req.params.shipmentId, req.params.purchaseId, getUserId(req.user)) }); }
    catch (error) { return upsFailure(res, error, 'UPS attempt recovery requires review.'); }
  });
  app.post('/api/fulfillment/shipments/:shipmentId/ups-labels/:purchaseId/retire-sample', isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const input = z.object({ reason: z.string().trim().min(10).max(500),
        evidenceReference: z.string().trim().min(8).max(300).optional() }).strict().parse(req.body);
      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: 'Authentication required.' });
      return res.json({ success: true, data: await retireUpsSampleLabel(getRequestOrganizationId(req),
        req.params.shipmentId, req.params.purchaseId, actorUserId, input) });
    } catch (error) { return upsFailure(res, error, 'Could not retire the sample label.'); }
  });
  app.post('/api/fulfillment/shipments/:shipmentId/ups-labels/:purchaseId/void', isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try { const history = await getUpsLabelHistory(getRequestOrganizationId(req), req.params.shipmentId);
      if (!history.some(row => row.id === req.params.purchaseId)) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'UPS label not found.' });
      return res.json({ success: true, data: await voidUpsLabel(getRequestOrganizationId(req), req.params.purchaseId, getUserId(req.user)) }); }
    catch (error) { return upsFailure(res, error, 'UPS void outcome needs investigation.'); }
  });
  app.post('/api/fulfillment/shipments/:shipmentId/ups-labels/:purchaseId/external-cancellation', isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const input = z.object({ reason: z.string().trim().min(3).max(2000), reference: z.string().trim().max(160).optional() }).strict().parse(req.body);
      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: 'Authentication required.' });
      return res.json({ success: true, data: await reportExternalUpsCancellation(getRequestOrganizationId(req),
        req.params.shipmentId, req.params.purchaseId, actorUserId, input) });
    } catch (error) { return upsFailure(res, error, 'Could not record external cancellation.'); }
  });
  app.post('/api/fulfillment/shipments/:shipmentId/ups-labels/:purchaseId/carrier-adjustments', isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const input = z.object({ kind: z.enum(['CONFIRMED_CREDIT', 'CARRIER_ADJUSTMENT']),
        amountCents: z.number().int().refine(value => value !== 0), currency: z.string().regex(/^[A-Z]{3}$/),
        providerReference: z.string().trim().min(1).max(160), note: z.string().trim().max(2000).optional() }).strict().parse(req.body);
      if (input.kind === 'CONFIRMED_CREDIT' && input.amountCents <= 0) return res.status(400).json({ success: false, message: 'A confirmed carrier credit must be positive.' });
      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: 'Authentication required.' });
      const history = await getUpsLabelHistory(getRequestOrganizationId(req), req.params.shipmentId);
      if (!history.some(row => row.id === req.params.purchaseId)) return res.status(404).json({ success: false, message: 'UPS purchase not found.' });
      return res.json({ success: true, data: await recordUpsCarrierAdjustment({ ...input,
        organizationId: getRequestOrganizationId(req), purchaseId: req.params.purchaseId, actorUserId }) });
    } catch (error) { return upsFailure(res, error, 'Could not record carrier adjustment.'); }
  });
  app.get('/api/reports/ups-shipping-profitability', isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const query = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        format: z.enum(['json', 'csv']).optional() }).parse(req.query);
      const from = new Date(`${query.from}T00:00:00.000Z`);
      const toExclusive = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000);
      if (Number.isNaN(from.getTime()) || Number.isNaN(toExclusive.getTime())) return res.status(400).json({ success: false, message: 'Invalid date range.' });
      const report = await getUpsProfitabilityReport(getRequestOrganizationId(req), from, toExclusive);
      if (query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="ups-shipping-profitability-${query.from}-${query.to}.csv"`);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.send(upsProfitabilityCsv(report.rows));
      }
      return res.json({ success: true, data: report });
    } catch (error) { return upsFailure(res, error, 'Could not load UPS profitability report.'); }
  });
  app.get('/api/fulfillment/shipments/:shipmentId/ups-labels/:purchaseId/packages/:packageId/image', isAuthenticated, tenantContext, async (req: any, res) => {
    try { const label = await readUpsPackageLabel(getRequestOrganizationId(req), req.params.shipmentId,
      req.params.purchaseId, req.params.packageId);
      res.setHeader('Content-Type', label.mimeType); res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="UPS-${label.trackingNumber}.gif"`);
      return res.send(label.bytes); }
    catch (error) { return upsFailure(res, error, 'Could not retrieve UPS label.'); }
  });
  app.get('/api/fulfillment/shipments/:shipmentId/ups-labels/:purchaseId/labels/:labelId/image', isAuthenticated, tenantContext, async (req: any, res) => {
    try { const label = await readUpsLabelEvidence(getRequestOrganizationId(req), req.params.shipmentId,
      req.params.purchaseId, req.params.labelId);
      res.setHeader('Content-Type', label.mimeType); res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `inline; filename="UPS-${label.trackingNumber}.gif"`);
      return res.send(label.bytes); }
    catch (error) { return upsFailure(res, error, 'Could not retrieve UPS label evidence.'); }
  });
  app.get('/api/fulfillment/shipments/:shipmentId/ups-labels/:purchaseId/all-labels.zip', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const labels = await readUpsLabelArchive(getRequestOrganizationId(req), req.params.shipmentId, req.params.purchaseId);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="UPS-${req.params.purchaseId}.zip"`);
      res.setHeader('Cache-Control', 'private, no-store');
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('error', error => res.destroy(error));
      archive.pipe(res);
      for (const label of labels) archive.append(Buffer.from(label.bytes), {
        name: `${label.package.reference.replace(/[^A-Za-z0-9_-]/g, '_')}-${label.trackingNumber}.gif`,
      });
      await archive.finalize();
    } catch (error) { if (!res.headersSent) return upsFailure(res, error, 'Could not download UPS labels.'); }
  });

  // ===== SHIPMENT & FULFILLMENT ROUTES =====

  app.post('/api/fulfillment/orders/:orderId/reopen-administrative', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      requireTerminalFulfillmentReversalAuthority(req);
      const data = await canonicalFulfillmentOperations.reopenAdministrativeFulfillment(
        getRequestOrganizationId(req), fulfillmentOrderIdSchema.parse(req.params.orderId), req.body,
        getUserId(req.user), req.actorOrgRole ?? req.orgRole ?? req.user?.orgRole ?? req.user?.role);
      return res.json({ success: true, data });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: 'A reason and valid correction quantities are required.' });
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      console.error('[fulfillment] administrative reopen failed', error);
      return res.status(500).json({ success: false, message: 'Could not reopen fulfillment. Refresh before retrying.' });
    }
  });

  app.post('/api/fulfillment/orders/:orderId/change-method', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const orderId = fulfillmentOrderIdSchema.parse(req.params.orderId);
      const { method } = z.object({ method: z.enum(['pickup', 'deliver', 'ship']) }).parse(req.body);
      const actorUserId = getUserId(req.user);
      if (!actorUserId) return res.status(401).json({ success: false, message: 'Authentication required.' });
      const data = await canonicalFulfillmentOperations.changeFulfillmentMethod(getRequestOrganizationId(req), orderId, method, actorUserId);
      return res.json({ success: true, data });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: 'Choose Pickup, Delivery, or Shipping.' });
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      const accountingBlock = methodChangeAccountingBlock(error);
      if (accountingBlock) return res.status(accountingBlock.status).json({ success: false, message: accountingBlock.message, code: accountingBlock.code });
      console.error('[fulfillment] method change failed', error);
      return res.status(500).json({ success: false, message: 'Could not change fulfillment method. Refresh and retry.' });
    }
  });
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

  app.put('/api/fulfillment/orders/:orderId/pickup-handoffs/:handoffId/note', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const orderId = fulfillmentOrderIdSchema.parse(req.params.orderId);
      const handoffId = fulfillmentOrderIdSchema.parse(req.params.handoffId);
      const { note } = fulfillmentHistoryNoteSchema.parse(req.body);
      const data = await canonicalFulfillmentOperations.updatePickupHistoryNote(organizationId, orderId, handoffId, note, getUserId(req.user), req.orgRole);
      res.json({ success: true, data, message: 'Pickup history note saved' });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: 'Invalid pickup history note', errors: error.errors });
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      console.error('Failed to save pickup history note:', error);
      res.status(500).json({ success: false, message: 'Failed to save pickup history note' });
    }
  });

  app.patch('/api/fulfillment/orders/:orderId/pickup-handoffs/:handoffId/details', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const data = await canonicalFulfillmentOperations.updatePickupDetails(
        getRequestOrganizationId(req), fulfillmentOrderIdSchema.parse(req.params.orderId),
        fulfillmentOrderIdSchema.parse(req.params.handoffId), pickupDetailsSchema.parse(req.body || {}),
        getUserId(req.user) || null, req.actorOrgRole ?? req.orgRole ?? null,
      );
      return res.json({ success: true, data });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: 'Invalid pickup details', code: 'VALIDATION_ERROR' });
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      console.error('[fulfillment] update pickup details failed', error);
      return res.status(500).json({ success: false, message: 'Failed to update pickup details' });
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
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      return res.status(500).json({ success: false, message: 'Failed to fetch shipment' });
    }
  });

  app.get('/api/fulfillment/shipments/:shipmentId/current-order-destination', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const data = await canonicalFulfillmentOperations.getCurrentOrderDestination(getRequestOrganizationId(req), req.params.shipmentId);
      return res.json({ success: true, data });
    } catch (error) {
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      console.error('[fulfillment] current Order destination error:', error);
      return res.status(500).json({ success: false, message: 'Could not load the saved Order destination.' });
    }
  });

  app.get('/api/fulfillment/shipments/:shipmentId/documents/:documentType', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(400).json({ success: false, message: 'Organization context is required' });
      const documentType = shippingDocumentTypeSchema.parse(req.params.documentType);
      const { packageId } = z.object({ packageId: z.string().trim().min(1).optional() }).strict().parse(req.query || {});
      const data = await canonicalFulfillmentOperations.getShipmentDocument(organizationId, req.params.shipmentId, documentType, packageId);
      return res.json({ success: true, data });
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: 'Invalid shipping document type or package selection', code: 'VALIDATION_ERROR' });
      if (error instanceof FulfillmentHttpError || (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500)) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      }
      console.error('[fulfillment] shipping document error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch shipping document' });
    }
  });

  app.patch('/api/fulfillment/shipments/:shipmentId', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user) || null;
      const parsed = patchFulfillmentShipmentSchema.parse(req.body || {});

      const shipment = await canonicalFulfillmentOperations.patchShipment(organizationId, req.params.shipmentId, {
        carrier: parsed.carrier,
        shippingContext: parsed.shippingContext,
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
        upsPackagingType: z.enum(['02', '21']).optional(),
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

  app.post('/api/fulfillment/shipments/:shipmentId/reverse', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      requireTerminalFulfillmentReversalAuthority(req);
      const parsed = terminalFulfillmentReversalSchema.parse(req.body || {});
      const clientRequestId = String(req.get('Idempotency-Key') || '').trim() || parsed.clientRequestId;
      const data = await canonicalFulfillmentOperations.reverseTerminalFulfillment(getRequestOrganizationId(req), {
        sourceType: 'SHIPMENT', sourceId: req.params.shipmentId, items: parsed.items, reason: parsed.reason,
        clientRequestId: clientRequestId || null, actorUserId: getUserId(req.user) || null,
        actorOrgRole: req.actorOrgRole ?? req.orgRole ?? null,
      });
      return res.json({ success: true, data, message: data.replayed ? 'Shipment reversal already recorded' : 'Shipment reversal recorded' });
    } catch (error: any) {
      if (error?.name === 'ZodError') return res.status(400).json({ success: false, message: 'A reason and valid reversal quantities are required.', code: 'VALIDATION_ERROR' });
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      console.error('[fulfillment] reverse shipment error:', error);
      return res.status(500).json({ success: false, message: 'Failed to reverse shipment', code: 'FULFILLMENT_TERMINAL_REVERSAL_FAILED' });
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

  app.post('/api/fulfillment/pickup/handoffs/:handoffId/reverse', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      requireTerminalFulfillmentReversalAuthority(req);
      const parsed = terminalFulfillmentReversalSchema.parse(req.body || {});
      const clientRequestId = String(req.get('Idempotency-Key') || '').trim() || parsed.clientRequestId;
      const data = await canonicalFulfillmentOperations.reverseTerminalFulfillment(getRequestOrganizationId(req), {
        sourceType: 'PICKUP_HANDOFF', sourceId: req.params.handoffId, items: parsed.items, reason: parsed.reason,
        clientRequestId: clientRequestId || null, actorUserId: getUserId(req.user) || null,
        actorOrgRole: req.actorOrgRole ?? req.orgRole ?? null,
      });
      return res.json({ success: true, data, message: data.replayed ? 'Pickup reversal already recorded' : 'Pickup reversal recorded' });
    } catch (error: any) {
      if (error?.name === 'ZodError') return res.status(400).json({ success: false, message: 'A reason and valid reversal quantities are required.', code: 'VALIDATION_ERROR' });
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      console.error('[fulfillment] reverse pickup error:', error);
      return res.status(500).json({ success: false, message: 'Failed to reverse pickup', code: 'FULFILLMENT_TERMINAL_REVERSAL_FAILED' });
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
