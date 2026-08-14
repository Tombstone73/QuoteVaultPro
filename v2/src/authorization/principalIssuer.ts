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

export interface PrincipalIssuer {
  issue(identity: AuthenticatedIdentity): Promise<Principal>;
}
