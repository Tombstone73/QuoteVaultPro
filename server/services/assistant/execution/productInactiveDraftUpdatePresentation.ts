export type ProductInactiveDraftUpdateChange = {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
};

/**
 * Pure, transport-safe presentation of the persisted update proposal. The
 * execution command remains the sole owner of the patch and fingerprint.
 */
export function productInactiveDraftUpdatePresentation(input: {
  productId: string;
  productName: string;
  sessionId: string;
  editorLink: string;
  changes: readonly ProductInactiveDraftUpdateChange[];
  readinessBefore: string;
  expectedReadinessAfter: string;
  warnings: readonly string[];
  validationErrors: readonly string[];
  unchanged: readonly string[];
}) {
  return {
    productId: input.productId,
    productName: input.productName,
    draftStatus: "Inactive PBV2 DRAFT" as const,
    sessionId: input.sessionId,
    editorLink: input.editorLink,
    changes: [...input.changes],
    readinessBefore: input.readinessBefore,
    expectedReadinessAfter: input.expectedReadinessAfter,
    warnings: [...input.warnings],
    validationErrors: [...input.validationErrors],
    unchanged: [...input.unchanged],
  };
}
