import bcrypt from "bcryptjs";
import connectPg from "connect-pg-simple";
import express, { type Express, type Request, type RequestHandler, type Response } from "express";
import session from "express-session";
import rateLimit from "express-rate-limit";
import type { Pool } from "pg";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import type { AuthenticatedIdentity } from "../../src/authorization/principalIssuer.js";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import type { TrustedHostIdentitySource } from "./trustedHostPrincipalProvider.js";
import { issueV2CsrfToken, issueV2SessionScope, requireV2CsrfToken } from "./sessionCsrf.js";

export type V2StaffOrganization = Readonly<{ id: string; name: string }>;
export type V2AuthenticatedStaff = Readonly<{ id: string; email: string; displayName: string }>;

export interface V2StaffCredentialVerifier {
  authenticate(email: string, password: string): Promise<V2AuthenticatedStaff | null>;
  currentStaff(userId: string): Promise<V2AuthenticatedStaff | null>;
  eligibleOrganizations(userId: string): Promise<readonly V2StaffOrganization[]>;
}

type V2Session = session.Session & {
  v2Auth?: { subjectId: string; activeOrganizationId?: string };
  v2CsrfToken?: string;
  v2SessionScope?: string;
};
type V2SessionRequest = Request & { session: V2Session };

const invalidCredentials = (response: Response) =>
  response.status(401).json({ ok: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials." } });

const sessionData = (request: V2SessionRequest, staff: V2AuthenticatedStaff, organizations: readonly V2StaffOrganization[]) => ({
  staff: { id: staff.id, email: staff.email, displayName: staff.displayName },
  organizations,
  activeOrganizationId: request.session.v2Auth?.activeOrganizationId ?? null,
  csrfToken: issueV2CsrfToken(request),
  sessionScope: issueV2SessionScope(request),
});

const readBodyCredentials = (body: unknown): { email: string; password: string } | null => {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  const password = typeof value.password === "string" ? value.password : "";
  return email && password && email.length <= 320 && password.length <= 1024 ? { email, password } : null;
};

export type V2StandaloneAuthConfig = Readonly<{
  sessionSecret: string;
  publicWebOrigin?: string;
  secureCookies: boolean;
}>;

export const loadV2StandaloneAuthConfig = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): V2StandaloneAuthConfig => {
  const secret = environment.V2_SESSION_SECRET?.trim() ?? "";
  if (secret.length < 32) throw new Error("V2_SESSION_SECRET must contain at least 32 characters.");
  const production = environment.NODE_ENV === "production";
  const requestedOrigin = environment.V2_PUBLIC_WEB_ORIGIN?.trim();
  if (production && !requestedOrigin) throw new Error("V2_PUBLIC_WEB_ORIGIN is required in production.");
  if (requestedOrigin) {
    let origin: URL;
    try { origin = new URL(requestedOrigin); } catch { throw new Error("V2_PUBLIC_WEB_ORIGIN must be an absolute URL."); }
    if (origin.origin !== requestedOrigin.replace(/\/$/, "") || (production && origin.protocol !== "https:")) {
      throw new Error("V2_PUBLIC_WEB_ORIGIN must be an exact HTTPS origin in production.");
    }
  }
  return { sessionSecret: secret, publicWebOrigin: requestedOrigin?.replace(/\/$/, ""), secureCookies: production };
};

export const createV2SessionMiddleware = (
  databaseUrl: string,
  config: V2StandaloneAuthConfig,
): RequestHandler => {
  const PgStore = connectPg(session);
  return session({
    name: "v2.sid",
    secret: config.sessionSecret,
    store: new PgStore({ conString: databaseUrl, createTableIfMissing: false, tableName: "sessions", ttl: 7 * 24 * 60 * 60, disableTouch: true }),
    resave: false,
    saveUninitialized: false,
    proxy: config.secureCookies,
    cookie: { path: "/", httpOnly: true, secure: config.secureCookies, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000 },
  });
};

/** Canonical V2-DB adapter: users/auth_identities authenticate; authority remains a fresh V2 issuer decision. */
export class PostgresStandaloneStaffCredentialVerifier implements V2StaffCredentialVerifier {
  private readonly issuer: PermissionSetPrincipalIssuer;
  constructor(private readonly pool: Pool) {
    this.issuer = new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(pool));
  }
  private async staffById(userId: string): Promise<(V2AuthenticatedStaff & { passwordHash?: string }) | null> {
    const result = await this.pool.query<{ id: string; email: string; first_name: string | null; last_name: string | null; password_hash: string | null }>(
      `SELECT u.id, u.email, u.first_name, u.last_name, ai.password_hash
       FROM users u JOIN auth_identities ai ON ai.user_id = u.id AND ai.provider = 'password'
       WHERE u.id = $1 AND u.account_type = 'INTERNAL_USER' AND COALESCE(u.must_set_password, false) = false`, [userId]);
    const row = result.rows[0];
    if (!row?.email) return null;
    return { id: row.id, email: row.email, displayName: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email, ...(row.password_hash ? { passwordHash: row.password_hash } : {}) };
  }
  async authenticate(email: string, password: string): Promise<V2AuthenticatedStaff | null> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT u.id FROM users u JOIN auth_identities ai ON ai.user_id = u.id AND ai.provider = 'password'
       WHERE lower(u.email) = lower($1) AND u.account_type = 'INTERNAL_USER' AND COALESCE(u.must_set_password, false) = false`, [email]);
    const staff = result.rows[0] ? await this.staffById(result.rows[0].id) : null;
    if (!staff?.passwordHash || !(await bcrypt.compare(password, staff.passwordHash))) return null;
    return { id: staff.id, email: staff.email, displayName: staff.displayName };
  }
  currentStaff(userId: string): Promise<V2AuthenticatedStaff | null> {
    return this.staffById(userId).then((staff) => staff && { id: staff.id, email: staff.email, displayName: staff.displayName });
  }
  async eligibleOrganizations(userId: string): Promise<readonly V2StaffOrganization[]> {
    const candidates = await this.pool.query<{ id: string; name: string }>(
      `SELECT o.id, o.name FROM user_organizations m JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1 AND m.is_active = true ORDER BY m.is_default DESC, o.name ASC`, [userId]);
    const identity: AuthenticatedIdentity = { subjectId: userId, authenticatedAt: new Date(), authenticationMethod: "session" };
    const eligible: V2StaffOrganization[] = [];
    for (const candidate of candidates.rows) {
      try {
        await this.issuer.issue(identity, { organizationId: candidate.id });
        eligible.push({ id: candidate.id, name: candidate.name });
      } catch { /* A membership without live V2 permission-set authority is not an auth destination. */ }
    }
    return eligible;
  }
}

export type StandaloneStaffAuthentication = Readonly<{
  install: (app: Express) => void;
  trustedHostIdentity: TrustedHostIdentitySource;
  trustedHostMiddleware: RequestHandler;
}>;

export const createStandaloneStaffAuthentication = (input: Readonly<{
  verifier: V2StaffCredentialVerifier;
  config: V2StandaloneAuthConfig;
  sessionMiddleware: RequestHandler;
}>): StandaloneStaffAuthentication => {
  const requireOrigin: RequestHandler = (request, response, next) => {
    const origin = request.header("origin");
    if (origin && input.config.publicWebOrigin && origin !== input.config.publicWebOrigin) {
      response.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Browser origin is not allowed." } });
      return;
    }
    next();
  };
  const identity: TrustedHostIdentitySource = {
    async authenticatedIdentity(request) {
      const auth = (request as V2SessionRequest).session?.v2Auth;
      if (!auth?.subjectId || !(await input.verifier.currentStaff(auth.subjectId))) return null;
      return { subjectId: auth.subjectId, sessionId: (request as V2SessionRequest).sessionID, authenticatedAt: new Date(), authenticationMethod: "session" };
    },
  };
  const requireStaff: RequestHandler = async (request, response, next) => {
    const sessionRequest = request as V2SessionRequest;
    const authenticated = await identity.authenticatedIdentity(request);
    if (!authenticated) return invalidCredentials(response);
    const activeOrganizationId = sessionRequest.session.v2Auth?.activeOrganizationId;
    const requestedOrganizationId = request.params.organizationId;
    if (requestedOrganizationId && !activeOrganizationId) {
      return response.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Select an active organization for this Staff session." } });
    }
    if (requestedOrganizationId && activeOrganizationId !== requestedOrganizationId) {
      return response.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "The requested organization is not active for this session." } });
    }
    next();
  };
  const install = (app: Express): void => {
    app.set("trust proxy", 1);
    app.use(input.sessionMiddleware);
    app.post("/v2/auth/login", requireOrigin, rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { ok: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials." } } }), async (request, response) => {
      const credentials = readBodyCredentials(request.body);
      if (!credentials) return invalidCredentials(response);
      const staff = await input.verifier.authenticate(credentials.email, credentials.password).catch(() => null);
      if (!staff) return invalidCredentials(response);
      const organizations = await input.verifier.eligibleOrganizations(staff.id).catch(() => []);
      if (organizations.length === 0) return invalidCredentials(response);
      const sessionRequest = request as V2SessionRequest;
      await new Promise<void>((resolve, reject) => sessionRequest.session.regenerate((error) => error ? reject(error) : resolve()));
      sessionRequest.session.v2Auth = { subjectId: staff.id, ...(organizations.length === 1 ? { activeOrganizationId: organizations[0].id } : {}) };
      await new Promise<void>((resolve, reject) => sessionRequest.session.save((error) => error ? reject(error) : resolve()));
      response.status(200).json({ ok: true, data: sessionData(sessionRequest, staff, organizations) });
    });
    app.get("/v2/auth/session", async (request, response) => {
      const sessionRequest = request as V2SessionRequest;
      const subjectId = sessionRequest.session?.v2Auth?.subjectId;
      const staff = subjectId ? await input.verifier.currentStaff(subjectId).catch(() => null) : null;
      if (!staff) return response.status(401).json({ ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
      const organizations = await input.verifier.eligibleOrganizations(staff.id).catch(() => []);
      if (!organizations.some((organization) => organization.id === sessionRequest.session.v2Auth?.activeOrganizationId)) delete sessionRequest.session.v2Auth!.activeOrganizationId;
      response.status(200).json({ ok: true, data: sessionData(sessionRequest, staff, organizations) });
    });
    app.post("/v2/auth/active-organization", requireOrigin, requireStaff, requireV2CsrfToken, async (request, response) => {
      const organizationId = typeof request.body?.organizationId === "string" ? request.body.organizationId.trim() : "";
      const sessionRequest = request as V2SessionRequest;
      const organizations = await input.verifier.eligibleOrganizations(sessionRequest.session.v2Auth!.subjectId);
      if (!organizationId || !organizations.some((organization) => organization.id === organizationId)) {
        return response.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "The organization is not available to this Staff session." } });
      }
      sessionRequest.session.v2Auth!.activeOrganizationId = organizationId;
      sessionRequest.session.v2SessionScope = undefined;
      sessionRequest.session.v2CsrfToken = undefined;
      const staff = await input.verifier.currentStaff(sessionRequest.session.v2Auth!.subjectId);
      if (!staff) return invalidCredentials(response);
      await new Promise<void>((resolve, reject) => sessionRequest.session.save((error) => error ? reject(error) : resolve()));
      response.status(200).json({ ok: true, data: sessionData(sessionRequest, staff, organizations) });
    });
    app.post("/v2/auth/logout", requireOrigin, requireStaff, requireV2CsrfToken, (request, response) => {
      const sessionRequest = request as V2SessionRequest;
      sessionRequest.session.destroy(() => {
        response.clearCookie("v2.sid", { path: "/", httpOnly: true, secure: input.config.secureCookies, sameSite: "lax" });
        response.status(200).json({ ok: true, data: { loggedOut: true } });
      });
    });
  };
  return { install, trustedHostIdentity: identity, trustedHostMiddleware: requireStaff };
};
