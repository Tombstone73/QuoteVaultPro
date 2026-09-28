import type { Express } from 'express';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { invoices } from '@shared/schema';
import { db } from '../db';
import { getRequestOrganizationId } from '../tenantContext';
import { canonicalOrderOperations } from '../services/orders/canonicalOrderOperations';
import { acknowledgeBillingOwnershipReview, getBillingOwnershipReview, requireBillingOwnershipReviewer } from '../services/billingOwnershipReview.service';

const confirmation = z.object({ confirmed: z.literal(true), reason: z.string().trim().min(1).max(2000) });
const overrideSchema = confirmation.extend({ customerId: z.string().min(1).nullable(), contactId: z.string().min(1).nullable(),
  invoiceId: z.string().min(1), invoiceVersion: z.number().int().positive(), orderUpdatedAt: z.string().datetime() }).strict();

export function registerBillingOwnershipRoutes(app: Express, middleware: { isAuthenticated: any; tenantContext: any }) {
  const auth = [middleware.isAuthenticated, middleware.tenantContext];
  const context = (req: any) => {
    const organizationId = getRequestOrganizationId(req);
    const actorUserId = req.user?.claims?.sub || req.user?.id;
    if (!organizationId || !actorUserId) throw Object.assign(new Error('Missing organization or user context.'), { statusCode: 401 });
    return { organizationId, actorUserId, actorOrgRole: String(req.actorOrgRole ?? req.orgRole ?? '') };
  };
  const failure = (res: any, error: any) => res.status(error instanceof z.ZodError ? 400 : error.statusCode || 409).json({ message: error.message, code: error.code });

  app.post('/api/orders/:id/billing-ownership-override', ...auth, async (req: any, res) => {
    try {
      const actor = context(req);
      requireBillingOwnershipReviewer(actor.actorOrgRole);
      const { customerId, contactId, ...billingOwnershipOverride } = overrideSchema.parse(req.body);
      const order = await canonicalOrderOperations.updateEditableHeader({ ...actor, orderId: req.params.id, allowNonNew: true,
        changes: { customerId, contactId }, billingOwnershipOverride, auditDescription: 'Authorized billing ownership override; QuickBooks reconciliation required.' });
      return res.json({ success: true, data: order });
    } catch (error) { return failure(res, error); }
  });

  for (const resource of ['orders', 'invoices'] as const) {
    app.get(`/api/${resource}/:id/billing-ownership-review`, ...auth, async (req: any, res) => {
      try {
        const actor = context(req);
        const [invoice] = await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.organizationId, actor.organizationId),
          resource === 'orders' ? and(eq(invoices.orderId, req.params.id), ne(invoices.status, 'void')) : eq(invoices.id, req.params.id))).limit(1);
        if (!invoice && resource === 'invoices') return res.status(404).json({ message: 'Invoice not found.' });
        const hold = invoice ? await getBillingOwnershipReview(actor.organizationId, invoice.id) : null;
        return res.json({ hold });
      } catch (error) { return failure(res, error); }
    });
  }
  app.post('/api/invoices/:id/billing-ownership-review/resolve', ...auth, async (req: any, res) => {
    try {
      const actor = context(req);
      requireBillingOwnershipReviewer(actor.actorOrgRole);
      const body = confirmation.extend({ overrideId: z.string().min(1) }).strict().parse(req.body);
      await acknowledgeBillingOwnershipReview({ ...actor, ...body, invoiceId: req.params.id });
      return res.json({ success: true });
    } catch (error) { return failure(res, error); }
  });
}
