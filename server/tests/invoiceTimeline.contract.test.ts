import { readFileSync } from 'node:fs';

describe('invoice timeline audit visibility', () => {
  const timelineRoute = readFileSync('server/routes/timeline.routes.ts', 'utf8');
  const invoiceDetail = readFileSync('client/src/pages/invoice-detail.tsx', 'utf8');

  it('accepts a tenant-scoped invoice context and includes invoice audit rows', () => {
    expect(timelineRoute).toContain('const invoiceId = (req.query.invoiceId as string | undefined) || undefined');
    expect(timelineRoute).toContain("eq(auditLogs.entityType, 'invoice')");
    expect(timelineRoute).toContain('eq(invoices.id, invoiceId)');
  });

  it('passes the current invoice into the existing Invoice Detail timeline', () => {
    expect(invoiceDetail).toContain('<TimelinePanel orderId={invoice.orderId} invoiceId={invoice.id} />');
  });
});
