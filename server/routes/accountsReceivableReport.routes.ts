import type { Express } from 'express';
import { getRequestOrganizationId } from '../tenantContext';
import { buildCsv } from '@shared/csv';
import { buildSimpleXlsx } from '../lib/simpleXlsx';

const headers = ['Customer', 'Contact', 'Invoice Number', 'Order Number', 'Job Name', 'PO Number', 'Issue Date', 'Due Date', 'Days Past Due', 'Aging Bucket', 'Invoice Status', 'Approval Status', 'Send Status', 'Terms', 'Total', 'Paid', 'Balance', 'Last Sent', 'QB Sync Status'];

function queryString(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function reportRow(row: any) { return [row.customerName, row.contactName, row.invoiceNumber, row.orderNumber, row.jobName, row.purchaseOrderNumber, row.issueDate, row.dueDate, row.daysPastDue, row.agingBucket, row.invoiceStatus, row.approvalStatus, row.sendStatus, row.terms, row.totalCents / 100, row.paidCents / 100, row.remainingCents / 100, row.lastSentAt, row.qbSyncStatus]; }

export function registerAccountsReceivableReportRoutes(app: Express, middleware: { isAuthenticated: any; tenantContext: any }): void {
  app.get('/api/reports/accounts-receivable', middleware.isAuthenticated, middleware.tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: 'Missing organization context' });
      const { getAccountsReceivableReport } = await import('../services/accountsReceivableReport');
      const report = await getAccountsReceivableReport({ organizationId, page: Number(req.query.page) || 1, pageSize: Number(req.query.pageSize) || 50, sortBy: queryString(req.query.sortBy) as any, sortDir: queryString(req.query.sortDir) === 'desc' ? 'desc' : 'asc', filters: { customerId: queryString(req.query.customerId), agingBucket: queryString(req.query.agingBucket) as any, invoiceStatus: queryString(req.query.invoiceStatus), sendStatus: queryString(req.query.sendStatus) as any, jobStatus: queryString(req.query.jobStatus) as any } });
      const customerOptions = Array.from(new Map(report.rows.filter((row) => row.customerId && row.customerName).map((row) => [row.customerId!, row.customerName!])).entries()).map(([id, name]) => ({ id, name }));
      return res.json({ success: true, data: { ...report, rows: undefined, customerOptions } });
    } catch (error) { console.error('[AccountsReceivableReport] Failed:', error); return res.status(500).json({ success: false, error: 'Failed to build Accounts Receivable report' }); }
  });

  app.get('/api/reports/accounts-receivable/export/:format', middleware.isAuthenticated, middleware.tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: 'Missing organization context' });
      const { getAccountsReceivableReport } = await import('../services/accountsReceivableReport');
      const report = await getAccountsReceivableReport({ organizationId, sortBy: queryString(req.query.sortBy) as any, sortDir: queryString(req.query.sortDir) === 'desc' ? 'desc' : 'asc', filters: { customerId: queryString(req.query.customerId), agingBucket: queryString(req.query.agingBucket) as any, invoiceStatus: queryString(req.query.invoiceStatus), sendStatus: queryString(req.query.sendStatus) as any, jobStatus: queryString(req.query.jobStatus) as any } });
      const filename = `accounts-receivable-${report.asOf}`;
      if (req.params.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        return res.send(buildCsv([headers, ...report.rows.map(reportRow), ['Totals', '', '', '', '', '', '', '', '', '', '', '', '', '', report.rows.reduce((sum, row) => sum + row.totalCents, 0) / 100, report.rows.reduce((sum, row) => sum + row.paidCents, 0) / 100, report.summary.totalOutstandingCents / 100]]));
      }
      if (req.params.format === 'xlsx') {
        const workbook = buildSimpleXlsx({ sheetName: 'Accounts Receivable', title: 'Accounts Receivable — Outstanding Invoices', generatedAt: new Date().toISOString(), filterSummary: JSON.stringify(report.filters), headers, rows: report.rows.map(reportRow), totals: ['Totals', '', '', '', '', '', '', '', '', '', '', '', '', '', report.rows.reduce((sum, row) => sum + row.totalCents, 0) / 100, report.rows.reduce((sum, row) => sum + row.paidCents, 0) / 100, report.summary.totalOutstandingCents / 100] });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
        return res.send(workbook);
      }
      return res.status(400).json({ success: false, error: 'Export format must be csv or xlsx' });
    } catch (error) { console.error('[AccountsReceivableReport] Export failed:', error); return res.status(500).json({ success: false, error: 'Failed to export Accounts Receivable report' }); }
  });
}
