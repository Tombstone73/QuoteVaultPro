import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { upsAccountConnections, type UpsAccountConnection } from '@shared/schema';
import { db } from '../../db';
import { decryptAiSecret, encryptAiSecret, isAiSecretEncryptionConfigured } from '../ai/aiSecretsEncryption';
import { FulfillmentHttpError } from '../fulfillment/types';

export type UpsPendingAuthorization = {
  organizationId: string;
  actorId: string;
  encryptedAccountNumber: string;
  state: string;
  codeVerifier: string;
  mode: 'test' | 'live';
  expiresAt: number;
};

type AppConfig = { clientId: string; clientSecret: string; redirectUri: string; mode: 'test' | 'live'; baseUrl: string };
const pendingRefreshes = new Map<string, Promise<string>>();
const safeText = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const asObject = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function appConfig(): AppConfig | null {
  const clientId = safeText(process.env.UPS_CLIENT_ID);
  const clientSecret = safeText(process.env.UPS_CLIENT_SECRET);
  const redirectUri = safeText(process.env.UPS_REDIRECT_URI);
  if (!clientId || !clientSecret || !redirectUri || !isAiSecretEncryptionConfigured()) return null;
  try {
    const callback = new URL(redirectUri);
    if (callback.pathname !== '/api/integrations/ups/callback' || callback.search || callback.hash ||
      (callback.protocol !== 'https:' && !(callback.protocol === 'http:' && callback.hostname === 'localhost'))) return null;
  } catch { return null; }
  const mode = process.env.UPS_ENVIRONMENT === 'production' ? 'live' : 'test';
  return { clientId, clientSecret, redirectUri, mode,
    baseUrl: mode === 'live' ? 'https://onlinetools.ups.com' : 'https://wwwcie.ups.com' };
}

export async function upsConnectionForOrg(organizationId: string): Promise<UpsAccountConnection | null> {
  const [connection] = await db.select().from(upsAccountConnections)
    .where(eq(upsAccountConnections.organizationId, organizationId)).limit(1);
  return connection ?? null;
}

export async function upsConnectionStatus(organizationId: string) {
  const config = appConfig();
  const row = await upsConnectionForOrg(organizationId);
  let accountLast4: string | null = null;
  if (row) {
    try { accountLast4 = decryptAiSecret(row.encryptedAccountNumber).slice(-4); }
    catch { /* Missing/rotated encryption key is reported as unavailable, never leaked. */ }
  }
  const refreshExpired = Boolean(row?.refreshExpiresAt && row.refreshExpiresAt.getTime() <= Date.now());
  const connected = Boolean(config && row?.status === 'connected' && row.mode === config.mode && accountLast4 && !refreshExpired);
  return { configured: Boolean(config), connected, verified: connected && Boolean(row?.verifiedAt),
    mode: config?.mode ?? null, accountLast4, connectedAt: row?.connectedAt ?? null,
    message: !config ? 'UPS developer app, callback, or credential encryption is not configured on this server.'
      : !row ? 'No UPS account connected. An Owner or Admin can authorize an account here.'
      : row.mode !== config.mode ? 'The UPS connection belongs to another UPS environment. Reconnect this account.'
      : row.status !== 'connected' ? 'UPS authorization expired or was revoked. Reconnect this account.'
      : refreshExpired ? 'UPS authorization expired. Reconnect this account.'
      : !accountLast4 ? 'UPS connection cannot be decrypted. Ask an administrator to restore the server encryption key.'
      : row.verifiedAt ? 'UPS account authorization and Rating API access were verified by a successful rate request.'
      : 'UPS authorized this account. Request a rate to verify account number and Rating API access.' };
}

export function startUpsAuthorization(organizationId: string, actorId: string, rawAccountNumber: string) {
  const config = appConfig();
  if (!config) throw new FulfillmentHttpError(409, 'UPS developer app, callback, or credential encryption is not configured.', 'UPS_APP_NOT_CONFIGURED');
  const accountNumber = safeText(rawAccountNumber).toUpperCase();
  if (!/^[A-Z0-9]{6,10}$/.test(accountNumber)) throw new FulfillmentHttpError(400,
    'Enter the UPS shipper/account number (6–10 letters or digits). The number alone does not authorize the account.', 'UPS_ACCOUNT_INVALID');
  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const pending: UpsPendingAuthorization = { organizationId, actorId, encryptedAccountNumber: encryptAiSecret(accountNumber).encrypted, state, codeVerifier,
    mode: config.mode, expiresAt: Date.now() + 10 * 60_000 };
  const url = new URL(`${config.baseUrl}/security/v1/oauth/authorize`);
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri,
    response_type: 'code', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
  return { url: url.toString(), pending };
}

