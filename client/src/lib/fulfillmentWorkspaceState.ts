export type FulfillmentWorkspaceLoadState = 'loading' | 'not_found' | 'error' | 'ready';

/** Keep true Order-not-found separate from an operational/API failure. */
export function getFulfillmentWorkspaceLoadState(input: {
  orderId: string | undefined;
  isLoading: boolean;
  isError: boolean;
  errorStatus?: number | null;
  hasDetail: boolean;
}): FulfillmentWorkspaceLoadState {
  if (!input.orderId) return 'not_found';
  if (input.isLoading) return 'loading';
  if (input.isError) return input.errorStatus === 404 ? 'not_found' : 'error';
  return input.hasDetail ? 'ready' : 'not_found';
}
