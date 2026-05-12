export type InvoiceAccountingDisplayInput = {
  status?: string | null;
  total?: string | number | null;
  totalCents?: number | null;
  amountPaid?: string | number | null;
  balanceDue?: string | number | null;
  importSource?: string | null;
  isHistorical?: boolean | null;
  qbImportBalanceDue?: string | number | null;
  lockedReason?: string | null;
  qbLineItemsSnapshot?: unknown;
  payments?: InvoiceAccountingPaymentInput[];
};

export type InvoiceAccountingPaymentInput = {
  id?: string | number | null;
  status?: string | null;
  amountCents?: number | null;
  syncStatus?: string | null;
  externalAccountingId?: string | null;
  qbReconciledAt?: string | Date | null;
};

export type ImportedQuickBooksPaymentSummary = {
  unreconciledCount: number;
  unreconciledCents: number;
  pendingSyncCount: number;
  pendingSyncCents: number;
  failedSyncCount: number;
  failedSyncCents: number;
  syncedUnreconciledCount: number;
  syncedUnreconciledCents: number;
  reconciledCount: number;
  reconciledCents: number;
};

export type InvoiceAccountingDisplay = {
  displayTotal: number;
  displayPaid: number;
  displayRemaining: number;
  displayTotalCents: number;
  displayPaidCents: number;
  displayRemainingCents: number;
  displayStatus: string;
  isImportedFromQuickBooks: boolean;
  isHistorical: boolean;
  accountingSource: 'quickbooks' | 'titanos';
  lockedReason: string | null;
  productionWorkflowDisabled: boolean;
  importedQuickBooksPaymentSummary: ImportedQuickBooksPaymentSummary;
};

export type QuickBooksLineItemDisplay = {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
};

export type QuickBooksLineItemsDisplay = {
  lines: QuickBooksLineItemDisplay[];
  unavailableMessage: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  overdue: 'Overdue',
  billed: 'Billed',
  void: 'Void',
  voided: 'Voided',
};

