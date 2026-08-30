import OAuthClient from 'intuit-oauth';
import crypto from 'crypto';
import { db } from './db';
import { oauthConnections, accountingSyncJobs, auditLogs, customers, customerContacts, customerContactLinks, invoices, orders, payments, invoiceLineItems, type OAuthConnection } from '../shared/schema';
import { getBillableBundleRoots } from './services/lineItemBundles';
import { eq, and, asc, desc, or, isNull, isNotNull, sql } from 'drizzle-orm';
import type { Customer } from '../shared/schema';
import { generateNextInvoiceNumber } from './invoicesService';
import { buildDocumentNumberParts } from './services/documentNumberingService';
import { resolveHistoricalQuickBooksInvoiceNumber } from '../shared/quickBooksHistoricalNumbering';
import { findHistoricalQuickBooksInvoiceNumberConflicts } from './services/quickBooksHistoricalInvoiceNumbering.service';
import { isSuspiciousContactName, deriveQBContactName } from './lib/qbContactHelpers';
import { fetchAllQBEntities } from './lib/qbPaginationHelper';
import { buildQuickBooksInvoiceLinePayloads } from './lib/downstreamEffectivePricing';
import { mapLocalCustomerToQB } from './lib/quickbooksCustomerMapping';
import {
  resolveBillingCustomerForOrder,
  writeContactAccountingPromotionAudit,
} from './services/contactAccountingPromotionService';
import {
  classifyQuickBooksCredentialError,
  encryptQuickBooksTokenIfConfigured,
  extractQuickBooksOAuthDiagnostic,
  getQuickBooksCredentialCauseText,
  quickBooksCredentialManager,
  selectAuthoritativeQuickBooksConnection,
  type QuickBooksConnectionState,
  type QuickBooksCredentialErrorCategory,
} from './services/quickbooksCredentialManager';

export { mapLocalCustomerToQB } from './lib/quickbooksCustomerMapping';

// Initialize QuickBooks OAuth client
const getOAuthClient = (): any => {
  // Support both QUICKBOOKS_* and QB_* environment variable naming schemes
  const clientId = process.env.QUICKBOOKS_CLIENT_ID || process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET || process.env.QB_CLIENT_SECRET;
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || process.env.QB_REDIRECT_URI;
  const environment = process.env.QUICKBOOKS_ENVIRONMENT || process.env.QB_ENV || 'sandbox';

  if (!clientId || !clientSecret || !redirectUri) {
    const missing: string[] = [];
    if (!clientId) missing.push('QUICKBOOKS_CLIENT_ID/QB_CLIENT_ID');
    if (!clientSecret) missing.push('QUICKBOOKS_CLIENT_SECRET/QB_CLIENT_SECRET');
    if (!redirectUri) missing.push('QUICKBOOKS_REDIRECT_URI/QB_REDIRECT_URI');
    console.warn('[QuickBooks] OAuth credentials not configured. Missing:', missing.join(', '));
    return null;
  }

  return new OAuthClient({
    clientId,
    clientSecret,
    environment: environment as 'sandbox' | 'production',
    redirectUri,
  });
};

function qbLogsEnabled(): boolean {
  return String(process.env.QB_DEBUG_LOGS || '').trim() === '1';
}

export type QuickBooksAuthState = 'connected' | 'not_connected' | 'needs_reauth';

export type QuickBooksHealthState = 'ok' | 'transient_error';

type QuickBooksAuthMetadata = {
  state?: QuickBooksAuthState;
  latchedAt?: string;
  reason?: string;
  message?: string;
};

type QuickBooksHealthMetadata = {
  state?: QuickBooksHealthState;
  lastErrorAt?: string;
  message?: string;
};

function toOneLineTruncatedMessage(input: unknown, maxLen = 220): string {
  const text = String(input || '')
    .replace(/\s+/g, ' ')
    .replace(/\u0000/g, '')
    .trim();
  if (!text) return 'QuickBooks error';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
}

function getQuickBooksAuthMetadata(connection: OAuthConnection | null): QuickBooksAuthMetadata | null {
  if (!connection) return null;
  const meta = (connection.metadata as any) || null;
  const qbAuth = meta?.qbAuth || null;
  if (!qbAuth || typeof qbAuth !== 'object') return null;
  return qbAuth as QuickBooksAuthMetadata;
}

function getQuickBooksHealthMetadata(connection: OAuthConnection | null): QuickBooksHealthMetadata | null {
  if (!connection) return null;
  const meta = (connection.metadata as any) || null;
  const qbHealth = meta?.qbHealth || null;
  if (!qbHealth || typeof qbHealth !== 'object') return null;
  return qbHealth as QuickBooksHealthMetadata;
}

