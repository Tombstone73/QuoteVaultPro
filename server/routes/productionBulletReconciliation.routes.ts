import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { hasAdminOrOwnerOperationalRole } from '@shared/roleAccess';
import { isPortalCustomerIdentity } from '../services/customerPortalAccessService';
import { auditProductionBullets, reconcileHistoricalProductionBullet } from '../services/productionBulletReconciliationService';

const applySchema = z.object({
  orderId: z.string().min(1),
  confirmOrderId: z.string().min(1),
  reason: z.string().trim().min(10).max(1000),
}).strict();

export function registerProductionBulletReconciliationRoutes(app: Express, middleware: {
  isAuthenticated: RequestHandler; tenantContext: RequestHandler;
}) {
  const authorize: RequestHandler = (req, res, next) => {
    if (!req.organizationId || !req.user || isPortalCustomerIdentity(req.user) || !hasAdminOrOwnerOperationalRole(req)) {
      return res.status(403).json({ success: false, code: 'PRODUCTION_BULLET_RECONCILIATION_FORBIDDEN', message: 'Owner or administrator access is required.' });
    }
    next();
  };
  app.get('/api/production-bullet-reconciliation', middleware.isAuthenticated, middleware.tenantContext, authorize, async (req, res) => {
    const parsed = z.string().trim().min(1).max(100).optional().safeParse(req.query.orderNumber);
    if (!parsed.success) return res.status(400).json({ success: false, code: 'INVALID_ORDER_NUMBER' });
    try { return res.json({ success: true, dryRun: true, data: await auditProductionBullets(req.organizationId!, parsed.data) }); }
    catch (error) { console.error('[ProductionBulletReconciliation] Audit failed', error); return res.status(500).json({ success: false, code: 'PRODUCTION_BULLET_AUDIT_FAILED' }); }
  });
  app.post('/api/production-bullet-reconciliation/apply', middleware.isAuthenticated, middleware.tenantContext, authorize, async (req, res) => {
    const parsed = applySchema.safeParse(req.body ?? {});
    if (!parsed.success || parsed.data.orderId !== parsed.data.confirmOrderId) {
      return res.status(400).json({ success: false, code: 'EXPLICIT_ORDER_CONFIRMATION_REQUIRED', message: 'Confirm the exact Order ID and provide a reason.' });
    }
    const actorUserId = (req.user as { id?: string }).id;
    if (!actorUserId) return res.status(403).json({ success: false, code: 'ACTOR_REQUIRED' });
    try {
      const result = await reconcileHistoricalProductionBullet({
        organizationId: req.organizationId!, orderId: parsed.data.orderId,
        actorUserId, reason: parsed.data.reason,
        actorUserName: [((req.user as { firstName?: string }).firstName), ((req.user as { lastName?: string }).lastName)].filter(Boolean).join(' ') || null,
      });
      if (!result.before) return res.status(404).json({ success: false, code: 'ORDER_NOT_FOUND' });
      const alreadyConsistent = result.before.currentPillKey === 'complete'
        && result.before.operationalComplete && !result.before.conflict;
      if (!result.changed && !result.before.repairEligible && !alreadyConsistent) {
        return res.status(409).json({ success: false, code: result.before.exclusionReason, data: result });
      }
      return res.json({ success: true, data: result });
    } catch (error) { console.error('[ProductionBulletReconciliation] Apply failed', error); return res.status(500).json({ success: false, code: 'PRODUCTION_BULLET_RECONCILIATION_FAILED' }); }
  });
}
