import type { CreatedProductWithInitialDraft } from "../api";

export type FirstSaveIdentity = Readonly<CreatedProductWithInitialDraft>;
export const firstSaveRequestHistoryKey = "v2.productBuilder.firstSaveRequestId";

/** A create request is durable on the server; the browser must retain the
 * logical request ID until it has adopted the returned Product/Draft pair. */
export const firstSaveRequestId = (
  pendingRequestId: string | null,
  createRequestId: () => string,
): string => pendingRequestId ?? createRequestId();

export const firstSaveRequestIdFromHistory = (historyState: unknown): string | null => {
  if (!historyState || typeof historyState !== "object") return null;
  const value = (historyState as Record<string, unknown>)[firstSaveRequestHistoryKey];
  return typeof value === "string" && value.trim() ? value : null;
};

/** Product identity is adopted as soon as create succeeds, before any later
 * independent section save can fail. */
export const adoptFirstSaveIdentity = (
  created: CreatedProductWithInitialDraft,
): FirstSaveIdentity => ({
  productId: created.productId,
  draftVersionId: created.draftVersionId,
  draftUpdatedAt: created.draftUpdatedAt,
});