function isTransientQuickBooksHttpStatus(status: number): boolean {
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

function isTransientNetworkError(error: unknown): boolean {
  const code = String((error as any)?.code || (error as any)?.cause?.code || '').toUpperCase();
  const message = String((error as any)?.message || error || '').toLowerCase();

  // undici / fetch timeout-ish
  if (message.includes('timeout') || message.includes('timed out')) return true;
  if (code.includes('TIMEOUT')) return true;

  // common network failures
  if (['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) return true;
  if (code.startsWith('UND_ERR_')) return true;

  return false;
}

function requireQuickBooksOrganizationId(organizationId: string | undefined | null, operation: string): string {
  const orgId = String(organizationId ?? '').trim();
  if (!orgId) {
    console.error('[QuickBooks] Missing organizationId for tenant-scoped operation', { operation, errorCategory: 'tenant_context_missing' });
    throw new Error(`QuickBooks ${operation} requires organizationId`);
  }
  return orgId;
}

async function refreshQuickBooksTokenWithDiagnostics(oauthClient: any, refreshToken: string, organizationId: string, stage: string) {
  try {
    oauthClient.setToken({
      refresh_token: refreshToken,
    } as any);
    const authResponse = await oauthClient.refresh();
    const diagnostic = extractQuickBooksOAuthDiagnostic(authResponse);
    console.log('[QuickBooks] OAuth refresh succeeded', {
      organizationId,
      stage,
      refreshHttpStatus: diagnostic.httpStatus,
      oauthError: diagnostic.oauthError,
      oauthErrorDescription: diagnostic.oauthErrorDescription,
      hasAccessToken: Boolean(authResponse?.token?.access_token),
      refreshTokenRotated: Boolean(authResponse?.token?.refresh_token),
    });
    return {
      ...authResponse.token,
      __quickBooksOAuthDiagnostic: diagnostic,
    };
  } catch (error) {
    const diagnostic = extractQuickBooksOAuthDiagnostic(error);
    console.error('[QuickBooks] OAuth refresh failed', {
      organizationId,
      stage,
      refreshHttpStatus: diagnostic.httpStatus,
      oauthError: diagnostic.oauthError,
      oauthErrorDescription: diagnostic.oauthErrorDescription,
      responseBody: diagnostic.responseBody,
      message: diagnostic.message,
    });
    throw error;
  }
}

async function setQuickBooksTransientHealthError(params: {
  organizationId: string;
  connection: OAuthConnection;
  message: string;
}): Promise<void> {
  const { organizationId, connection, message } = params;
  const qbAuth = getQuickBooksAuthMetadata(connection);
  if (qbAuth?.state === 'needs_reauth') return;

  const nowIso = new Date().toISOString();
  const nextMessage = toOneLineTruncatedMessage(message);
  const existingMeta = (connection.metadata as any) || {};
  const existingHealth = (existingMeta?.qbHealth as any) || null;
  const existingAt = existingHealth?.lastErrorAt ? Date.parse(String(existingHealth.lastErrorAt)) : NaN;

  // Avoid hammering DB if it's the same message repeatedly within ~60s.
  if (
    existingHealth?.state === 'transient_error' &&
    String(existingHealth?.message || '') === nextMessage &&
    Number.isFinite(existingAt) &&
    Date.now() - existingAt < 60_000
  ) {
    return;
  }

  const nextMetadata = {
    ...existingMeta,
    qbHealth: {
      state: 'transient_error',
      lastErrorAt: nowIso,
      message: nextMessage,
    } satisfies QuickBooksHealthMetadata,
  };

  await db
    .update(oauthConnections)
    .set({
      metadata: nextMetadata as any,
      updatedAt: new Date(),
    })
    .where(and(eq(oauthConnections.id, connection.id), eq(oauthConnections.organizationId, organizationId)));
}

async function clearQuickBooksTransientHealth(params: { organizationId: string; connection: OAuthConnection }): Promise<void> {
  const { organizationId, connection } = params;
  const existingMeta = (connection.metadata as any) || {};
  if (!existingMeta?.qbHealth) return;

  const { qbHealth: _qbHealth, ...rest } = existingMeta;
  await db
    .update(oauthConnections)
    .set({
      metadata: rest as any,
      updatedAt: new Date(),
    })
    .where(and(eq(oauthConnections.id, connection.id), eq(oauthConnections.organizationId, organizationId)));
}

export async function getQuickBooksAuthStateForOrganization(organizationId: string): Promise<{
  authState: QuickBooksAuthState;
  message?: string;
  connection: OAuthConnection | null;
}> {
  const connection = await getActiveConnection(organizationId);
  if (!connection) return { authState: 'not_connected', message: 'QuickBooks not connected', connection: null };

  const qbAuth = getQuickBooksAuthMetadata(connection);
  if (qbAuth?.state === 'needs_reauth') {
    return {
      authState: 'needs_reauth',
      message: qbAuth.message || 'QuickBooks connection needs reauthorization',
      connection,
    };
  }

  return { authState: 'connected', connection };
}

export async function isQuickBooksReauthRequiredForOrganization(organizationId: string): Promise<{ needsReauth: boolean; message?: string }> {
  const connection = await getActiveConnection(organizationId);
  const qbAuth = getQuickBooksAuthMetadata(connection);
  if (qbAuth?.state === 'needs_reauth') return { needsReauth: true, message: qbAuth.message };
  return { needsReauth: false };
}

function shouldLatchQuickBooksReauth(error: unknown): boolean {
  const message = String((error as any)?.message || error || '').toLowerCase();
  const category = String((error as any)?.category || (error as any)?.errorCategory || '').toLowerCase();
  if (category === 'invalid_grant' || message.includes('invalid_grant') || message.includes('invalid grant') || message.includes('refresh token is invalid')) return true;

  try {
    const raw = JSON.stringify(error);
    const haystack = `${message} ${raw}`.toLowerCase();
    if (haystack.includes('invalid_grant') || haystack.includes('invalid grant')) return true;
  } catch {}

  return false;
}

async function latchQuickBooksNeedsReauth(params: { organizationId: string; connection: OAuthConnection; error: unknown }): Promise<void> {
  const { organizationId, connection, error } = params;
  const message = String((error as any)?.message || error || 'QuickBooks refresh token is invalid').replace(/\s+/g, ' ').trim();
  const existing = (connection.metadata as any) || {};
  const nextMetadata = {
    ...existing,
    qbAuth: {
      state: 'needs_reauth',
      latchedAt: new Date().toISOString(),
      reason: 'invalid_grant',
      message: message || 'QuickBooks refresh token is invalid. Reconnect required.',
    } satisfies QuickBooksAuthMetadata,
  };

  await db
    .update(oauthConnections)
    .set({
      metadata: nextMetadata as any,
      updatedAt: new Date(),
    })
    .where(and(eq(oauthConnections.id, connection.id), eq(oauthConnections.organizationId, organizationId)));
}

function buildOAuthState(organizationId: string): string {
  const secret = String(process.env.SESSION_SECRET || '').trim();
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  const ts = Date.now();
  const data = `${organizationId}:${ts}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex').slice(0, 32);
  return `qvp:${organizationId}:${ts}:${sig}`;
}

export function parseOAuthState(state: string | undefined | null): { organizationId: string } | null {
  if (!state || typeof state !== 'string') {
    if (qbLogsEnabled()) console.log('[QB OAuth] parseOAuthState: missing or invalid state parameter');
    return null;
  }
  const parts = state.split(':');
  if (parts.length !== 4) {
    if (qbLogsEnabled()) console.log('[QB OAuth] parseOAuthState: state format invalid (expected 4 parts)', { parts: parts.length });
    return null;
  }
  const [prefix, organizationId, tsRaw, sig] = parts;
  if (prefix !== 'qvp') {
    if (qbLogsEnabled()) console.log('[QB OAuth] parseOAuthState: invalid prefix', { prefix });
    return null;
  }
  if (!organizationId) {
    if (qbLogsEnabled()) console.log('[QB OAuth] parseOAuthState: missing organizationId');
    return null;
  }

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || ts <= 0) {
    if (qbLogsEnabled()) console.log('[QB OAuth] parseOAuthState: invalid timestamp', { tsRaw });
    return null;
  }

  // 30 minute window for OAuth redirect round-trip.
  const ageMs = Date.now() - ts;
  if (ageMs < 0 || ageMs > 30 * 60 * 1000) {
    if (qbLogsEnabled()) console.log('[QB OAuth] parseOAuthState: state expired', { ageMs: Math.round(ageMs / 1000), maxAgeSeconds: 1800 });
    return null;
  }

  const secret = String(process.env.SESSION_SECRET || '').trim();
  if (!secret) {
    if (qbLogsEnabled()) console.log('[QB OAuth] parseOAuthState: SESSION_SECRET not configured');
    return null;
  }

  const data = `${organizationId}:${ts}`;
  const expected = crypto.createHmac('sha256', secret).update(data).digest('hex').slice(0, 32);
  if (expected !== sig) {
    if (qbLogsEnabled()) console.log('[QB OAuth] parseOAuthState: signature mismatch');
    return null;
  }

  if (qbLogsEnabled()) {
    console.log('[QB OAuth] parseOAuthState: valid state', { organizationId, ageSeconds: Math.round(ageMs / 1000) });
  }

  return { organizationId };
}

/**
 * Get the active QuickBooks OAuth connection for the company
 */
export async function getActiveConnection(organizationId: string) {
  const orgId = requireQuickBooksOrganizationId(organizationId, 'getActiveConnection');
  const connections = await db
    .select()
    .from(oauthConnections)
    .where(and(eq(oauthConnections.provider, 'quickbooks'), eq(oauthConnections.organizationId, orgId)))
    .orderBy(desc(oauthConnections.updatedAt), desc(oauthConnections.createdAt));

  return selectAuthoritativeQuickBooksConnection(connections);
}

/**
 * Generate OAuth authorization URL to redirect user to QuickBooks login
 */
export async function getAuthorizationUrl(): Promise<string> {
  throw new Error('QuickBooks authorization URL requires organizationId. Use getAuthorizationUrlForOrganization.');
}

export async function getAuthorizationUrlForOrganization(organizationId: string): Promise<string> {
  const oauthClient = getOAuthClient();
  if (!oauthClient) {
    throw new Error('QuickBooks OAuth not configured');
  }

  const orgId = requireQuickBooksOrganizationId(organizationId, 'getAuthorizationUrlForOrganization');
  const state = buildOAuthState(orgId);

  const authUrl = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state,
  });

  if (qbLogsEnabled()) {
    console.log('[QB OAuth] Authorization URL generated', {
      organizationId: orgId,
      state: state.slice(0, 20) + '...',
      environment: process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox',
    });
  }

  return authUrl;
}

/**
 * Exchange authorization code for access/refresh tokens
 */
export async function exchangeCodeForTokens(
  parseRedirectUrl: string,
  realmId: string,
  organizationId?: string
): Promise<void> {
  const oauthClient = getOAuthClient();
  if (!oauthClient) {
    throw new Error('QuickBooks OAuth not configured');
  }

  const orgId = requireQuickBooksOrganizationId(organizationId, 'exchangeCodeForTokens');

  // Debug logging for token exchange configuration (gated by DEBUG_QB_OAUTH)
  if (process.env.DEBUG_QB_OAUTH === 'true') {
    const resolvedRedirectUri = process.env.QUICKBOOKS_REDIRECT_URI || process.env.QB_REDIRECT_URI;
    const resolvedEnvironment = process.env.QUICKBOOKS_ENVIRONMENT || process.env.QB_ENV || 'sandbox';
    const resolvedClientId = process.env.QUICKBOOKS_CLIENT_ID || process.env.QB_CLIENT_ID;
    const resolvedClientSecret = process.env.QUICKBOOKS_CLIENT_SECRET || process.env.QB_CLIENT_SECRET;
    console.log('[QB OAuth] Token exchange configuration', {
      redirectUriUsed: resolvedRedirectUri,
      environmentUsed: resolvedEnvironment,
      hasClientId: !!resolvedClientId,
      hasClientSecret: !!resolvedClientSecret,
      clientIdLength: resolvedClientId?.length || 0,
      organizationId: orgId,
      hasFullCallbackUrl: !!parseRedirectUrl,
    });
  }

  // Always-on safe diagnostic log — never logs tokens or secrets.
  {
    const cfgUri = process.env.QUICKBOOKS_REDIRECT_URI || process.env.QB_REDIRECT_URI || '';
    let cfgHost = '(not set)'; let cfgPath = '(not set)'; let cbHost = '(parse error)'; let hostMatch = false;
    try { if (cfgUri) { const u = new URL(cfgUri); cfgHost = u.host; cfgPath = u.pathname; } } catch { cfgHost = '(parse error)'; }
    try { const u = new URL(parseRedirectUrl); cbHost = u.host; hostMatch = cbHost === cfgHost; } catch {}
    console.log('[QB OAuth] Token exchange starting', {
      environment: process.env.QUICKBOOKS_ENVIRONMENT || process.env.QB_ENV || 'sandbox (default)',
      hasClientId: !!(process.env.QUICKBOOKS_CLIENT_ID || process.env.QB_CLIENT_ID),
      hasClientSecret: !!(process.env.QUICKBOOKS_CLIENT_SECRET || process.env.QB_CLIENT_SECRET),
      configuredRedirectUriHost: cfgHost,
      configuredRedirectUriPath: cfgPath,
      constructedCallbackHost: cbHost,
      redirectUriHostMatch: hostMatch,
      organizationId: orgId,
      realmIdPresent: !!realmId,
    });
  }

  if (qbLogsEnabled()) {
    console.log('[QB OAuth] Exchanging authorization code', {
      organizationId: orgId,
      realmId,
    });
  }

  // Exchange code for tokens - pass full callback URL with query params
  const authResponse = await oauthClient.createToken(parseRedirectUrl);
  const token = authResponse.token;
  const accessToken = String(token.access_token ?? '').trim();
  const refreshToken = String(token.refresh_token ?? '').trim();
  const expiresAt = new Date(Date.now() + (Number(token.expires_in || 3600) * 1000));

  if (!accessToken) {
    throw new Error('QuickBooks token exchange did not return an access token');
  }
  if (!refreshToken) {
    throw new Error('QuickBooks token exchange did not return a refresh token');
  }

  if (qbLogsEnabled()) {
    console.log('[QB OAuth] Tokens received', {
      organizationId: orgId,
      realmId,
      hasAccessToken: !!token.access_token,
      hasRefreshToken: !!token.refresh_token,
      expiresIn: token.expires_in,
    });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  let storedConnectionId: string | null = null;

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`quickbooks_oauth_connection:${orgId}`}))`);

    const existingConnections = await tx
      .select()
      .from(oauthConnections)
      .where(and(eq(oauthConnections.provider, 'quickbooks'), eq(oauthConnections.organizationId, orgId)))
      .orderBy(desc(oauthConnections.updatedAt), desc(oauthConnections.createdAt));
    const existingAuthoritative = selectAuthoritativeQuickBooksConnection(existingConnections);
    const baseMetadata = existingAuthoritative?.metadata && typeof existingAuthoritative.metadata === 'object'
      ? { ...(existingAuthoritative.metadata as any) }
      : {};
    const { qbAuth: _qbAuth, qbHealth: _qbHealth, qbCredential: _qbCredential, qbConnection: existingQbConnection, ...restMetadata } = baseMetadata;
    const connectedAt = typeof existingQbConnection?.connectedAt === 'string' && existingQbConnection.connectedAt
      ? existingQbConnection.connectedAt
      : nowIso;
    const metadata = {
      ...restMetadata,
      realmId,
      tokenType: token.token_type,
      qbConnection: {
        ...(existingQbConnection && typeof existingQbConnection === 'object' ? existingQbConnection : {}),
        authoritative: true,
        state: 'connected',
        connectedAt,
        reauthorizedAt: nowIso,
      },
      qbCredential: {
        state: 'connected',
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
      },
    };

    const values = {
      provider: 'quickbooks' as const,
      accessToken: encryptQuickBooksTokenIfConfigured(accessToken),
      refreshToken: encryptQuickBooksTokenIfConfigured(refreshToken),
      expiresAt,
      companyId: realmId,
      organizationId: orgId,
      metadata: metadata as any,
      updatedAt: now,
    };

    const [stored] = existingAuthoritative
      ? await tx
        .update(oauthConnections)
        .set(values)
        .where(and(eq(oauthConnections.id, existingAuthoritative.id), eq(oauthConnections.organizationId, orgId)))
        .returning()
      : await tx
        .insert(oauthConnections)
        .values({
          ...values,
          createdAt: now,
        })
        .returning();

    if (!stored) {
      throw new Error('QuickBooks OAuth connection persistence matched zero rows');
    }
    storedConnectionId = stored.id;

    for (const staleConnection of existingConnections) {
      if (staleConnection.id === stored.id) continue;
      const staleMeta = staleConnection.metadata && typeof staleConnection.metadata === 'object'
        ? { ...(staleConnection.metadata as any) }
        : {};
      const staleQbConnection = staleMeta.qbConnection && typeof staleMeta.qbConnection === 'object'
        ? staleMeta.qbConnection
        : {};
      await tx
        .update(oauthConnections)
        .set({
          metadata: {
            ...staleMeta,
            qbConnection: {
              ...staleQbConnection,
              authoritative: false,
              state: 'superseded',
              supersededAt: nowIso,
              supersededByConnectionId: stored.id,
            },
          } as any,
          updatedAt: now,
        })
        .where(and(eq(oauthConnections.id, staleConnection.id), eq(oauthConnections.organizationId, orgId)));
    }
  });

  if (!storedConnectionId) {
    throw new Error('QuickBooks OAuth connection was not persisted');
  }

  if (qbLogsEnabled()) {
    console.log('[QB OAuth] Connection stored successfully', { organizationId: orgId, realmId, connectionId: storedConnectionId });
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(): Promise<boolean> {
  throw new Error('QuickBooks token refresh requires organizationId. Use refreshAccessTokenForOrganization.');
}

export async function refreshAccessTokenForOrganization(organizationId: string): Promise<boolean> {
  const oauthClient = getOAuthClient();
  if (!oauthClient) {
    throw new Error('QuickBooks OAuth not configured');
  }

  const orgId = requireQuickBooksOrganizationId(organizationId, 'refreshAccessTokenForOrganization');
  const refreshed = await quickBooksCredentialManager.getValidAccessToken(
    orgId,
    async (refreshToken) => {
      return refreshQuickBooksTokenWithDiagnostics(oauthClient, refreshToken, orgId, 'refreshAccessTokenForOrganization');
    },
    { forceRefresh: true },
  );
  return Boolean(refreshed);
}

async function refreshQuickBooksCredentialsForRequest(organizationId: string, forceRefresh = false): Promise<string | null> {
  const oauthClient = getOAuthClient();
  if (!oauthClient) {
    throw new Error('QuickBooks OAuth not configured');
  }
  const orgId = requireQuickBooksOrganizationId(organizationId, 'refreshQuickBooksCredentialsForRequest');
  return quickBooksCredentialManager.getValidAccessToken(
    orgId,
    async (refreshToken) => {
      return refreshQuickBooksTokenWithDiagnostics(oauthClient, refreshToken, orgId, 'refreshQuickBooksCredentialsForRequest');
    },
    { forceRefresh },
  );
}

/**
 * Get valid access token (refresh if needed)
 */
export async function getValidAccessToken(): Promise<string | null> {
  throw new Error('QuickBooks access token lookup requires organizationId. Use getValidAccessTokenForOrganization.');
}

export async function getValidAccessTokenForOrganization(organizationId: string): Promise<string | null> {
  return refreshQuickBooksCredentialsForRequest(organizationId, false);
}

/**
 * Disconnect QuickBooks integration
 */
export async function disconnectConnection(): Promise<void> {
  throw new Error('QuickBooks disconnect requires organizationId. Use disconnectConnectionForOrganization.');
}

export async function disconnectConnectionForOrganization(organizationId: string): Promise<void> {
  const orgId = requireQuickBooksOrganizationId(organizationId, 'disconnectConnectionForOrganization');
  const connection = await quickBooksCredentialManager.loadCredentials(orgId);
  if (!connection) return;

  const oauthClient = getOAuthClient();
  if (oauthClient && connection.accessToken) {
    try {
      oauthClient.setToken({
        access_token: connection.accessToken,
        refresh_token: connection.refreshToken,
      } as any);
      await oauthClient.revoke();
    } catch (error) {
      console.error('[QuickBooks] Token revocation failed:', { organizationId, message: (error as any)?.message || String(error) });
    }
  }

  await db
    .delete(oauthConnections)
    .where(and(eq(oauthConnections.id, connection.id), eq(oauthConnections.organizationId, orgId)));
}

/**
 * Queue sync jobs for push or pull operations
 */
export async function queueSyncJobs(
  direction: 'push' | 'pull',
  resources: Array<'customers' | 'invoices' | 'orders'>
): Promise<void> {
  void direction;
  void resources;
  throw new Error('QuickBooks sync queueing requires organizationId. Use queueSyncJobsForOrganization.');
}

export async function queueSyncJobsForOrganization(
  organizationId: string,
  direction: 'push' | 'pull',
  resources: Array<'customers' | 'invoices' | 'orders'>
): Promise<void> {
  const connection = await getActiveConnection(organizationId);
  if (!connection) {
    throw new Error('QuickBooks not connected');
  }

  const jobs = resources.map((resource) => ({
    provider: 'quickbooks' as const,
    direction: direction as 'push' | 'pull',
    resourceType: resource as 'customers' | 'invoices' | 'orders',
    status: 'pending' as const,
    organizationId,
  }));

  await db.insert(accountingSyncJobs).values(jobs);
}

// ==================== Data Mapping Functions ====================

/**
 * Map QuickBooks Customer to local Customer format
 */
function mapQBCustomerToLocal(qbCustomer: any): Partial<Customer> {
  return {
    companyName: qbCustomer.DisplayName || qbCustomer.CompanyName || 'Unknown',
    email: qbCustomer.PrimaryEmailAddr?.Address || null,
    phone: qbCustomer.PrimaryPhone?.FreeFormNumber || null,
    website: qbCustomer.WebAddr?.URI || null,
    billingAddress: qbCustomer.BillAddr ? formatQBAddress(qbCustomer.BillAddr) : null,
    shippingAddress: qbCustomer.ShipAddr ? formatQBAddress(qbCustomer.ShipAddr) : null,
    currentBalance: qbCustomer.Balance?.toString() || '0',
    externalAccountingId: qbCustomer.Id,
    syncStatus: 'synced',
    syncedAt: new Date(),
    notes: qbCustomer.Notes || null,
  };
}

// ==================== QB Contact Mapping Helpers ====================
// isSuspiciousContactName and deriveQBContactName are imported from
// ./lib/qbContactHelpers (pure, no DB) so they can be unit-tested in isolation.
export { isSuspiciousContactName, deriveQBContactName };

type QBContactPayload = {
  customerId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
  externalSource: string;      // 'quickbooks'
  externalSourceId: string;    // QB Customer.Id
  externalSourceType: string;  // 'customer_primary_contact'
};

/**
 * Build a TitanOS contact payload from a QuickBooks Customer.
 *
 * Returns null when:
 *   - there is no person-level name (email/phone already stored on the customer row), OR
 *   - the derived name is a known generic placeholder.
 *
 * This prevents phantom contacts like "Primary Contact" from being created.
 * Email/phone are still stored on the parent customer record via mapQBCustomerToLocal.
 */
function mapQBCustomerToContact(
  qbCustomer: any,
  customerId: string,
): QBContactPayload | null {
  const email  = String(qbCustomer.PrimaryEmailAddr?.Address || '').trim() || null;
  const phone  = String(qbCustomer.PrimaryPhone?.FreeFormNumber || '').trim() || null;
  const mobile = String(qbCustomer.Mobile?.FreeFormNumber || '').trim() || null;

  const name = deriveQBContactName(qbCustomer);

  // No real person name → skip contact creation entirely.
  // Falling back to "Primary Contact" would create placeholder rows that staff
  // would need to manually repair after every sync.
  if (!name) return null;

  const { firstName, lastName } = name;

  // Double-check: even if deriveQBContactName returned something, guard against
  // any future path that produces a known placeholder.
  if (isSuspiciousContactName(firstName, lastName)) return null;

  // Need at least one piece of contact data beyond the name.
  if (!email && !phone && !mobile) return null;

  return {
    customerId,
    firstName,
    lastName,
    email,
    phone,
    mobile,
    isPrimary: true,
    externalSource: 'quickbooks',
    externalSourceId: String(qbCustomer.Id),
    externalSourceType: 'customer_primary_contact',
  };
}

type ContactUpsertOutcome = 'created' | 'updated';

/**
 * Idempotent upsert of a primary contact for a QB-imported customer.
 *
 * Match order (first match wins):
 *   0. customerId + externalSource + externalSourceId + externalSourceType
 *      → definitive QB identity; updates all safe fields including name
 *   1. customerId + email (case-insensitive) — no source fields yet
 *      → attaches QB source fields; conservatively updates phone/mobile
 *   2. customerId + normalized firstName/lastName — no source fields yet
 *      → attaches QB source fields; updates email/phone/mobile
 *   3. No match → INSERT with all fields including source tracking
 */
async function upsertQBContact(payload: QBContactPayload): Promise<ContactUpsertOutcome> {
  const { customerId, firstName, lastName, email, phone, mobile, isPrimary,
          externalSource, externalSourceId, externalSourceType } = payload;
  if (!customerId) return 'updated';
  const [customerForContact] = await db
    .select({ organizationId: customers.organizationId })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  const organizationId = customerForContact?.organizationId;
  if (!organizationId) return 'updated';

  // Pass 0: match by definitive QB source identity
  const [bySource] = await db
    .select()
    .from(customerContacts)
    .where(
      and(
        eq(customerContacts.customerId, customerId),
        eq(customerContacts.externalSource, externalSource),
        eq(customerContacts.externalSourceId, externalSourceId),
        eq(customerContacts.externalSourceType, externalSourceType),
      ),
    )
    .limit(1);

  if (bySource) {
    // Definitive match — update name only when the incoming name is not a
    // placeholder that would overwrite a real person name already on record.
    const incomingSuspicious  = isSuspiciousContactName(firstName, lastName);
    const existingSuspicious  = isSuspiciousContactName(bySource.firstName, bySource.lastName ?? '');
    const shouldUpdateName    = !incomingSuspicious || existingSuspicious;
    await db
      .update(customerContacts)
      .set({
        ...(shouldUpdateName ? { firstName, lastName } : {}),
        email:     email     ?? bySource.email,
        phone:     phone     ?? bySource.phone,
        mobile:    mobile    ?? bySource.mobile,
        isPrimary: isPrimary || bySource.isPrimary,
        updatedAt: new Date(),
      })
      .where(eq(customerContacts.id, bySource.id));
    return 'updated';
  }

  // Pass 1: match by email (contact predates source tracking)
  if (email) {
    const [byEmail] = await db
      .select()
      .from(customerContacts)
      .where(
        and(
          eq(customerContacts.customerId, customerId),
          sql`${customerContacts.externalSource} IS NULL`,
          sql`LOWER(TRIM(${customerContacts.email})) = LOWER(TRIM(${email}))`,
        ),
      )
      .limit(1);

    if (byEmail) {
      // Attach source fields; conservatively do not overwrite name (may be Titan-edited)
      await db
        .update(customerContacts)
        .set({
          externalSource,
          externalSourceId,
          externalSourceType,
          phone: phone ?? byEmail.phone,
          mobile: mobile ?? byEmail.mobile,
          updatedAt: new Date(),
        })
        .where(eq(customerContacts.id, byEmail.id));
      return 'updated';
    }
  }

  // Pass 2: match by normalized name (contact predates source tracking)
  const [byName] = await db
    .select()
    .from(customerContacts)
    .where(
      and(
        eq(customerContacts.customerId, customerId),
        sql`${customerContacts.externalSource} IS NULL`,
        sql`LOWER(TRIM(${customerContacts.firstName})) = LOWER(${firstName.trim()})`,
        sql`LOWER(TRIM(${customerContacts.lastName})) = LOWER(${lastName.trim()})`,
      ),
    )
    .limit(1);

  if (byName) {
    // Attach source fields; update email/phone/mobile
    await db
      .update(customerContacts)
      .set({
        externalSource,
        externalSourceId,
        externalSourceType,
        email: email ?? byName.email,
        phone: phone ?? byName.phone,
        mobile: mobile ?? byName.mobile,
        isPrimary: isPrimary || byName.isPrimary,
        updatedAt: new Date(),
      })
      .where(eq(customerContacts.id, byName.id));
    return 'updated';
  }

  // Pass 3: no match — create with full source tracking
  const [createdContact] = await db.insert(customerContacts).values({
    organizationId,
    customerId,
    firstName,
    lastName,
    email,
    phone,
    mobile,
    isPrimary,
    externalSource,
    externalSourceId,
    externalSourceType,
  }).returning();
  if (createdContact) {
    if (isPrimary) {
      await db
        .update(customerContactLinks)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(and(eq(customerContactLinks.customerId, customerId), eq(customerContactLinks.status, "active")));
    }
    await db.insert(customerContactLinks).values({
      organizationId,
      customerId,
      contactId: createdContact.id,
      status: "active",
      isPrimary,
    }).onConflictDoNothing();
  }
  return 'created';
}

/**
 * Format QuickBooks address to local text format
 */
function formatQBAddress(qbAddr: any): string {
  const parts = [
    qbAddr.Line1,
    qbAddr.Line2,
    qbAddr.Line3,
    qbAddr.City,
    qbAddr.CountrySubDivisionCode,
    qbAddr.PostalCode,
    qbAddr.Country,
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * Make authenticated request to QuickBooks API
 */
async function makeQBRequest(
  method: 'GET' | 'POST' | 'PUT',
  endpoint: string,
  body?: any,
  organizationId?: string
): Promise<any> {
  const orgId = requireQuickBooksOrganizationId(organizationId, `makeQBRequest:${method}:${endpoint}`);
  const connection = await getActiveConnection(orgId);
  if (!connection) {
    throw new Error('QuickBooks not connected');
  }

  let accessToken: string | null;
  try {
    accessToken = await getValidAccessTokenForOrganization(orgId);
  } catch (error) {
    if (shouldLatchQuickBooksReauth(error)) {
      try { await latchQuickBooksNeedsReauth({ organizationId: orgId, connection, error }); }
      catch (latchError) { console.error('[QuickBooks] Failed to persist reauthorization state', { organizationId: orgId, message: (latchError as any)?.message || String(latchError) }); }
    }
    const cause = getQuickBooksCredentialCauseText(error);
    console.error('[QuickBooks] Failed to get valid access token', {
      organizationId: orgId,
      connectionId: connection.id,
      endpoint,
      method,
      cause,
      stage: (error as any)?.stage,
      errorCategory: (error as any)?.category ?? classifyQuickBooksCredentialError(error),
      refreshHttpStatus: (error as any)?.diagnostic?.httpStatus,
      oauthError: (error as any)?.diagnostic?.oauthError,
      oauthErrorDescription: (error as any)?.diagnostic?.oauthErrorDescription,
      finalCredentialState: (error as any)?.category === 'invalid_grant' ? 'needs_reauth' : 'degraded',
    });
    const wrapped: any = new Error(`Failed to get valid access token.\nCause:\n${cause}`);
    wrapped.cause = error;
    wrapped.statusCode = (error as any)?.category === 'invalid_grant' ? 409 : 503;
    wrapped.errorCategory = (error as any)?.category ?? classifyQuickBooksCredentialError(error);
    throw wrapped;
  }
  if (!accessToken) {
    const wrapped: any = new Error('Failed to get valid access token.\nCause:\nmissing_credentials');
    wrapped.errorCategory = 'missing_credentials';
    throw wrapped;
  }

  const baseUrl = process.env.QUICKBOOKS_ENVIRONMENT === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';

  const url = `${baseUrl}/v3/company/${connection.companyId}${endpoint}`;

  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  // A provider request that never settles must not retain a queue lease
  // forever.  Timeouts are ambiguous provider outcomes, so callers reconcile
  // their durable identities before any replayed write.
  const sendRequest = async (token: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        const timedOut: any = new Error("QuickBooks provider request timed out.");
        timedOut.code = "ETIMEDOUT";
        throw timedOut;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  let response: Response;
  try {
    response = await sendRequest(accessToken);
  } catch (error: any) {
    if (isTransientNetworkError(error)) {
      try {
        await quickBooksCredentialManager.recordTransientFailure(orgId, 'transient_api_failure', error);
        await setQuickBooksTransientHealthError({ organizationId: orgId, connection, message: String(error?.message || error) });
      } catch (healthError) {
        console.error('[QuickBooks] Failed to record transient health error:', {
          organizationId: orgId,
          message: (healthError as any)?.message || String(healthError),
        });
      }
    }
    throw error;
  }

  if (response.status === 401) {
    console.warn('[QuickBooks] API returned 401; forcing one credential refresh and replay', {
      organizationId: orgId,
      connectionId: connection.id,
      endpoint,
      method,
      retryAttempt: 1,
      replayAttempted: true,
    });
    const replayToken = await refreshQuickBooksCredentialsForRequest(orgId, true);
    if (replayToken) {
      response = await sendRequest(replayToken);
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    
    // Parse error details
    let qbError: any = null;
    let faultMessage: string | null = null;
    let errorCode: string | null = null;
    try {
      const parsed = JSON.parse(errorText);
      qbError = parsed?.Fault?.Error?.[0];
      errorCode = qbError?.code;
      const messagePart = qbError?.Message ? String(qbError.Message) : '';
      const detailPart = qbError?.Detail ? String(qbError.Detail) : '';
      const combined = [messagePart, detailPart].filter(Boolean).join(' - ');
      if (combined) faultMessage = combined;
    } catch {
      // ignore JSON parse errors
    }

    // Log ValidationFault (2010) with full payload for debugging
    if (errorCode === '2010' && body && endpoint.includes('/invoice')) {
      console.error('[QuickBooks] ValidationFault 2010 - Invalid/unsupported property in Invoice payload', {
        organizationId: orgId,
        endpoint,
        status: response.status,
        errorCode,
        errorMessage: faultMessage,
        sanitizedPayload: JSON.stringify(body, null, 2),
      });
    } else {
      console.error('[QuickBooks] API error', {
        organizationId: orgId,
        endpoint,
        status: response.status,
        errorCode: errorCode || undefined,
        message: errorText ? String(errorText).slice(0, 800) : null,
      });
    }

    const msg = faultMessage
      ? `QuickBooks API error: ${response.status} ${faultMessage}`
      : `QuickBooks API error: ${response.status} ${String(errorText || '').slice(0, 500)}`;
    const err: any = new Error(msg);
    err.statusCode = response.status;

    if (response.status === 401) {
      const category = classifyQuickBooksCredentialError(err);
      if (category === 'invalid_grant') {
        const latest = await quickBooksCredentialManager.loadCredentials(orgId);
        if (latest) await quickBooksCredentialManager.markNeedsReauth(orgId, latest, err);
      } else {
        await quickBooksCredentialManager.recordTransientFailure(orgId, 'transient_api_failure', err);
      }
    }

    if (isTransientQuickBooksHttpStatus(response.status)) {
      try {
        await quickBooksCredentialManager.recordTransientFailure(orgId, 'transient_api_failure', err);
        await setQuickBooksTransientHealthError({ organizationId: orgId, connection, message: msg });
      } catch (healthError) {
        console.error('[QuickBooks] Failed to record transient health error:', {
          organizationId: orgId,
          message: (healthError as any)?.message || String(healthError),
        });
      }
    }

    throw err;
  }

  const data = await response.json();

  // Successful QB call: clear transient health banner state if present.
  try {
    await quickBooksCredentialManager.recordSuccessfulRequest(orgId);
    await clearQuickBooksTransientHealth({ organizationId: orgId, connection });
  } catch (healthError) {
    console.error('[QuickBooks] Failed to clear transient health state:', {
      organizationId: orgId,
      message: (healthError as any)?.message || String(healthError),
    });
  }

  return data;
}

function escapeQBQueryString(value: string): string {
  return String(value || '').replace(/'/g, "\\'");
}

// V2 supplies the commercial facts below.  This provider bridge intentionally
// does not query legacy Invoice or Payment rows; OAuth/token handling remains
// shared integration infrastructure.
export type V2QuickBooksCustomer = Readonly<{ id: string; displayName: string; companyName?: string; email?: string; phone?: string; kind: "business" | "individual" }>;
export type V2QuickBooksInvoiceLine = Readonly<{ description: string; quantity: number; unitAmountCents: number; lineAmountCents: number }>;

async function ensureQBCustomerForV2(organizationId: string, customer: V2QuickBooksCustomer, existingId?: string): Promise<string> {
  if (existingId) return existingId;
  const displayName = customer.displayName.trim();
  if (!displayName) throw new Error("V2 Customer has no display name for QuickBooks sync.");
  const query = `SELECT Id, DisplayName, PrimaryEmailAddr FROM Customer WHERE DisplayName = '${escapeQBQueryString(displayName)}' MAXRESULTS 20`;
  const lookup = await makeQBRequest("GET", `/query?query=${encodeURIComponent(query)}`, undefined, organizationId);
  const candidates = Array.isArray(lookup?.QueryResponse?.Customer) ? lookup.QueryResponse.Customer : [];
  const email = String(customer.email || "").trim().toLowerCase();
  const nameMatches = candidates.filter((candidate: any) => String(candidate?.DisplayName || "").trim().toLocaleLowerCase() === displayName.toLocaleLowerCase());
  const identityMatches = email
    ? nameMatches.filter((candidate: any) => String(candidate?.PrimaryEmailAddr?.Address || "").trim().toLocaleLowerCase() === email)
    : nameMatches;
  // A known provider link is always preferred.  Without one, no name-only
  // ambiguity is guessed: retries must never attach a CRM Customer to another
  // party's QuickBooks Customer.
  const found = identityMatches.length === 1 ? identityMatches[0] : null;
  if (candidates.length && !found) {
    const error: any = new Error("QUICKBOOKS_CUSTOMER_REVIEW_REQUIRED: Existing QuickBooks customer candidates require review before linking this V2 CRM Customer.");
    error.statusCode = 409;
    throw error;
  }
  if (found?.Id) return String(found.Id);
  const payload: any = { DisplayName: displayName };
  if (customer.companyName) payload.CompanyName = customer.companyName;
  if (customer.email) payload.PrimaryEmailAddr = { Address: customer.email };
  if (customer.phone) payload.PrimaryPhone = { FreeFormNumber: customer.phone };
  const created = await makeQBRequest("POST", "/customer", payload, organizationId);
  if (!created?.Customer?.Id) throw new Error("QuickBooks customer create returned no Id");
  return String(created.Customer.Id);
}

export async function syncV2InvoiceToQuickBooks(input: Readonly<{ organizationId: string; invoiceId: string; displayNumber: string; currency: string; issuedAt: string; customer: V2QuickBooksCustomer; customerQuickBooksId?: string; quickBooksInvoiceId?: string; lines: readonly V2QuickBooksInvoiceLine[] }>): Promise<{ qbInvoiceId: string; qbCustomerId: string }> {
  const qbCustomerId = await ensureQBCustomerForV2(input.organizationId, input.customer, input.customerQuickBooksId);
  const payload: any = { CustomerRef: { value: qbCustomerId }, DocNumber: input.displayNumber, TxnDate: new Date(input.issuedAt).toISOString().slice(0, 10), CurrencyRef: { value: input.currency }, Line: input.lines.map((line, index) => ({ LineNum: index + 1, Amount: Number((line.lineAmountCents / 100).toFixed(2)), DetailType: "SalesItemLineDetail", SalesItemLineDetail: { Qty: line.quantity, UnitPrice: Number((line.unitAmountCents / 100).toFixed(2)) }, Description: line.description })) };
  if (input.quickBooksInvoiceId) {
    const existing = await makeQBRequest("GET", `/invoice/${input.quickBooksInvoiceId}`, undefined, input.organizationId);
    if (!existing?.Invoice?.Id) throw new Error("QuickBooks Invoice link could not be resolved.");
    return { qbInvoiceId: String(existing.Invoice.Id), qbCustomerId };
  }
  const query = `SELECT Id, CustomerRef FROM Invoice WHERE DocNumber = '${escapeQBQueryString(input.displayNumber)}' MAXRESULTS 20`;
  const candidates = (await makeQBRequest("GET", `/query?query=${encodeURIComponent(query)}`, undefined, input.organizationId))?.QueryResponse?.Invoice ?? [];
  const found = candidates.find((item: any) => String(item?.CustomerRef?.value || "") === qbCustomerId);
  if (found?.Id) return { qbInvoiceId: String(found.Id), qbCustomerId };
  if (candidates.length) {
    const error: any = new Error("QUICKBOOKS_INVOICE_REVIEW_REQUIRED: A QuickBooks Invoice already uses this V2 DocNumber for a different Customer.");
    error.statusCode = 409;
    throw error;
  }
  try {
    const created = await makeQBRequest("POST", "/invoice", payload, input.organizationId);
    if (!created?.Invoice?.Id) throw new Error("QuickBooks invoice create returned no Id");
    return { qbInvoiceId: String(created.Invoice.Id), qbCustomerId };
  } catch (error) {
    // A lost provider response is reconciled by immutable V2 DocNumber + Customer.
    const resolved = (await makeQBRequest("GET", `/query?query=${encodeURIComponent(query)}`, undefined, input.organizationId))?.QueryResponse?.Invoice?.find((item: any) => String(item?.CustomerRef?.value || "") === qbCustomerId);
    if (resolved?.Id) return { qbInvoiceId: String(resolved.Id), qbCustomerId };
    throw error;
  }
}

export async function syncV2PaymentToQuickBooks(input: Readonly<{ organizationId: string; paymentId: string; quickBooksPaymentId?: string; quickBooksInvoiceId: string; quickBooksCustomerId: string; amountCents: number; currency: string; occurredAt: string }>): Promise<{ qbPaymentId: string }> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error("V2 Payment amount must be a positive exact-cent value.");
  if (input.quickBooksPaymentId) {
    const existing = await makeQBRequest("GET", `/payment/${input.quickBooksPaymentId}`, undefined, input.organizationId);
    if (!existing?.Payment?.Id) throw new Error("QuickBooks Payment link could not be resolved.");
    return { qbPaymentId: String(existing.Payment.Id) };
  }
  const amount = Number((input.amountCents / 100).toFixed(2));
  const paymentRefNum = v2PaymentReference(input.paymentId);
  const query = `SELECT Id FROM Payment WHERE PaymentRefNum = '${escapeQBQueryString(paymentRefNum)}' MAXRESULTS 1`;
  const found = (await makeQBRequest("GET", `/query?query=${encodeURIComponent(query)}`, undefined, input.organizationId))?.QueryResponse?.Payment?.[0];
  if (found?.Id) return { qbPaymentId: String(found.Id) };
  const payload: any = { CustomerRef: { value: input.quickBooksCustomerId }, TotalAmt: amount, TxnDate: new Date(input.occurredAt).toISOString().slice(0, 10), CurrencyRef: { value: input.currency }, PaymentRefNum: paymentRefNum, PrivateNote: `PrintersHero V2 payment ${input.paymentId}`, Line: [{ Amount: amount, LinkedTxn: [{ TxnId: input.quickBooksInvoiceId, TxnType: "Invoice" }] }] };
  try {
    const created = await makeQBRequest("POST", "/payment", payload, input.organizationId);
    if (!created?.Payment?.Id) throw new Error("QuickBooks payment create returned no Id");
    return { qbPaymentId: String(created.Payment.Id) };
  } catch (error) {
    const resolved = (await makeQBRequest("GET", `/query?query=${encodeURIComponent(query)}`, undefined, input.organizationId))?.QueryResponse?.Payment?.[0];
    if (resolved?.Id) return { qbPaymentId: String(resolved.Id) };
    throw error;
  }
}

type V2QuickBooksRefundLine = Readonly<{ description: string; quantity: number; unitAmountCents: number; lineAmountCents: number }>;
const exactCents = (value: number) => Number((value / 100).toFixed(2));
// QuickBooks Online limits PaymentRefNum to 21 characters.  Preserve a
// deterministic 64-bit identity token for lookup/replay without leaking the
// full V2 UUID into the provider field.
const v2PaymentReference = (paymentId: string) => `PHV2-${crypto.createHash("sha256").update(paymentId).digest("hex").slice(0, 16)}`;
const v2RefundReference = (refundId: string, prefix: string) => `${prefix}-${crypto.createHash("sha256").update(refundId).digest("hex").slice(0, 16)}`;
const refundCreditLines = (lines: readonly V2QuickBooksRefundLine[], refundCents: number): any[] => {
  const total = lines.reduce((sum, line) => sum + line.lineAmountCents, 0);
  if (!Number.isSafeInteger(refundCents) || refundCents <= 0 || total <= 0 || refundCents > total) throw new Error("V2 Refund amount cannot be allocated to immutable issued Invoice facts.");
  let allocated = 0;
  return lines.map((line, index) => {
    const cents = index === lines.length - 1 ? refundCents - allocated : Math.floor((line.lineAmountCents * refundCents) / total);
    allocated += cents;
    return { LineNum: index + 1, Amount: exactCents(cents), DetailType: "SalesItemLineDetail", SalesItemLineDetail: { Qty: 1, UnitPrice: exactCents(cents) }, Description: line.description };
  }).filter((line) => line.Amount > 0);
};

/** CreditMemo is the A/R-credit half of a paid-Invoice refund.  Its DocNumber
 * is a deterministic V2 Refund identity, so provider-response uncertainty is
 * reconciled by a repeatable query before another CreditMemo can be created. */
export async function syncV2RefundCreditMemoToQuickBooks(input: Readonly<{ organizationId: string; refundId: string; quickBooksCreditMemoId?: string; quickBooksInvoiceId: string; quickBooksCustomerId: string; amountCents: number; currency: string; occurredAt: string; invoiceDisplayNumber: string; originalInvoiceLines: readonly V2QuickBooksRefundLine[] }>): Promise<{ qbCreditMemoId: string }> {
  if (input.quickBooksCreditMemoId) {
    const existing = await makeQBRequest("GET", `/creditmemo/${input.quickBooksCreditMemoId}`, undefined, input.organizationId);
    if (!existing?.CreditMemo?.Id) throw new Error("QuickBooks Refund CreditMemo link could not be resolved.");
    return { qbCreditMemoId: String(existing.CreditMemo.Id) };
  }
  const docNumber = v2RefundReference(input.refundId, "PHR");
  const query = `SELECT Id, CustomerRef FROM CreditMemo WHERE DocNumber = '${escapeQBQueryString(docNumber)}' MAXRESULTS 20`;
  const candidates = (await makeQBRequest("GET", `/query?query=${encodeURIComponent(query)}`, undefined, input.organizationId))?.QueryResponse?.CreditMemo ?? [];
  const existing = candidates.find((item: any) => String(item?.CustomerRef?.value || "") === input.quickBooksCustomerId);
  if (existing?.Id) return { qbCreditMemoId: String(existing.Id) };
  if (candidates.length) { const error: any = new Error("QUICKBOOKS_REFUND_REVIEW_REQUIRED: A different QuickBooks Customer already uses this V2 Refund reference."); error.statusCode = 409; throw error; }
  const payload = { CustomerRef: { value: input.quickBooksCustomerId }, DocNumber: docNumber, TxnDate: new Date(input.occurredAt).toISOString().slice(0, 10), CurrencyRef: { value: input.currency }, PrivateNote: `PrintersHero V2 refund ${input.refundId} for Invoice ${input.invoiceDisplayNumber}`, Line: refundCreditLines(input.originalInvoiceLines, input.amountCents) };
  try {
    const created = await makeQBRequest("POST", "/creditmemo", payload, input.organizationId);
    if (!created?.CreditMemo?.Id) throw new Error("QuickBooks Refund CreditMemo create returned no Id");
    return { qbCreditMemoId: String(created.CreditMemo.Id) };
  } catch (error) {
    const resolved = (await makeQBRequest("GET", `/query?query=${encodeURIComponent(query)}`, undefined, input.organizationId))?.QueryResponse?.CreditMemo?.find((item: any) => String(item?.CustomerRef?.value || "") === input.quickBooksCustomerId);
    if (resolved?.Id) return { qbCreditMemoId: String(resolved.Id) };
    throw error;
  }
}

/** Check is the cash/bank disbursement half.  It posts its line to the same
 * customer A/R account as the original QuickBooks Invoice, so it reconciles
 * the CreditMemo without mutating either the original Invoice or Payment. */
export async function syncV2RefundDisbursementToQuickBooks(input: Readonly<{ organizationId: string; refundId: string; quickBooksDisbursementId?: string; quickBooksCreditMemoId: string; quickBooksInvoiceId: string; quickBooksPaymentId: string; quickBooksCustomerId: string; amountCents: number; currency: string; occurredAt: string }>): Promise<{ qbDisbursementId: string }> {
  if (input.quickBooksDisbursementId) {
    const existing = await makeQBRequest("GET", `/check/${input.quickBooksDisbursementId}`, undefined, input.organizationId);
    if (!existing?.Check?.Id) throw new Error("QuickBooks Refund disbursement link could not be resolved.");
    return { qbDisbursementId: String(existing.Check.Id) };
  }
  const invoice = (await makeQBRequest("GET", `/invoice/${input.quickBooksInvoiceId}`, undefined, input.organizationId))?.Invoice;
  const payment = (await makeQBRequest("GET", `/payment/${input.quickBooksPaymentId}`, undefined, input.organizationId))?.Payment;
  const arAccountId = String(invoice?.ARAccountRef?.value || process.env.QUICKBOOKS_AR_ACCOUNT_ID || "").trim();
  const bankAccountId = String(payment?.DepositToAccountRef?.value || process.env.QUICKBOOKS_REFUND_BANK_ACCOUNT_ID || "").trim();
  if (!arAccountId || !bankAccountId) { const error: any = new Error("QUICKBOOKS_REFUND_ACCOUNT_CONFIGURATION_REQUIRED: The original Invoice A/R account and refund bank account must be available before a refund disbursement can be posted."); error.statusCode = 409; throw error; }
  const docNumber = v2RefundReference(input.refundId, "PHRC");
  const query = `SELECT Id, PayeeRef FROM Check WHERE DocNumber = '${escapeQBQueryString(docNumber)}' MAXRESULTS 20`;
  const candidates = (await makeQBRequest("GET", `/query?query=${encodeURIComponent(query)}`, undefined, input.organizationId))?.QueryResponse?.Check ?? [];
  const existing = candidates.find((item: any) => String(item?.PayeeRef?.value || "") === input.quickBooksCustomerId);
  if (existing?.Id) return { qbDisbursementId: String(existing.Id) };
  if (candidates.length) { const error: any = new Error("QUICKBOOKS_REFUND_REVIEW_REQUIRED: A different QuickBooks payee already uses this V2 Refund disbursement reference."); error.statusCode = 409; throw error; }
  const amount = exactCents(input.amountCents);
  const payload = { PayeeRef: { value: input.quickBooksCustomerId, type: "Customer" }, BankAccountRef: { value: bankAccountId }, DocNumber: docNumber, TxnDate: new Date(input.occurredAt).toISOString().slice(0, 10), CurrencyRef: { value: input.currency }, PrivateNote: `PrintersHero V2 refund ${input.refundId}; CreditMemo ${input.quickBooksCreditMemoId}`, Line: [{ Amount: amount, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: arAccountId }, CustomerRef: { value: input.quickBooksCustomerId } } }] };
  try {
    const created = await makeQBRequest("POST", "/check", payload, input.organizationId);
    if (!created?.Check?.Id) throw new Error("QuickBooks Refund disbursement create returned no Id");
    return { qbDisbursementId: String(created.Check.Id) };
  } catch (error) {
    const resolved = (await makeQBRequest("GET", `/query?query=${encodeURIComponent(query)}`, undefined, input.organizationId))?.QueryResponse?.Check?.find((item: any) => String(item?.PayeeRef?.value || "") === input.quickBooksCustomerId);
    if (resolved?.Id) return { qbDisbursementId: String(resolved.Id) };
    throw error;
  }
}

async function ensureQBCustomerIdForLocalCustomer(organizationId: string, customer: Customer): Promise<string> {
  if ((customer as any).externalAccountingId) return String((customer as any).externalAccountingId);

  const customerType = String((customer as any).customerType || "business").trim().toLowerCase();
  const isIndividual = customerType === "individual";
  const displayName = String((customer as any).displayName || (customer as any).companyName || '').trim();
  if (!displayName) throw new Error('Customer has no display name for QuickBooks sync');

  // First, try to find an existing QB Customer by DisplayName. Individuals
  // require an exact email corroboration when email is available; name-only
  // attachment is deliberately avoided.
  const query = `SELECT Id, DisplayName, PrimaryEmailAddr FROM Customer WHERE DisplayName = '${escapeQBQueryString(displayName)}' MAXRESULTS 20`;
  const lookup = await makeQBRequest('GET', `/query?query=${encodeURIComponent(query)}`, undefined, organizationId);
  const candidates = Array.isArray(lookup?.QueryResponse?.Customer) ? lookup.QueryResponse.Customer : [];
  const localEmail = String((customer as any).email || "").trim().toLowerCase();
  const found = isIndividual
    ? candidates.filter((candidate: any) => {
        const candidateName = String(candidate?.DisplayName || "").trim();
        const candidateEmail = String(candidate?.PrimaryEmailAddr?.Address || "").trim().toLowerCase();
        return candidateName === displayName && localEmail && candidateEmail === localEmail;
      })[0]
    : candidates[0];
  if (isIndividual && candidates.length > 0 && !found) {
    const err: any = new Error('QUICKBOOKS_CUSTOMER_REVIEW_REQUIRED: Existing QuickBooks customer candidates require review before linking this individual customer.');
    err.code = 'QUICKBOOKS_CUSTOMER_REVIEW_REQUIRED';
    err.statusCode = 409;
    throw err;
  }
  if (found?.Id) {
    await db
      .update(customers)
      .set({ externalAccountingId: String(found.Id), syncStatus: 'synced', syncError: null, syncedAt: new Date(), updatedAt: new Date() } as any)
      .where(and(eq(customers.id, (customer as any).id), eq(customers.organizationId, organizationId)));
    await db.insert(auditLogs).values({
      organizationId,
      userId: null,
      actionType: "quickbooks_customer_matched",
      entityType: "customer",
      entityId: (customer as any).id,
      entityName: displayName,
      description: "QuickBooks customer matched for local customer.",
      newValues: {
        quickBooksCustomerId: String(found.Id),
        customerType,
        sourceContactId: (customer as any).sourceContactId ?? null,
        matchMode: isIndividual ? "display_name_and_email" : "display_name",
      } as any,
    } as any).catch(() => undefined);
    return String(found.Id);
  }

  // Create new QB Customer.
  const qbCustomerData = mapLocalCustomerToQB(customer);
  try {
    const created = await makeQBRequest('POST', '/customer', qbCustomerData, organizationId);
    const qb = created?.Customer;
    if (!qb?.Id) throw new Error('QuickBooks customer create returned no Id');
    await db
      .update(customers)
      .set({ externalAccountingId: String(qb.Id), syncStatus: 'synced', syncError: null, syncedAt: new Date(), updatedAt: new Date() } as any)
      .where(and(eq(customers.id, (customer as any).id), eq(customers.organizationId, organizationId)));
    await db.insert(auditLogs).values({
      organizationId,
      userId: null,
      actionType: "quickbooks_customer_created",
      entityType: "customer",
      entityId: (customer as any).id,
      entityName: displayName,
      description: "QuickBooks customer created for local customer.",
      newValues: {
        quickBooksCustomerId: String(qb.Id),
        customerType,
        sourceContactId: (customer as any).sourceContactId ?? null,
      } as any,
    } as any).catch(() => undefined);
    return String(qb.Id);
  } catch (err: any) {
    // Fallback: if already exists, re-query.
    console.error('[QuickBooks] customer ensure failed', { organizationId, customerId: (customer as any).id, message: String(err?.message || err) });
    const retry = await makeQBRequest('GET', `/query?query=${encodeURIComponent(query)}`, undefined, organizationId);
    const retryCandidates = Array.isArray(retry?.QueryResponse?.Customer) ? retry.QueryResponse.Customer : [];
    const retryFound = isIndividual
      ? retryCandidates.filter((candidate: any) => {
          const candidateName = String(candidate?.DisplayName || "").trim();
          const candidateEmail = String(candidate?.PrimaryEmailAddr?.Address || "").trim().toLowerCase();
          return candidateName === displayName && localEmail && candidateEmail === localEmail;
        })[0]
      : retryCandidates[0];
    if (retryFound?.Id) {
      await db
        .update(customers)
        .set({ externalAccountingId: String(retryFound.Id), syncStatus: 'synced', syncError: null, syncedAt: new Date(), updatedAt: new Date() } as any)
        .where(and(eq(customers.id, (customer as any).id), eq(customers.organizationId, organizationId)));
      return String(retryFound.Id);
    }
    throw err;
  }
}

/**
 * Push a single local invoice to QuickBooks immediately (fail-fast).
 * Callers should catch errors and persist qb_last_error/qb_sync_status without blocking local transitions.
 */
export async function syncSingleInvoiceToQuickBooks(invoiceId: string): Promise<{ qbInvoiceId: string }>{
  void invoiceId;
  throw new Error('QuickBooks invoice sync requires organizationId. Use syncSingleInvoiceToQuickBooksForOrganization.');
}

export async function syncSingleInvoiceToQuickBooksForOrganization(organizationId: string, invoiceId: string): Promise<{ qbInvoiceId: string }>{
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)))
    .limit(1);
  if (!invoice) throw new Error('Invoice not found');

  const status = String((invoice as any).status || '').toLowerCase();
  if (status === 'void') throw new Error('Cannot sync a void invoice');

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, invoice.customerId), eq(customers.organizationId, organizationId)))
    .limit(1);
  if (!customer) throw new Error('Customer not found');

  const qbCustomerId = await ensureQBCustomerIdForLocalCustomer(organizationId, customer as any);

  const lineItems = await db
    .select({
      id: invoiceLineItems.id,
      description: invoiceLineItems.description,
      quantity: invoiceLineItems.quantity,
      unitPriceCents: invoiceLineItems.unitPriceCents,
      unitPrice: invoiceLineItems.unitPrice,
      lineTotalCents: invoiceLineItems.lineTotalCents,
      totalPrice: invoiceLineItems.totalPrice,
    })
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId))
    .orderBy(invoiceLineItems.sortOrder, desc(invoiceLineItems.createdAt));

  const txnDate = (invoice.issuedAt || invoice.issueDate || new Date()) as any;

  const invoiceDisplayNumber = String((invoice as any).displayNumber || invoice.invoiceNumber);

  const qbInvoiceData: any = {
    CustomerRef: { value: qbCustomerId },
    DocNumber: invoiceDisplayNumber,
    TxnDate: new Date(txnDate).toISOString().split('T')[0],
    DueDate: invoice.dueDate ? new Date(invoice.dueDate as any).toISOString().split('T')[0] : undefined,
    Line: buildQuickBooksInvoiceLinePayloads(getBillableBundleRoots(lineItems as any[])),
  };

  // Remove undefined properties for QB API
  if (!qbInvoiceData.DueDate) delete qbInvoiceData.DueDate;

  const existingId = (invoice.qbInvoiceId || invoice.externalAccountingId) as string | null;
  if (existingId) {
    const existing = await makeQBRequest('GET', `/invoice/${existingId}`, undefined, organizationId);
    qbInvoiceData.Id = existingId;
    qbInvoiceData.SyncToken = existing?.Invoice?.SyncToken;
    const response = await makeQBRequest('POST', '/invoice', qbInvoiceData, organizationId);
    const qb = response?.Invoice;
    if (!qb?.Id) throw new Error('QuickBooks invoice update returned no Id');
    return { qbInvoiceId: qb.Id };
  }

  // Idempotency fallback: look up by DocNumber + CustomerRef if local link missing.
  const docNumber = invoiceDisplayNumber;
  const findQuery = `SELECT Id, DocNumber FROM Invoice WHERE DocNumber = '${escapeQBQueryString(docNumber)}' MAXRESULTS 1`;
  const findResp = await makeQBRequest('GET', `/query?query=${encodeURIComponent(findQuery)}`, undefined, organizationId);
  const found = findResp?.QueryResponse?.Invoice?.[0];
  if (found?.Id) {
    const existing = await makeQBRequest('GET', `/invoice/${String(found.Id)}`, undefined, organizationId);
    qbInvoiceData.Id = String(found.Id);
    qbInvoiceData.SyncToken = existing?.Invoice?.SyncToken;
    const response = await makeQBRequest('POST', '/invoice', qbInvoiceData, organizationId);
    const qb = response?.Invoice;
    if (!qb?.Id) throw new Error('QuickBooks invoice update returned no Id');
    return { qbInvoiceId: qb.Id };
  }

  const response = await makeQBRequest('POST', '/invoice', qbInvoiceData, organizationId);
  const qb = response?.Invoice;
  if (!qb?.Id) throw new Error('QuickBooks invoice create returned no Id');
  return { qbInvoiceId: qb.Id };
}

