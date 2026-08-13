import { readFileSync } from 'node:fs';
import { buildInvoiceEmailSentAudit } from '../lib/invoiceEmailAudit';

describe('invoice email audit contract', () => {
  const sentAt = new Date('2026-08-13T13:12:00.000Z');

  it('records the successful saved-recipient send with actor, invoice, recipient, and timestamp', () => {
    const entry = buildInvoiceEmailSentAudit({
      organizationId: 'org-1', invoiceId: 'invoice-1', invoiceNumber: 'INV-1001',
      actorUserId: 'user-1', actorName: 'Dale', recipientEmail: 'accounting@example.com',
      invoiceVersion: 3, messageId: 'message-1', sentAt,
    });

    expect(entry).toMatchObject({
      userId: 'user-1', userName: 'Dale', actionType: 'invoice.sent', entityType: 'invoice', entityId: 'invoice-1',
      description: 'Invoice sent via email to accounting@example.com', createdAt: sentAt,
      newValues: { recipientEmail: 'accounting@example.com', invoiceVersion: 3, via: 'email' },
    });
  });

  it('records the actual manual one-time recipient rather than a saved default', () => {
    const entry = buildInvoiceEmailSentAudit({
      organizationId: 'org-1', invoiceId: 'invoice-1', invoiceNumber: 'INV-1001',
      actorUserId: 'user-1', actorName: 'Dale', recipientEmail: 'override@example.com',
      invoiceVersion: 3, messageId: null, sentAt,
    });

    expect(entry.description).toContain('override@example.com');
    expect((entry.newValues as any).recipientEmail).toBe('override@example.com');
  });

  it('builds a successful audit only after the delivery call path', () => {
    const source = readFileSync('server/routes/mvpInvoicing.routes.ts', 'utf8');
    expect(source.indexOf('messageId = await emailService.sendEmail')).toBeGreaterThan(-1);
    expect(source.lastIndexOf('buildInvoiceEmailSentAudit')).toBeGreaterThan(source.indexOf('messageId = await emailService.sendEmail'));
    expect(source).toContain('status: "failed"');
    expect(source).toContain('throw sendError');
  });
});
