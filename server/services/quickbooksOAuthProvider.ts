export type QuickBooksOAuthRefreshClient = {
  refreshUsingToken(refreshToken: string): Promise<any>;
};

/**
 * Refresh with the persisted grant explicitly. `intuit-oauth#refresh()` first
 * validates expiry metadata held by its in-memory Token object. Reconstructing
 * that object from only a persisted refresh token makes the SDK assign a zero
 * refresh lifetime and reject a valid grant before contacting Intuit.
 */
export async function refreshQuickBooksOAuthGrant(
  oauthClient: QuickBooksOAuthRefreshClient,
  refreshToken: string,
): Promise<any> {
  const storedGrant = String(refreshToken ?? "").trim();
  if (!storedGrant) throw new Error("The QuickBooks refresh token is missing.");
  return oauthClient.refreshUsingToken(storedGrant);
}