export async function syncSinglePaymentToQuickBooksForOrganization(organizationId: string, paymentId: string): Promise<{ qbPaymentId: string }>{
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)))
    .limit(1);
  if (!payment) throw new Error('Payment not found');

  const status = String((payment as any).status || '').toLowerCase();
  if (status !== 'succeeded' && status !== 'captured') throw new Error('Only succeeded or captured payments can be synced to QuickBooks');

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, (payment as any).invoiceId), eq(invoices.organizationId, organizationId)))
    .limit(1);
  if (!invoice) throw new Error('Invoice not found for payment');

  const invoiceStatus = String((invoice as any).status || '').toLowerCase();
  if (invoiceStatus === 'void') throw new Error('Cannot sync payments for void invoices');

  const qbInvoiceId = String((invoice as any).qbInvoiceId || '').trim();
  if (!qbInvoiceId) {
    const err: any = new Error('Invoice must be synced to QuickBooks before syncing payments');
    err.statusCode = 409;
    throw err;
  }

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, (invoice as any).customerId), eq(customers.organizationId, organizationId)))
    .limit(1);
  if (!customer) throw new Error('Customer not found for invoice');

  const qbCustomerId = await ensureQBCustomerIdForLocalCustomer(organizationId, customer as any);

  const amountCents = Math.max(0, Math.round(Number((payment as any).amountCents || 0)));
  if (amountCents <= 0) throw new Error('Payment amount must be > 0');
  const amount = Number((amountCents / 100).toFixed(2));

  const paidAtRaw = (payment as any).paidAt || (payment as any).succeededAt || (payment as any).appliedAt || new Date();
  const txnDate = new Date(paidAtRaw as any);
  const txnDateStr = Number.isNaN(txnDate.getTime()) ? new Date().toISOString().split('T')[0] : txnDate.toISOString().split('T')[0];

  const localPaymentId = String((payment as any).id);
  const paymentRefNum = `QVP-${localPaymentId}`;
  const privateNote = `QVP payment ${localPaymentId}`;

  const qbPaymentData: any = {
    CustomerRef: { value: qbCustomerId },
    TotalAmt: amount,
    TxnDate: txnDateStr,
    PaymentRefNum: paymentRefNum,
    PrivateNote: privateNote,
    Line: [
      {
        Amount: amount,
        LinkedTxn: [{ TxnId: qbInvoiceId, TxnType: 'Invoice' }],
      },
    ],
  };

  const existingQbPaymentId = String((payment as any).externalAccountingId || '').trim();
  if (existingQbPaymentId) {
    const existing = await makeQBRequest('GET', `/payment/${existingQbPaymentId}`, undefined, organizationId);
    qbPaymentData.Id = existingQbPaymentId;
    qbPaymentData.SyncToken = existing?.Payment?.SyncToken;
    const updated = await makeQBRequest('POST', '/payment', qbPaymentData, organizationId);
    const qb = updated?.Payment;
    if (!qb?.Id) throw new Error('QuickBooks payment update returned no Id');
    return { qbPaymentId: String(qb.Id) };
  }

  // Idempotency fallback: query by PaymentRefNum (PrivateNote is not queryable in QB).
  const findQuery = `SELECT Id FROM Payment WHERE PaymentRefNum = '${escapeQBQueryString(paymentRefNum)}' MAXRESULTS 1`;
  const findResp = await makeQBRequest('GET', `/query?query=${encodeURIComponent(findQuery)}`, undefined, organizationId);
  const found = findResp?.QueryResponse?.Payment?.[0];
  if (found?.Id) {
    const existing = await makeQBRequest('GET', `/payment/${String(found.Id)}`, undefined, organizationId);
    qbPaymentData.Id = String(found.Id);
    qbPaymentData.SyncToken = existing?.Payment?.SyncToken;
    const updated = await makeQBRequest('POST', '/payment', qbPaymentData, organizationId);
    const qb = updated?.Payment;
    if (!qb?.Id) throw new Error('QuickBooks payment update returned no Id');
    return { qbPaymentId: String(qb.Id) };
  }

  try {
    const created = await makeQBRequest('POST', '/payment', qbPaymentData, organizationId);
    const qb = created?.Payment;
    if (!qb?.Id) throw new Error('QuickBooks payment create returned no Id');
    return { qbPaymentId: String(qb.Id) };
  } catch (err: any) {
    // If QB reports a duplicate/already-exists condition, attempt a last-chance resolve by PaymentRefNum.
    // This keeps the operation idempotent even under race conditions.
    const msg = String(err?.message || '').toLowerCase();
    const isDuplicate = msg.includes('duplicate') || msg.includes('already exists') || msg.includes('already-exists');
    if (!isDuplicate) throw err;

    const retryFindResp = await makeQBRequest('GET', `/query?query=${encodeURIComponent(findQuery)}`, undefined, organizationId);
    const retryFound = retryFindResp?.QueryResponse?.Payment?.[0];
    if (retryFound?.Id) {
      return { qbPaymentId: String(retryFound.Id) };
    }

    throw err;
  }
}

