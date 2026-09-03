export const QUICKBOOKS_DOCUMENT_NUMBER_MAX_LENGTH = 21;

export type QuickBooksPaymentReferenceSource = "explicit" | "canonical";

export type ResolvedQuickBooksPaymentReference = {
  value: string;
  source: QuickBooksPaymentReferenceSource;
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
 * Prefers the operator-entered payment/check reference when QBO can accept it.
 * If it is absent or too long, callers must reuse or allocate a persisted
 * PrintersHero reference instead; the original metadata is intentionally left intact.
 */
export function resolveQuickBooksPaymentReference(input: {
  metadata: unknown;
  canonicalReference: unknown;
}): ResolvedQuickBooksPaymentReference | null {
  const explicitReference = getExplicitPaymentReference(input.metadata);
  if (explicitReference && isQuickBooksDocumentNumberValid(explicitReference)) {
    return { value: explicitReference, source: "explicit" };
  }

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
