export const QUICKBOOKS_DOCUMENT_NUMBER_MAX_LENGTH = 21;

export type QuickBooksPaymentReferenceSource = "canonical";

export type ResolvedQuickBooksPaymentReference = {
  value: string;
  source: QuickBooksPaymentReferenceSource;
};

export type QuickBooksPaymentPayload = {
  CustomerRef: { value: string };
  TotalAmt: number;
  TxnDate: string;
  PaymentRefNum: string;
  PrivateNote: string;
  Line: Array<{ Amount: number; LinkedTxn: Array<{ TxnId: string; TxnType: 'Invoice' }> }>;
};

function normalizeReference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reference = value.trim();
  return reference || null;
}

export function getExplicitPaymentReference(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return normalizeReference((metadata as Record<string, unknown>).reference);
}

export function isQuickBooksDocumentNumberValid(value: unknown): boolean {
  const reference = normalizeReference(value);
  return Boolean(reference && reference.length <= QUICKBOOKS_DOCUMENT_NUMBER_MAX_LENGTH);
}

export function assertQuickBooksDocumentNumber(value: unknown, label: string): string {
  const reference = normalizeReference(value);
  if (!reference) {
    const error: any = new Error(`${label} is required before it can be sent to QuickBooks.`);
    error.code = "QUICKBOOKS_DOCUMENT_NUMBER_REQUIRED";
    error.statusCode = 422;
    throw error;
  }
  if (reference.length > QUICKBOOKS_DOCUMENT_NUMBER_MAX_LENGTH) {
    const error: any = new Error(`${label} must be ${QUICKBOOKS_DOCUMENT_NUMBER_MAX_LENGTH} characters or fewer for QuickBooks.`);
    error.code = "QUICKBOOKS_DOCUMENT_NUMBER_TOO_LONG";
    error.statusCode = 422;
    throw error;
  }
  return reference;
}

/**
 * PaymentRefNum is the provider-searchable recovery key for a local Payment.
 * It must therefore be the persisted, organization-unique reference rather
 * than an operator-entered check/reference that can be reused by another
 * payment. Operator-entered references remain local presentation metadata.
 */
export function resolveQuickBooksPaymentReference(input: {
  canonicalReference: unknown;
}): ResolvedQuickBooksPaymentReference | null {
  const canonicalReference = normalizeReference(input.canonicalReference);
  if (canonicalReference) {
    return {
      value: assertQuickBooksDocumentNumber(canonicalReference, "Stored PrintersHero payment reference"),
      source: "canonical",
    };
  }

  return null;
}

export function formatQuickBooksPaymentReference(sequenceNumber: number): string {
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1) {
    throw new Error("QuickBooks payment reference sequence is invalid.");
  }
  return assertQuickBooksDocumentNumber(`PMT-${sequenceNumber}`, "Generated PrintersHero payment reference");
}

/** Build the exact QBO Payment shape without changing any local financial fact. */
export function buildQuickBooksPaymentPayload(input: {
  qbCustomerId: string;
  amount: number;
  txnDate: string;
  paymentReference: string;
  privateNote: string;
  qbInvoiceId: string;
}): QuickBooksPaymentPayload {
  const paymentRefNum = assertQuickBooksDocumentNumber(input.paymentReference, 'QuickBooks payment reference');
  return {
    CustomerRef: { value: input.qbCustomerId },
    TotalAmt: input.amount,
    TxnDate: input.txnDate,
    PaymentRefNum: paymentRefNum,
    PrivateNote: input.privateNote,
    Line: [{
      Amount: input.amount,
      LinkedTxn: [{ TxnId: input.qbInvoiceId, TxnType: 'Invoice' }],
    }],
  };
}