// ==================== Customer Sync Processors ====================

// ==================== QB Customer Preview (read-only, no writes) ====================

export type QBCustomerPreviewRow = {
  qbCustomerId: string;
  qbDisplayName: string;
  mappedCompanyName: string;
  mappedContactFirstName: string | null;
  mappedContactLastName: string | null;
  email: string | null;
  phone: string | null;
  willCreateCompany: boolean;
  willUpdateCompany: boolean;
  willCreateContact: boolean;
  contactNeedsReview: boolean;
  suspiciousFields: string[];
  matchedExistingCustomerId: string | null;
  matchedExistingContactId: string | null;
  importStatus: 'create_company' | 'update_company' | 'create_company_only' | 'update_company_only';
  failureReason: string | null;
};

export type QuickBooksCustomerMigrationSourceStatus = {
  connected: boolean;
  state: QuickBooksConnectionState;
  authState: QuickBooksAuthState;
  healthState: QuickBooksHealthState;
  healthMessage?: string;
  lastErrorAt?: string;
  lastErrorCode?: QuickBooksCredentialErrorCategory | null;
  lastErrorMessage?: string | null;
  lastErrorStage?: string | null;
  lastErrorHttpStatus?: number | null;
  lastOAuthError?: string | null;
  lastOAuthErrorDescription?: string | null;
  lastSuccessfulRefreshAt?: string | null;
  lastSuccessfulRequestAt?: string | null;
  consecutiveTransientFailureCount?: number;
  requiresUserAction?: boolean;
  connectedCompanyName: string | null;
  quickBooksCompanyId: string | null;
  connectedAt: Date | null;
  expiresAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
};

function getQuickBooksConnectedCompanyName(connection: OAuthConnection | null): string | null {
  if (!connection) return null;
  const meta = (connection.metadata as any) || {};
  const companyName = String(meta.companyName || meta.companyInfo?.CompanyName || '').trim();
  if (companyName) return companyName;
  // A realm/company identifier is integration metadata, not useful Settings
  // copy.  Surface a recognisable provider display name only when one exists.
  return null;
}

export async function getQuickBooksCustomerMigrationSourceStatus(organizationId: string): Promise<QuickBooksCustomerMigrationSourceStatus> {
  const orgId = requireQuickBooksOrganizationId(organizationId, 'getQuickBooksCustomerMigrationSourceStatus');
  const connection = await getActiveConnection(orgId);
  const lastSuccessfulSync = await db
    .select({ updatedAt: accountingSyncJobs.updatedAt })
    .from(accountingSyncJobs)
    .where(and(
      eq(accountingSyncJobs.organizationId, orgId),
      eq(accountingSyncJobs.provider, 'quickbooks'),
      eq(accountingSyncJobs.resourceType, 'customers'),
      eq(accountingSyncJobs.direction, 'pull'),
      eq(accountingSyncJobs.status, 'synced'),
    ))
    .orderBy(desc(accountingSyncJobs.updatedAt))
    .limit(1);

  if (!connection || connection.organizationId !== orgId) {
    return {
      connected: false,
      state: 'disconnected',
      authState: 'not_connected',
      healthState: 'ok',
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorStage: null,
      lastErrorHttpStatus: null,
      lastOAuthError: null,
      lastOAuthErrorDescription: null,
      requiresUserAction: false,
      connectedCompanyName: null,
      quickBooksCompanyId: null,
      connectedAt: null,
      expiresAt: null,
      lastSuccessfulSyncAt: lastSuccessfulSync[0]?.updatedAt ?? null,
    };
  }

  const qbAuth = getQuickBooksAuthMetadata(connection);
  const qbHealth = getQuickBooksHealthMetadata(connection);
  const credentialStatus = await quickBooksCredentialManager.getStatus(orgId);
  const healthState = qbHealth?.state === 'transient_error' ? 'transient_error' : 'ok';
  const state = credentialStatus.state;
  const authState: QuickBooksAuthState = state === 'needs_reauth' ? 'needs_reauth' : state === 'disconnected' ? 'not_connected' : 'connected';

  return {
    connected: credentialStatus.connected,
    state,
    authState,
    healthState: state === 'degraded' ? 'transient_error' : healthState,
    healthMessage: credentialStatus.lastErrorMessage ?? (qbHealth?.message ? String(qbHealth.message) : undefined),
    lastErrorAt: credentialStatus.lastErrorAt ?? (qbHealth?.lastErrorAt ? String(qbHealth.lastErrorAt) : undefined),
    lastErrorCode: credentialStatus.lastErrorCode,
    lastErrorMessage: credentialStatus.lastErrorMessage,
    lastErrorStage: credentialStatus.lastErrorStage,
    lastErrorHttpStatus: credentialStatus.lastErrorHttpStatus,
    lastOAuthError: credentialStatus.lastOAuthError,
    lastOAuthErrorDescription: credentialStatus.lastOAuthErrorDescription,
    lastSuccessfulRefreshAt: credentialStatus.lastSuccessfulRefreshAt,
    lastSuccessfulRequestAt: credentialStatus.lastSuccessfulRequestAt,
    consecutiveTransientFailureCount: credentialStatus.consecutiveTransientFailureCount,
    requiresUserAction: credentialStatus.requiresUserAction,
    connectedCompanyName: getQuickBooksConnectedCompanyName(connection),
    quickBooksCompanyId: connection.companyId ?? null,
    connectedAt: connection.createdAt ?? null,
    expiresAt: connection.expiresAt ?? null,
    lastSuccessfulSyncAt: lastSuccessfulSync[0]?.updatedAt ?? null,
  };
}

/** Browser-safe connection projection.  Environment is explicit only: a
 * missing or unexpected configuration is UNKNOWN rather than inferred from a
 * DEV hostname or the provider's default endpoint. */
export type QuickBooksConnectionReadiness = Readonly<{
  state: "not_connected" | "connected_sandbox" | "connected_production" | "connected_unknown" | "authorization_required" | "reconnect_required" | "worker_not_ready" | "sync_ready" | "action_required";
  environment: "sandbox" | "production" | "unknown";
  connected: boolean;
  connectedCompanyName: string | null;
  actionRequired: string | null;
}>;
export async function getQuickBooksConnectionReadinessForOrganization(organizationId: string): Promise<QuickBooksConnectionReadiness> {
  const status = await getQuickBooksCustomerMigrationSourceStatus(organizationId);
  const configured = String(process.env.QUICKBOOKS_ENVIRONMENT || process.env.QB_ENV || "").trim().toLowerCase();
  const environment: QuickBooksConnectionReadiness["environment"] = configured === "sandbox" ? "sandbox" : configured === "production" ? "production" : "unknown";
  const workerReady = String(process.env.QUICKBOOKS_AUTOMATION_OWNER || "").trim().toLowerCase() === "queue";
  if (!status.connected) return { state: status.authState === "needs_reauth" ? "reconnect_required" : "not_connected", environment, connected: false, connectedCompanyName: null, actionRequired: status.authState === "needs_reauth" ? "Reconnect QuickBooks to restore authorization." : "Connect QuickBooks to enable accounting synchronization." };
  if (status.authState === "needs_reauth" || status.requiresUserAction) return { state: "authorization_required", environment, connected: true, connectedCompanyName: status.connectedCompanyName, actionRequired: status.healthMessage || "Reconnect QuickBooks to restore authorization." };
  if (environment === "unknown") return { state: "connected_unknown", environment, connected: true, connectedCompanyName: status.connectedCompanyName, actionRequired: "QuickBooks connection mode must be configured explicitly before provider writes are enabled." };
  if (!workerReady) return { state: "worker_not_ready", environment, connected: true, connectedCompanyName: status.connectedCompanyName, actionRequired: "QuickBooks synchronization worker is not ready." };
  return { state: "sync_ready", environment, connected: true, connectedCompanyName: status.connectedCompanyName, actionRequired: null };
}

export async function fetchQBCustomersForMigrationSource(organizationId: string): Promise<{
  customers: any[];
  status: QuickBooksCustomerMigrationSourceStatus;
  retrievedAt: Date;
}> {
  const status = await getQuickBooksCustomerMigrationSourceStatus(organizationId);
  if (!status.connected) {
    const error: any = new Error(status.authState === 'needs_reauth'
      ? 'QuickBooks connection needs reauthorization.'
      : 'No active QuickBooks connection is available for this organization.');
    error.statusCode = status.authState === 'needs_reauth' ? 409 : 404;
    throw error;
  }

  const customers: any[] = await fetchAllQBEntities(
    'Customer',
    'SELECT * FROM Customer',
    (q) => makeQBRequest('GET', `/query?query=${encodeURIComponent(q)}`, undefined, organizationId),
  );

  return { customers, status, retrievedAt: new Date() };
}

/**
 * Fetch all QB customers and return mapping decisions WITHOUT writing anything.
 * Used by the UI preview step before committing a pull sync.
 */
export async function fetchQBCustomersForPreview(organizationId: string): Promise<QBCustomerPreviewRow[]> {
  const qbCustomers: any[] = await fetchAllQBEntities(
    'Customer',
    'SELECT * FROM Customer',
    (q) => makeQBRequest('GET', `/query?query=${encodeURIComponent(q)}`, undefined, organizationId),
  );
  console.log(`[QB Preview Customers] Fetched ${qbCustomers.length} QuickBooks customers`);

  const rows: QBCustomerPreviewRow[] = [];

  for (const qbCustomer of qbCustomers) {
    const localData  = mapQBCustomerToLocal(qbCustomer);
    const name       = deriveQBContactName(qbCustomer);
    const email      = String(qbCustomer.PrimaryEmailAddr?.Address || '').trim() || null;
    const phone      = String(qbCustomer.PrimaryPhone?.FreeFormNumber || '').trim() || null;

    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        or(
          and(eq(customers.organizationId, organizationId), eq(customers.externalAccountingId, String(qbCustomer.Id))),
          localData.email
            ? and(eq(customers.organizationId, organizationId), eq(customers.email, localData.email))
            : sql`false`,
        ),
      )
      .limit(1);

    let matchedContactId: string | null = null;
    if (existing) {
      if (email) {
        const [byEmail] = await db
          .select({ id: customerContacts.id })
          .from(customerContacts)
          .where(and(
            eq(customerContacts.customerId, existing.id),
            sql`LOWER(TRIM(${customerContacts.email})) = LOWER(${email})`,
          ))
          .limit(1);
        if (byEmail) matchedContactId = byEmail.id;
      }
      if (!matchedContactId && name) {
        const [byName] = await db
          .select({ id: customerContacts.id })
          .from(customerContacts)
          .where(and(
            eq(customerContacts.customerId, existing.id),
            sql`LOWER(TRIM(${customerContacts.firstName})) = LOWER(${name.firstName.trim()})`,
          ))
          .limit(1);
        if (byName) matchedContactId = byName.id;
      }
    }

    const suspiciousFields: string[] = [];
    const nameIsSuspicious = name ? isSuspiciousContactName(name.firstName, name.lastName) : false;
    if (!name)            suspiciousFields.push('missing_person_name');
    else if (nameIsSuspicious) suspiciousFields.push('suspicious_contact_name');

    const willCreateContact = !!name && !nameIsSuspicious && !matchedContactId
      && !!(email || phone || String(qbCustomer.Mobile?.FreeFormNumber || '').trim());
    const importStatus = existing
      ? (willCreateContact ? 'update_company' : 'update_company_only')
      : (willCreateContact ? 'create_company' : 'create_company_only');
    const failureReason = !name
      ? 'missing_person_name'
      : nameIsSuspicious
        ? 'suspicious_contact_name'
        : null;

    rows.push({
      qbCustomerId:             String(qbCustomer.Id),
      qbDisplayName:            String(qbCustomer.DisplayName || ''),
      mappedCompanyName:        localData.companyName as string,
      mappedContactFirstName:   name?.firstName ?? null,
      mappedContactLastName:    name?.lastName  ?? null,
      email,
      phone,
      willCreateCompany:        !existing,
      willUpdateCompany:        !!existing,
      willCreateContact,
      contactNeedsReview:       !name || nameIsSuspicious,
      suspiciousFields,
      matchedExistingCustomerId: existing?.id         ?? null,
      matchedExistingContactId:  matchedContactId,
      importStatus,
      failureReason,
    });
  }

  return rows;
}

export type QBCustomerSearchMatch = {
  qbCustomerId: string;
  qbDisplayName: string;
  qbCompanyName: string | null;
  qbFullyQualifiedName: string | null;
  email: string | null;
  active: boolean | null;
};

function toQBCustomerSearchMatch(qbCustomer: any): QBCustomerSearchMatch {
  return {
    qbCustomerId: String(qbCustomer?.Id ?? ''),
    qbDisplayName: String(qbCustomer?.DisplayName ?? ''),
    qbCompanyName: String(qbCustomer?.CompanyName ?? '').trim() || null,
    qbFullyQualifiedName: String(qbCustomer?.FullyQualifiedName ?? '').trim() || null,
    email: String(qbCustomer?.PrimaryEmailAddr?.Address ?? '').trim() || null,
    active: typeof qbCustomer?.Active === 'boolean' ? qbCustomer.Active : null,
  };
}

/**
 * Read-only developer lookup helper for finding QB Customer IDs without using the QB UI.
 * Numeric input preserves the exact-ID path; names search DisplayName, CompanyName, and
 * FullyQualifiedName with bounded QB queries.
 */
export async function searchQBCustomersForInspection(
  organizationId: string,
  query: string,
): Promise<QBCustomerSearchMatch[]> {
  const term = String(query || '').trim();
  if (!term) throw new Error('query is required');

  const matches = new Map<string, QBCustomerSearchMatch>();
  const addCustomer = (qbCustomer: any) => {
    if (!qbCustomer?.Id) return;
    const match = toQBCustomerSearchMatch(qbCustomer);
    matches.set(match.qbCustomerId, match);
  };

  if (/^\d+$/.test(term)) {
    const exact = await fetchQBCustomerForInspection(organizationId, term);
    if (exact?.raw) addCustomer(exact.raw);
  }

  const escaped = escapeQBQueryString(term);
  const queries = [
    `SELECT * FROM Customer WHERE DisplayName = '${escaped}' MAXRESULTS 20`,
    `SELECT * FROM Customer WHERE CompanyName = '${escaped}' MAXRESULTS 20`,
    `SELECT * FROM Customer WHERE FullyQualifiedName = '${escaped}' MAXRESULTS 20`,
  ];

  for (const qbQuery of queries) {
    const resp = await makeQBRequest('GET', `/query?query=${encodeURIComponent(qbQuery)}`, undefined, organizationId);
    const customersPage = Array.isArray(resp?.QueryResponse?.Customer) ? resp.QueryResponse.Customer : [];
    for (const qbCustomer of customersPage) addCustomer(qbCustomer);
  }

  if (matches.size === 0 && term.length >= 2) {
    const all = await fetchAllQBEntities<any>(
      'Customer',
      'SELECT * FROM Customer',
      (q) => makeQBRequest('GET', `/query?query=${encodeURIComponent(q)}`, undefined, organizationId),
      { pageSize: 1000, maxCap: 10_000 },
    );
    const needle = term.toLowerCase();
    for (const qbCustomer of all) {
      const haystack = [
        qbCustomer.DisplayName,
        qbCustomer.CompanyName,
        qbCustomer.FullyQualifiedName,
      ].map((v) => String(v ?? '').toLowerCase());
      if (haystack.some((value) => value.includes(needle))) {
        addCustomer(qbCustomer);
      }
      if (matches.size >= 50) break;
    }
  }

  return Array.from(matches.values()).sort((a, b) => {
    const aName = a.qbDisplayName || a.qbCompanyName || a.qbCustomerId;
    const bName = b.qbDisplayName || b.qbCompanyName || b.qbCustomerId;
    return aName.localeCompare(bName, undefined, { numeric: true });
  });
}

