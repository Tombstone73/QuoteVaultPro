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
 * The Product Editor submits its full form state, including availability.  On
 * an existing Product, availability is a distinct lifecycle command: it must
 * not be sent as part of an ordinary configuration/DRAFT save.  In
 * particular, an unchanged `isActive: true` must not cause the lifecycle
 * boundary to revalidate the currently published tree before staff can repair
 * it in a DRAFT revision.
 */
export function isolateProductEditorLifecycleChange(input: {
  isNewProduct: boolean;
  currentIsActive: boolean | undefined;
  payload: Record<string, unknown>;
}): { productPayload: Record<string, unknown>; deferredLifecycle: { desiredIsActive: boolean } | null } {
  const productPayload = { ...input.payload };
  if (input.isNewProduct || typeof productPayload.isActive !== "boolean") {
    return { productPayload, deferredLifecycle: null };
  }

  const desiredIsActive = productPayload.isActive;
  delete productPayload.isActive;
  return {
    productPayload,
    deferredLifecycle: desiredIsActive !== input.currentIsActive ? { desiredIsActive } : null,
  };
}

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
