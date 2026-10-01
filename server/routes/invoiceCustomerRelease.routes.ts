import type { Express, RequestHandler } from 'express';
import { releaseInvoiceToCustomer } from '../services/invoiceCustomerRelease.service';

export function registerInvoiceCustomerReleaseRoutes(app: Express, deps: {
  isAuthenticated: RequestHandler; tenantContext: RequestHandler;
  requireOrgOwnerAdmin?: RequestHandler;
}) {
  // Same Owner/Admin authority as staff Invoice Send/Resend controls. Never
  // fall back to authentication alone if the permission middleware is absent.
  const communicationPermission: RequestHandler = deps.requireOrgOwnerAdmin
    ?? ((_req, res) => { res.status(403).json({ error: 'Invoice communication permission required.' }); });
  app.post('/api/invoices/:id/release-to-customer', deps.isAuthenticated, deps.tenantContext, communicationPermission, async (req: any, res) => {
    const userId = req.user?.claims?.sub || req.user?.id;
    if (!req.organizationId || !userId) return res.status(401).json({ error: 'Missing organization or user context.' });
    if (req.staffPortalPreview) return res.status(403).json({ error: 'Staff portal preview is read-only.' });
    try {
      const data = await releaseInvoiceToCustomer({
        organizationId: req.organizationId, invoiceId: req.params.id, actorUserId: userId,
        actorUserName: `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email || null,
      });
      return res.json({ success: true, data });
    } catch (error: any) {
      return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unable to release invoice.' });
    }
  });
}