// ==================== QB Suspicious-Contact Repair Report ====================

export type SuspiciousContactRow = {
  contactId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  customerId: string | null;
  companyName: string;
  externalSourceId: string | null;
};

/**
 * Return contacts linked to QB-sourced customers whose names are known placeholders.
 * Read-only — used by the repair/report admin endpoint.
 */
export async function findSuspiciousQBContacts(organizationId: string): Promise<SuspiciousContactRow[]> {
  const rows = await db
    .select({
      contactId:       customerContacts.id,
      firstName:       customerContacts.firstName,
      lastName:        customerContacts.lastName,
      email:           customerContacts.email,
      phone:           customerContacts.phone,
      customerId:      customerContacts.customerId,
      companyName:     customers.companyName,
      externalSourceId: customerContacts.externalSourceId,
    })
    .from(customerContacts)
    .innerJoin(customers, and(
      eq(customerContacts.customerId, customers.id),
      eq(customers.organizationId, organizationId),
    ))
    .where(eq(customerContacts.externalSource, 'quickbooks'));

  return rows.filter(r => isSuspiciousContactName(r.firstName, r.lastName ?? ''));
}

// ==================== QB Customer Pull Sync (writes) ====================

/**
 * Process pull sync: Fetch customers from QuickBooks and upsert into local DB.
 * Also creates or updates a primary contact record when QB provides contact-level data.
 */
export async function processPullCustomers(jobId: string, organizationId: string): Promise<void> {
  try {
    console.log(`[QB Pull Customers] Starting job ${jobId}`, { organizationId });

    const connection = await getActiveConnection(organizationId);
    if (!connection) {
      console.warn('[QB Pull Customers] No active QuickBooks connection found', { organizationId, jobId });
      throw new Error(`QuickBooks not connected for organization ${organizationId}`);
    }

    // Update job status to processing
    await db
      .update(accountingSyncJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));

    // Fetch all customers from QuickBooks (paginated)
    const qbCustomers = await fetchAllQBEntities(
      'Customer',
      'SELECT * FROM Customer',
      (q) => makeQBRequest('GET', `/query?query=${encodeURIComponent(q)}`, undefined, organizationId),
    );
    console.log(`[QB Pull Customers] Fetched ${qbCustomers.length} QuickBooks customers`);

    let customersCreated = 0;
    let customersUpdated = 0;
    let contactsCreated = 0;
    let contactsUpdated = 0;
    let skippedContacts = 0;
    let contactsSkippedSuspicious = 0;
    let errorCount = 0;

    for (const qbCustomer of qbCustomers) {
      try {
        const localData = mapQBCustomerToLocal(qbCustomer);

        // Check if customer exists by external ID or email (org-scoped)
        const [existing] = await db
          .select()
          .from(customers)
          .where(
            or(
              and(eq(customers.organizationId, organizationId), eq(customers.externalAccountingId, qbCustomer.Id)),
              localData.email ? and(eq(customers.organizationId, organizationId), eq(customers.email, localData.email)) : sql`false`
            )
          )
          .limit(1);

        let customerId: string;

        if (existing) {
          const overrides: Record<string, boolean> = (existing as any).qbFieldOverrides || {};
          const filteredLocalData: any = { ...localData };
          // QB wins by default, unless the field is Titan-overridden.
          if (overrides.email) delete filteredLocalData.email;
          if (overrides.phone) delete filteredLocalData.phone;
          if (overrides.website) delete filteredLocalData.website;
          if (overrides.billingAddress) delete filteredLocalData.billingAddress;
          if (overrides.shippingAddress) delete filteredLocalData.shippingAddress;
          if (overrides.notes) delete filteredLocalData.notes;

          await db
            .update(customers)
            .set({ ...filteredLocalData, updatedAt: new Date() })
            .where(eq(customers.id, existing.id));

          customerId = existing.id;
          customersUpdated++;
          console.log(`[QB Pull Customers] Updated customer: ${localData.companyName}`);
        } else {
          const [created] = await db
            .insert(customers)
            .values({
              ...localData,
              customerType: 'business',
              status: 'active',
              organizationId,
            } as any)
            .returning({ id: customers.id });

          customerId = created.id;
          customersCreated++;
          console.log(`[QB Pull Customers] Created customer: ${localData.companyName}`);
        }

        // --- Contact upsert ---
        const contactPayload = mapQBCustomerToContact(qbCustomer, customerId);
        if (!contactPayload) {
          // Distinguish between "no contact data at all" and "skipped due to suspicious name"
          const derivedName = deriveQBContactName(qbCustomer);
          if (derivedName && isSuspiciousContactName(derivedName.firstName, derivedName.lastName)) {
            contactsSkippedSuspicious++;
            console.log(`[QB Pull Customers] Skipped placeholder contact for: ${localData.companyName} (suspicious name: "${derivedName.firstName}")`);
          } else {
            skippedContacts++;
          }
        } else {
          try {
            const outcome = await upsertQBContact(contactPayload);
            if (outcome === 'created') {
              contactsCreated++;
              console.log(`[QB Pull Customers] Created contact for: ${localData.companyName}`);
            } else if (outcome === 'updated') {
              contactsUpdated++;
            }
          } catch (contactErr: any) {
            console.error(`[QB Pull Customers] Contact upsert failed for customer ${localData.companyName}:`, contactErr.message);
            errorCount++;
          }
        }
      } catch (error: any) {
        console.error(`[QB Pull Customers] Error syncing customer ${qbCustomer.DisplayName}:`, error);
        errorCount++;
      }
    }

    // syncedCount kept for UI backward compat (Sync History shows "N synced")
    const syncedCount = customersCreated + customersUpdated;

    // Update job status to completed
    await db
      .update(accountingSyncJobs)
      .set({
        status: 'synced',
        updatedAt: new Date(),
        payloadJson: {
          syncedCount,
          customersCreated,
          customersUpdated,
          contactsCreated,
          contactsUpdated,
          skippedContacts,
          contactsSkippedSuspicious,
          errorCount,
          totalQuickBooksCustomers: qbCustomers.length,
        } as any,
      })
      .where(eq(accountingSyncJobs.id, jobId));

    console.log(
      `[QB Pull Customers] Completed: ${customersCreated} created, ${customersUpdated} updated, ` +
      `${contactsCreated} contacts created, ${contactsUpdated} contacts updated, ` +
      `${skippedContacts} contacts skipped (no data), ${contactsSkippedSuspicious} skipped (placeholder name), ${errorCount} errors`,
    );
  } catch (error: any) {
    console.error(`[QB Pull Customers] Job failed:`, error);
    await db
      .update(accountingSyncJobs)
      .set({
        status: 'error',
        error: error.message,
        updatedAt: new Date(),
      })
      .where(eq(accountingSyncJobs.id, jobId));
    throw error;
  }
}

/**
 * Process push sync: Push local customers to QuickBooks
 */
export async function processPushCustomers(jobId: string, organizationId: string): Promise<void> {
  const orgId = requireQuickBooksOrganizationId(organizationId, 'processPushCustomers');
  try {
    console.log(`[QB Push Customers] Starting job ${jobId}`, { organizationId: orgId });

    // Update job status to processing
    await db
      .update(accountingSyncJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));

    // Find local customers that need to be synced (no external ID or pending status)
    const localCustomers = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, orgId),
          or(
            isNull(customers.externalAccountingId),
            eq(customers.syncStatus, 'pending')
          )
        )
      );

    console.log(`[QB Push Customers] Found ${localCustomers.length} customers to sync`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const customer of localCustomers) {
      try {
        const qbCustomerData = mapLocalCustomerToQB(customer);

        let qbCustomer;
        if (customer.externalAccountingId) {
          // Update existing QB customer
          // First fetch to get SyncToken
          const existing = await makeQBRequest(
            'GET',
            `/customer/${customer.externalAccountingId}`,
            undefined,
            orgId,
          );
          qbCustomerData.Id = customer.externalAccountingId;
          qbCustomerData.SyncToken = existing.Customer.SyncToken;

          const response = await makeQBRequest('POST', '/customer', qbCustomerData, orgId);
          qbCustomer = response.Customer;
          console.log(`[QB Push Customers] Updated QB customer: ${customer.companyName}`);
        } else {
          // Create new QB customer
          const response = await makeQBRequest('POST', '/customer', qbCustomerData, orgId);
          qbCustomer = response.Customer;
          console.log(`[QB Push Customers] Created QB customer: ${customer.companyName}`);
        }

        // Update local customer with QB ID
        await db
          .update(customers)
          .set({
            externalAccountingId: qbCustomer.Id,
            syncStatus: 'synced',
            syncError: null,
            syncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(customers.id, customer.id));

        syncedCount++;
      } catch (error: any) {
        console.error(`[QB Push Customers] Error syncing customer ${customer.companyName}:`, error);
        
        // Update customer with error status
        await db
          .update(customers)
          .set({
            syncStatus: 'error',
            syncError: error.message,
            updatedAt: new Date(),
          })
          .where(eq(customers.id, customer.id));

        errorCount++;
      }
    }

    // Update job status to completed
    await db
      .update(accountingSyncJobs)
      .set({
        status: 'synced',
        updatedAt: new Date(),
        payloadJson: { syncedCount, errorCount, total: localCustomers.length } as any,
      })
      .where(eq(accountingSyncJobs.id, jobId));

    console.log(`[QB Push Customers] Completed: ${syncedCount} synced, ${errorCount} errors`);
  } catch (error: any) {
    console.error(`[QB Push Customers] Job failed:`, error);
    await db
      .update(accountingSyncJobs)
      .set({
        status: 'error',
        error: error.message,
        updatedAt: new Date(),
      })
      .where(eq(accountingSyncJobs.id, jobId));
    throw error;
  }
}

/**
 * Process pull sync: Fetch invoices from QuickBooks
 */
export async function processPullInvoices(jobId: string, organizationId: string): Promise<void> {
  try {
    console.log(`[QB Pull Invoices] Starting job ${jobId}`, { organizationId });

    const connection = await getActiveConnection(organizationId);
    if (!connection) {
      console.warn('[QB Pull Invoices] No active QuickBooks connection found', { organizationId, jobId });
      throw new Error(`QuickBooks not connected for organization ${organizationId}`);
    }

    await db
      .update(accountingSyncJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));

    const qbInvoices = await fetchAllQBEntities(
      'Invoice',
      'SELECT * FROM Invoice',
      (q) => makeQBRequest('GET', `/query?query=${encodeURIComponent(q)}`, undefined, organizationId),
    );
    console.log(`[QB Pull Invoices] Fetched ${qbInvoices.length} QuickBooks invoices`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const qbInvoice of qbInvoices) {
      try {
        // Map QB invoice to local format
        const localData: {
          invoiceNumber: number;
          customerId: string | null;
          status: string;
          issueDate: Date;
          dueDate: Date | null;
          subtotal: string;
          tax: string;
          total: string;
          balanceDue: string;
          externalAccountingId: string;
        } = {
          invoiceNumber: parseInt(qbInvoice.DocNumber) || 0,
          customerId: null, // Need to match QB customer to local
          status: mapQBInvoiceStatus(qbInvoice.Balance > 0 ? 'unpaid' : 'paid'),
          issueDate: new Date(qbInvoice.TxnDate),
          dueDate: qbInvoice.DueDate ? new Date(qbInvoice.DueDate) : null,
          subtotal: qbInvoice.TotalAmt?.toString() || '0',
          tax: qbInvoice.TxnTaxDetail?.TotalTax?.toString() || '0',
          total: qbInvoice.TotalAmt?.toString() || '0',
          balanceDue: qbInvoice.Balance?.toString() || '0',
          externalAccountingId: qbInvoice.Id,
        };

        // Try to find matching local customer by QB customer ID, scoped to this org
        if (qbInvoice.CustomerRef?.value) {
          const [matchedCustomer] = await db
            .select()
            .from(customers)
            .where(
              and(
                eq(customers.organizationId, organizationId),
                eq(customers.externalAccountingId, qbInvoice.CustomerRef.value)
              )
            )
            .limit(1);

          if (matchedCustomer) {
            localData.customerId = matchedCustomer.id;
          }
        }

        // Skip if no customer match found
        if (!localData.customerId) {
          console.warn(`[QB Pull Invoices] Skipping invoice ${qbInvoice.DocNumber} - no matching customer`, { organizationId });
          continue;
        }

        // Check if invoice exists, scoped to this org
        const [existing] = await db
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.organizationId, organizationId),
              eq(invoices.externalAccountingId, qbInvoice.Id)
            )
          )
          .limit(1);

        if (existing) {
          await db
            .update(invoices)
            .set({
              invoiceNumber: localData.invoiceNumber,
              customerId: localData.customerId,
              status: localData.status,
              issueDate: localData.issueDate,
              dueDate: localData.dueDate,
              subtotal: localData.subtotal,
              tax: localData.tax,
              total: localData.total,
              balanceDue: localData.balanceDue,
              externalAccountingId: localData.externalAccountingId,
            })
            .where(eq(invoices.id, existing.id));
          console.log(`[QB Pull Invoices] Updated invoice: ${qbInvoice.DocNumber}`);
        } else {
          // Would need createdByUserId - skip creation for now
          console.warn(`[QB Pull Invoices] Skipping new invoice ${qbInvoice.DocNumber} - requires user context`);
        }

        syncedCount++;
      } catch (error: any) {
        console.error(`[QB Pull Invoices] Error syncing invoice ${qbInvoice.DocNumber}:`, error);
        errorCount++;
      }
    }

    await db
      .update(accountingSyncJobs)
      .set({
        status: 'synced',
        updatedAt: new Date(),
        payloadJson: { syncedCount, errorCount, total: qbInvoices.length } as any,
      })
      .where(eq(accountingSyncJobs.id, jobId));

    console.log(`[QB Pull Invoices] Completed: ${syncedCount} synced, ${errorCount} errors`);
  } catch (error: any) {
    console.error(`[QB Pull Invoices] Job failed:`, error);
    await db
      .update(accountingSyncJobs)
            .set({ status: 'error', error: error.message, updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));
    throw error;
  }
}

/**
 * Process push sync: Push local invoices to QuickBooks
 */
export async function processPushInvoices(jobId: string, organizationId: string): Promise<void> {
  const orgId = requireQuickBooksOrganizationId(organizationId, 'processPushInvoices');
  try {
    console.log(`[QB Push Invoices] Starting job ${jobId}`, { organizationId: orgId });

    await db
      .update(accountingSyncJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));

    const localInvoices = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, orgId),
          sql`lower(${invoices.status}) <> 'draft'`,
          or(
            isNull(invoices.externalAccountingId),
            eq(invoices.syncStatus, 'pending')
          )
        )
      );

    console.log(`[QB Push Invoices] Found ${localInvoices.length} invoices to sync`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const invoice of localInvoices) {
      try {
        // Get customer's QB ID
        const [customer] = await db
          .select()
          .from(customers)
          .where(and(eq(customers.id, invoice.customerId), eq(customers.organizationId, orgId)))
          .limit(1);

        if (!customer?.externalAccountingId) {
          throw new Error('Customer not synced to QuickBooks');
        }

        // Build QB invoice
        const qbInvoiceData: any = {
          CustomerRef: { value: customer.externalAccountingId },
          TxnDate: invoice.issueDate.toISOString().split('T')[0],
          DueDate: invoice.dueDate?.toISOString().split('T')[0],
          Line: [], // Would need line items from invoice_line_items table
        };

        let qbInvoice;
        if (invoice.externalAccountingId) {
          // Update existing
          const existing = await makeQBRequest('GET', `/invoice/${invoice.externalAccountingId}`, undefined, orgId);
          qbInvoiceData.Id = invoice.externalAccountingId;
          qbInvoiceData.SyncToken = existing.Invoice.SyncToken;
          const response = await makeQBRequest('POST', '/invoice', qbInvoiceData, orgId);
          qbInvoice = response.Invoice;
        } else {
          // Create new
          const response = await makeQBRequest('POST', '/invoice', qbInvoiceData, orgId);
          qbInvoice = response.Invoice;
        }

        await db
          .update(invoices)
          .set({
            externalAccountingId: qbInvoice.Id,
            syncStatus: 'synced',
            syncError: null,
            syncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, invoice.id));

        syncedCount++;
      } catch (error: any) {
        console.error(`[QB Push Invoices] Error syncing invoice ${invoice.invoiceNumber}:`, error);
        await db
          .update(invoices)
          .set({ syncStatus: 'error', syncError: error.message, updatedAt: new Date() })
          .where(eq(invoices.id, invoice.id));
        errorCount++;
      }
    }

    await db
      .update(accountingSyncJobs)
      .set({
        status: 'synced',
        updatedAt: new Date(),
        payloadJson: { syncedCount, errorCount, total: localInvoices.length } as any,
      })
      .where(eq(accountingSyncJobs.id, jobId));

    console.log(`[QB Push Invoices] Completed: ${syncedCount} synced, ${errorCount} errors`);
  } catch (error: any) {
    console.error(`[QB Push Invoices] Job failed:`, error);
    await db
      .update(accountingSyncJobs)
            .set({ status: 'error', error: error.message, updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));
    throw error;
  }
}

/**
 * Map QB invoice status to local status
 */
function mapQBInvoiceStatus(qbStatus: string): string {
  const statusMap: Record<string, string> = {
    'unpaid': 'sent',
    'paid': 'paid',
    'partial': 'partially_paid',
  };
  return statusMap[qbStatus] || 'draft';
}

/**
 * Process pull sync: Fetch orders/sales receipts from QuickBooks
 */
export async function processPullOrders(jobId: string, organizationId: string): Promise<void> {
  const orgId = requireQuickBooksOrganizationId(organizationId, 'processPullOrders');
  try {
    console.log(`[QB Pull Orders] Starting job ${jobId}`, { organizationId: orgId });

    await db
      .update(accountingSyncJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));

    // QB SalesReceipt is closest to our Order concept
    const qbSalesReceipts = await fetchAllQBEntities(
      'SalesReceipt',
      'SELECT * FROM SalesReceipt',
      (q) => makeQBRequest('GET', `/query?query=${encodeURIComponent(q)}`, undefined, orgId),
    );
    console.log(`[QB Pull Orders] Fetched ${qbSalesReceipts.length} QuickBooks sales receipts`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const qbReceipt of qbSalesReceipts) {
      try {
        // Map QB sales receipt to local order format
        const localData: {
          orderNumber: string;
          customerId: string | null;
          status: string;
          priority: string;
          fulfillmentStatus: string;
          subtotal: string;
          tax: string;
          total: string;
          externalAccountingId: string;
        } = {
          orderNumber: qbReceipt.DocNumber || `QB-${qbReceipt.Id}`,
          customerId: null,
          status: 'completed',
          priority: 'normal',
          fulfillmentStatus: 'delivered',
          subtotal: qbReceipt.TotalAmt?.toString() || '0',
          tax: qbReceipt.TxnTaxDetail?.TotalTax?.toString() || '0',
          total: qbReceipt.TotalAmt?.toString() || '0',
          externalAccountingId: qbReceipt.Id,
        };

        // Find matching customer
        if (qbReceipt.CustomerRef?.value) {
          const [matchedCustomer] = await db
            .select()
            .from(customers)
            .where(and(eq(customers.organizationId, orgId), eq(customers.externalAccountingId, qbReceipt.CustomerRef.value)))
            .limit(1);

          if (matchedCustomer) {
            localData.customerId = matchedCustomer.id;
          }
        }

        if (!localData.customerId) {
          console.warn(`[QB Pull Orders] Skipping sales receipt ${qbReceipt.DocNumber} - no matching customer`);
          continue;
        }

        // Check if order exists
        const [existing] = await db
          .select()
          .from(orders)
          .where(and(eq(orders.organizationId, orgId), eq(orders.externalAccountingId, qbReceipt.Id)))
          .limit(1);

        if (existing) {
          const updateData: any = {
            orderNumber: localData.orderNumber,
            status: localData.status,
            priority: localData.priority,
            fulfillmentStatus: localData.fulfillmentStatus,
            subtotal: localData.subtotal,
            tax: localData.tax,
            total: localData.total,
            externalAccountingId: localData.externalAccountingId,
            updatedAt: new Date().toISOString()
          };

          if (localData.customerId) {
            updateData.customerId = localData.customerId;
          }

          await db
            .update(orders)
            .set(updateData)
            .where(eq(orders.id, existing.id));
          console.log(`[QB Pull Orders] Updated order: ${qbReceipt.DocNumber}`);
        } else {
          console.warn(`[QB Pull Orders] Skipping new order ${qbReceipt.DocNumber} - requires user context`);
        }

        syncedCount++;
      } catch (error: any) {
        console.error(`[QB Pull Orders] Error syncing sales receipt ${qbReceipt.DocNumber}:`, error);
        errorCount++;
      }
    }

    await db
      .update(accountingSyncJobs)
      .set({
        status: 'synced',
        updatedAt: new Date(),
        payloadJson: { syncedCount, errorCount, total: qbSalesReceipts.length } as any,
      })
      .where(eq(accountingSyncJobs.id, jobId));

    console.log(`[QB Pull Orders] Completed: ${syncedCount} synced, ${errorCount} errors`);
  } catch (error: any) {
    console.error(`[QB Pull Orders] Job failed:`, error);
    await db
      .update(accountingSyncJobs)
            .set({ status: 'error', error: error.message, updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));
    throw error;
  }
}

/**
 * Process push sync: Push local orders to QuickBooks as SalesReceipts
 */
