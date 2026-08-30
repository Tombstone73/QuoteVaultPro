import * as quickBooks from "../../../server/quickbooksService.js";

/** Narrow provider adapter: secrets and OAuth tokens never leave this server
 * boundary.  V2 only receives readiness and a redirect URL. */
export class QuickBooksIntegrationReadinessService {
  async readiness(organizationId: string) { return quickBooks.getQuickBooksConnectionReadinessForOrganization(organizationId); }
  async beginConnect(organizationId: string) { return { authorizeUrl: await quickBooks.getAuthorizationUrlForOrganization(organizationId) }; }
  async disconnect(organizationId: string) { await quickBooks.disconnectConnectionForOrganization(organizationId); return this.readiness(organizationId); }
}
