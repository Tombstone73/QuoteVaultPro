import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import connectPg from "connect-pg-simple";
import express, { type Express, type Request, type RequestHandler, type Response } from "express";
import session from "express-session";
import rateLimit from "express-rate-limit";
import type { Pool } from "pg";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import type { AuthenticatedIdentity } from "../../src/authorization/principalIssuer.js";
import type { Principal } from "../../src/authorization/principals.js";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import { PostgresEmailIntegrationService } from "../communications/postgresEmailIntegration.js";
import type { TrustedHostIdentitySource } from "./trustedHostPrincipalProvider.js";
import { issueV2CsrfToken, issueV2SessionScope, requireV2CsrfToken } from "./sessionCsrf.js";

export type V2StaffOrganization = Readonly<{ id: string; name: string }>;
export type V2AuthenticatedStaff = Readonly<{ id: string; email: string; displayName: string }>;
export type V2AuthenticatedPortal = Readonly<{ id: string; email: string; displayName: string; organizationId: string; customerId: string }>;

export interface V2StaffCredentialVerifier {
  authenticate(email: string, password: string): Promise<V2AuthenticatedStaff | null>;
  currentStaff(userId: string): Promise<V2AuthenticatedStaff | null>;
  eligibleOrganizations(userId: string): Promise<readonly V2StaffOrganization[]>;
}
export interface V2PortalCredentialVerifier {
  authenticatePortal(email: string, password: string): Promise<V2AuthenticatedPortal | null>;
  currentPortal(userId: string, organizationId: string): Promise<V2AuthenticatedPortal | null>;
}
export interface V2PortalCredentialLifecycle {
  establishCredentials(token: string, password: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<void>;
}

export type V2Session = session.Session & {
  v2Auth?: { subjectId: string; activeOrganizationId?: string };
  v2PortalAuth?: { subjectId: string; organizationId: string; returnTo: string };
  v2CsrfToken?: string;
  v2SessionScope?: string;
};
export type V2SessionRequest = Request & { session: V2Session };

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
const readTokenPassword = (body: unknown): { token: string; password: string } | null => {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const token = typeof value.token === "string" ? value.token.trim() : "";
  const password = typeof value.password === "string" ? value.password : "";
  return token && password && token.length <= 512 && password.length <= 1024 ? { token, password } : null;
};
const passwordIsAcceptable = (password: string) => password.length >= 12 && password.length <= 1024;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const portalCredentialError = (error: unknown, fallback: string) => error instanceof Error && error.message === "Choose a password with at least 12 characters." ? error.message : fallback;

export const safePortalReturnTo = (value: unknown): string => {
  if (typeof value !== "string") return "/portal/invoices";
  const destination = value.trim();
  if (!destination.startsWith("/") || destination.startsWith("//") || destination.includes("\\")) return "/portal/invoices";
  return /^\/portal\/invoices(?:\/[A-Za-z0-9_-]+)?$/.test(destination) ? destination : "/portal/invoices";
};

export type V2StandaloneAuthConfig = Readonly<{
  sessionSecret: string;
  publicWebOrigin?: string;
  secureCookies: boolean;
}>;

export const loadV2StandaloneAuthConfig = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): V2StandaloneAuthConfig => {
  const secret = environment.SESSION_SECRET?.trim() ?? "";
  if (secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  const production = environment.NODE_ENV === "production";
  const requestedOrigin = environment.APP_PUBLIC_WEB_ORIGIN?.trim();
  if (production && !requestedOrigin) throw new Error("APP_PUBLIC_WEB_ORIGIN is required in production.");
  if (requestedOrigin) {
    let origin: URL;
    try { origin = new URL(requestedOrigin); } catch { throw new Error("APP_PUBLIC_WEB_ORIGIN must be an absolute URL."); }
    if (origin.origin !== requestedOrigin.replace(/\/$/, "") || (production && origin.protocol !== "https:")) {
      throw new Error("APP_PUBLIC_WEB_ORIGIN must be an exact HTTPS origin in production.");
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

/** Password identity is shared, but a portal user can only establish a V2
 * portal session through one active tenant/customer access record. */
export class PostgresStandalonePortalCredentialVerifier implements V2PortalCredentialVerifier {
  constructor(private readonly pool: Pool) {}
  private async find(where: string, values: readonly string[]): Promise<(V2AuthenticatedPortal & { passwordHash?: string }) | null> {
    const result = await this.pool.query<{ id:string; email:string; first_name:string|null; last_name:string|null; password_hash:string|null; organization_id:string; customer_id:string; display_name:string|null }>(
      `SELECT u.id,u.email,u.first_name,u.last_name,ai.password_hash,cpa.organization_id,cpa.customer_id,cpa.display_name
       FROM users u JOIN customer_portal_access cpa ON cpa.user_id=u.id AND cpa.status='ACTIVE'
       JOIN auth_identities ai ON ai.user_id=u.id AND ai.provider='password'
       JOIN customers c ON c.id=cpa.customer_id AND c.organization_id=cpa.organization_id
       LEFT JOIN customer_contacts cc ON cc.id=cpa.contact_id AND cc.organization_id=cpa.organization_id
       LEFT JOIN customer_contact_links l ON l.organization_id=cpa.organization_id AND l.customer_id=cpa.customer_id AND l.contact_id=cpa.contact_id
       WHERE u.account_type='PORTAL_CUSTOMER' AND COALESCE(u.must_set_password,false)=false
         AND c.is_active IS DISTINCT FROM false AND COALESCE(c.status,'active') NOT IN ('archived','deleted','superseded') AND c.merged_into_customer_id IS NULL
         AND (cpa.contact_id IS NULL OR (cc.status='active' AND l.status='active')) AND ${where}`,
      [...values],
    );
    const row=result.rows[0]; if(!row?.email) return null;
    return { id:row.id,email:row.email,displayName:row.display_name?.trim() || [row.first_name,row.last_name].filter(Boolean).join(" ") || row.email,organizationId:row.organization_id,customerId:row.customer_id,...(row.password_hash?{passwordHash:row.password_hash}:{}) };
  }
  async authenticatePortal(email:string,password:string):Promise<V2AuthenticatedPortal|null>{ const portal=await this.find("lower(u.email)=lower($1)",[email]); if(!portal?.passwordHash || !(await bcrypt.compare(password,portal.passwordHash))) return null; return {id:portal.id,email:portal.email,displayName:portal.displayName,organizationId:portal.organizationId,customerId:portal.customerId}; }
  async currentPortal(userId:string,organizationId:string):Promise<V2AuthenticatedPortal|null>{ const portal=await this.find("u.id=$1 AND cpa.organization_id=$2",[userId,organizationId]); return portal && {id:portal.id,email:portal.email,displayName:portal.displayName,organizationId:portal.organizationId,customerId:portal.customerId}; }
}

/** Owns only the one-time credential handoff for a canonical portal-access
 * record. Customer/contact authority, invitation delivery, and portal
 * session issuance deliberately stay in their existing V2 owners. */
export class PostgresPortalCredentialLifecycle implements V2PortalCredentialLifecycle {
  private readonly communications: PostgresEmailIntegrationService;
  constructor(private readonly pool: Pool, private readonly publicWebOrigin: string | undefined) {
    this.communications = new PostgresEmailIntegrationService(pool);
  }

  private setupUrl(token: string, path: "/portal/setup" | "/portal/reset-password") {
    const origin = this.publicWebOrigin?.replace(/\/$/u, "");
    if (!origin) throw new Error("The public portal origin is unavailable.");
    return `${origin}${path}?token=${encodeURIComponent(token)}`;
  }

  private validPassword(password: string) {
    if (!passwordIsAcceptable(password)) throw new Error("Choose a password with at least 12 characters.");
  }

  async establishCredentials(token: string, password: string): Promise<void> {
    this.validPassword(password);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const invite = await client.query<{ id:string; access_id:string; organization_id:string; email:string; user_id:string|null; status:string }>(
        `SELECT t.id,t.access_id,t.organization_id,a.email,a.user_id,a.status::text
         FROM customer_portal_invite_tokens t
         JOIN customer_portal_access a ON a.id=t.access_id AND a.organization_id=t.organization_id
         JOIN customers c ON c.id=a.customer_id AND c.organization_id=a.organization_id
         LEFT JOIN customer_contacts cc ON cc.id=a.contact_id AND cc.organization_id=a.organization_id
         LEFT JOIN customer_contact_links l ON l.organization_id=a.organization_id AND l.customer_id=a.customer_id AND l.contact_id=a.contact_id
         WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>now()
           AND a.status='PENDING_INVITE' AND c.is_active IS DISTINCT FROM false
           AND COALESCE(c.status,'active') NOT IN ('archived','deleted','superseded') AND c.merged_into_customer_id IS NULL
           AND (a.contact_id IS NULL OR (cc.status='active' AND l.status='active')) FOR UPDATE OF t, a`,
        [tokenHash(token)],
      );
      const access = invite.rows[0];
      if (!access) throw new Error("This setup link is invalid or expired.");
      const email = access.email.trim().toLowerCase();
      const existing = await client.query<{ id:string; account_type:string; email:string }>("SELECT id,account_type::text,email FROM users WHERE lower(email)=lower($1) FOR UPDATE", [email]);
      let userId = access.user_id;
      if (existing.rows[0]) {
        if (existing.rows[0].account_type !== "PORTAL_CUSTOMER" || (userId && existing.rows[0].id !== userId)) throw new Error("This setup link is unavailable.");
        userId = existing.rows[0].id;
      }
      if (!userId) {
        userId = randomBytes(18).toString("base64url");
        await client.query("INSERT INTO users(id,email,account_type,role,must_set_password) VALUES($1,$2,'PORTAL_CUSTOMER','customer',false)", [userId, email]);
      }
      const passwordHash = await bcrypt.hash(password, 12);
      await client.query("INSERT INTO auth_identities(id,user_id,provider,password_hash,password_set_at) VALUES($1,$2,'password',$3,now()) ON CONFLICT(user_id,provider) DO UPDATE SET password_hash=EXCLUDED.password_hash,password_set_at=now(),updated_at=now()", [randomBytes(18).toString("base64url"), userId, passwordHash]);
      await client.query("UPDATE customer_portal_invite_tokens SET used_at=now() WHERE id=$1", [access.id]);
      await client.query("UPDATE customer_portal_invite_tokens SET revoked_at=now() WHERE access_id=$1 AND id<>$2 AND used_at IS NULL AND revoked_at IS NULL", [access.access_id, access.id]);
      await client.query("UPDATE customer_portal_access SET user_id=$3,status='ACTIVE',invite_accepted_at=now(),password_set_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2", [access.organization_id, access.access_id, userId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async requestPasswordReset(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return;
    const client = await this.pool.connect(); let recipient = ""; let token = ""; let organizationId = "";
    try {
      await client.query("BEGIN");
      const access = await client.query<{ id:string; organization_id:string; email:string }>(
        `SELECT a.id,a.organization_id,a.email FROM customer_portal_access a
         JOIN users u ON u.id=a.user_id AND u.account_type='PORTAL_CUSTOMER'
         JOIN customers c ON c.id=a.customer_id AND c.organization_id=a.organization_id
         LEFT JOIN customer_contacts cc ON cc.id=a.contact_id AND cc.organization_id=a.organization_id
         LEFT JOIN customer_contact_links l ON l.organization_id=a.organization_id AND l.customer_id=a.customer_id AND l.contact_id=a.contact_id
         WHERE a.status='ACTIVE' AND lower(a.email)=lower($1) AND c.is_active IS DISTINCT FROM false
           AND COALESCE(c.status,'active') NOT IN ('archived','deleted','superseded') AND c.merged_into_customer_id IS NULL
           AND (a.contact_id IS NULL OR (cc.status='active' AND l.status='active')) FOR UPDATE OF a`, [email]);
      const row = access.rows[0];
      if (!row) { await client.query("COMMIT"); return; }
      token = randomBytes(32).toString("hex"); recipient = row.email; organizationId = row.organization_id;
      await client.query("UPDATE v2_portal_password_reset_tokens SET revoked_at=now() WHERE access_id=$1 AND used_at IS NULL AND revoked_at IS NULL", [row.id]);
      await client.query("INSERT INTO v2_portal_password_reset_tokens(access_id,organization_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '2 hours')", [row.id, organizationId, tokenHash(token)]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    await this.communications.sendPortalPasswordReset(organizationId, recipient, this.setupUrl(token, "/portal/reset-password"));
  }

  async resetPassword(token: string, password: string): Promise<void> {
    this.validPassword(password);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const reset = await client.query<{ id:string; access_id:string; user_id:string|null }>(
        `SELECT t.id,t.access_id,a.user_id FROM v2_portal_password_reset_tokens t
         JOIN customer_portal_access a ON a.id=t.access_id AND a.organization_id=t.organization_id
         JOIN customers c ON c.id=a.customer_id AND c.organization_id=a.organization_id
         LEFT JOIN customer_contacts cc ON cc.id=a.contact_id AND cc.organization_id=a.organization_id
         LEFT JOIN customer_contact_links l ON l.organization_id=a.organization_id AND l.customer_id=a.customer_id AND l.contact_id=a.contact_id
         WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>now() AND a.status='ACTIVE'
           AND c.is_active IS DISTINCT FROM false AND COALESCE(c.status,'active') NOT IN ('archived','deleted','superseded') AND c.merged_into_customer_id IS NULL
           AND (a.contact_id IS NULL OR (cc.status='active' AND l.status='active')) FOR UPDATE OF t, a`, [tokenHash(token)]);
      const row = reset.rows[0];
      if (!row?.user_id) throw new Error("This password reset link is invalid or expired.");
      const passwordHash = await bcrypt.hash(password, 12);
      await client.query("UPDATE auth_identities SET password_hash=$2,password_set_at=now(),updated_at=now() WHERE user_id=$1 AND provider='password'", [row.user_id, passwordHash]);
      await client.query("UPDATE v2_portal_password_reset_tokens SET used_at=now() WHERE id=$1", [row.id]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}

export type StandaloneStaffAuthentication = Readonly<{
  install: (app: Express) => void;
  trustedHostIdentity: TrustedHostIdentitySource;
  trustedHostMiddleware: RequestHandler;
  publicWebOrigin?: string;
  portalMiddleware: RequestHandler;
  portalPrincipal: Readonly<{ principal(request: Request): Promise<Principal> }>;
}>;

export const createStandaloneStaffAuthentication = (input: Readonly<{
  verifier: V2StaffCredentialVerifier;
  portalVerifier?: V2PortalCredentialVerifier;
  portalLifecycle?: V2PortalCredentialLifecycle;
  portalIssuer?: PermissionSetPrincipalIssuer;
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
  const portalPrincipal = {
    async principal(request: Request): Promise<Principal> {
      const auth=(request as V2SessionRequest).session?.v2PortalAuth;
      if(!auth || !input.portalVerifier || !input.portalIssuer) throw new Error("Portal authentication is required.");
      const portal=await input.portalVerifier.currentPortal(auth.subjectId,auth.organizationId);
      if(!portal) throw new Error("Portal access is unavailable.");
      return input.portalIssuer.issue({subjectId:portal.id,authenticatedAt:new Date(),authenticationMethod:"portal_session"},{organizationId:portal.organizationId});
    },
  };
  const requirePortal: RequestHandler = async (request,response,next) => {
    try { await portalPrincipal.principal(request); next(); }
    catch { response.status(401).json({ok:false,error:{code:"UNAUTHENTICATED",message:"Portal authentication is required."}}); }
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
    const establishPortalSession = async (request: Request, response: Response, portal: V2AuthenticatedPortal, returnToInput: unknown) => {
      const sessionRequest=request as V2SessionRequest;
      await new Promise<void>((resolve,reject)=>sessionRequest.session.regenerate((error)=>error?reject(error):resolve()));
      const returnTo=safePortalReturnTo(returnToInput);
      sessionRequest.session.v2PortalAuth={subjectId:portal.id,organizationId:portal.organizationId,returnTo};
      await new Promise<void>((resolve,reject)=>sessionRequest.session.save((error)=>error?reject(error):resolve()));
      response.status(200).json({ok:true,data:{portal:{displayName:portal.displayName,customerId:portal.customerId},returnTo,csrfToken:issueV2CsrfToken(sessionRequest),sessionScope:issueV2SessionScope(sessionRequest)}});
    };
    app.post("/v2/portal/auth/login", requireOrigin, rateLimit({windowMs:15*60*1000,max:10,standardHeaders:true,legacyHeaders:false}), async (request,response) => {
      const credentials=readBodyCredentials(request.body); const portal=credentials && input.portalVerifier ? await input.portalVerifier.authenticatePortal(credentials.email,credentials.password).catch(()=>null) : null;
      if(!portal) return invalidCredentials(response);
      await establishPortalSession(request,response,portal,request.body?.returnTo);
    });
    app.post("/v2/portal/auth/setup", requireOrigin, rateLimit({windowMs:15*60*1000,max:10,standardHeaders:true,legacyHeaders:false}), async (request,response) => {
      const credentials=readTokenPassword(request.body);
      if (!credentials || !input.portalLifecycle) return response.status(400).json({ok:false,error:{code:"INVALID_SETUP",message:"This setup link is invalid or expired."}});
      try { await input.portalLifecycle.establishCredentials(credentials.token,credentials.password); }
      catch (error) { return response.status(400).json({ok:false,error:{code:"INVALID_SETUP",message:portalCredentialError(error,"This setup link is invalid or expired.")}}); }
      response.status(200).json({ok:true,data:{setupComplete:true}});
    });
    app.post("/v2/portal/auth/forgot-password", requireOrigin, rateLimit({windowMs:15*60*1000,max:5,standardHeaders:true,legacyHeaders:false}), async (request,response) => {
      const email=typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
      try { if (email && input.portalLifecycle) await input.portalLifecycle.requestPasswordReset(email); } catch { /* Never disclose reset eligibility or provider state. */ }
      response.status(202).json({ok:true,data:{accepted:true}});
    });
    app.post("/v2/portal/auth/reset-password", requireOrigin, rateLimit({windowMs:15*60*1000,max:10,standardHeaders:true,legacyHeaders:false}), async (request,response) => {
      const credentials=readTokenPassword(request.body);
      if (!credentials || !input.portalLifecycle) return response.status(400).json({ok:false,error:{code:"INVALID_RESET",message:"This password reset link is invalid or expired."}});
      try { await input.portalLifecycle.resetPassword(credentials.token,credentials.password); response.status(200).json({ok:true,data:{passwordReset:true}}); }
      catch (error) { response.status(400).json({ok:false,error:{code:"INVALID_RESET",message:portalCredentialError(error,"This password reset link is invalid or expired.")}}); }
    });
    app.get("/v2/portal/auth/session", async (request,response) => {
      try { const principal=await portalPrincipal.principal(request); if(principal.kind!=="portal") throw new Error("Portal unavailable"); const sessionRequest=request as V2SessionRequest; response.status(200).json({ok:true,data:{portal:{displayName:principal.subjectId,customerId:principal.customerId},returnTo:safePortalReturnTo(sessionRequest.session.v2PortalAuth?.returnTo),csrfToken:issueV2CsrfToken(sessionRequest),sessionScope:issueV2SessionScope(sessionRequest)}}); }
      catch { response.status(401).json({ok:false,error:{code:"UNAUTHENTICATED",message:"Portal authentication is required."}}); }
    });
    app.post("/v2/portal/auth/logout", requireOrigin, requirePortal, requireV2CsrfToken, (request,response) => {
      const sessionRequest=request as V2SessionRequest; sessionRequest.session.destroy(()=>{response.clearCookie("v2.sid",{path:"/",httpOnly:true,secure:input.config.secureCookies,sameSite:"lax"});response.status(200).json({ok:true,data:{loggedOut:true}});});
    });
  };
  return { install, trustedHostIdentity: identity, trustedHostMiddleware: requireStaff, publicWebOrigin: input.config.publicWebOrigin, portalMiddleware:requirePortal, portalPrincipal };
};