export async function processPushOrders(jobId: string, organizationId: string): Promise<void> {
  const orgId = requireQuickBooksOrganizationId(organizationId, 'processPushOrders');
  try {
    console.log(`[QB Push Orders] Starting job ${jobId}`, { organizationId: orgId });

    await db
      .update(accountingSyncJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));

    // Only sync completed/paid orders
    const localOrders = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.organizationId, orgId),
          or(
            isNull(orders.externalAccountingId),
            eq(orders.syncStatus, 'pending')
          ),
          eq(orders.status, 'completed')
        )
      );

    console.log(`[QB Push Orders] Found ${localOrders.length} orders to sync`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const order of localOrders) {
      try {
        const resolvedOrder = order.customerId
          ? order
          : await db.transaction(async (tx) => {
              const resolution = await resolveBillingCustomerForOrder(tx, {
                organizationId: orgId,
                order: order as any,
                actorUserId: null,
              });
              await writeContactAccountingPromotionAudit(tx, {
                organizationId: orgId,
                actorUserId: null,
                orderId: order.id,
                invoiceId: null,
                customerId: resolution.customerId,
                contactId: resolution.contactId,
                resolution: resolution.resolution,
                createdCustomerId: resolution.createdCustomerId,
              });
              return { ...order, customerId: resolution.customerId };
            });
        const resolvedCustomerId = resolvedOrder.customerId;
        if (!resolvedCustomerId) throw new Error('ORDER_CUSTOMER_REQUIRED_FOR_QUICKBOOKS: Unable to resolve a billing customer before QuickBooks export');
        const [customer] = await db
          .select()
          .from(customers)
          .where(and(eq(customers.id, resolvedCustomerId), eq(customers.organizationId, orgId)))
          .limit(1);

        if (!customer) throw new Error('Customer not found for QuickBooks export');
        const qbCustomerId = await ensureQBCustomerIdForLocalCustomer(orgId, customer as any);

        // Build QB sales receipt
        const qbReceiptData: any = {
          CustomerRef: { value: qbCustomerId },
          TxnDate: new Date(order.createdAt).toISOString().split('T')[0],
          Line: [], // Would need line items
        };

        const response = await makeQBRequest('POST', '/salesreceipt', qbReceiptData, orgId);
        const qbReceipt = response.SalesReceipt;

        await db
          .update(orders)
          .set({
            externalAccountingId: qbReceipt.Id,
            syncStatus: 'synced',
            syncError: null,
            syncedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(orders.id, order.id));

        syncedCount++;
      } catch (error: any) {
        console.error(`[QB Push Orders] Error syncing order ${order.orderNumber}:`, error);
        await db
          .update(orders)
          .set({ syncStatus: 'error', syncError: error.message, updatedAt: new Date().toISOString() })
          .where(eq(orders.id, order.id));
        errorCount++;
      }
    }

    await db
      .update(accountingSyncJobs)
      .set({
        status: 'synced',
        updatedAt: new Date(),
        payloadJson: { syncedCount, errorCount, total: localOrders.length } as any,
      })
      .where(eq(accountingSyncJobs.id, jobId));

    console.log(`[QB Push Orders] Completed: ${syncedCount} synced, ${errorCount} errors`);
  } catch (error: any) {
    console.error(`[QB Push Orders] Job failed:`, error);
    await db
      .update(accountingSyncJobs)
            .set({ status: 'error', error: error.message, updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));
    throw error;
  }
}

// ==================== QB Invoice Preview & Import ====================

export type QBReferenceDebugField = {
  name: string | null;
  type: string | null;
  value: string | null;
};

export type QBReferenceDebug = {
  customFields: QBReferenceDebugField[];
  privateNote: string | null;
  customerMemo: string | null;
  lineDescriptions: string[];
  docNumber: string | null;
  txnDate: string | null;
};

export type QBInvoiceImportClassification = 'open_ar' | 'historical';
export type QBInvoiceImportOverride = QBInvoiceImportClassification | 'skip';

export type QBInvoiceMappingDiagnostic = {
  qbField: string;
  titanField: string | null;
  status: 'mapped' | 'ignored' | 'empty' | 'unknown';
  fallbackBehavior: string | null;
  truncationBehavior: string | null;
  valuePreview: string | null;
};

export type QBInvoicePayloadInspection = {
  rawPayload: any;
  mappedDraft: Record<string, any>;
  classification: {
    suggested: QBInvoiceImportClassification;
    rationale: string;
  };
  exclusionReasons: string[];
  warningReasons: string[];
  unmappedFields: string[];
  mappingCoverage: {
    mapped: string[];
    ignored: string[];
    empty: string[];
    unknown: string[];
  };
  mappingDiagnostics: QBInvoiceMappingDiagnostic[];
  poLikeCandidates: Array<{
    qbField: string;
    value: string;
    mapped: boolean;
    destination: string | null;
  }>;
};

export type QBInvoicePreviewRow = {
  qbInvoiceId: string;
  qbDocNumber: string;
  customerRefName: string;
  qbCustomerRefId: string | null;
  localCustomerId: string | null;
  localCustomerName: string | null;
  txnDate: string;
  dueDate: string | null;
  totalAmt: number;
  balance: number;
  classification: 'open_ar' | 'historical';
  alreadyImported: boolean;
  localInvoiceId: string | null;
  canImport: boolean;
  cannotImportReason?: string;
  exclusionReasons: string[];
  warningReasons: string[];
  customerPoNumber: string | null;
  customerPoSource: string | null;
  referenceDebug?: QBReferenceDebug;
  inspection?: QBInvoicePayloadInspection;
};

/**
 * Classify a QB invoice as open A/R or historical based on its balance.
 */
function classifyQBInvoice(qbInvoice: any): 'open_ar' | 'historical' {
  return Number(qbInvoice.Balance ?? 0) > 0 ? 'open_ar' : 'historical';
}

/**
 * Custom field names that indicate an explicit customer PO number.
 * Checked case-insensitively after normalizing internal whitespace.
 */
const QB_PO_FIELD_NAMES = new Set([
  'po', 'p.o.', 'po number', 'p.o. number',
  'purchase order', 'purchase order number',
  'customer po', 'customer po number',
  'client po', 'buyer po',
]);

/**
 * Custom field names that indicate a useful job/reference description.
 * Used as a fallback when no explicit PO is found.
 * Checked case-insensitively after normalizing internal whitespace.
 */
const QB_REFERENCE_FIELD_NAMES = new Set([
  'ref', 'ref #', 'reference',
  'customer reference', 'client reference',
  'job', 'job name', 'job description',
  'project', 'project name',
  'description', 'work description',
  'order description', 'invoice description',
]);

/**
 * Conservative regex for extracting an explicit PO value from free-text fields.
 * Requires a recognizable PO label followed by a separator and a value token.
 * Does NOT match bare numbers or unlabelled text.
 */
