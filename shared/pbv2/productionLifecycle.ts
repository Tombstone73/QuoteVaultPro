/** A draft is never an order-entry configuration. An inactive product may
 * become active only after its PBV2 draft has been published and assigned. */
export function requiresPublishedPbv2BeforeActivation(input: {
  currentlyActive: boolean;
  requestedActive: boolean | undefined;
  activeTreeVersionId: string | null | undefined;
  draftTreeVersionId: string | null | undefined;
}): boolean {
  return input.currentlyActive === false
    && input.requestedActive === true
    && !input.activeTreeVersionId
    && Boolean(input.draftTreeVersionId);
}
