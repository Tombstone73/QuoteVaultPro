import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { oauthConnections, type OAuthConnection } from "../../shared/schema";

export type QuickBooksConnectionState = "connected" | "refreshing" | "degraded" | "needs_reauth" | "disconnected";

export type QuickBooksCredentialErrorCategory =
  | "invalid_grant"
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
  token_type?: string | null;
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
  return encryptionSecret() && value ? encryptQuickBooksToken(value) : value;
}

export function classifyQuickBooksCredentialError(error: unknown): QuickBooksCredentialErrorCategory {
  const message = String((error as any)?.message || error || "").toLowerCase();
  let serialized = "";
  try {
    serialized = JSON.stringify(error).toLowerCase();
  } catch {}
  const haystack = `${message} ${serialized}`;
  if (haystack.includes("invalid_grant") || haystack.includes("invalid grant") || haystack.includes("revoked")) {
    return "invalid_grant";
  }
  const status = Number((error as any)?.statusCode ?? (error as any)?.status ?? (error as any)?.response?.status);
  if (status === 429 || status >= 500) return "transient_api_failure";
  if (message.includes("timeout") || message.includes("timed out") || message.includes("econnreset") || message.includes("etimedout")) {
    return "transient_refresh_failure";
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
    consecutiveTransientFailureCount: Number(credential.consecutiveTransientFailureCount || 0),
    requiresUserAction: state === "needs_reauth",
    connection: decrypted,
  };
}

export class QuickBooksCredentialManager {
  async loadCredentials(organizationId: string): Promise<QuickBooksDecryptedConnection | null> {
    const orgId = requireOrganizationId(organizationId, "loadCredentials");
    const [connection] = await db
      .select()
      .from(oauthConnections)
      .where(and(eq(oauthConnections.provider, "quickbooks"), eq(oauthConnections.organizationId, orgId)))
      .orderBy(desc(oauthConnections.createdAt))
      .limit(1);
    if (!connection) return null;

    const access = decryptQuickBooksToken(connection.accessToken);
    const refresh = decryptQuickBooksToken(connection.refreshToken);
    const decrypted = { ...connection, accessToken: access.value, refreshToken: refresh.value };

    if ((!access.wasEncrypted || !refresh.wasEncrypted) && encryptionSecret()) {
      await this.persistCredentials({
        organizationId: orgId,
        connection: decrypted,
        accessToken: decrypted.accessToken,
        refreshToken: decrypted.refreshToken,
        expiresAt: connection.expiresAt,
        metadataPatch: {
          encryptedAt: new Date().toISOString(),
          plaintextCompatibilityRewriteAt: new Date().toISOString(),
        },
      });
    }

    return decrypted;
  }

  async getStatus(organizationId: string): Promise<QuickBooksConnectionStatus> {
    const orgId = requireOrganizationId(organizationId, "getStatus");
    const connection = await this.loadCredentials(orgId);
    if (!connection) return statusFromConnection(null, null);
    return statusFromConnection(connection, connection);
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
    const connection = await this.loadCredentials(orgId);
    if (!connection) return null;
    if (qbAuthMetadata(connection).state === "needs_reauth") return null;

    if (!options.forceRefresh && !this.isExpiredOrExpiring(connection)) {
      return connection.accessToken;
    }

    const refreshed = await this.refreshCredentials({ organizationId: orgId, connection, refreshWithIntuit, force: options.forceRefresh });
    return refreshed?.accessToken ?? null;
  }