const QB_PO_TEXT_PATTERN = /(?:PO|P\.O\.|Purchase\s+Order(?:\s+Number)?|Customer\s+PO(?:\s+Number)?|Client\s+PO|Buyer\s+PO)\s*[:#\s]\s*([A-Za-z0-9\-\/]{1,50})/i;

/**
 * Generic boilerplate phrases that should NOT be stored as a job description.
 * Tested case-insensitively as a substring match against the memo/note text.
 */
const QB_GENERIC_MEMO_FRAGMENTS = [
  'thank you for your business',
  'have a great day',
  'we appreciate your business',
  'thanks for your order',
  'please remit payment',
  'payment is due',
  'terms and conditions',
  'thank you for choosing',
];

/**
 * Returns true if the text is likely generic boilerplate with no useful reference content.
 * A short text with at least one generic fragment is rejected.
 */
function isGenericBoilerplate(text: string): boolean {
  const lower = text.toLowerCase();
  return QB_GENERIC_MEMO_FRAGMENTS.some(fragment => lower.includes(fragment));
}

/**
 * Returns true if a line description string contains useful textual content.
 * Rejects: empty, whitespace-only, numeric-only, and very short strings.
 */
function isMeaningfulLineDesc(desc: string): boolean {
  const trimmed = desc.trim();
  if (trimmed.length < 2) return false;
  // Must contain at least one letter
  if (!/[A-Za-z]/.test(trimmed)) return false;
  return true;
}

/**
 * Join up to maxItems meaningful descriptions with ' / ', truncated to maxLen chars.
 * Truncates cleanly at a word boundary with '...' if needed.
 */
function joinLineDescs(descs: string[], maxItems: number, maxLen: number): string {
  const joined = descs.slice(0, maxItems).join(' / ');
  if (joined.length <= maxLen) return joined;
  // Truncate at last word boundary before maxLen - 3 (room for '...')
  const cutoff = joined.lastIndexOf(' ', maxLen - 3);
  return cutoff > 0 ? joined.slice(0, cutoff) + '...' : joined.slice(0, maxLen - 3) + '...';
}

/**
 * Extract a customer PO / Description from a QB invoice.
 *
 * The stored field (customer_po_number) is treated as "PO / Description":
 * - If an explicit PO is found, use it (highest fidelity).
 * - If not, fall back to useful reference/description data in priority order.
 *
 * Extraction priority:
 *   A0. CustomField named "sales1" (legacy InfoFloPrint PO/reference) → source: 'custom_field_sales1'
 *   A.  CustomField with PO name       → source: 'custom_field'
 *   B.  Explicit PO pattern in PrivateNote → source: 'private_note'
 *   C.  Explicit PO pattern in CustomerMemo → source: 'customer_memo'
 *   D.  Explicit PO pattern in any Line description → source: 'line_description'
 *   E.  CustomField with reference name → source: 'custom_field_reference'
 *   F.  CustomerMemo if concise and not generic boilerplate → source: 'customer_memo'
 *   G.  PrivateNote if concise and not generic boilerplate → source: 'private_note'
 *   H.  Joined meaningful line descriptions → source: 'line_description'
 *   I.  Nothing reliable found → null / null
 *
 * Returns { poNumber, source } or { null, null }.
 * Never logs raw invoice payloads.
 */
export function extractQBInvoiceCustomerPo(qbInvoice: any): { poNumber: string | null; source: string | null } {
  // ── A0. CustomField named "sales1" — legacy InfoFloPrint PO/reference ─────
  // This field is populated by the legacy InfoFloPrint system and contains the
  // customer PO or job reference. It must take priority over all other fields.
  if (Array.isArray(qbInvoice.CustomField)) {
    for (const field of qbInvoice.CustomField) {
      const name = String(field.Name ?? '').toLowerCase().trim();
      if (name !== 'sales1') continue;
      const value = String(field.StringValue ?? '').trim();
      if (value) return { poNumber: value.slice(0, 100), source: 'custom_field_sales1' };
    }
  }

  // ── A. CustomField with explicit PO name ──────────────────────────────────
  let referenceFieldValue: string | null = null; // save any reference field for step E
  if (Array.isArray(qbInvoice.CustomField)) {
    for (const field of qbInvoice.CustomField) {
      const name = String(field.Name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
      const value = String(field.StringValue ?? '').trim();
      if (!value) continue;
      if (QB_PO_FIELD_NAMES.has(name)) {
        return { poNumber: value.slice(0, 100), source: 'custom_field' };
      }
      // Collect first non-empty reference field value for step E
      if (referenceFieldValue === null && QB_REFERENCE_FIELD_NAMES.has(name)) {
        referenceFieldValue = value;
      }
    }
  }

  // ── B. Explicit PO pattern in PrivateNote ────────────────────────────────
  const privateNote = String(qbInvoice.PrivateNote ?? '').trim();
  if (privateNote) {
    const m = privateNote.match(QB_PO_TEXT_PATTERN);
    if (m?.[1]) {
      return { poNumber: m[1].trim().slice(0, 100), source: 'private_note' };
    }
  }

  // ── C. Explicit PO pattern in CustomerMemo ───────────────────────────────
  const customerMemoValue = qbInvoice.CustomerMemo?.value ?? qbInvoice.CustomerMemo ?? '';
  const customerMemo = String(customerMemoValue).trim();
  if (customerMemo) {
    const m = customerMemo.match(QB_PO_TEXT_PATTERN);
    if (m?.[1]) {
      return { poNumber: m[1].trim().slice(0, 100), source: 'customer_memo' };
    }
  }

  // ── D. Explicit PO pattern in any Line description ───────────────────────
  if (Array.isArray(qbInvoice.Line)) {
    for (const line of qbInvoice.Line) {
      const desc = String(line.Description ?? '').trim();
      if (desc) {
        const m = desc.match(QB_PO_TEXT_PATTERN);
        if (m?.[1]) {
          return { poNumber: m[1].trim().slice(0, 100), source: 'line_description' };
        }
      }
    }
  }

  // ── E. CustomField with reference/description name ───────────────────────
  if (referenceFieldValue) {
    return { poNumber: referenceFieldValue.slice(0, 100), source: 'custom_field_reference' };
  }

  // ── F. CustomerMemo — useful and not generic boilerplate ─────────────────
  if (customerMemo && !isGenericBoilerplate(customerMemo)) {
    return { poNumber: customerMemo.slice(0, 100), source: 'customer_memo' };
  }

  // ── G. PrivateNote — useful and not generic boilerplate ──────────────────
  if (privateNote && !isGenericBoilerplate(privateNote)) {
    return { poNumber: privateNote.slice(0, 100), source: 'private_note' };
  }

  // ── H. Meaningful line descriptions joined as fallback ───────────────────
  if (Array.isArray(qbInvoice.Line)) {
    const seen = new Set<string>();
    const meaningful: string[] = [];
    for (const line of qbInvoice.Line) {
      const desc = String(line.Description ?? '').trim();
      if (isMeaningfulLineDesc(desc) && !seen.has(desc)) {
        seen.add(desc);
        meaningful.push(desc);
      }
    }
    if (meaningful.length > 0) {
      const joined = joinLineDescs(meaningful, 5, 100);
      return { poNumber: joined, source: 'line_description' };
    }
  }

  // ── I. Nothing found ─────────────────────────────────────────────────────
  return { poNumber: null, source: null };
}

/**
 * Produce a safe diagnostic summary of QB invoice fields relevant to PO / reference detection.
 *
 * Rules:
 *   - Only surfaces fields useful for understanding where PO/reference data lives.
 *   - Trims and collapses whitespace; limits each string to 300 characters.
 *   - Never includes tokens, auth headers, realmId, or connection metadata.
 *   - Does not include the full raw invoice payload.
 */
export function summarizeQBInvoiceReferenceFields(qbInvoice: any): QBReferenceDebug {
  const cap = (s: string | null | undefined): string | null => {
    if (s == null) return null;
    const trimmed = String(s).replace(/\s+/g, ' ').trim();
    return trimmed.length > 0 ? trimmed.slice(0, 300) : null;
  };

  // CustomField array — include all entries (not just PO-matching ones, so admin sees everything)
  const customFields: QBReferenceDebugField[] = Array.isArray(qbInvoice.CustomField)
    ? qbInvoice.CustomField.map((f: any): QBReferenceDebugField => ({
        name: cap(f.Name) ?? null,
        type: cap(f.Type) ?? null,
        value: cap(f.StringValue) ?? cap(f.DateValue) ?? cap(f.NumberValue) ?? null,
      }))
    : [];

  // PrivateNote
  const privateNote = cap(qbInvoice.PrivateNote);

  // CustomerMemo — handles both { value: "..." } and plain string
  const customerMemoRaw = qbInvoice.CustomerMemo?.value ?? qbInvoice.CustomerMemo ?? null;
  const customerMemo = cap(customerMemoRaw);

  // Line descriptions — collect unique non-empty Description values from all lines
  const lineDescriptions: string[] = [];
  if (Array.isArray(qbInvoice.Line)) {
    const seen = new Set<string>();
    for (const line of qbInvoice.Line) {
      const desc = cap(line.Description);
      if (desc && !seen.has(desc)) {
        seen.add(desc);
        lineDescriptions.push(desc);
      }
      if (lineDescriptions.length >= 10) break; // cap at 10 lines
    }
  }

  return {
    customFields,
    privateNote,
    customerMemo,
    lineDescriptions,
    docNumber: cap(qbInvoice.DocNumber),
    txnDate: cap(qbInvoice.TxnDate),
  };
}

/**
 * Fetch all QB invoices and return a preview with local match status.
 * Read-only — no writes to any table.
 */
function previewScalar(value: unknown, maxLen = 220): string | null {
  if (value == null) return null;
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const trimmed = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 3)}...` : trimmed;
}

function hasQBValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return String(value).trim().length > 0;
}

function pushMappingDiagnostic(
  diagnostics: QBInvoiceMappingDiagnostic[],
  coverage: QBInvoicePayloadInspection['mappingCoverage'],
  diagnostic: QBInvoiceMappingDiagnostic,
) {
  diagnostics.push(diagnostic);
  coverage[diagnostic.status].push(diagnostic.qbField);
}

function collectQBInvoicePoLikeCandidates(qbInvoice: any, mappedSource: string | null): QBInvoicePayloadInspection['poLikeCandidates'] {
  const candidates: QBInvoicePayloadInspection['poLikeCandidates'] = [];
  const add = (qbField: string, rawValue: unknown, source: string | null) => {
    const value = previewScalar(rawValue, 300);
    if (!value) return;
    const looksUseful = /po|p\.o\.|purchase|ref|reference|job|project|description|proof|poster|podium|sign/i.test(`${qbField} ${value}`);
    if (!looksUseful) return;
    candidates.push({
      qbField,
      value,
      mapped: source !== null && source === mappedSource,
      destination: source !== null && source === mappedSource ? 'invoices.customerPoNumber' : null,
    });
  };

  add('CustomerMemo', qbInvoice.CustomerMemo?.value ?? qbInvoice.CustomerMemo, 'customer_memo');
  add('PrivateNote', qbInvoice.PrivateNote, 'private_note');

  if (Array.isArray(qbInvoice.CustomField)) {
    qbInvoice.CustomField.forEach((field: any, index: number) => {
      const fieldName = String(field?.Name ?? '').toLowerCase().trim();
      const qbFieldLabel = `CustomField[${index}]${field?.Name ? `.${field.Name}` : ''}`;
      const rawValue = field?.StringValue ?? field?.DateValue ?? field?.NumberValue;
      const isSales1 = fieldName === 'sales1';
      // sales1 is always included (it is the legacy InfoFloPrint PO/reference field)
      // Other custom fields are filtered by usefulness
      if (isSales1) {
        const value = previewScalar(rawValue, 300);
        if (value) {
          candidates.push({
            qbField: qbFieldLabel,
            value,
            mapped: mappedSource === 'custom_field_sales1',
            destination: mappedSource === 'custom_field_sales1' ? 'invoices.customerPoNumber' : null,
          });
        }
      } else {
        const cfSource = mappedSource === 'custom_field' || mappedSource === 'custom_field_reference' ? mappedSource : null;
        add(qbFieldLabel, rawValue, cfSource);
      }
    });
  }

  if (Array.isArray(qbInvoice.Line)) {
    qbInvoice.Line.forEach((line: any, index: number) => {
      add(`Line[${index}].Description`, line?.Description, 'line_description');
    });
  }

  return candidates;
}

function buildQBInvoiceMappedDraft(params: {
  qbInvoice: any;
  localCustomerId: string | null;
  classification: QBInvoiceImportClassification;
  customerPoNumber: string | null;
  customerPoSource: string | null;
}): Record<string, any> {
  const { qbInvoice, localCustomerId, classification, customerPoNumber, customerPoSource } = params;
  const balance = Number(qbInvoice.Balance ?? 0);
  const totalAmt = Number(qbInvoice.TotalAmt ?? 0);
  const taxAmt = Number(qbInvoice.TxnTaxDetail?.TotalTax ?? 0);
  const amountPaid = Math.max(0, totalAmt - balance);
  const isHistorical = classification === 'historical';

  return {
    customerId: localCustomerId,
    status: isHistorical ? 'paid' : (balance > 0 ? 'billed' : 'paid'),
    issueDate: qbInvoice.TxnDate ?? null,
    dueDate: qbInvoice.DueDate ?? null,
    subtotal: totalAmt.toFixed(2),
    tax: taxAmt.toFixed(2),
    total: totalAmt.toFixed(2),
    amountPaid: amountPaid.toFixed(2),
    balanceDue: balance.toFixed(2),
    externalAccountingId: qbInvoice.Id ?? null,
    qbInvoiceId: qbInvoice.Id ?? null,
    qbSyncStatus: 'synced',
    syncStatus: 'synced',
    importSource: 'quickbooks',
    isHistorical,
    qbImportBalanceDue: balance.toFixed(2),
    qbDocNumber: qbInvoice.DocNumber ?? null,
    qbLineItemsSnapshot: Array.isArray(qbInvoice.Line) ? qbInvoice.Line : null,
    lockedReason: isHistorical ? 'historical_import' : 'quickbooks_import',
    customerPoNumber,
    qbPoSource: customerPoSource,
  };
}

function buildQBInvoicePayloadInspection(params: {
  qbInvoice: any;
  localCustomerId: string | null;
  classification: QBInvoiceImportClassification;
  exclusionReasons: string[];
  warningReasons: string[];
  customerPoNumber: string | null;
  customerPoSource: string | null;
}): QBInvoicePayloadInspection {
  const { qbInvoice, localCustomerId, classification, exclusionReasons, warningReasons, customerPoNumber, customerPoSource } = params;
  const mappedDraft = buildQBInvoiceMappedDraft({ qbInvoice, localCustomerId, classification, customerPoNumber, customerPoSource });
  const coverage: QBInvoicePayloadInspection['mappingCoverage'] = { mapped: [], ignored: [], empty: [], unknown: [] };
  const diagnostics: QBInvoiceMappingDiagnostic[] = [];

  const addField = (
    qbField: string,
    value: unknown,
    titanField: string | null,
    statusWhenPresent: 'mapped' | 'ignored',
    fallbackBehavior: string | null = null,
    truncationBehavior: string | null = null,
  ) => {
    const present = hasQBValue(value);
    pushMappingDiagnostic(diagnostics, coverage, {
      qbField,
      titanField: present ? titanField : null,
      status: present ? statusWhenPresent : 'empty',
      fallbackBehavior,
      truncationBehavior,
      valuePreview: previewScalar(value),
    });
  };

  addField('Id', qbInvoice.Id, 'invoices.externalAccountingId / invoices.qbInvoiceId', 'mapped');
  addField('DocNumber', qbInvoice.DocNumber, 'invoices.qbDocNumber', 'mapped');
  addField('CustomerRef', qbInvoice.CustomerRef, 'invoices.customerId', 'mapped', 'Matched by CustomerRef.value to org-scoped customers.externalAccountingId.');
  addField('TxnDate', qbInvoice.TxnDate, 'invoices.issueDate', 'mapped');
  addField('DueDate', qbInvoice.DueDate, 'invoices.dueDate', 'mapped');
  addField('TotalAmt', qbInvoice.TotalAmt, 'invoices.subtotal / invoices.total / invoices.totalCents', 'mapped');
  addField('Balance', qbInvoice.Balance, 'invoices.balanceDue / invoices.qbImportBalanceDue / classification', 'mapped');
  addField('TxnTaxDetail.TotalTax', qbInvoice.TxnTaxDetail?.TotalTax, 'invoices.tax / invoices.taxCents', 'mapped');
  addField('Line', qbInvoice.Line, 'invoices.qbLineItemsSnapshot', 'mapped', 'Stored as structured QBInvoiceLineItemDetail[] snapshot (with parsedDetails); not written to production-coupled invoice_line_items.');
  addField('Line[].Description', Array.isArray(qbInvoice.Line) ? qbInvoice.Line.map((line: any) => line?.Description).filter(hasQBValue) : null, customerPoSource === 'line_description' ? 'invoices.customerPoNumber' : null, customerPoSource === 'line_description' ? 'mapped' : 'ignored', 'Can be fallback source for customerPoNumber when useful line descriptions are found.', 'Joined fallback is capped at 100 characters.');
  addField('CustomerMemo', qbInvoice.CustomerMemo?.value ?? qbInvoice.CustomerMemo, customerPoSource === 'customer_memo' ? 'invoices.customerPoNumber' : null, customerPoSource === 'customer_memo' ? 'mapped' : 'ignored', 'Can be fallback source for customerPoNumber unless it looks like boilerplate.', 'Stored customerPoNumber is capped at 100 characters.');
  addField('PrivateNote', qbInvoice.PrivateNote, customerPoSource === 'private_note' ? 'invoices.customerPoNumber' : null, customerPoSource === 'private_note' ? 'mapped' : 'ignored', 'Can be fallback source for customerPoNumber when an explicit PO or useful note is found.', 'Stored customerPoNumber is capped at 100 characters.');
  addField('CustomField[]', qbInvoice.CustomField, customerPoSource === 'custom_field' || customerPoSource === 'custom_field_reference' || customerPoSource === 'custom_field_sales1' ? 'invoices.customerPoNumber' : null, customerPoSource === 'custom_field' || customerPoSource === 'custom_field_reference' || customerPoSource === 'custom_field_sales1' ? 'mapped' : 'ignored', 'sales1 field (InfoFloPrint legacy) wins first; PO-named fields next; reference-named fields are fallback.', 'Stored customerPoNumber is capped at 100 characters.');
  addField('BillAddr', qbInvoice.BillAddr, null, 'ignored');
  addField('ShipAddr', qbInvoice.ShipAddr, null, 'ignored');

  const knownTopLevelFields = new Set([
    'Id', 'DocNumber', 'CustomerRef', 'TxnDate', 'DueDate', 'TotalAmt', 'Balance',
    'TxnTaxDetail', 'Line', 'CustomerMemo', 'PrivateNote', 'CustomField', 'BillAddr', 'ShipAddr',
    'SyncToken', 'MetaData', 'domain', 'sparse', 'LinkedTxn', 'EmailStatus', 'PrintStatus',
    'AllowIPNPayment', 'AllowOnlinePayment', 'AllowOnlineCreditCardPayment', 'AllowOnlineACHPayment',
    'CurrencyRef', 'ExchangeRate', 'HomeTotalAmt', 'HomeBalance', 'Deposit', 'ApplyTaxAfterDiscount',
    'SalesTermRef', 'BillEmail', 'DeliveryInfo', 'TxnSource', 'GlobalTaxCalculation',
  ]);

  for (const fieldName of ['SyncToken', 'MetaData', 'domain', 'sparse', 'LinkedTxn', 'EmailStatus', 'PrintStatus', 'CurrencyRef', 'ExchangeRate', 'HomeTotalAmt', 'HomeBalance', 'BillEmail', 'SalesTermRef']) {
    if (fieldName in qbInvoice) {
      addField(fieldName, qbInvoice[fieldName], null, 'ignored');
    }
  }

  for (const fieldName of Object.keys(qbInvoice)) {
    if (!knownTopLevelFields.has(fieldName)) {
      const present = hasQBValue(qbInvoice[fieldName]);
      pushMappingDiagnostic(diagnostics, coverage, {
        qbField: fieldName,
        titanField: null,
        status: present ? 'unknown' : 'empty',
        fallbackBehavior: null,
        truncationBehavior: null,
        valuePreview: previewScalar(qbInvoice[fieldName]),
      });
    }
  }

  const unmappedFields = Array.from(new Set([...coverage.ignored, ...coverage.unknown]));

  return {
    rawPayload: qbInvoice,
    mappedDraft,
    classification: {
      suggested: classification,
      rationale: Number(qbInvoice.Balance ?? 0) > 0
        ? 'Balance is greater than 0, so the existing backend logic classifies this invoice as Open A/R.'
        : 'Balance is 0 or missing, so the existing backend logic classifies this invoice as Historical.',
    },
    exclusionReasons,
    warningReasons,
    unmappedFields,
    mappingCoverage: {
      mapped: Array.from(new Set(coverage.mapped)),
      ignored: Array.from(new Set(coverage.ignored)),
      empty: Array.from(new Set(coverage.empty)),
      unknown: Array.from(new Set(coverage.unknown)),
    },
    mappingDiagnostics: diagnostics,
    poLikeCandidates: collectQBInvoicePoLikeCandidates(qbInvoice, customerPoSource),
  };
}

async function buildQBInvoicePreviewRows(organizationId: string, qbInvoices: any[], includeReferenceDebug = false): Promise<QBInvoicePreviewRow[]> {
  console.log(`[QB Preview Invoices] Building ${qbInvoices.length} QuickBooks invoice preview rows`);

  // All QB-linked local customers for this org
  const localCustomers = await db
    .select({ id: customers.id, companyName: customers.companyName, externalAccountingId: customers.externalAccountingId })
    .from(customers)
    .where(and(
      eq(customers.organizationId, organizationId),
      isNotNull(customers.externalAccountingId),
    ));

  const customerByQBId = new Map(localCustomers.map(c => [c.externalAccountingId!, c]));

  // All QB-linked local invoices for this org
  const localInvoices = await db
    .select({ id: invoices.id, externalAccountingId: invoices.externalAccountingId, qbInvoiceId: invoices.qbInvoiceId })
    .from(invoices)
    .where(and(
      eq(invoices.organizationId, organizationId),
      or(isNotNull(invoices.externalAccountingId), isNotNull(invoices.qbInvoiceId)),
    ));

  const invoiceByQBId = new Map<string, string>();
  for (const invoice of localInvoices) {
    if (invoice.externalAccountingId) invoiceByQBId.set(invoice.externalAccountingId, invoice.id);
    if (invoice.qbInvoiceId) invoiceByQBId.set(invoice.qbInvoiceId, invoice.id);
  }

  return qbInvoices.map((qbInvoice): QBInvoicePreviewRow => {
    const qbCustomerRefId: string | null = qbInvoice.CustomerRef?.value ?? null;
    const localCustomer = qbCustomerRefId ? (customerByQBId.get(qbCustomerRefId) ?? null) : null;
    const alreadyImported = invoiceByQBId.has(qbInvoice.Id);
    const exclusionReasons: string[] = [];
    const warningReasons: string[] = [];

    let classification: 'open_ar' | 'historical';
    try {
      classification = classifyQBInvoice(qbInvoice);
    } catch {
      classification = 'historical';
      exclusionReasons.push('classification_failed');
    }

    const { poNumber: customerPoNumber, source: customerPoSource } = extractQBInvoiceCustomerPo(qbInvoice);

    let canImport = true;
    let cannotImportReason: string | undefined;
    if (!localCustomer) {
      exclusionReasons.push('missing_customer');
    }
    if (alreadyImported) {
      warningReasons.push('already_imported');
    }
    if (!qbInvoice.Id) {
      canImport = false;
      exclusionReasons.push('validation_error');
      cannotImportReason = 'QuickBooks invoice is missing Id';
    }
    if (!hasQBValue(qbInvoice.CustomerRef)) {
      canImport = false;
      if (!exclusionReasons.includes('missing_customer')) exclusionReasons.push('missing_customer');
      cannotImportReason = 'QuickBooks invoice is missing CustomerRef';
    }
    if (!localCustomer) {
      canImport = false;
      cannotImportReason = 'No matching local customer — pull customers first';
    }
    if (exclusionReasons.includes('classification_failed')) {
      canImport = false;
      cannotImportReason = cannotImportReason ?? 'Could not determine invoice classification';
    }
    if (!qbInvoice.DocNumber) {
      warningReasons.push('missing_invoice_number');
    }
    if (qbInvoice.TotalAmt == null) {
      warningReasons.push('missing_total');
    }

    return {
      qbInvoiceId: qbInvoice.Id,
      qbDocNumber: qbInvoice.DocNumber ?? '',
      customerRefName: qbInvoice.CustomerRef?.name ?? '',
      qbCustomerRefId,
      localCustomerId: localCustomer?.id ?? null,
      localCustomerName: localCustomer?.companyName ?? null,
      txnDate: qbInvoice.TxnDate ?? '',
      dueDate: qbInvoice.DueDate ?? null,
      totalAmt: Number(qbInvoice.TotalAmt ?? 0),
      balance: Number(qbInvoice.Balance ?? 0),
      classification,
      alreadyImported,
      localInvoiceId: invoiceByQBId.get(qbInvoice.Id) ?? null,
      canImport,
      cannotImportReason,
      exclusionReasons,
      warningReasons,
      customerPoNumber,
      customerPoSource,
      ...(includeReferenceDebug ? { referenceDebug: summarizeQBInvoiceReferenceFields(qbInvoice) } : {}),
      ...(includeReferenceDebug ? {
        inspection: buildQBInvoicePayloadInspection({
          qbInvoice,
          localCustomerId: localCustomer?.id ?? null,
          classification,
          exclusionReasons,
          warningReasons,
          customerPoNumber,
          customerPoSource,
        }),
      } : {}),
    };
  });
}

export type QBInvoicePreviewScope = 'open_ar' | 'historical' | 'all_unsynced';
export type QBInvoicePreviewPage = Readonly<{ rows: QBInvoicePreviewRow[]; scope: QBInvoicePreviewScope; page: number; pageSize: number; sourceTotal: number | null; sourceRowsOnPage: number; alreadyImportedExcludedOnPage: number; hasNextPage: boolean }>;

/** A bounded, provider-filtered compatibility-import preview.  It never mutates V2 Billing. */
export async function fetchQBInvoicePreviewPage(input: { organizationId: string; scope: QBInvoicePreviewScope; page: number; pageSize: number; includeReferenceDebug?: boolean }): Promise<QBInvoicePreviewPage> {
  const page = Math.max(1, Math.floor(input.page));
  const pageSize = Math.max(1, Math.min(200, Math.floor(input.pageSize)));
  const whereClause = input.scope === 'open_ar' ? " WHERE Balance > '0'" : input.scope === 'historical' ? " WHERE Balance <= '0'" : '';
  const startPosition = ((page - 1) * pageSize) + 1;
  const query = `SELECT * FROM Invoice${whereClause} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`;
  const response = await makeQBRequest('GET', `/query?query=${encodeURIComponent(query)}`, undefined, input.organizationId);
  const qbInvoices: any[] = Array.isArray(response?.QueryResponse?.Invoice) ? response.QueryResponse.Invoice : [];
  const sourceTotalValue = Number(response?.QueryResponse?.totalCount);
  const sourceTotal = Number.isFinite(sourceTotalValue) ? sourceTotalValue : null;
  const allRows = await buildQBInvoicePreviewRows(input.organizationId, qbInvoices, input.includeReferenceDebug === true);
  const rows = allRows.filter((row) => !row.alreadyImported);
  return { rows, scope: input.scope, page, pageSize, sourceTotal, sourceRowsOnPage: allRows.length, alreadyImportedExcludedOnPage: allRows.length - rows.length, hasNextPage: sourceTotal !== null ? startPosition + allRows.length <= sourceTotal : allRows.length === pageSize };
}

/**
 * Import a list of QB invoices (identified by QB Invoice Id) into TitanOS.
 *
 * Safety contract:
 *   - Does NOT create orders, production jobs, or any workflow records.
 *   - Does NOT trigger invoice email send or reminder logic.
 *   - Does NOT enqueue a QB push sync for the imported invoices.
 *   - Line items are NOT imported into invoice_line_items (production-coupled table);
 *     the raw QB Line array is stored as qbLineItemsSnapshot on the invoice row.
 *   - createdByUserId must be supplied by the caller (the admin user from req.user).
 *
 * PO preservation rules on update:
 *   - If existing invoice has a manually-entered PO (importSource != 'quickbooks') → keep it.
 *   - If existing invoice is QB-imported and QB now provides a PO → update it.
 *   - If existing invoice is QB-imported and QB provides null PO → leave existing PO as-is.
 */
export type QBInvoiceImportResult = {
  created: number;
  updated: number;
  skipped: number;
  excluded: number;
  failed: number;
  importedOpenAr: number;
  importedHistorical: number;
  numberingConflicts: number;
  errors: string[];
};

export async function importQBInvoicesByIds(
  organizationId: string,
  qbInvoiceIds: string[],
  mode: 'auto' | 'open_ar' | 'historical',
  createdByUserId: string,
  perInvoiceModes: Record<string, QBInvoiceImportOverride> = {},
): Promise<QBInvoiceImportResult> {
  const result: QBInvoiceImportResult = { created: 0, updated: 0, skipped: 0, excluded: 0, failed: 0, importedOpenAr: 0, importedHistorical: 0, numberingConflicts: 0, errors: [] };

  if (qbInvoiceIds.length === 0) return result;

  // Fetch the specified invoices from QB in batches (QB query API: WHERE Id IN (...), max 1000 per request)
  const QB_BATCH_SIZE = 1000;
  const qbInvoices: any[] = [];
  const seenInvoiceIds = new Set<string>();

  for (let i = 0; i < qbInvoiceIds.length; i += QB_BATCH_SIZE) {
    const batch = qbInvoiceIds.slice(i, i + QB_BATCH_SIZE);
    const idList = batch.map(id => `'${String(id).replace(/'/g, '')}'`).join(', ');
    const query = `SELECT * FROM Invoice WHERE Id IN (${idList}) MAXRESULTS ${QB_BATCH_SIZE}`;
    const response = await makeQBRequest('GET', `/query?query=${encodeURIComponent(query)}`, undefined, organizationId);
    const page: any[] = response.QueryResponse?.Invoice || [];
    for (const inv of page) {
      if (!seenInvoiceIds.has(inv.Id)) {
        seenInvoiceIds.add(inv.Id);
        qbInvoices.push(inv);
      }
    }
  }

  if (qbLogsEnabled()) {
    console.log(`[QB Import Invoices] Requested ${qbInvoiceIds.length} IDs, QB returned ${qbInvoices.length}`, { organizationId });
  }

  for (const qbInvoice of qbInvoices) {
    try {
      const rowOverride = perInvoiceModes[String(qbInvoice.Id)] ?? null;
      if (rowOverride === 'skip') {
        result.skipped++;
        continue;
      }
      const classification: 'open_ar' | 'historical' =
        rowOverride === 'open_ar' || rowOverride === 'historical'
          ? rowOverride
          : mode === 'auto'
          ? classifyQBInvoice(qbInvoice)
          : mode;
      const isHistorical = classification === 'historical';
      const balance = Number(qbInvoice.Balance ?? 0);
      const totalAmt = Number(qbInvoice.TotalAmt ?? 0);
      const taxAmt = Number(qbInvoice.TxnTaxDetail?.TotalTax ?? 0);
      const amountPaid = Math.max(0, totalAmt - balance);
      const qbCustomerRefId: string | null = qbInvoice.CustomerRef?.value ?? null;
      // Store structured/parsed line snapshots (not raw QB Line array) so imported invoices
      // are readable and auditable without re-fetching from QB. rawDescription is always preserved.
      const lineItemsSnapshot: QBInvoiceLineItemDetail[] | null = Array.isArray(qbInvoice.Line)
        ? qbInvoice.Line
            .filter((l: any) => l.DetailType === 'SalesItemLineDetail')
            .map((l: any): QBInvoiceLineItemDetail => {
              const detail = l.SalesItemLineDetail;
              const description = String(l.Description ?? '').trim() || null;
              const itemRef: QBInvoiceLineItemDetail['itemRef'] = detail?.ItemRef?.value
                ? { qbId: String(detail.ItemRef.value), name: String(detail.ItemRef.name ?? '') }
                : null;
              const parsedDetails = parseQBLineDescription(description);
              return {
                lineNum: Number(l.LineNum ?? 0),
                description,
                amount: Number(l.Amount ?? 0),
                qty: detail?.Qty != null ? Number(detail.Qty) : null,
                unitPrice: detail?.UnitPrice != null ? Number(detail.UnitPrice) : null,
                itemRef,
                serviceDate: detail?.ServiceDate ?? null,
                parsedDetails,
                suggestedProductName: itemRef?.name || parsedDetails?.productName || null,
              };
            })
        : null;
      const { poNumber: extractedPo, source: extractedPoSource } = extractQBInvoiceCustomerPo(qbInvoice);

      // Find local customer (org-scoped)
      let localCustomerId: string | null = null;
      if (qbCustomerRefId) {
        const [match] = await db
          .select({ id: customers.id })
          .from(customers)
          .where(and(
            eq(customers.organizationId, organizationId),
            eq(customers.externalAccountingId, qbCustomerRefId),
          ))
          .limit(1);
        localCustomerId = match?.id ?? null;
      }

      if (!localCustomerId) {
        result.excluded++;
        result.errors.push(`Invoice ${qbInvoice.DocNumber ?? qbInvoice.Id}: no local customer for QB customer ${qbCustomerRefId}`);
        continue;
      }

      const status = isHistorical ? 'paid' : (balance > 0 ? 'billed' : 'paid');
      const issueDate = qbInvoice.TxnDate ? new Date(qbInvoice.TxnDate) : new Date();
      const dueDate = qbInvoice.DueDate ? new Date(qbInvoice.DueDate) : null;
      const lockedReason = isHistorical ? 'historical_import' : 'quickbooks_import';

      const reconcileImportedInvoicePayments = async (params: {
        invoiceId: string;
        previousBalanceDue: string | null;
        nextBalanceDue: string;
      }) => {
        const previousBalanceCents = Math.max(0, Math.round(Number(params.previousBalanceDue ?? 0) * 100));
        const nextBalanceCents = Math.max(0, Math.round(Number(params.nextBalanceDue || 0) * 100));
        const reflectedDeltaCents = previousBalanceCents - nextBalanceCents;
        if (reflectedDeltaCents <= 0) return;

        const syncedUnreconciledPayments = await db
          .select({
            id: payments.id,
            amountCents: payments.amountCents,
          })
          .from(payments)
          .where(and(
            eq(payments.organizationId, organizationId),
            eq(payments.invoiceId, params.invoiceId),
            sql`lower(${payments.status}) in ('succeeded','captured')`,
            eq(payments.syncStatus, 'synced'),
            isNotNull(payments.externalAccountingId),
            isNull(payments.qbReconciledAt),
          ))
          .orderBy(asc(payments.appliedAt), asc(payments.createdAt));

        let remainingReflectedCents = reflectedDeltaCents;
        const paymentIdsToReconcile: string[] = [];
        for (const payment of syncedUnreconciledPayments) {
          const amountCents = Number(payment.amountCents || 0);
          if (amountCents <= 0 || amountCents > remainingReflectedCents) continue;
          paymentIdsToReconcile.push(payment.id);
          remainingReflectedCents -= amountCents;
          if (remainingReflectedCents <= 0) break;
        }

        if (paymentIdsToReconcile.length === 0) return;

        await db
          .update(payments)
          .set({
            qbReconciledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(
            eq(payments.organizationId, organizationId),
            sql`${payments.id} = ANY(${paymentIdsToReconcile})`,
          ));
      };

      // Check for existing invoice (by QB Invoice Id, org-scoped)
      // Fetch customerPoNumber and importSource to apply PO preservation rules.
      const [existing] = await db
        .select({
          id: invoices.id,
          customerPoNumber: invoices.customerPoNumber,
          importSource: invoices.importSource,
          qbImportBalanceDue: invoices.qbImportBalanceDue,
        })
        .from(invoices)
        .where(and(
          eq(invoices.organizationId, organizationId),
          or(
            eq(invoices.qbInvoiceId, qbInvoice.Id),
            eq(invoices.externalAccountingId, qbInvoice.Id),
          ),
        ))
        .limit(1);

      if (existing) {
        // PO preservation: only update PO if QB has a value AND (invoice is QB-imported OR had no PO before)
        const isQBImported = existing.importSource === 'quickbooks';
        const existingHasPo = !!existing.customerPoNumber;
        const shouldUpdatePo = extractedPo !== null && (isQBImported || !existingHasPo);
        const newPoNumber = shouldUpdatePo ? extractedPo : existing.customerPoNumber ?? null;
        const newPoSource = shouldUpdatePo ? extractedPoSource : null;

        await db
          .update(invoices)
          .set({
            customerId: localCustomerId,
            status,
            issueDate,
            dueDate,
            subtotal: totalAmt.toFixed(2),
            tax: taxAmt.toFixed(2),
            total: totalAmt.toFixed(2),
            amountPaid: amountPaid.toFixed(2),
            balanceDue: balance.toFixed(2),
            importSource: 'quickbooks',
            isHistorical,
            qbImportBalanceDue: balance.toFixed(2),
            qbDocNumber: qbInvoice.DocNumber ?? null,
            qbLineItemsSnapshot: lineItemsSnapshot,
            lockedReason,
            customerPoNumber: newPoNumber,
            qbPoSource: newPoSource,
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, existing.id));

        if (!isHistorical) {
          await reconcileImportedInvoicePayments({
            invoiceId: existing.id,
            previousBalanceDue: existing.qbImportBalanceDue,
            nextBalanceDue: balance.toFixed(2),
          });
        }
        result.updated++;
        if (isHistorical) result.importedHistorical++; else result.importedOpenAr++;
      } else {
        const historicalNumber = isHistorical ? resolveHistoricalQuickBooksInvoiceNumber(qbInvoice.DocNumber) : null;
        if (historicalNumber && 'error' in historicalNumber) {
          result.skipped++;
          result.errors.push(`Invoice ${qbInvoice.Id}: ${historicalNumber.error}`);
          continue;
        }
        if (historicalNumber) {
          const conflicts = await findHistoricalQuickBooksInvoiceNumberConflicts({ organizationId, identity: historicalNumber.value });
          if (conflicts.length > 0) {
            result.skipped++;
            result.numberingConflicts++;
            result.errors.push(`Invoice ${historicalNumber.value.sourceDocNumber}: historical number conflict (${conflicts.map((conflict) => `${conflict.kind}:${conflict.entity}:${conflict.id}`).join(', ')})`);
            continue;
          }
        }
        // Imported historical records preserve DocNumber and never allocate a native job-derived number.
        const invoiceNumber = historicalNumber?.value.invoiceNumber ?? await generateNextInvoiceNumber(organizationId);
        const { displayNumber, numberCore } = historicalNumber ? historicalNumber.value : await buildDocumentNumberParts(organizationId, 'invoice', invoiceNumber);

        await db.insert(invoices).values({
          organizationId,
          invoiceNumber,
          displayNumber,
          numberCore,
          customerId: localCustomerId,
          status,
          issueDate,
          dueDate,
          subtotal: totalAmt.toFixed(2),
          tax: taxAmt.toFixed(2),
          total: totalAmt.toFixed(2),
          subtotalCents: Math.round(totalAmt * 100),
          taxCents: Math.round(taxAmt * 100),
          totalCents: Math.round(totalAmt * 100),
          currency: 'USD',
          amountPaid: amountPaid.toFixed(2),
          balanceDue: balance.toFixed(2),
          externalAccountingId: qbInvoice.Id,
          qbInvoiceId: qbInvoice.Id,
          // Already in QB — do not enqueue a push back to QB
          qbSyncStatus: 'synced',
          syncStatus: 'synced',
          importSource: 'quickbooks',
          isHistorical,
          qbImportBalanceDue: balance.toFixed(2),
          importedAt: new Date(),
          qbDocNumber: qbInvoice.DocNumber ?? null,
          qbLineItemsSnapshot: lineItemsSnapshot,
          lockedReason,
          customerPoNumber: extractedPo,
          qbPoSource: extractedPoSource,
          createdByUserId,
        });
        result.created++;
        if (isHistorical) result.importedHistorical++; else result.importedOpenAr++;
      }
    } catch (error: any) {
      result.failed++;
      console.error(`[QB Import Invoices] Error on invoice ${qbInvoice.DocNumber ?? qbInvoice.Id}:`, {
        organizationId,
        message: error.message,
      });
      result.errors.push(`Invoice ${qbInvoice.DocNumber ?? qbInvoice.Id}: ${error.message}`);
    }
  }

  console.log(`[QB Import Invoices] Done — created: ${result.created}, updated: ${result.updated}, skipped: ${result.skipped}, excluded: ${result.excluded}, failed: ${result.failed}, openAr: ${result.importedOpenAr}, historical: ${result.importedHistorical}, numberingConflicts: ${result.numberingConflicts}, errors: ${result.errors.length}`, { organizationId });
  return result;
}

