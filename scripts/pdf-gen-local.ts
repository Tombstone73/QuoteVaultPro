import fs from 'node:fs/promises';
import path from 'node:path';

import { generateInvoicePdfBytes } from '../server/lib/invoicePdf';

async function ensureDir(dirPath: string) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

async function main() {
  const outPath = path.resolve('tmp', 'invoice-local.pdf');
  await ensureDir(path.dirname(outPath));

  // In-memory only (never persisted). Keep this minimal and deterministic.
  const params = {
    invoice: {
      invoiceNumber: 999001,
      status: 'draft',
      currency: 'USD',
      issueDate: '2020-01-01T00:00:00.000Z',
      dueDate: '2020-01-15T00:00:00.000Z',
      subtotalCents: 25000,
      taxCents: 0,
      shippingCents: 0,
      totalCents: 25000,
      notesPublic: 'Local PDF generation (serverless).',
      customTerms: null,
    },
    customer: {
      companyName: 'Local Customer',
      billingStreet1: '123 Main St',
      billingCity: 'Springfield',
      billingState: 'IL',
      billingPostalCode: '62701',
      billingCountry: 'US',
    },
    companySettings: {
      companyName: 'Titan Printing',
    },
    paymentSummary: {
      amountPaidCents: 0,
      amountDueCents: 25000,
      statusLabel: 'Draft',
    },
    lineItems: [
      {
        description: 'Local sanity-check line item',
        quantity: 1,
        unitPriceCents: 25000,
        lineTotalCents: 25000,
      },
    ],
  } as const;

  // Optional theme import seam (kept here so this script still works if theme changes).
  let bytes: Uint8Array;
  try {
    const themeModule = await import('../server/lib/invoicePdfTheme');
    const theme = (themeModule as any)?.DEFAULT_INVOICE_PDF_THEME;
    bytes = await (generateInvoicePdfBytes as any)(params, theme);
  } catch {
    bytes = await (generateInvoicePdfBytes as any)(params);
  }

  const buf = Buffer.from(bytes);
  await fs.writeFile(outPath, buf);

  console.log(`OK: wrote tmp/invoice-local.pdf (${buf.length} bytes)`);
}

(async () => {
  try {
    await main();
  } catch (err: any) {
    console.error('[pdf:gen:local] FAIL:', err?.message || err);
    process.exit(1);
  }
})();
