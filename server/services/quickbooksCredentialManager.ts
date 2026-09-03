import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { oauthConnections, type OAuthConnection } from "../../shared/schema";

export type QuickBooksConnectionState = "connected" | "refreshing" | "degraded" | "needs_reauth" | "disconnected";

export type QuickBooksCredentialErrorCategory =
  | "invalid_grant"
  | "invalid_client"
  | "configuration_error"
  | "network_failure"
  | "credential_manager_failure"
  | "decrypt_failure"
  | "persistence_failure"
  | "refresh_response_error"
  | "transient_refresh_failure"
  | "transient_api_failure"
  | "missing_credentials"
  | "tenant_context_missing"
  | "lock_timeout"
  | "unknown";

export type QuickBooksTokenRefreshResponse = {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_in?: number | null;
  // Intuit returns this on token exchange/refresh. Keep it in non-secret
  // credential metadata so an approaching refresh-token expiry is observable.
  x_refresh_token_expires_in?: number | null;
  refresh_token_expires_in?: number | null;
  token_type?: string | null;
  __quickBooksOAuthDiagnostic?: QuickBooksOAuthDiagnostic;
};

export type QuickBooksOAuthDiagnostic = {
  httpStatus?: number | null;
  oauthError?: string | null;
  oauthErrorDescription?: string | null;
  responseBody?: unknown;
  message?: string | null;
};

export type QuickBooksDecryptedConnection = OAuthConnection & {
  accessToken: string;
  refreshToken: string;
};

export type QuickBooksConnectionStatus = {
  connected: boolean;
  state: QuickBooksConnectionState;
  lastSuccessfulRefreshAt: string | null;
  lastSuccessfulRequestAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: QuickBooksCredentialErrorCategory | null;
  lastErrorMessage: string | null;
  lastErrorStage: string | null;
  lastErrorHttpStatus: number | null;
  lastOAuthError: string | null;
  lastOAuthErrorDescription: string | null;
  consecutiveTransientFailureCount: number;
  requiresUserAction: boolean;
  connection: QuickBooksDecryptedConnection | null;
};

type RefreshCredentialsInput = {
  organizationId: string;
  connection: QuickBooksDecryptedConnection;
  refreshWithIntuit: (refreshToken: string) => Promise<QuickBooksTokenRefreshResponse>;
  force?: boolean;
};

const ENCRYPTED_TOKEN_PREFIX = "qbtoken:v1:";
const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_LOCK_TIMEOUT_MS = 8000;
const DEFAULT_LOCK_POLL_MS = 250;
const LOG_BODY_LIMIT = 1600;

/**
 * Every writer of a QuickBooks credential row must use this key. In particular,
 * an OAuth callback/reconnect must not race an in-flight refresh and restore an
 * older, already-rotated refresh token.
 */
export function quickBooksCredentialLockKey(organizationId: string): string {
  return `quickbooks_oauth_credentials:${String(organizationId ?? "").trim()}`;
}

export function resolveQuickBooksTokenExpiryMetadata(
  token: QuickBooksTokenRefreshResponse,
  now = new Date(),
): { accessExpiresAt: Date; refreshTokenExpiresAt: string | null; refreshTokenExpiresInSeconds: number | null } {
  const accessExpiresInSeconds = firstNumber(token.expires_in) ?? 3600;
  const refreshTokenExpiresInSeconds = firstNumber(
    token.x_refresh_token_expires_in,
    token.refresh_token_expires_in,
  );
  return {
    accessExpiresAt: new Date(now.getTime() + accessExpiresInSeconds * 1000),
    refreshTokenExpiresAt: refreshTokenExpiresInSeconds
      ? new Date(now.getTime() + refreshTokenExpiresInSeconds * 1000).toISOString()
      : null,
    refreshTokenExpiresInSeconds,
  };
}

export class QuickBooksCredentialManagerError extends Error {
  category: QuickBooksCredentialErrorCategory;
  stage: string;
  organizationId?: string;
  connectionId?: string;
  diagnostic: QuickBooksOAuthDiagnostic;

  constructor(message: string, args: {
    category: QuickBooksCredentialErrorCategory;
    stage: string;
    organizationId?: string;
    connectionId?: string;
    diagnostic?: QuickBooksOAuthDiagnostic;
    cause?: unknown;
  }) {
    super(message);
    this.name = "QuickBooksCredentialManagerError";
    this.category = args.category;
    this.stage = args.stage;
    this.organizationId = args.organizationId;
    this.connectionId = args.connectionId;
    this.diagnostic = args.diagnostic ?? {};
    (this as any).cause = args.cause;
  }
}

function requireOrganizationId(organizationId: string | undefined | null, operation: string): string {
  const trimmed = String(organizationId ?? "").trim();
  if (!trimmed) {
    console.error("[QB Credentials] Missing organizationId", { operation, errorCategory: "tenant_context_missing" });
    throw Object.assign(new Error("QuickBooks operation requires organizationId."), { code: "QB_TENANT_CONTEXT_MISSING" });
  }
  return trimmed;
}

function encryptionSecret(): string | null {
  const value = String(process.env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY || process.env.QB_TOKEN_ENCRYPTION_KEY || "").trim();
  return value || null;
}

function encryptionKeyId(): string {
  return String(process.env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY_ID || process.env.QB_TOKEN_ENCRYPTION_KEY_ID || "v1").trim() || "v1";
}

function deriveEncryptionKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function redactDiagnosticValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 6) return "[MaxDepth]";
  if (typeof value === "string") {
    return value.length > LOG_BODY_LIMIT ? `${value.slice(0, LOG_BODY_LIMIT)}...[truncated]` : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => redactDiagnosticValue(item, depth + 1));

  const redacted: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (
      normalized.includes("token") ||
      normalized.includes("authorization") ||
      normalized.includes("client_secret") ||
      normalized.includes("secret") ||
      normalized.includes("password")
    ) {
      redacted[key] = typeof raw === "boolean" || typeof raw === "number" ? raw : "[REDACTED]";
      continue;
    }
    redacted[key] = redactDiagnosticValue(raw, depth + 1);
  }
  return redacted;
}

export function redactQuickBooksOAuthDiagnostic(value: unknown): unknown {
  return redactDiagnosticValue(value);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return value;
  if (!text.startsWith("{") && !text.startsWith("[")) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function extractQuickBooksOAuthDiagnostic(errorOrResponse: unknown): QuickBooksOAuthDiagnostic {
  const source: any = errorOrResponse as any;
  const rawBody = parseMaybeJson(
    source?.response?.data ??
    source?.response?.body ??
    source?.responseBody ??
    source?.body ??
    source?.authResponse?.json ??
    source?.authResponse?.body ??
    source?.json ??
    source?.data ??
    null,
  );
  const body: any = rawBody && typeof rawBody === "object" ? rawBody : null;
  const fault = body?.Fault?.Error?.[0];
  const oauthError = firstString(
    source?.error,
    source?.oauthError,
    body?.error,
    body?.errorCode,
    fault?.code,
  );
  const oauthErrorDescription = firstString(
    source?.error_description,
    source?.oauthErrorDescription,
    body?.error_description,
    body?.errorMessage,
    body?.message,
    fault?.Message,
    fault?.Detail,
    source?.message,
  );

  return {
    httpStatus: firstNumber(
      source?.statusCode,
      source?.status,
      source?.response?.status,
      source?.response?.statusCode,
      source?.authResponse?.response?.status,
    ),
    oauthError,
    oauthErrorDescription,
    responseBody: rawBody == null ? undefined : redactQuickBooksOAuthDiagnostic(rawBody),
    message: firstString(source?.message, oauthErrorDescription, oauthError),
  };
}

export function getQuickBooksCredentialCauseText(error: unknown): string {
  const managerError = error as Partial<QuickBooksCredentialManagerError>;
  const diagnostic = managerError.diagnostic ?? extractQuickBooksOAuthDiagnostic(error);
  return (
    diagnostic.oauthError ||
    diagnostic.oauthErrorDescription ||
    managerError.category ||
    (error as any)?.message ||
    String(error || "unknown")
  );
}

function credentialLog(level: "info" | "warn" | "error", event: string, payload: Record<string, unknown>): void {
  const safePayload = redactQuickBooksOAuthDiagnostic(payload) as Record<string, unknown>;
  const method = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  method(`[QB Credentials] ${event}`, safePayload);
}

export function isEncryptedQuickBooksToken(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(ENCRYPTED_TOKEN_PREFIX);
}

export function encryptQuickBooksToken(plaintext: string): string {
  const secret = encryptionSecret();
  if (!secret) {
    throw new Error("QUICKBOOKS_TOKEN_ENCRYPTION_KEY/QB_TOKEN_ENCRYPTION_KEY is not configured.");
  }
  const trimmed = String(plaintext ?? "");
  if (!trimmed) throw new Error("Cannot encrypt an empty QuickBooks token.");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveEncryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTED_TOKEN_PREFIX.slice(0, -1),
    encryptionKeyId(),
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptQuickBooksToken(envelopeOrPlaintext: string): { value: string; wasEncrypted: boolean } {
  const value = String(envelopeOrPlaintext ?? "");
  if (!isEncryptedQuickBooksToken(value)) return { value, wasEncrypted: false };

  const secret = encryptionSecret();
  if (!secret) {
    throw new Error("QuickBooks token is encrypted, but QUICKBOOKS_TOKEN_ENCRYPTION_KEY/QB_TOKEN_ENCRYPTION_KEY is not configured.");
  }

  const parts = value.split(":");
  if (parts.length !== 6 || `${parts[0]}:${parts[1]}` !== "qbtoken:v1") {
    throw new Error("Invalid QuickBooks encrypted token envelope.");
  }

  const [, , _keyId, ivText, tagText, ciphertextText] = parts;
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveEncryptionKey(secret), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");

  return { value: plaintext, wasEncrypted: true };
}

export function encryptQuickBooksTokenIfConfigured(plaintext: string | null | undefined): string {
  const value = String(plaintext ?? "");
  if (isEncryptedQuickBooksToken(value)) return value;
  return encryptionSecret() && value ? encryptQuickBooksToken(value) : value;
}

export function classifyQuickBooksCredentialError(error: unknown): QuickBooksCredentialErrorCategory {
  if (error instanceof QuickBooksCredentialManagerError) return error.category;
  const diagnostic = extractQuickBooksOAuthDiagnostic(error);
  if (diagnostic.oauthError === "invalid_grant") return "invalid_grant";
  if (diagnostic.oauthError === "invalid_client") return "invalid_client";
  if (diagnostic.oauthError && diagnostic.oauthError.includes("client")) return "configuration_error";
  const message = String((error as any)?.message || error || "").toLowerCase();
  let serialized = "";
  try {
    serialized = JSON.stringify(error).toLowerCase();
  } catch {}
  const haystack = `${message} ${serialized}`;
  // The Intuit SDK can surface this as a plain Error rather than structured
  // OAuth JSON. It is not transient: retrying the same refresh token cannot
  // repair it, and operators need the existing reconnect action.
  if (
    haystack.includes("invalid_grant") ||
    ((haystack.includes("refresh token is invalid") || haystack.includes("invalid refresh token")) &&
      (haystack.includes("authorize again") || haystack.includes("authorise again") || haystack.includes("reauthoriz") || haystack.includes("reconnect")))
  ) {
    return "invalid_grant";
  }
  if (haystack.includes("invalid_client") || haystack.includes("invalid client") || haystack.includes("client_secret")) {
    return "invalid_client";
  }
  if (haystack.includes("quickbooks oauth not configured") || haystack.includes("client id") || haystack.includes("client secret")) {
    return "configuration_error";
  }
  const status = Number((error as any)?.statusCode ?? (error as any)?.status ?? (error as any)?.response?.status);
  if (status === 429 || status >= 500) return "transient_api_failure";
  if (message.includes("timeout") || message.includes("timed out") || message.includes("econnreset") || message.includes("etimedout")) {
    return "network_failure";
  }
  return "unknown";
}

export function mergeQuickBooksRefreshToken(existingRefreshToken: string, token: QuickBooksTokenRefreshResponse): string {
  const next = String(token.refresh_token ?? "").trim();
  return next || existingRefreshToken;
}

function metadataOf(connection: OAuthConnection | null): Record<string, any> {
  return connection?.metadata && typeof connection.metadata === "object" ? { ...(connection.metadata as any) } : {};
}

function qbCredentialMetadata(connection: OAuthConnection | null): Record<string, any> {
  const meta = metadataOf(connection);
  return meta.qbCredential && typeof meta.qbCredential === "object" ? { ...meta.qbCredential } : {};
}

function qbAuthMetadata(connection: OAuthConnection | null): Record<string, any> {
  const meta = metadataOf(connection);
  return meta.qbAuth && typeof meta.qbAuth === "object" ? { ...meta.qbAuth } : {};
}

function qbConnectionMetadata(connection: OAuthConnection | null): Record<string, any> {
  const meta = metadataOf(connection);
  return meta.qbConnection && typeof meta.qbConnection === "object" ? { ...meta.qbConnection } : {};
}

function isSupersededOrDisconnected(connection: OAuthConnection): boolean {
  const connectionMeta = qbConnectionMetadata(connection);
  const credential = qbCredentialMetadata(connection);
  const state = String(connectionMeta.state ?? credential.state ?? "").trim().toLowerCase();
  return state === "superseded" || state === "disconnected";
}

function connectionTimeMs(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? time : 0;
}

function compareConnectionRecency(a: OAuthConnection, b: OAuthConnection): number {
  const updatedDelta = connectionTimeMs(b.updatedAt) - connectionTimeMs(a.updatedAt);
  if (updatedDelta !== 0) return updatedDelta;
  const createdDelta = connectionTimeMs(b.createdAt) - connectionTimeMs(a.createdAt);
  if (createdDelta !== 0) return createdDelta;
  return String(b.id).localeCompare(String(a.id));
}

export function selectAuthoritativeQuickBooksConnection(connections: OAuthConnection[]): OAuthConnection | null {
  const usable = connections.filter((connection) => !isSupersededOrDisconnected(connection));
  if (usable.length === 0) return null;

  const explicitlyAuthoritative = usable.filter((connection) => qbConnectionMetadata(connection).authoritative === true);
  const candidates = explicitlyAuthoritative.length > 0 ? explicitlyAuthoritative : usable;
  return [...candidates].sort(compareConnectionRecency)[0] ?? null;
}

function buildMetadata(connection: OAuthConnection, patch: Record<string, unknown>): Record<string, unknown> {
  const meta = metadataOf(connection);
  return {
    ...meta,
    qbCredential: {
      ...qbCredentialMetadata(connection),
      ...patch,
    },
  };
}

function statusFromConnection(connection: OAuthConnection | null, decrypted: QuickBooksDecryptedConnection | null): QuickBooksConnectionStatus {
  if (!connection || !decrypted) {
    return {
      connected: false,
      state: "disconnected",
      lastSuccessfulRefreshAt: null,
      lastSuccessfulRequestAt: null,
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorStage: null,
      lastErrorHttpStatus: null,
      lastOAuthError: null,
      lastOAuthErrorDescription: null,
      consecutiveTransientFailureCount: 0,
      requiresUserAction: false,
      connection: null,
    };
  }

  const credential = qbCredentialMetadata(connection);
  const auth = qbAuthMetadata(connection);
  const state = auth.state === "needs_reauth"
    ? "needs_reauth"
    : credential.state === "refreshing"
      ? "refreshing"
      : credential.state === "degraded"
        ? "degraded"
        : "connected";

  return {
    connected: state !== "needs_reauth",
    state,
    lastSuccessfulRefreshAt: credential.lastSuccessfulRefreshAt ?? null,
    lastSuccessfulRequestAt: credential.lastSuccessfulRequestAt ?? null,
    lastErrorAt: credential.lastErrorAt ?? auth.latchedAt ?? null,
    lastErrorCode: credential.lastErrorCode ?? (auth.state === "needs_reauth" ? "invalid_grant" : null),
    lastErrorMessage: credential.lastErrorMessage ?? auth.message ?? null,
    lastErrorStage: credential.lastErrorStage ?? null,
    lastErrorHttpStatus: credential.lastErrorHttpStatus ?? null,
    lastOAuthError: credential.lastOAuthError ?? null,
    lastOAuthErrorDescription: credential.lastOAuthErrorDescription ?? null,
    consecutiveTransientFailureCount: Number(credential.consecutiveTransientFailureCount || 0),
    requiresUserAction: state === "needs_reauth",
    connection: decrypted,
  };
}

export class QuickBooksCredentialManager {
  async loadCredentials(organizationId: string): Promise<QuickBooksDecryptedConnection | null> {
    const orgId = requireOrganizationId(organizationId, "loadCredentials");
    credentialLog("info", "loadCredentials.start", { organizationId: orgId, stage: "load_credentials" });
    const connections = await db
      .select()
      .from(oauthConnections)
      .where(and(eq(oauthConnections.provider, "quickbooks"), eq(oauthConnections.organizationId, orgId)))
      .orderBy(desc(oauthConnections.updatedAt), desc(oauthConnections.createdAt));
    const connection = selectAuthoritativeQuickBooksConnection(connections);
    if (!connection) {
      credentialLog("warn", "loadCredentials.not_found", {
        organizationId: orgId,
        stage: "load_credentials",
        connectionFound: false,
        finalCredentialState: "disconnected",
      });
      return null;
    }
    if (connections.length > 1) {
      credentialLog("warn", "loadCredentials.multiple_rows_resolved", {
        organizationId: orgId,
        connectionId: connection.id,
        stage: "load_credentials",
        connectionRowCount: connections.length,
        authoritativeConnectionId: connection.id,
        authoritativeMarked: qbConnectionMetadata(connection).authoritative === true,
      });
    }

    let access: { value: string; wasEncrypted: boolean };
    let refresh: { value: string; wasEncrypted: boolean };
    try {
      access = decryptQuickBooksToken(connection.accessToken);
      refresh = decryptQuickBooksToken(connection.refreshToken);
    } catch (error) {
      const diagnostic = extractQuickBooksOAuthDiagnostic(error);
      credentialLog("error", "loadCredentials.decrypt_failed", {
        organizationId: orgId,
        connectionId: connection.id,
        stage: "decrypt_stored_credentials",
        decryptStatus: "failed",
        errorCategory: "decrypt_failure",
        oauthError: diagnostic.oauthError,
        oauthErrorDescription: diagnostic.oauthErrorDescription,
        message: diagnostic.message,
        finalCredentialState: "degraded",
      });
      throw new QuickBooksCredentialManagerError("QuickBooks stored credentials could not be decrypted.", {
        category: "decrypt_failure",
        stage: "decrypt_stored_credentials",
        organizationId: orgId,
        connectionId: connection.id,
        diagnostic,
        cause: error,
      });
    }
    const decrypted = { ...connection, accessToken: access.value, refreshToken: refresh.value };
    credentialLog("info", "loadCredentials.decrypt_succeeded", {
      organizationId: orgId,
      connectionId: connection.id,
      stage: "decrypt_stored_credentials",
      connectionState: qbCredentialMetadata(connection).state ?? qbAuthMetadata(connection).state ?? "connected",
      accessTokenLoaded: Boolean(access.value),
      refreshTokenLoaded: Boolean(refresh.value),
      accessTokenDecrypted: true,
      refreshTokenDecrypted: true,
      accessTokenWasEncrypted: access.wasEncrypted,
      refreshTokenWasEncrypted: refresh.wasEncrypted,
      accessTokenExpired: this.isExpiredOrExpiring(connection),
    });

    // Do not opportunistically rewrite legacy plaintext rows here. This read
    // path can run concurrently with a token rotation; a late rewrite of the
    // snapshot would restore an obsolete refresh token. The explicit backfill
    // command remains the safe, lock-aware migration path for legacy rows.

    return decrypted;
  }

  async getStatus(organizationId: string): Promise<QuickBooksConnectionStatus> {
    const orgId = requireOrganizationId(organizationId, "getStatus");
    try {
      const connection = await this.loadCredentials(orgId);
      if (!connection) return statusFromConnection(null, null);
      return statusFromConnection(connection, connection);
    } catch (error) {
      const managerError = error as Partial<QuickBooksCredentialManagerError>;
      const diagnostic = managerError.diagnostic ?? extractQuickBooksOAuthDiagnostic(error);
      return {
        connected: false,
        state: "degraded",
        lastSuccessfulRefreshAt: null,
        lastSuccessfulRequestAt: null,
        lastErrorAt: new Date().toISOString(),
        lastErrorCode: managerError.category ?? classifyQuickBooksCredentialError(error),
        lastErrorMessage: getQuickBooksCredentialCauseText(error),
        lastErrorStage: managerError.stage ?? "get_status",
        lastErrorHttpStatus: diagnostic.httpStatus ?? null,
        lastOAuthError: diagnostic.oauthError ?? null,
        lastOAuthErrorDescription: diagnostic.oauthErrorDescription ?? null,
        consecutiveTransientFailureCount: 1,
        requiresUserAction: managerError.category === "invalid_grant",
        connection: null,
      };
    }
  }

  isExpiredOrExpiring(connection: Pick<OAuthConnection, "expiresAt">, now = new Date()): boolean {
    const expiresAt = connection.expiresAt ? new Date(connection.expiresAt) : null;
    return !expiresAt || expiresAt.getTime() <= now.getTime() + REFRESH_WINDOW_MS;
  }

  async getValidAccessToken(
    organizationId: string,
    refreshWithIntuit: (refreshToken: string) => Promise<QuickBooksTokenRefreshResponse>,
    options: { forceRefresh?: boolean } = {},
  ): Promise<string | null> {
    const orgId = requireOrganizationId(organizationId, "getValidAccessToken");
    credentialLog("info", "getValidAccessToken.start", {
      organizationId: orgId,
      stage: "get_valid_access_token",
      forceRefresh: options.forceRefresh === true,
      refreshAttempted: false,
    });
    const connection = await this.loadCredentials(orgId);
    if (!connection) {
      credentialLog("warn", "getValidAccessToken.no_connection", {
        organizationId: orgId,
        stage: "get_valid_access_token",
        connectionFound: false,
        refreshAttempted: false,
        finalCredentialState: "disconnected",
      });
      return null;
    }
    const connectionState = qbAuthMetadata(connection).state ?? qbCredentialMetadata(connection).state ?? "connected";
    const accessTokenExpired = this.isExpiredOrExpiring(connection);
    credentialLog("info", "getValidAccessToken.connection_loaded", {
      organizationId: orgId,
      connectionId: connection.id,
      stage: "get_valid_access_token",
      connectionState,
      accessTokenExpired,
      refreshAttempted: false,
    });
    if (qbAuthMetadata(connection).state === "needs_reauth") {
      credentialLog("warn", "getValidAccessToken.needs_reauth_latched", {
        organizationId: orgId,
        connectionId: connection.id,
        stage: "get_valid_access_token",
        connectionState: "needs_reauth",
        accessTokenExpired,
        refreshAttempted: false,
        finalCredentialState: "needs_reauth",
      });
      throw new QuickBooksCredentialManagerError("QuickBooks authorization requires reconnection.", {
        category: "invalid_grant",
        stage: "get_valid_access_token",
        organizationId: orgId,
        connectionId: connection.id,
        diagnostic: { oauthError: "invalid_grant", oauthErrorDescription: "Stored QuickBooks authorization is latched as needs_reauth." },
      });
    }

    if (!options.forceRefresh && !accessTokenExpired) {
      credentialLog("info", "getValidAccessToken.cached_token_usable", {
        organizationId: orgId,
        connectionId: connection.id,
        stage: "get_valid_access_token",
        connectionState,
        accessTokenExpired: false,
        refreshAttempted: false,
        finalCredentialState: connectionState,
      });
      return connection.accessToken;
    }

    credentialLog("info", "getValidAccessToken.refresh_required", {
      organizationId: orgId,
      connectionId: connection.id,
      stage: "get_valid_access_token",
      connectionState,
      accessTokenExpired,
      refreshAttempted: true,
    });
    const refreshed = await this.refreshCredentials({ organizationId: orgId, connection, refreshWithIntuit, force: options.forceRefresh });
    credentialLog(refreshed ? "info" : "warn", "getValidAccessToken.finished", {
      organizationId: orgId,
      connectionId: connection.id,
      stage: "get_valid_access_token",
      accessTokenExpired,
      refreshAttempted: true,
      finalCredentialState: refreshed ? "connected" : "degraded",
      accessTokenPersisted: Boolean(refreshed),
    });
    return refreshed?.accessToken ?? null;
  }

  async refreshCredentials(input: RefreshCredentialsInput): Promise<QuickBooksDecryptedConnection | null> {
    const orgId = requireOrganizationId(input.organizationId, "refreshCredentials");
    return this.withRefreshLock(orgId, async () => {
      const latest = await this.loadCredentials(orgId);
      if (!latest) return null;
      const connectionState = qbAuthMetadata(latest).state ?? qbCredentialMetadata(latest).state ?? "connected";
      const accessTokenExpired = this.isExpiredOrExpiring(latest);
      credentialLog("info", "refreshCredentials.lock_work_started", {
        organizationId: orgId,
        connectionId: latest.id,
        stage: "refresh_credentials",
        connectionState,
        accessTokenExpired,
        refreshAttempted: false,
      });
      const peerAlreadyRefreshed = input.force && latest.accessToken !== input.connection.accessToken && !accessTokenExpired;
      if ((!input.force && !accessTokenExpired) || peerAlreadyRefreshed) {
        credentialLog("info", "refreshCredentials.skipped_after_lock", {
          organizationId: orgId,
          connectionId: latest.id,
          stage: "refresh_credentials",
          connectionState,
          accessTokenExpired: false,
          refreshAttempted: false,
          peerAlreadyRefreshed,
          finalCredentialState: connectionState,
        });
        return latest;
      }
      if (qbAuthMetadata(latest).state === "needs_reauth") {
        credentialLog("warn", "refreshCredentials.needs_reauth_latched", {
          organizationId: orgId,
          connectionId: latest.id,
          stage: "refresh_credentials",
          connectionState: "needs_reauth",
          accessTokenExpired,
          refreshAttempted: false,
          finalCredentialState: "needs_reauth",
        });
        throw new QuickBooksCredentialManagerError("QuickBooks authorization requires reconnection.", {
          category: "invalid_grant",
          stage: "refresh_credentials",
          organizationId: orgId,
          connectionId: latest.id,
          diagnostic: { oauthError: "invalid_grant", oauthErrorDescription: "Stored QuickBooks authorization is latched as needs_reauth." },
        });
      }

      await this.markRefreshing(orgId, latest);

      let token: QuickBooksTokenRefreshResponse;
      try {
        credentialLog("info", "refreshCredentials.intuit_refresh_started", {
          organizationId: orgId,
          connectionId: latest.id,
          stage: "intuit_refresh",
          connectionState: "refreshing",
          accessTokenExpired,
          refreshAttempted: true,
        });
        token = await input.refreshWithIntuit(latest.refreshToken);
      } catch (error) {
        const category = classifyQuickBooksCredentialError(error);
        const diagnostic = extractQuickBooksOAuthDiagnostic(error);
        credentialLog("error", "refreshCredentials.intuit_refresh_failed", {
          organizationId: orgId,
          connectionId: latest.id,
          stage: "intuit_refresh",
          connectionState: "refreshing",
          accessTokenExpired,
          refreshAttempted: true,
          refreshHttpStatus: diagnostic.httpStatus,
          oauthError: diagnostic.oauthError,
          oauthErrorDescription: diagnostic.oauthErrorDescription,
          responseBody: diagnostic.responseBody,
          finalCredentialState: category === "invalid_grant" ? "needs_reauth" : "degraded",
        });
        if (category === "invalid_grant") {
          await this.markNeedsReauth(orgId, latest, error);
        } else {
          await this.markDegraded(orgId, latest, category, error, "intuit_refresh");
        }
        throw new QuickBooksCredentialManagerError("OAuth refresh failed.", {
          category,
          stage: "intuit_refresh",
          organizationId: orgId,
          connectionId: latest.id,
          diagnostic,
          cause: error,
        });
      }

      const diagnostic = token.__quickBooksOAuthDiagnostic ?? {};
      credentialLog("info", "refreshCredentials.intuit_refresh_succeeded", {
        organizationId: orgId,
        connectionId: latest.id,
        stage: "intuit_refresh",
        connectionState: "refreshing",
        accessTokenExpired,
        refreshAttempted: true,
        refreshHttpStatus: diagnostic.httpStatus,
        oauthError: diagnostic.oauthError,
        oauthErrorDescription: diagnostic.oauthErrorDescription,
      });

      const accessToken = String(token.access_token ?? "").trim();
      if (!accessToken) {
        const error = new QuickBooksCredentialManagerError("QuickBooks refresh response did not include an access token.", {
          category: "refresh_response_error",
          stage: "intuit_refresh_response",
          organizationId: orgId,
          connectionId: latest.id,
          diagnostic,
        });
        await this.markDegraded(orgId, latest, "refresh_response_error", error, "intuit_refresh_response");
        throw error;
      }

      const refreshToken = mergeQuickBooksRefreshToken(latest.refreshToken, token);
      const refreshTokenRotated = String(token.refresh_token ?? "").trim().length > 0 && refreshToken !== latest.refreshToken;
      const refreshTokenPreserved = String(token.refresh_token ?? "").trim().length === 0;
      const expiry = resolveQuickBooksTokenExpiryMetadata(token);
      const existingCredential = qbCredentialMetadata(latest);

      try {
        await this.persistCredentials({
          organizationId: orgId,
          connection: latest,
          accessToken,
          refreshToken,
          expiresAt: expiry.accessExpiresAt,
          metadataPatch: {
            state: "connected",
            lastSuccessfulRefreshAt: new Date().toISOString(),
            lastErrorAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            consecutiveTransientFailureCount: 0,
            ...(refreshTokenRotated || expiry.refreshTokenExpiresAt
              ? {
                  refreshTokenExpiresAt: expiry.refreshTokenExpiresAt,
                  refreshTokenExpiresInSeconds: expiry.refreshTokenExpiresInSeconds,
                }
              : {
                  refreshTokenExpiresAt: existingCredential.refreshTokenExpiresAt ?? null,
                  refreshTokenExpiresInSeconds: existingCredential.refreshTokenExpiresInSeconds ?? null,
                }),
          },
          clearQbAuth: true,
        });
      } catch (error) {
        const persistDiagnostic = extractQuickBooksOAuthDiagnostic(error);
        credentialLog("error", "refreshCredentials.persist_failed", {
          organizationId: orgId,
          connectionId: latest.id,
          stage: "persist_refreshed_credentials",
          accessTokenPersisted: false,
          refreshTokenRotated,
          refreshTokenPreserved,
          errorCategory: "persistence_failure",
          oauthError: persistDiagnostic.oauthError,
          oauthErrorDescription: persistDiagnostic.oauthErrorDescription,
          finalCredentialState: "degraded",
        });
        // Intuit may already have invalidated the previous refresh token. Do
        // not advertise automatic recovery when its replacement could not be
        // durably stored; a reconnect is the only safe recovery path.
        await this.markNeedsReauth(orgId, latest, error, "persistence_failure");
        throw new QuickBooksCredentialManagerError("QuickBooks refreshed credentials could not be persisted.", {
          category: "persistence_failure",
          stage: "persist_refreshed_credentials",
          organizationId: orgId,
          connectionId: latest.id,
          diagnostic: persistDiagnostic,
          cause: error,
        });
      }

      credentialLog("info", "refreshCredentials.persist_succeeded", {
        organizationId: orgId,
        connectionId: latest.id,
        stage: "persist_refreshed_credentials",
        accessTokenPersisted: true,
        refreshTokenRotated,
        refreshTokenPreserved,
        finalCredentialState: "connected",
      });
      return this.loadCredentials(orgId);
    });
  }

  async recordSuccessfulRequest(organizationId: string): Promise<void> {
    const orgId = requireOrganizationId(organizationId, "recordSuccessfulRequest");
    const connection = await this.loadCredentials(orgId);
    if (!connection) return;
    await db.update(oauthConnections)
      .set({
        metadata: buildMetadata(connection, {
          state: "connected",
          lastSuccessfulRequestAt: new Date().toISOString(),
          lastErrorAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          consecutiveTransientFailureCount: 0,
        }) as any,
        updatedAt: new Date(),
      })
      .where(and(eq(oauthConnections.id, connection.id), eq(oauthConnections.organizationId, orgId)));
  }

  async recordTransientFailure(organizationId: string, category: QuickBooksCredentialErrorCategory, error: unknown): Promise<void> {
    const orgId = requireOrganizationId(organizationId, "recordTransientFailure");
    const connection = await this.loadCredentials(orgId);
    if (!connection || qbAuthMetadata(connection).state === "needs_reauth") return;
    await this.markDegraded(orgId, connection, category, error);
  }

  async markNeedsReauth(
    organizationId: string,
    connection: OAuthConnection,
    error: unknown,
    category: QuickBooksCredentialErrorCategory = "invalid_grant",
  ): Promise<void> {
    const orgId = requireOrganizationId(organizationId, "markNeedsReauth");
    const nowIso = new Date().toISOString();
    const diagnostic = extractQuickBooksOAuthDiagnostic(error);
    const message = String(
      diagnostic.oauthError
        ? `OAuth refresh failed. OAuth error: ${diagnostic.oauthError}${diagnostic.oauthErrorDescription ? ` - ${diagnostic.oauthErrorDescription}` : ""}`
        : ((error as any)?.message || error || "QuickBooks authorization is invalid. Reconnect required.")
    ).replace(/\s+/g, " ").trim();
    const meta = metadataOf(connection);
    await db.update(oauthConnections)
      .set({
        metadata: {
          ...meta,
          qbAuth: {
            state: "needs_reauth",
            latchedAt: nowIso,
            reason: category,
            message,
          },
          qbCredential: {
            ...qbCredentialMetadata(connection),
            state: "needs_reauth",
            needsReauthAt: nowIso,
            lastErrorAt: nowIso,
            lastErrorCode: category,
            lastErrorMessage: message,
            lastErrorStage: (error as any)?.stage ?? "intuit_refresh",
            lastErrorHttpStatus: diagnostic.httpStatus ?? null,
            lastOAuthError: diagnostic.oauthError ?? category,
            lastOAuthErrorDescription: diagnostic.oauthErrorDescription ?? null,
          },
        } as any,
        updatedAt: new Date(),
      })
      .where(and(eq(oauthConnections.id, connection.id), eq(oauthConnections.organizationId, orgId)));
  }

  private async markRefreshing(organizationId: string, connection: OAuthConnection): Promise<void> {
    await db.update(oauthConnections)
      .set({
        metadata: buildMetadata(connection, { state: "refreshing", refreshingAt: new Date().toISOString() }) as any,
        updatedAt: new Date(),
      })
      .where(and(eq(oauthConnections.id, connection.id), eq(oauthConnections.organizationId, organizationId)));
  }

  private async markDegraded(organizationId: string, connection: OAuthConnection, category: QuickBooksCredentialErrorCategory, error: unknown, stage = "unknown"): Promise<void> {
    const credential = qbCredentialMetadata(connection);
    const diagnostic = extractQuickBooksOAuthDiagnostic(error);
    const message = String(
      diagnostic.oauthError
        ? `OAuth refresh failed. OAuth error: ${diagnostic.oauthError}${diagnostic.oauthErrorDescription ? ` - ${diagnostic.oauthErrorDescription}` : ""}`
        : ((error as any)?.message || error || "QuickBooks is temporarily unavailable.")
    ).replace(/\s+/g, " ").trim();
    await db.update(oauthConnections)
      .set({
        metadata: buildMetadata(connection, {
          state: "degraded",
          lastRefreshFailureAt: new Date().toISOString(),
          lastErrorAt: new Date().toISOString(),
          lastErrorCode: category,
          lastErrorMessage: message.slice(0, 240),
          lastErrorStage: (error as any)?.stage ?? stage,
          lastErrorHttpStatus: diagnostic.httpStatus ?? null,
          lastOAuthError: diagnostic.oauthError ?? null,
          lastOAuthErrorDescription: diagnostic.oauthErrorDescription ?? null,
          consecutiveTransientFailureCount: Number(credential.consecutiveTransientFailureCount || 0) + 1,
        }) as any,
        updatedAt: new Date(),
      })
      .where(and(eq(oauthConnections.id, connection.id), eq(oauthConnections.organizationId, organizationId)));
  }

  private async persistCredentials(args: {
    organizationId: string;
    connection: OAuthConnection;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date | null;
    metadataPatch: Record<string, unknown>;
    clearQbAuth?: boolean;
  }): Promise<void> {
    if (!String(args.accessToken || "").trim()) {
      throw new Error("Refusing to persist empty QuickBooks access token.");
    }
    if (!String(args.refreshToken || "").trim()) {
      throw new Error("Refusing to persist empty QuickBooks refresh token.");
    }
    const meta = metadataOf(args.connection);
    const { qbAuth: _qbAuth, ...withoutAuth } = meta;
    const nextMeta = args.clearQbAuth ? withoutAuth : meta;
    const updated = await db.update(oauthConnections)
      .set({
        accessToken: encryptQuickBooksTokenIfConfigured(args.accessToken),
        refreshToken: encryptQuickBooksTokenIfConfigured(args.refreshToken),
        expiresAt: args.expiresAt ?? null,
        metadata: {
          ...nextMeta,
          qbCredential: {
            ...qbCredentialMetadata(args.connection),
            credentialGeneration: Number(qbCredentialMetadata(args.connection).credentialGeneration || 0) + 1,
            ...args.metadataPatch,
            encrypted: Boolean(encryptionSecret()),
            encryptionKeyId: encryptionSecret() ? encryptionKeyId() : null,
          },
        } as any,
        updatedAt: new Date(),
      })
      .where(and(eq(oauthConnections.id, args.connection.id), eq(oauthConnections.organizationId, args.organizationId)))
      .returning();

    if (updated.length !== 1) {
      throw new Error(`QuickBooks credential persistence matched ${updated.length} rows; expected exactly 1.`);
    }

    const persisted = updated[0];
    const access = decryptQuickBooksToken(persisted.accessToken);
    const refresh = decryptQuickBooksToken(persisted.refreshToken);
    const persistedMeta = metadataOf(persisted);
    const persistedCredential = qbCredentialMetadata(persisted);
    if (!access.value || !refresh.value) {
      throw new Error("QuickBooks credential persistence verification failed: stored token is empty.");
    }
    if (args.clearQbAuth && persistedMeta.qbAuth) {
      throw new Error("QuickBooks credential persistence verification failed: stale qbAuth metadata remains.");
    }
    if (args.metadataPatch.state === "connected" && persistedCredential.state !== "connected") {
      throw new Error("QuickBooks credential persistence verification failed: connected state was not persisted.");
    }
    if (args.expiresAt && (!persisted.expiresAt || new Date(persisted.expiresAt).getTime() < args.expiresAt.getTime())) {
      throw new Error("QuickBooks credential persistence verification failed: expiration was not advanced.");
    }
  }

  async withRefreshLock<T>(organizationId: string, work: () => Promise<T>, timeoutMs = DEFAULT_LOCK_TIMEOUT_MS): Promise<T> {
    const orgId = requireOrganizationId(organizationId, "withRefreshLock");
    const lockKey = quickBooksCredentialLockKey(orgId);
    const deadline = Date.now() + timeoutMs;

    credentialLog("info", "refreshLock.wait_started", {
      organizationId: orgId,
      stage: "refresh_lock",
      refreshLockAcquired: false,
      timeoutMs,
    });

    while (Date.now() <= deadline) {
      const attempt = await db.transaction(async (tx) => {
        const result: any = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${lockKey})) as locked`);
        const rows = Array.isArray(result) ? result : result?.rows;
        const acquired = Boolean(rows?.[0]?.locked);
        if (!acquired) return { acquired: false as const };

        credentialLog("info", "refreshLock.acquired", {
          organizationId: orgId,
          stage: "refresh_lock",
          refreshLockAcquired: true,
        });
        const value = await work();
        return { acquired: true as const, value };
      });

      if (attempt.acquired) {
        credentialLog("info", "refreshLock.released", {
          organizationId: orgId,
          stage: "refresh_lock",
          refreshLockAcquired: false,
          lockScope: "transaction",
        });
        return attempt.value;
      }

      await new Promise((resolve) => setTimeout(resolve, DEFAULT_LOCK_POLL_MS));
      const latest = await this.loadCredentials(orgId);
      if (latest && !this.isExpiredOrExpiring(latest) && qbCredentialMetadata(latest).state !== "refreshing") {
        credentialLog("info", "refreshLock.peer_refreshed", {
          organizationId: orgId,
          connectionId: latest.id,
          stage: "refresh_lock",
          refreshLockAcquired: false,
          accessTokenExpired: false,
          finalCredentialState: qbCredentialMetadata(latest).state ?? "connected",
        });
        return latest as T;
      }
    }

    const latest = await this.loadCredentials(orgId);
    if (latest && !this.isExpiredOrExpiring(latest)) return latest as T;
    credentialLog("error", "refreshLock.timeout", {
      organizationId: orgId,
      connectionId: latest?.id,
      stage: "refresh_lock",
      refreshLockAcquired: false,
      errorCategory: "lock_timeout",
      finalCredentialState: "degraded",
    });
    await this.recordTransientFailure(orgId, "lock_timeout", new Error("Timed out waiting for QuickBooks credential refresh lock."));
    throw new QuickBooksCredentialManagerError("Timed out waiting for QuickBooks credential refresh lock.", {
      category: "lock_timeout",
      stage: "refresh_lock",
      organizationId: orgId,
      connectionId: latest?.id,
    });
  }
}

export const quickBooksCredentialManager = new QuickBooksCredentialManager();
