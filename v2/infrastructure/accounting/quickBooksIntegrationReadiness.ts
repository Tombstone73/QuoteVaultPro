import * as quickBooks from "../../../server/quickbooksService.js";

/** Narrow provider adapter: secrets and OAuth tokens never leave this server
 * boundary.  V2 only receives readiness and a redirect URL. */
export class QuickBooksIntegrationReadinessService {
  async readiness(organizationId: string) { return quickBooks.getQuickBooksConnectionReadinessForOrganization(organizationId); }
  async refundDisbursementAccounts(organizationId: string) { return quickBooks.listQuickBooksRefundDisbursementAccounts(organizationId); }
  async setRefundDisbursementAccount(input: Readonly<{ organizationId: string; accountId: string; actorUserId: string }>) { return quickBooks.setQuickBooksRefundDisbursementAccount(input); }
  async beginConnect(organizationId: string) { return { authorizeUrl: await quickBooks.getAuthorizationUrlForOrganization(organizationId) }; }
  async finishConnect(input: Readonly<{ state: string; code: string; realmId: string; callbackUrl: string }>): Promise<void> {
    const parsed = quickBooks.parseOAuthState(input.state);
    if (!parsed?.organizationId || !input.code || !input.realmId) throw new Error("QuickBooks OAuth callback state is invalid or expired.");
    await quickBooks.exchangeCodeForTokens(input.callbackUrl, input.realmId, parsed.organizationId);
  }
  async disconnect(organizationId: string) { await quickBooks.disconnectConnectionForOrganization(organizationId); return this.readiness(organizationId); }
}
