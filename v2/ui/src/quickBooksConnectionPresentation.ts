export type QuickBooksConnectionPresentationState = Readonly<{
  connected: boolean;
  connectedCompanyName: string | null;
}>;

/**
 * A provider authorization carries a realm/company association even when the
 * optional provider display name was not returned or has not been refreshed.
 * Keep those states distinct: missing display metadata is not a disconnection.
 */
export const quickBooksCompanyConnectionCopy = (state: QuickBooksConnectionPresentationState | undefined): string => {
  if (!state?.connected) return "No QuickBooks company connected.";
  if (state.connectedCompanyName) return `Connected to ${state.connectedCompanyName}.`;
  return "QuickBooks company connected · company name unavailable.";
};