// ==================== Single Invoice Lookup ====================

export type ParsedQBLineDetails = {
  productName: string | null;
  sides: string | null;
  quantity: number | null;
  measurementUnit: string | null;
  width: number | null;
  height: number | null;
  artFileName: string | null;
  rawDescription: string;
};

export type QBInvoiceLineItemDetail = {
  lineNum: number;
  description: string | null;
  amount: number;
  qty: number | null;
  unitPrice: number | null;
  itemRef: { qbId: string; name: string } | null;
  serviceDate: string | null;
  parsedDetails: ParsedQBLineDetails | null;
  suggestedProductName: string | null;
};

// Art file extensions commonly uploaded to InfoFloPrint / TitanOS
const QB_ART_FILE_PATTERN = /\b([\w.\- ]+?\.(pdf|ai|eps|png|jpg|jpeg|svg|psd|tif|tiff|indd|cdr|zip))\b/i;
// Dimension pattern: 24 x 36, 24" x 36", 24.5 x 36.5, etc.
const QB_DIMENSION_PATTERN = /(\d+(?:\.\d+)?)\s*[""']?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[""']?/;
// Sidedness: "2 sides", "2-sided", "double sided", "sides: 2", "1 side", "single sided"
const QB_SIDES_PATTERN = /\b(\d+)\s*[-\s]?sided?\b|\b(single|one|double|two)\s*[-\s]?sided?\b|\bsides?\s*[:\-]?\s*(\d+)\b/i;
// Measurement units for quantity context
const QB_MEASURE_UNIT_PATTERN = /\b(sq\.?\s*ft|sq\.?\s*in|square\s+fe?e?t|square\s+inch(?:es)?|sq\.?\s*yd|linear\s+ft|linear\s+feet|each|ea\.?|pieces?|pcs?|units?)\b/i;

/**
 * Best-effort parser for QB invoice line descriptions.
 * Extracts structured fields from multiline text like:
 *   "Foam Board\n2 Sides\n100 sq ft\n24 x 36\nartwork.pdf"
 *
 * Never throws — returns null on empty description, partial object on parse failure.
 * rawDescription is always preserved.
 */
export function parseQBLineDescription(description: string | null): ParsedQBLineDetails | null {
  if (!description || !description.trim()) return null;
  try {
    const rawDescription = description;
    const lines = description.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    // productName: first non-empty line (caller may override with itemRef.name)
    const productName = lines[0] ?? null;

    // sides
    let sides: string | null = null;
    const sidesMatch = description.match(QB_SIDES_PATTERN);
    if (sidesMatch) {
      if (sidesMatch[3]) {
        sides = sidesMatch[3];
      } else if (sidesMatch[1]) {
        sides = sidesMatch[1] + '-sided';
      } else if (sidesMatch[2]) {
        const word = sidesMatch[2].toLowerCase();
        sides = (word === 'single' || word === 'one') ? '1-sided' : '2-sided';
      }
    }

    // width and height from dimension pattern
    let width: number | null = null;
    let height: number | null = null;
    const dimMatch = description.match(QB_DIMENSION_PATTERN);
    if (dimMatch) {
      width = parseFloat(dimMatch[1]);
      height = parseFloat(dimMatch[2]);
    }

    // measurementUnit
    let measurementUnit: string | null = null;
    const unitMatch = description.match(QB_MEASURE_UNIT_PATTERN);
    if (unitMatch) {
      measurementUnit = unitMatch[1].replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // quantity: standalone number adjacent to unit OR on its own line
    // Exclude dimension numbers to avoid false positives
    let quantity: number | null = null;
    const qtyLinePattern = /^(\d+(?:[,]\d{3})*(?:\.\d+)?)\s*(sq\.?\s*ft|sq\.?\s*in|each|ea|pieces?|pcs?|units?|qty)?$/i;
    for (const line of lines) {
      const m = line.match(qtyLinePattern);
      if (!m) continue;
      const num = parseFloat(m[1].replace(/,/g, ''));
      if (isNaN(num) || num <= 0) continue;
      // Don't pick up dimension numbers as quantity
      if (dimMatch && (num === width || num === height)) continue;
      quantity = num;
      if (m[2]) measurementUnit = measurementUnit ?? m[2].toLowerCase().trim();
      break;
    }

    // artFileName
    let artFileName: string | null = null;
    const artMatch = description.match(QB_ART_FILE_PATTERN);
    if (artMatch) {
      artFileName = artMatch[1].trim();
    }

    return { productName, sides, quantity, measurementUnit, width, height, artFileName, rawDescription };
  } catch {
    return { productName: null, sides: null, quantity: null, measurementUnit: null, width: null, height: null, artFileName: null, rawDescription: String(description) };
  }
}

export type QBInvoiceDetail = {
  qbId: string;
  invoiceNumber: string;
  poNumber: string | null;
  poSource: string | null;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  customer: {
    qbId: string;
    displayName: string;
  } | null;
  billingEmail: string | null;
  shipAddress: string | null;
  billAddress: string | null;
  customerMemo: string | null;
  privateNote: string | null;
  emailStatus: string | null;
  subtotal: number;
  tax: number;
  total: number;
  balanceDue: number;
  lineItems: QBInvoiceLineItemDetail[];
  customFields: Array<{ name: string; value: string | null }>;
};

function transformQBInvoice(qbInvoice: any): QBInvoiceDetail {
  const total = Number(qbInvoice.TotalAmt ?? 0);
  const balance = Number(qbInvoice.Balance ?? 0);
  const tax = Number(qbInvoice.TxnTaxDetail?.TotalTax ?? 0);

  const { poNumber, source: poSource } = extractQBInvoiceCustomerPo(qbInvoice);

  const lineItems: QBInvoiceLineItemDetail[] = [];
  if (Array.isArray(qbInvoice.Line)) {
    for (const line of qbInvoice.Line) {
      // Only map actual product/service lines. Subtotals, tax summaries, and
      // grouping lines all have a different DetailType and must not become line items.
      if (line.DetailType !== 'SalesItemLineDetail') continue;
      const detail = line.SalesItemLineDetail;
      const description = String(line.Description ?? '').trim() || null;
      const itemRef: QBInvoiceLineItemDetail['itemRef'] = detail?.ItemRef?.value
        ? { qbId: String(detail.ItemRef.value), name: String(detail.ItemRef.name ?? '') }
        : null;
      const parsedDetails = parseQBLineDescription(description);
      const suggestedProductName = itemRef?.name || parsedDetails?.productName || null;
      lineItems.push({
        lineNum: Number(line.LineNum ?? 0),
        description,
        amount: Number(line.Amount ?? 0),
        qty: detail?.Qty != null ? Number(detail.Qty) : null,
        unitPrice: detail?.UnitPrice != null ? Number(detail.UnitPrice) : null,
        itemRef,
        serviceDate: detail?.ServiceDate ?? null,
        parsedDetails,
        suggestedProductName,
      });
    }
  }

  const customFields: Array<{ name: string; value: string | null }> = [];
  if (Array.isArray(qbInvoice.CustomField)) {
    for (const field of qbInvoice.CustomField) {
      customFields.push({
        name: String(field.Name ?? ''),
        value: field.StringValue != null
          ? String(field.StringValue)
          : field.DateValue != null
          ? String(field.DateValue)
          : field.NumberValue != null
          ? String(field.NumberValue)
          : null,
      });
    }
  }

  const billAddr = qbInvoice.BillAddr ? formatQBAddress(qbInvoice.BillAddr) : null;
  const shipAddr = qbInvoice.ShipAddr ? formatQBAddress(qbInvoice.ShipAddr) : null;
  const customerMemoRaw = qbInvoice.CustomerMemo?.value ?? qbInvoice.CustomerMemo ?? null;

  return {
    qbId: String(qbInvoice.Id),
    invoiceNumber: String(qbInvoice.DocNumber ?? ''),
    poNumber,
    poSource,
    status: balance > 0 ? 'open' : 'paid',
    issueDate: qbInvoice.TxnDate ?? null,
    dueDate: qbInvoice.DueDate ?? null,
    customer: qbInvoice.CustomerRef?.value
      ? { qbId: String(qbInvoice.CustomerRef.value), displayName: String(qbInvoice.CustomerRef.name ?? '') }
      : null,
    billingEmail: qbInvoice.BillEmail?.Address ?? null,
    shipAddress: shipAddr,
    billAddress: billAddr,
    customerMemo: customerMemoRaw ? String(customerMemoRaw).trim() || null : null,
    privateNote: qbInvoice.PrivateNote ? String(qbInvoice.PrivateNote).trim() || null : null,
    emailStatus: qbInvoice.EmailStatus ?? null,
    subtotal: total - tax,
    tax,
    total,
    balanceDue: balance,
    lineItems,
    customFields,
  };
}

/**
 * Fetch a single QuickBooks invoice by its DocNumber (invoice number).
 *
 * Returns null if no invoice with that DocNumber exists in QuickBooks.
 * Throws on network/auth errors (consistent with makeQBRequest behaviour).
 *
 * Does NOT write to any local table.
 */
export async function fetchQBInvoiceByNumber(
  organizationId: string,
  invoiceNumber: string,
): Promise<{ raw: any; transformed: QBInvoiceDetail } | null> {
  const safeNumber = String(invoiceNumber).trim();
  if (!safeNumber) throw new Error('invoiceNumber is required');

  // Step 1: resolve QB internal Id via DocNumber query
  const query = `SELECT Id, DocNumber FROM Invoice WHERE DocNumber = '${escapeQBQueryString(safeNumber)}' MAXRESULTS 1`;
  const queryResp = await makeQBRequest(
    'GET',
    `/query?query=${encodeURIComponent(query)}`,
    undefined,
    organizationId,
  );

  const found = queryResp?.QueryResponse?.Invoice?.[0];
  if (!found?.Id) {
    return null; // No invoice with this DocNumber in QB
  }

  // Step 2: fetch full invoice record by Id
  const fullResp = await makeQBRequest('GET', `/invoice/${String(found.Id)}`, undefined, organizationId);
  const qbInvoice = fullResp?.Invoice;
  if (!qbInvoice) {
    return null;
  }

  return {
    raw: qbInvoice,
    transformed: transformQBInvoice(qbInvoice),
  };
}

// ==================== Customer Payload Inspector ====================

export type QBCustomerFieldSource = 'qb_display_name' | 'qb_company_name' | 'qb_given_family_name' | 'qb_primary_email' | 'qb_primary_phone' | 'qb_mobile' | 'qb_bill_addr' | 'qb_ship_addr' | 'qb_balance' | 'qb_notes' | 'qb_web_addr';

export type QBCustomerMappedField = {
  titanField: string;
  value: string | null;
  source: QBCustomerFieldSource | null;
};

export type QBCustomerUnmappedField = {
  qbField: string;
  value: unknown;
  reason: string;
};

export type QBCustomerInspectionResult = {
  qbCustomerId: string;
  qbDisplayName: string;
  mapped: QBCustomerMappedField[];
  unmapped: QBCustomerUnmappedField[];
  warnings: string[];
  contactMapped: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    willBeCreated: boolean;
    skipReason: string | null;
  };
};

/**
 * Fetch a single QB customer by their QB Id and return a full field inspection:
 * raw payload, mapped TitanOS fields (with source annotation), unmapped QB fields,
 * and warnings (e.g. missing person name).
 *
 * Read-only — does NOT write to any local table.
 * Restricted to platform developers at the route level.
 */
export async function fetchQBCustomerForInspection(
  organizationId: string,
  qbCustomerId: string,
): Promise<{ raw: any; inspection: QBCustomerInspectionResult } | null> {
  const safeId = String(qbCustomerId).trim();
  if (!safeId) throw new Error('qbCustomerId is required');

  const resp = await makeQBRequest('GET', `/customer/${encodeURIComponent(safeId)}`, undefined, organizationId);
  const qbCustomer = resp?.Customer;
  if (!qbCustomer) return null;

  const warnings: string[] = [];

  // ── Mapped fields ────────────────────────────────────────────────────────
  const mapped: QBCustomerMappedField[] = [];

  // Company name: prefer DisplayName, fall back to CompanyName
  const displayName = String(qbCustomer.DisplayName || '').trim();
  const companyName = String(qbCustomer.CompanyName || '').trim();
  const resolvedCompanyName = displayName || companyName || null;
  mapped.push({
    titanField: 'customers.companyName',
    value: resolvedCompanyName,
    source: displayName ? 'qb_display_name' : companyName ? 'qb_company_name' : null,
  });

  // Email
  const email = String(qbCustomer.PrimaryEmailAddr?.Address || '').trim() || null;
  mapped.push({ titanField: 'customers.email', value: email, source: email ? 'qb_primary_email' : null });

  // Phone
  const phone = String(qbCustomer.PrimaryPhone?.FreeFormNumber || '').trim() || null;
  mapped.push({ titanField: 'customers.phone', value: phone, source: phone ? 'qb_primary_phone' : null });

  // Website
  const website = String(qbCustomer.WebAddr?.URI || '').trim() || null;
  mapped.push({ titanField: 'customers.website', value: website, source: website ? 'qb_web_addr' : null });

  // Billing address
  const billAddr = qbCustomer.BillAddr ? formatQBAddress(qbCustomer.BillAddr) : null;
  mapped.push({ titanField: 'customers.billingAddress', value: billAddr, source: billAddr ? 'qb_bill_addr' : null });

  // Shipping address
  const shipAddr = qbCustomer.ShipAddr ? formatQBAddress(qbCustomer.ShipAddr) : null;
  mapped.push({ titanField: 'customers.shippingAddress', value: shipAddr, source: shipAddr ? 'qb_ship_addr' : null });

  // Balance
  const balance = qbCustomer.Balance != null ? String(qbCustomer.Balance) : null;
  mapped.push({ titanField: 'customers.currentBalance', value: balance, source: balance != null ? 'qb_balance' : null });

  // Notes
  const notes = String(qbCustomer.Notes || '').trim() || null;
  mapped.push({ titanField: 'customers.notes', value: notes, source: notes ? 'qb_notes' : null });

  // External accounting ID (QB Id itself)
  mapped.push({ titanField: 'customers.externalAccountingId', value: safeId, source: 'qb_display_name' });

  // ── Contact mapping ──────────────────────────────────────────────────────
  const contactName = deriveQBContactName(qbCustomer);
  const mobile = String(qbCustomer.Mobile?.FreeFormNumber || '').trim() || null;
  const hasMeaningfulContactData = !!(email || phone || mobile);
  const nameIsSuspicious = contactName ? isSuspiciousContactName(contactName.firstName, contactName.lastName) : false;

  let skipReason: string | null = null;
  if (!contactName) {
    skipReason = 'No person-level name (GivenName/FamilyName) — contact not created to avoid placeholder records';
    warnings.push('missing_person_name: GivenName and FamilyName are both absent; no contact will be created');
  } else if (nameIsSuspicious) {
    skipReason = `Name "${contactName.firstName} ${contactName.lastName}".trim() is a known placeholder — contact creation skipped`;
    warnings.push(`suspicious_contact_name: "${contactName.firstName} ${contactName.lastName}".trim()`);
  } else if (!hasMeaningfulContactData) {
    skipReason = 'No email, phone, or mobile — contact will be created but has no contact info';
    warnings.push('no_contact_info: contact has no email, phone, or mobile');
  }

  const contactMapped = {
    firstName: contactName?.firstName ?? null,
    lastName: contactName?.lastName ?? null,
    email,
    phone,
    mobile,
    willBeCreated: !!contactName && !nameIsSuspicious,
    skipReason,
  };

  // ── Unmapped QB fields ───────────────────────────────────────────────────
  const unmapped: QBCustomerUnmappedField[] = [];
  const hasValue = (v: unknown) => v != null && String(v).trim() !== '';

  const knownMapped = new Set([
    'Id', 'DisplayName', 'CompanyName', 'GivenName', 'FamilyName', 'MiddleName', 'Suffix', 'Title',
    'PrimaryEmailAddr', 'PrimaryPhone', 'Mobile', 'WebAddr',
    'BillAddr', 'ShipAddr', 'Balance', 'Notes',
    'MetaData', 'SyncToken', 'domain', 'sparse', 'Active', 'Taxable',
    'Job', 'BillWithParent', 'Level', 'PrintOnCheckName',
    'FullyQualifiedName', 'DefaultTaxCodeRef', 'CustomerTypeRef',
  ]);

  for (const [key, value] of Object.entries(qbCustomer)) {
    if (knownMapped.has(key)) continue;
    if (!hasValue(value)) continue;
    unmapped.push({
      qbField: key,
      value,
      reason: 'No TitanOS mapping defined for this QB Customer field',
    });
  }

  // Warn if mobile is present but has no contact to attach to
  if (mobile && !contactName) {
    warnings.push(`mobile_unreachable: Mobile (${mobile}) present but no contact created — stored on customer row only`);
  }

  return {
    raw: qbCustomer,
    inspection: {
      qbCustomerId: String(qbCustomer.Id),
      qbDisplayName: displayName,
      mapped,
      unmapped,
      warnings,
      contactMapped,
    },
  };
}