  async refreshCredentials(input: RefreshCredentialsInput): Promise<QuickBooksDecryptedConnection | null> {
    const orgId = requireOrganizationId(input.organizationId, "refreshCredentials");
    return this.withRefreshLock(orgId, async () => {
      const latest = await this.loadCredentials(orgId);
      if (!latest) return null;
      if (!input.force && !this.isExpiredOrExpiring(latest)) return latest;
      if (qbAuthMetadata(latest).state === "needs_reauth") return null;

      await this.markRefreshing(orgId, latest);

      try {
        const token = await input.refreshWithIntuit(latest.refreshToken);
        const accessToken = String(token.access_token ?? "").trim();
        if (!accessToken) throw new Error("QuickBooks refresh response did not include an access token.");
        const refreshToken = mergeQuickBooksRefreshToken(latest.refreshToken, token);
        const expiresAt = new Date(Date.now() + (Number(token.expires_in || 3600) * 1000));
        await this.persistCredentials({
          organizationId: orgId,
          connection: latest,
          accessToken,
          refreshToken,
          expiresAt,
          metadataPatch: {
            state: "connected",
            lastSuccessfulRefreshAt: new Date().toISOString(),
            lastErrorAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            consecutiveTransientFailureCount: 0,
          },
          clearQbAuth: true,
        });
        return this.loadCredentials(orgId);
      } catch (error) {
        const category = classifyQuickBooksCredentialError(error);
        if (category === "invalid_grant") {
          await this.markNeedsReauth(orgId, latest, error);
        } else {
          await this.markDegraded(orgId, latest, category, error);
        }
        return null;
      }
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

  async markNeedsReauth(organizationId: string, connection: OAuthConnection, error: unknown): Promise<void> {
    const orgId = requireOrganizationId(organizationId, "markNeedsReauth");
    const nowIso = new Date().toISOString();
    const message = String((error as any)?.message || error || "QuickBooks authorization is invalid. Reconnect required.").replace(/\s+/g, " ").trim();
    const meta = metadataOf(connection);
    await db.update(oauthConnections)
      .set({
        metadata: {
          ...meta,
          qbAuth: {
            state: "needs_reauth",
            latchedAt: nowIso,
            reason: "invalid_grant",
            message,
          },
          qbCredential: {
            ...qbCredentialMetadata(connection),
            state: "needs_reauth",
            needsReauthAt: nowIso,
            lastErrorAt: nowIso,
            lastErrorCode: "invalid_grant",
            lastErrorMessage: message,
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

  private async markDegraded(organizationId: string, connection: OAuthConnection, category: QuickBooksCredentialErrorCategory, error: unknown): Promise<void> {
    const credential = qbCredentialMetadata(connection);
    const message = String((error as any)?.message || error || "QuickBooks is temporarily unavailable.").replace(/\s+/g, " ").trim();
    await db.update(oauthConnections)
      .set({
        metadata: buildMetadata(connection, {
          state: "degraded",
          lastRefreshFailureAt: new Date().toISOString(),
          lastErrorAt: new Date().toISOString(),
          lastErrorCode: category,
          lastErrorMessage: message.slice(0, 240),
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
    const meta = metadataOf(args.connection);
    const { qbAuth: _qbAuth, ...withoutAuth } = meta;
    const nextMeta = args.clearQbAuth ? withoutAuth : meta;
    await db.update(oauthConnections)
      .set({
        accessToken: encryptQuickBooksTokenIfConfigured(args.accessToken),
        refreshToken: encryptQuickBooksTokenIfConfigured(args.refreshToken),
        expiresAt: args.expiresAt ?? null,
        metadata: {
          ...nextMeta,
          qbCredential: {
            ...qbCredentialMetadata(args.connection),
            ...args.metadataPatch,
            encrypted: Boolean(encryptionSecret()),
            encryptionKeyId: encryptionSecret() ? encryptionKeyId() : null,
          },
        } as any,
        updatedAt: new Date(),
      })
      .where(and(eq(oauthConnections.id, args.connection.id), eq(oauthConnections.organizationId, args.organizationId)));
  }

  async withRefreshLock<T>(organizationId: string, work: () => Promise<T>, timeoutMs = DEFAULT_LOCK_TIMEOUT_MS): Promise<T> {
    const orgId = requireOrganizationId(organizationId, "withRefreshLock");
    const lockKey = `quickbooks_oauth_refresh:${orgId}`;
    const deadline = Date.now() + timeoutMs;
    let acquired = false;

    while (Date.now() <= deadline) {
      const result: any = await db.execute(sql`select pg_try_advisory_lock(hashtext(${lockKey})) as locked`);
      const rows = Array.isArray(result) ? result : result?.rows;
      acquired = Boolean(rows?.[0]?.locked);
      if (acquired) break;
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_LOCK_POLL_MS));
      const latest = await this.loadCredentials(orgId);
      if (latest && !this.isExpiredOrExpiring(latest) && qbCredentialMetadata(latest).state !== "refreshing") {
        return latest as T;
      }
    }

    if (!acquired) {
      const latest = await this.loadCredentials(orgId);
      if (latest && !this.isExpiredOrExpiring(latest)) return latest as T;
      await this.recordTransientFailure(orgId, "lock_timeout", new Error("Timed out waiting for QuickBooks credential refresh lock."));
      return null as T;
    }

    try {
      return await work();
    } finally {
      try {
        await db.execute(sql`select pg_advisory_unlock(hashtext(${lockKey}))`);
      } catch (error) {
        console.error("[QB Credentials] Failed to release refresh lock", {
          organizationId: orgId,
          operation: "releaseRefreshLock",
          errorCategory: "lock_timeout",
          message: (error as any)?.message || String(error),
        });
      }
    }
  }
}

export const quickBooksCredentialManager = new QuickBooksCredentialManager();
