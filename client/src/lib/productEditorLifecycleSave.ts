export type ProductEditorPublishResult = {
  productIsActive: boolean;
};

export type DeferredProductLifecycleInput = {
  shouldApplyLifecycle: boolean;
  desiredIsActive: boolean;
  draftId: string | null;
  draftAlreadyPublished?: boolean;
  publishDraft: (input: { treeVersionId: string; activateProduct: boolean }) => Promise<ProductEditorPublishResult>;
  updateLifecycle: (isActive: boolean) => Promise<void>;
};

/**
 * Completes the lifecycle portion of a Product Editor save only after the
 * caller has durably saved the PBV2 draft. Publishing and activating an
 * unpublished draft are one canonical server transaction; legacy products
 * with no draft retain the normal lifecycle endpoint behavior.
 */
export async function completeDeferredProductLifecycle(input: DeferredProductLifecycleInput): Promise<void> {
  if (!input.shouldApplyLifecycle) return;

  if (!input.desiredIsActive) {
    await input.updateLifecycle(false);
    return;
  }

  if (input.draftId && !input.draftAlreadyPublished) {
    const publishResult = await input.publishDraft({
      treeVersionId: input.draftId,
      activateProduct: true,
    });
    if (publishResult.productIsActive) return;
  }

  // An already-published tree, an auto-published draft, or a legacy Product
  // without PBV2 configuration still uses the canonical lifecycle operation.
  await input.updateLifecycle(true);
}
