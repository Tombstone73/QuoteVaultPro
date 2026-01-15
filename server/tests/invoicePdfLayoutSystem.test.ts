import { DEFAULT_INVOICE_PDF_THEME } from '../lib/invoicePdfTheme';
import { generateInvoicePdfBytes } from '../lib/invoicePdf';

describe('Invoice PDF v1 layout system', () => {
  test('badge color + watermark + footer are theme-driven and deterministic', async () => {
    const theme = {
      ...DEFAULT_INVOICE_PDF_THEME,
      statusBadge: {
        ...DEFAULT_INVOICE_PDF_THEME.statusBadge,
        backgrounds: {
          paid: [0, 1, 0] as const,
          partial: [1, 1, 0] as const,
          unpaid: [1, 0, 0] as const,
          draft: [0, 0, 1] as const,
          voided: [0.2, 0.2, 0.2] as const,
        },
      },
      watermark: {
        ...DEFAULT_INVOICE_PDF_THEME.watermark,
        enabled: true,
        mode: 'auto' as const,
        rotationDegrees: 0,
        fontSize: 48,
        color: [0.85, 0.85, 0.85] as const,
      },
      footer: {
        ...DEFAULT_INVOICE_PDF_THEME.footer,
        enabled: true,
        align: 'left' as const,
        reservedHeight: 40,
        text: 'DEFAULT_FOOTER_SHOULD_BE_OVERRIDDEN',
      },
      tradeTerms: {
        ...DEFAULT_INVOICE_PDF_THEME.tradeTerms,
        enabled: false,
      },
    };

    const paidParams = {
      invoice: {
        invoiceNumber: 123,
        status: 'paid',
        currency: 'USD',
        issueDate: '2020-01-01T00:00:00.000Z',
        dueDate: '2020-01-15T00:00:00.000Z',
        subtotalCents: 1000,
        taxCents: 0,
        shippingCents: 0,
        totalCents: 1000,
        notesPublic: null,
        customTerms: null,
      },
      customer: {
        companyName: 'Acme Co',
        billingStreet1: '1 Main St',
        billingCity: 'Springfield',
        billingState: 'IL',
        billingPostalCode: '62701',
        billingCountry: 'US',
      },
      companySettings: {
        companyName: 'Titan Printing',
      },
      paymentSummary: {
        amountPaidCents: 1000,
        amountDueCents: 0,
        statusLabel: 'Paid',
      },
      lineItems: [
        {
          description: 'Test item',
          quantity: 1,
          unitPriceCents: 1000,
          lineTotalCents: 1000,
        },
      ],
      overrides: {
        footerText: 'FOOTER_OVERRIDE_999',
      },
    } as const;

    const bytesA = await generateInvoicePdfBytes(paidParams as any, theme as any);
    const bytesB = await generateInvoicePdfBytes(paidParams as any, theme as any);

    expect(Buffer.from(bytesA)).toEqual(Buffer.from(bytesB));

    const pdfText = Buffer.from(bytesA).toString('latin1');

    // Footer override rendered
    expect(pdfText).toContain('FOOTER_OVERRIDE_999');

    // Watermark logic (auto -> PAID)
    expect(pdfText).toMatch(/PAID/);

    // Status badge color (paid bg = 0 1 0 -> '0 1 0 rg')
    expect(pdfText).toMatch(/0\s+1\s+0\s+rg/);

    const draftParams = {
      ...paidParams,
      invoice: {
        ...paidParams.invoice,
        status: 'draft',
      },
      paymentSummary: {
        ...paidParams.paymentSummary,
        statusLabel: 'Draft',
        amountPaidCents: 0,
        amountDueCents: 1000,
      },
    } as const;

    const draftBytes = await generateInvoicePdfBytes(draftParams as any, theme as any);
    const draftText = Buffer.from(draftBytes).toString('latin1');

    // Watermark logic (auto -> DRAFT)
    expect(draftText).toMatch(/DRAFT/);

    // Footer still renders on draft
    expect(draftText).toContain('FOOTER_OVERRIDE_999');
  });
});
