import type { Express, Request, RequestHandler } from "express";
import { and, desc, eq } from "drizzle-orm";
import { isFinancialPaymentHistory } from "@shared/financialPaymentHistory";
import { manualPaymentMethodSchema, payments, users } from "@shared/schema";
import { db } from "../db";
import { getInvoiceWithRelations } from "../invoicesService";
import { normalizePaymentListSort, type PaymentDatePreset } from "../services/paymentListService";
import { listPaymentReceipts } from "../services/paymentReceiptHistoryService";

export function registerPaymentHistoryRoutes(app: Express, deps: {
  isAuthenticated: RequestHandler;
  tenantContext: RequestHandler;
  getRequestOrganizationId: (req: Request) => string | undefined;
}) {
  const { isAuthenticated, tenantContext, getRequestOrganizationId } = deps;

  // ------------------------------------------------------------
  // Payments list (organization-scoped canonical collections view)
  // ------------------------------------------------------------
  app.get('/api/payments', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: 'Missing organization context' });

      const allowedPresets: PaymentDatePreset[] = ['today', 'this-week', 'this-month', 'custom', 'all'];
      const datePreset = String(req.query.datePreset || 'all') as PaymentDatePreset;
      if (!allowedPresets.includes(datePreset)) return res.status(400).json({ success: false, error: 'Invalid payment date preset' });

      const method = String(req.query.method || '').trim();
      if (method && !manualPaymentMethodSchema.safeParse(method).success) return res.status(400).json({ success: false, error: 'Invalid payment method' });

      const data = await listPaymentReceipts({
        organizationId,
        datePreset,
        dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
        dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
        customerId: typeof req.query.customerId === 'string' ? req.query.customerId.trim() || undefined : undefined,
        method: method || undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        sortBy: normalizePaymentListSort(req.query.sortBy),
        sortDir: String(req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc',
        page: Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1),
        pageSize: Math.max(1, Math.min(200, Number.parseInt(String(req.query.pageSize || '50'), 10) || 50)),
      });
      return res.json({ success: true, data });
    } catch (error: any) {
      console.error('Error fetching payments list:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch payments' });
    }
  });

  // ------------------------------------------------------------
  // Payments list (invoice-scoped, tenant-scoped)
  // ------------------------------------------------------------
  app.get('/api/invoices/:id/payments', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: 'Invoice not found' });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ error: 'Invoice not found' });

      const rows = await db
        .select({
          payment: payments,
          createdBy: users,
        })
        .from(payments)
        .leftJoin(users, eq(payments.createdByUserId, users.id))
        .where(and(eq(payments.invoiceId, inv.id), eq(payments.organizationId, organizationId)))
        .orderBy(desc(payments.createdAt));

      const data = rows.filter(r => isFinancialPaymentHistory(r.payment)).map((r: any) => {
        const u = r.createdBy as any;
        const name = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '';
        return {
          ...(r.payment as any),
          createdBy: u
            ? {
                id: u.id,
                name: name || u.email || null,
                email: u.email || null,
              }
            : null,
        };
      });

      return res.json({ success: true, data });
    } catch (error: any) {
      console.error('Error fetching invoice payments:', error);
      return res.status(500).json({ error: error.message || 'Failed to fetch payments' });
    }
  });
}
