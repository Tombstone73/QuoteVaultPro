export type InvoicePaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded';

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'canceled' | 'refunded' | 'voided';

export type PaymentRollupInput = {
  id?: string | number | null | undefined;
  status: PaymentStatus | string | null | undefined;
  amountCents: number | null | undefined;
};

export type InvoicePaymentRollup = {
  amountPaidCents: number;
  amountDueCents: number;
  paymentStatus: InvoicePaymentStatus;
};

export type InvoicePaymentStatusLabel = 'Draft' | 'Voided' | 'Unpaid' | 'Partially Paid' | 'Paid';

export function getInvoicePaymentStatusLabel(params: {
  invoiceStatus: string | null | undefined;
  rollup: InvoicePaymentRollup;
}): InvoicePaymentStatusLabel {
  const base = String(params.invoiceStatus || '').trim().toLowerCase();
  if (base === 'void' || base === 'voided') return 'Voided';
  if (base === 'draft') return 'Draft';

  const paid = toSafeCents(params.rollup?.amountPaidCents);
  const due = toSafeCents(params.rollup?.amountDueCents);

  if (paid <= 0) return 'Unpaid';
  if (due <= 0) return 'Paid';
  return 'Partially Paid';
}

const normalizeStatus = (raw: unknown): PaymentStatus | 'unknown' => {
  if (!raw) return 'unknown';
  const s = String(raw).trim().toLowerCase();
  if (s === 'pending') return 'pending';
  if (s === 'succeeded') return 'succeeded';
  if (s === 'failed') return 'failed';
  if (s === 'canceled' || s === 'cancelled') return 'canceled';
  if (s === 'refunded') return 'refunded';
  if (s === 'voided' || s === 'void') return 'voided';
  return 'unknown';
};

const toSafeCents = (v: unknown): number => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
};

export function computeInvoicePaymentRollup(params: {
  invoiceTotalCents: number;
  payments: PaymentRollupInput[];
}): InvoicePaymentRollup {
  const invoiceTotalCents = toSafeCents(params.invoiceTotalCents);

  let paid = 0;
  let hadSucceeded = false;
  let hadRefund = false;

  const seenPaymentIds = new Set<string>();

  for (const p of params.payments || []) {
    const rawId = (p as any)?.id;
    if (rawId !== null && rawId !== undefined && String(rawId).trim()) {
      const id = String(rawId);
      if (seenPaymentIds.has(id)) continue;
      seenPaymentIds.add(id);
    }

    const status = normalizeStatus(p.status);
    const amountCents = toSafeCents(p.amountCents);

    if (status === 'succeeded') {
      hadSucceeded = true;
      paid += amountCents;
    } else if (status === 'refunded') {
      hadRefund = true;
      paid -= amountCents;
    }
  }

  if (!Number.isFinite(paid)) paid = 0;
  paid = Math.max(0, Math.min(invoiceTotalCents, paid));

  const due = Math.max(0, invoiceTotalCents - paid);

  let paymentStatus: InvoicePaymentStatus = 'unpaid';
  if (paid <= 0) {
    paymentStatus = hadSucceeded && hadRefund ? 'refunded' : 'unpaid';
  } else if (paid >= invoiceTotalCents) {
    paymentStatus = hadRefund ? 'refunded' : 'paid';
  } else {
    paymentStatus = 'partial';
  }

  return {
    amountPaidCents: paid,
    amountDueCents: due,
    paymentStatus,
  };
}
