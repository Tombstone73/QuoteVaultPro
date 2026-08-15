import type { Request } from "express";
import type {
  PrincipalIssuer,
  AuthenticatedIdentity,
} from "../../src/authorization/principalIssuer.js";
import type { Principal } from "../../src/authorization/principals.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { VerifiedV2PrincipalProvider } from "../../src/interfaces/http/quoteRoutes.js";

/**
 * This is the narrow seam from an already-authenticated host request to V2.
 * It deliberately carries identity only: tenant, role, sets and capabilities
 * are re-resolved by the V2 PrincipalIssuer on every request.
 */
export interface TrustedHostIdentitySource {
  authenticatedIdentity(
    request: Request,
  ): Promise<AuthenticatedIdentity | null>;
}

type PassportLikeRequest = Request & {
  isAuthenticated?: () => boolean;
  user?: { id?: unknown; claims?: { sub?: unknown } };
  sessionID?: unknown;
};

/**
 * Adapter for the existing trusted Passport/session host. It must be mounted
 * only in that host; a standalone V2 shell has no source and remains closed.
 */
export class PassportSessionIdentitySource implements TrustedHostIdentitySource {
  async authenticatedIdentity(
    request: Request,
  ): Promise<AuthenticatedIdentity | null> {
    const host = request as PassportLikeRequest;
    if (host.isAuthenticated?.() !== true) return null;
    const subjectId =
      typeof host.user?.claims?.sub === "string"
        ? host.user.claims.sub
        : host.user?.id;
    if (typeof subjectId !== "string" || !subjectId.trim()) return null;
    return Object.freeze({
      subjectId,
      ...(typeof host.sessionID === "string" && host.sessionID
        ? { sessionId: host.sessionID }
        : {}),
      authenticatedAt: new Date(),
      authenticationMethod: "session" as const,
    });
  }
}

/** Verified request identity plus freshly-read final M1.5 authority. */
export class IssuedV2PrincipalProvider implements VerifiedV2PrincipalProvider {
  constructor(
    private readonly identities: TrustedHostIdentitySource,
    private readonly issuer: PrincipalIssuer,
  ) {}
  async principal(
    request: Request,
    organizationId: string,
  ): Promise<Principal> {
    const identity = await this.identities.authenticatedIdentity(request);
    if (!identity)
      throw new V2ApplicationError("FORBIDDEN", "Authentication is required.");
    const principal = await this.issuer.issue(identity, { organizationId });
    if (principal.organizationId !== organizationId)
      throw new V2ApplicationError(
        "WRONG_TENANT",
        "Authenticated authority is unavailable for this organization.",
      );
    return principal;
  }
}
