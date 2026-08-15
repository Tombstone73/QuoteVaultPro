import type { Principal } from "./principals.js";

/**
 * The minimal output of a verified authentication adapter. It deliberately
 * contains no organization, role, capability, or customer authority claim:
 * the issuer must resolve those facts from trusted server-side sources.
 */
export type AuthenticatedIdentity = Readonly<{
  subjectId: string;
  sessionId?: string;
  authenticatedAt: Date;
  authenticationMethod: "session" | "portal_session" | "service_credential";
}>;

/** Requested scope is never an authority claim; the issuer validates it server-side. */
export type PrincipalIssuanceContext = Readonly<{ organizationId?: string }>;

export interface PrincipalIssuer {
  issue(identity: AuthenticatedIdentity, context?: PrincipalIssuanceContext): Promise<Principal>;
}