function toFiniteNumber(value: unknown): number {
  const numeric = typeof value === 'string' ? Number(value.trim()) : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function moneyToCents(value: unknown): number {
  return Math.max(0, Math.round(toFiniteNumber(value) * 100));
}

function toSafeCents(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

function centsToMoney(value: number): number {
  return Math.max(0, value) / 100;
}

function titleCaseFallback(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getPreservedStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? titleCaseFallback(status || 'unpaid');
}

function emptyImportedQuickBooksPaymentSummary(): ImportedQuickBooksPaymentSummary {
  return {
    unreconciledCount: 0,
    unreconciledCents: 0,
    pendingSyncCount: 0,
    pendingSyncCents: 0,
    failedSyncCount: 0,
    failedSyncCents: 0,
    syncedUnreconciledCount: 0,
    syncedUnreconciledCents: 0,
    reconciledCount: 0,
    reconciledCents: 0,
  };
}

function normalizePaymentStatus(raw: unknown): string {
  return String(raw || '').trim().toLowerCase();
}

function normalizeSyncStatus(raw: unknown): 'pending' | 'failed' | 'synced' | 'other' {
  const status = String(raw || '').trim().toLowerCase();
  if (status === 'pending') return 'pending';
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'synced') return 'synced';
  return 'other';
}

export function summarizeImportedQuickBooksPayments(
  payments: InvoiceAccountingPaymentInput[] | null | undefined,
): ImportedQuickBooksPaymentSummary {
  const summary = emptyImportedQuickBooksPaymentSummary();

  for (const payment of payments || []) {
    const paymentStatus = normalizePaymentStatus(payment?.status);
    if (paymentStatus !== 'succeeded') continue;

    const amountCents = toSafeCents(payment?.amountCents);
    if (amountCents <= 0) continue;

    if (payment?.qbReconciledAt) {
      summary.reconciledCount += 1;
      summary.reconciledCents += amountCents;
      continue;
    }

    summary.unreconciledCount += 1;
    summary.unreconciledCents += amountCents;

    const syncStatus = normalizeSyncStatus(payment?.syncStatus);
    if (syncStatus === 'synced' || (payment?.externalAccountingId && syncStatus !== 'failed')) {
      summary.syncedUnreconciledCount += 1;
      summary.syncedUnreconciledCents += amountCents;
      continue;
    }

    if (syncStatus === 'failed') {
      summary.failedSyncCount += 1;
      summary.failedSyncCents += amountCents;
      continue;
    }

    summary.pendingSyncCount += 1;
    summary.pendingSyncCents += amountCents;
  }

  return summary;
}

export function normalizeInvoiceAccountingDisplay(
  invoice: InvoiceAccountingDisplayInput,
): InvoiceAccountingDisplay {
  const rawStatus = String(invoice.status || '').trim().toLowerCase();
  const isImportedFromQuickBooks = String(invoice.importSource || '').trim().toLowerCase() === 'quickbooks';
  const isHistorical = Boolean(invoice.isHistorical);
  const importedQuickBooksPaymentSummary = summarizeImportedQuickBooksPayments(invoice.payments);

  const displayTotalCents = invoice.totalCents != null
    ? Math.max(0, Math.round(Number(invoice.totalCents)))
    : moneyToCents(invoice.total);

  const qbBalanceSnapshotCents = isImportedFromQuickBooks && invoice.qbImportBalanceDue != null
    ? moneyToCents(invoice.qbImportBalanceDue)
    : invoice.balanceDue != null
      ? moneyToCents(invoice.balanceDue)
      : Math.max(0, displayTotalCents - moneyToCents(invoice.amountPaid));

  const rawRemainingCents = isImportedFromQuickBooks && !isHistorical && Array.isArray(invoice.payments)
    ? Math.max(0, qbBalanceSnapshotCents - importedQuickBooksPaymentSummary.unreconciledCents)
    : invoice.balanceDue != null
      ? moneyToCents(invoice.balanceDue)
      : qbBalanceSnapshotCents;

  const displayRemainingCents = Math.max(0, Math.min(displayTotalCents, rawRemainingCents));

  const rawPaidCents = isImportedFromQuickBooks
    ? Math.max(0, displayTotalCents - displayRemainingCents)
    : invoice.amountPaid != null
      ? moneyToCents(invoice.amountPaid)
      : Math.max(0, displayTotalCents - displayRemainingCents);

  const displayPaidCents = Math.max(0, Math.min(displayTotalCents, rawPaidCents));

  let displayStatus: string;
  if (rawStatus === 'void' || rawStatus === 'voided') {
    displayStatus = 'Voided';
  } else if (rawStatus === 'draft') {
    displayStatus = 'Draft';
  } else if (isImportedFromQuickBooks) {
    if (isHistorical) {
      if (displayRemainingCents <= 0) displayStatus = 'Paid Historical';
      else if (displayPaidCents <= 0) displayStatus = 'Historical Unpaid';
      else displayStatus = 'Historical Partial';
    } else if (displayRemainingCents <= 0 && importedQuickBooksPaymentSummary.unreconciledCents > 0) {
      displayStatus = 'Paid, pending QB sync';
    } else if (displayRemainingCents <= 0) {
      displayStatus = 'Paid';
    } else if (displayPaidCents <= 0) {
      displayStatus = 'Unpaid';
    } else {
      displayStatus = 'Partially Paid';
    }
  } else if (!rawStatus) {
    if (displayRemainingCents <= 0) displayStatus = 'Paid';
    else if (displayPaidCents > 0) displayStatus = 'Partially Paid';
    else displayStatus = 'Unpaid';
  } else {
    displayStatus = getPreservedStatusLabel(rawStatus);
  }

  return {
    displayTotal: centsToMoney(displayTotalCents),
    displayPaid: centsToMoney(displayPaidCents),
    displayRemaining: centsToMoney(displayRemainingCents),
    displayTotalCents,
    displayPaidCents,
    displayRemainingCents,
    displayStatus,
    isImportedFromQuickBooks,
    isHistorical,
    accountingSource: isImportedFromQuickBooks ? 'quickbooks' : 'titanos',
    lockedReason: invoice.lockedReason ?? null,
    productionWorkflowDisabled: isImportedFromQuickBooks,
    importedQuickBooksPaymentSummary,
  };
}

function readNestedNumber(source: Record<string, any> | null | undefined, keys: string[]): number | null {
  if (!source) return null;

  for (const key of keys) {
    const value = source[key];
    if (value == null || value === '') continue;
    const numeric = toFiniteNumber(value);
    if (Number.isFinite(numeric)) return numeric;
  }

  return null;
}

function trimText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

export function normalizeQuickBooksLineItemsSnapshot(snapshot: unknown): QuickBooksLineItemsDisplay {
  if (snapshot == null) {
    return { lines: [], unavailableMessage: null };
  }

  if (!Array.isArray(snapshot)) {
    return {
      lines: [],
      unavailableMessage: 'Line details unavailable from QuickBooks snapshot',
    };
  }

  const lines: QuickBooksLineItemDisplay[] = snapshot
    .map((rawLine) => {
      if (!rawLine || typeof rawLine !== 'object') return null;

      const line = rawLine as Record<string, any>;
      const detailType = trimText(line.DetailType);
      const detail = detailType && typeof line[detailType] === 'object' ? (line[detailType] as Record<string, any>) : null;

      const description = trimText(line.Description)
        ?? trimText(detail?.ItemRef?.name)
        ?? trimText(detail?.AccountRef?.name)
        ?? trimText(detail?.ClassRef?.name)
        ?? trimText(detailType?.replace(/([a-z])([A-Z])/g, '$1 $2'))
        ?? 'Line item';

      const quantity = readNestedNumber(detail, ['Qty', 'Quantity']);
      let unitPrice = readNestedNumber(detail, ['UnitPrice', 'Price']);
      const amount = line.Amount == null ? null : toFiniteNumber(line.Amount);

      if (unitPrice == null && quantity && quantity > 0 && amount != null) {
        unitPrice = amount / quantity;
      }

      if (!description && quantity == null && unitPrice == null && amount == null) {
        return null;
      }

      return {
        description,
        quantity,
        unitPrice,
        amount,
      } satisfies QuickBooksLineItemDisplay;
    })
    .filter((line): line is QuickBooksLineItemDisplay => Boolean(line));

  if (lines.length === 0 && snapshot.length > 0) {
    return {
      lines: [],
      unavailableMessage: 'Line details unavailable from QuickBooks snapshot',
    };
  }

  return { lines, unavailableMessage: null };
}