export function validUpsAuthorizationState(pending: UpsPendingAuthorization | undefined, state: unknown,
  organizationId: string, actorId: string): pending is UpsPendingAuthorization {
  if (!pending || typeof state !== 'string' || pending.expiresAt < Date.now() ||
    pending.organizationId !== organizationId || pending.actorId !== actorId ||
    pending.mode !== appConfig()?.mode) return false;
  const supplied = Buffer.from(state);
  const expected = Buffer.from(pending.state);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function completeUpsAuthorization(pending: UpsPendingAuthorization, code: string) {
  const config = appConfig();
  if (!config || config.mode !== pending.mode) throw new FulfillmentHttpError(409, 'UPS app configuration changed. Start connection again.', 'UPS_APP_NOT_CONFIGURED');
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/security/v1/oauth/token`, { method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri,
        code_verifier: pending.codeVerifier, client_id: config.clientId }) });
  } catch { throw new FulfillmentHttpError(503, 'UPS authorization is unavailable. Try connecting again.', 'UPS_AUTH_UNAVAILABLE'); }
  const body = asObject(await response.json().catch(() => ({})));
  const access = safeText(body.access_token);
  const refresh = safeText(body.refresh_token);
  if (!response.ok || !access || !refresh) throw new FulfillmentHttpError(409,
    'UPS did not authorize this connection. Check the developer app callback and try again.', 'UPS_AUTH_FAILED');
  const accessSeconds = Number(body.expires_in);
  const refreshSeconds = Number(body.refresh_token_expires_in);
  const now = new Date();
  const accountNumber = decryptAiSecret(pending.encryptedAccountNumber);
  await db.insert(upsAccountConnections).values({ organizationId: pending.organizationId,
    encryptedAccountNumber: encryptAiSecret(accountNumber).encrypted,
    encryptedAccessToken: encryptAiSecret(access).encrypted,
    encryptedRefreshToken: encryptAiSecret(refresh).encrypted,
    accessExpiresAt: new Date(now.getTime() + (Number.isFinite(accessSeconds) && accessSeconds > 0 ? accessSeconds : 300) * 1000),
    refreshExpiresAt: Number.isFinite(refreshSeconds) && refreshSeconds > 0 ? new Date(now.getTime() + refreshSeconds * 1000) : null,
    mode: config.mode, status: 'connected', verifiedAt: null, connectedAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: upsAccountConnections.organizationId, set: {
      encryptedAccountNumber: encryptAiSecret(accountNumber).encrypted,
      encryptedAccessToken: encryptAiSecret(access).encrypted,
      encryptedRefreshToken: encryptAiSecret(refresh).encrypted,
      accessExpiresAt: new Date(now.getTime() + (Number.isFinite(accessSeconds) && accessSeconds > 0 ? accessSeconds : 300) * 1000),
      refreshExpiresAt: Number.isFinite(refreshSeconds) && refreshSeconds > 0 ? new Date(now.getTime() + refreshSeconds * 1000) : null,
      mode: config.mode, status: 'connected', verifiedAt: null, connectedAt: now, updatedAt: now } });
  return upsConnectionStatus(pending.organizationId);
}

export async function disconnectUps(organizationId: string) {
  await db.delete(upsAccountConnections).where(eq(upsAccountConnections.organizationId, organizationId));
  pendingRefreshes.delete(organizationId);
  return upsConnectionStatus(organizationId);
}

export async function upsRateCredentials(organizationId: string) {
  const config = appConfig();
  const row = await upsConnectionForOrg(organizationId);
  if (!config || !row || row.status !== 'connected' || row.mode !== config.mode) throw new FulfillmentHttpError(409,
    'UPS is not connected for this organization. An Owner or Admin can connect it in Shipping Settings.', 'UPS_NOT_CONNECTED');
  if (row.refreshExpiresAt && row.refreshExpiresAt.getTime() <= Date.now()) throw new FulfillmentHttpError(409,
    'UPS authorization expired. Reconnect the account in Shipping Settings.', 'UPS_RECONNECT_REQUIRED');
  if (row.accessExpiresAt.getTime() > Date.now() + 60_000) {
    return { token: decryptAiSecret(row.encryptedAccessToken), accountNumber: decryptAiSecret(row.encryptedAccountNumber), baseUrl: config.baseUrl, row };
  }
  let pending = pendingRefreshes.get(organizationId);
  if (!pending) {
    pending = refreshAccess(organizationId, row, config);
    pendingRefreshes.set(organizationId, pending);
  }
  try { await pending; }
  finally { if (pendingRefreshes.get(organizationId) === pending) pendingRefreshes.delete(organizationId); }
  // Another process may have refreshed or reconnected the tenant while this request waited.
  // Always pair the account number and token from the same authoritative row.
  const latest = await upsConnectionForOrg(organizationId);
  if (!latest || latest.status !== 'connected' || latest.mode !== config.mode) throw new FulfillmentHttpError(409,
    'UPS connection changed. Request rates again.', 'UPS_CONNECTION_CHANGED');
  return { token: decryptAiSecret(latest.encryptedAccessToken), accountNumber: decryptAiSecret(latest.encryptedAccountNumber),
    baseUrl: config.baseUrl, row: latest };
}

async function refreshAccess(organizationId: string, row: UpsAccountConnection, config: AppConfig): Promise<string> {
  if (row.refreshExpiresAt && row.refreshExpiresAt.getTime() <= Date.now()) throw new FulfillmentHttpError(409,
    'UPS authorization expired. Reconnect the account in Shipping Settings.', 'UPS_RECONNECT_REQUIRED');
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/security/v1/oauth/refresh`, { method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decryptAiSecret(row.encryptedRefreshToken) }) });
  } catch { throw new FulfillmentHttpError(503, 'UPS token refresh is temporarily unavailable. Retry shortly.', 'UPS_AUTH_UNAVAILABLE'); }
  const body = asObject(await response.json().catch(() => ({})));
  const access = safeText(body.access_token);
  const refresh = safeText(body.refresh_token);
  if (!response.ok || !access || !refresh) {
    const latest = await upsConnectionForOrg(organizationId);
    if (latest?.status === 'connected' && latest.mode === row.mode && latest.updatedAt.getTime() !== row.updatedAt.getTime()) {
      return decryptAiSecret(latest.encryptedAccessToken);
    }
    if (response.status === 400 || response.status === 401) {
      await db.update(upsAccountConnections).set({ status: 'needs_reconnect', updatedAt: new Date() })
        .where(and(eq(upsAccountConnections.organizationId, organizationId), eq(upsAccountConnections.updatedAt, row.updatedAt)));
      throw new FulfillmentHttpError(409, 'UPS authorization expired. Reconnect the account in Shipping Settings.', 'UPS_RECONNECT_REQUIRED');
    }
    throw new FulfillmentHttpError(503, 'UPS token refresh is unavailable. Retry shortly.', 'UPS_AUTH_UNAVAILABLE');
  }
  const seconds = Number(body.expires_in);
  const refreshSeconds = Number(body.refresh_token_expires_in);
  const now = new Date();
  const updated = await db.update(upsAccountConnections).set({ encryptedAccessToken: encryptAiSecret(access).encrypted,
    encryptedRefreshToken: encryptAiSecret(refresh).encrypted,
    accessExpiresAt: new Date(now.getTime() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 300) * 1000),
    refreshExpiresAt: Number.isFinite(refreshSeconds) && refreshSeconds > 0 ? new Date(now.getTime() + refreshSeconds * 1000) : row.refreshExpiresAt,
    updatedAt: now }).where(and(eq(upsAccountConnections.organizationId, organizationId),
      eq(upsAccountConnections.updatedAt, row.updatedAt), eq(upsAccountConnections.status, 'connected'))).returning({ organizationId: upsAccountConnections.organizationId });
  if (updated.length) return access;
  const latest = await upsConnectionForOrg(organizationId);
  if (latest?.status === 'connected' && latest.mode === row.mode && latest.updatedAt.getTime() !== row.updatedAt.getTime()) {
    return decryptAiSecret(latest.encryptedAccessToken);
  }
  throw new FulfillmentHttpError(409, 'UPS connection changed. Request rates again.', 'UPS_CONNECTION_CHANGED');
}

export async function markUpsAccountVerified(organizationId: string, row: UpsAccountConnection) {
  await db.update(upsAccountConnections).set({ verifiedAt: new Date() })
    .where(and(eq(upsAccountConnections.organizationId, organizationId),
      eq(upsAccountConnections.connectedAt, row.connectedAt), eq(upsAccountConnections.status, 'connected')));
}
