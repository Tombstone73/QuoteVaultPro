import type { Express, RequestHandler } from 'express';
import { getRequestOrganizationId } from '../tenantContext';
import { bulkFulfillmentOperations } from '../services/fulfillment/bulkOperations';
import { FulfillmentHttpError } from '../services/fulfillment/types';

export function registerBulkFulfillmentRoutes(app: Express, middleware: { isAuthenticated: RequestHandler; tenantContext: RequestHandler }) {
  const handle = (operation: (req: any, organizationId: string, userId: string) => Promise<unknown>) => async (req: any, res: any) => {
    try {
      const orgId = getRequestOrganizationId(req), userId = String(req.user?.claims?.sub || req.user?.id || '');
      if (!orgId || !userId) return res.status(401).json({ success: false, message: 'Sign in again.' });
      return res.json({ success: true, data: await operation(req, orgId, userId) });
    } catch (error) {
      if (error instanceof FulfillmentHttpError) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
      if (error instanceof Error && error.name === 'ZodError') return res.status(400).json({ success: false, message: 'Invalid bulk selection or confirmation.', code: 'VALIDATION_ERROR' });
      console.error('[fulfillment bulk] command failed', error);
      return res.status(500).json({ success: false, message: 'Unable to finish this request. Retry the same operation to recover safely.', code: 'BULK_RECOVERY_REQUIRED' });
    }
  };
  const boundary = [middleware.isAuthenticated, middleware.tenantContext];
  app.get('/api/fulfillment/bulk/permissions', ...boundary, handle((_req, org, actor) => bulkFulfillmentOperations.permissions(org, actor)));
  app.get('/api/fulfillment/orders/:orderId/bulk-context', ...boundary, handle((req, org, actor) => bulkFulfillmentOperations.context(org, actor, req.params.orderId)));
  app.post('/api/fulfillment/bulk/preview', ...boundary, handle((req, org, actor) => bulkFulfillmentOperations.preview(org, actor, req.body)));
  app.post('/api/fulfillment/bulk/execute', ...boundary, handle((req, org, actor) => bulkFulfillmentOperations.execute(org, actor, req.body)));
}
