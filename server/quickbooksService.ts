import OAuthClient from 'intuit-oauth';
import crypto from 'crypto';
import { db } from './db';
import { oauthConnections, accountingSyncJobs, customers, customerContacts, invoices, orders, payments, invoiceLineItems, type OAuthConnection } from '../shared/schema';
import { eq, and, asc, desc, or, isNull, isNotNull, sql } from 'drizzle-orm';
import type { Customer } from '../shared/schema';
import { DEFAULT_ORGANIZATION_ID } from './tenantContext';
import { generateNextInvoiceNumber } from './invoicesService';

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
  if (message.includes('invalid_grant') || message.includes('invalid grant')) return true;

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
export async function getActiveConnection(organizationId?: string) {
  const orgId = organizationId || DEFAULT_ORGANIZATION_ID;
  const [connection] = await db
    .select()
    .from(oauthConnections)
    .where(and(eq(oauthConnections.provider, 'quickbooks'), eq(oauthConnections.organizationId, orgId)))
    .orderBy(desc(oauthConnections.createdAt))
    .limit(1);

  return connection || null;
}

/**
 * Generate OAuth authorization URL to redirect user to QuickBooks login
 */
export async function getAuthorizationUrl(): Promise<string> {
  const oauthClient = getOAuthClient();
  if (!oauthClient) {
    throw new Error('QuickBooks OAuth not configured');
  }

  const state = buildOAuthState(DEFAULT_ORGANIZATION_ID);

  const authUrl = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state,
  });

  return authUrl;
}

export async function getAuthorizationUrlForOrganization(organizationId: string): Promise<string> {
  const oauthClient = getOAuthClient();
  if (!oauthClient) {
    throw new Error('QuickBooks OAuth not configured');
  }

  const state = buildOAuthState(organizationId);

  const authUrl = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state,
  });

  if (qbLogsEnabled()) {
    console.log('[QB OAuth] Authorization URL generated', {
      organizationId,
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

  const orgId = organizationId || DEFAULT_ORGANIZATION_ID;

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

  if (qbLogsEnabled()) {
    console.log('[QB OAuth] Exchanging authorization code', {
      organizationId: orgId,
      realmId,
    });
  }

  // Exchange code for tokens - pass full callback URL with query params
  const authResponse = await oauthClient.createToken(parseRedirectUrl);
  const token = authResponse.token;

  if (qbLogsEnabled()) {
    console.log('[QB OAuth] Tokens received', {
      organizationId: orgId,
      realmId,
      hasAccessToken: !!token.access_token,
      hasRefreshToken: !!token.refresh_token,
      expiresIn: token.expires_in,
    });
  }

  // Delete existing connection for this organization/provider.
  await db
    .delete(oauthConnections)
    .where(and(eq(oauthConnections.provider, 'quickbooks'), eq(oauthConnections.organizationId, orgId)));

  // Store new connection
  await db.insert(oauthConnections).values({
    provider: 'quickbooks',
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + (token.expires_in || 3600) * 1000),
    companyId: realmId,
    organizationId: orgId,
    metadata: {
      realmId,
      tokenType: token.token_type,
      createdAt: new Date().toISOString(),
    },
  });

  if (qbLogsEnabled()) {
    console.log('[QB OAuth] Connection stored successfully', { organizationId: orgId, realmId });
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(): Promise<boolean> {
  const connection = await getActiveConnection(DEFAULT_ORGANIZATION_ID);
  if (!connection || !connection.refreshToken) {
    return false;
  }

  const oauthClient = getOAuthClient();
  if (!oauthClient) {
    throw new Error('QuickBooks OAuth not configured');
  }

  try {
    // Set the refresh token
    oauthClient.setToken({
      refresh_token: connection.refreshToken,
    } as any);

    // Refresh the token
    const authResponse = await oauthClient.refresh();
    const token = authResponse.token;

    // Update stored connection
    await db
      .update(oauthConnections)
      .set({
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(Date.now() + (token.expires_in || 3600) * 1000),
        updatedAt: new Date(),
      })
      .where(eq(oauthConnections.id, connection.id));

    return true;
  } catch (error) {
    console.error('[QuickBooks] Token refresh failed:', error);
    return false;
  }
}

export async function refreshAccessTokenForOrganization(organizationId: string): Promise<boolean> {
  const connection = await getActiveConnection(organizationId);
  if (!connection || !connection.refreshToken) {
    return false;
  }

  const qbAuth = getQuickBooksAuthMetadata(connection);
  if (qbAuth?.state === 'needs_reauth') {
    // Latch is set: do not attempt refresh and do not spam logs.
    return false;
  }

  const oauthClient = getOAuthClient();
  if (!oauthClient) {
    throw new Error('QuickBooks OAuth not configured');
  }

  try {
    oauthClient.setToken({
      refresh_token: connection.refreshToken,
    } as any);

    const authResponse = await oauthClient.refresh();
    const token = authResponse.token;

    await db
      .update(oauthConnections)
      .set({
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(Date.now() + (token.expires_in || 3600) * 1000),
        updatedAt: new Date(),
      })
      .where(eq(oauthConnections.id, connection.id));

    return true;
  } catch (error) {
    if (shouldLatchQuickBooksReauth(error)) {
      try {
        await latchQuickBooksNeedsReauth({ organizationId, connection, error });
      } catch (latchError) {
        console.error('[QuickBooks] Failed to latch needs_reauth:', {
          organizationId,
          message: (latchError as any)?.message || String(latchError),
        });
      }
      return false;
    }

    console.error('[QuickBooks] Token refresh failed:', { organizationId, message: (error as any)?.message || String(error) });
    return false;
  }
}

/**
 * Get valid access token (refresh if needed)
 */
export async function getValidAccessToken(): Promise<string | null> {
  const connection = await getActiveConnection(DEFAULT_ORGANIZATION_ID);
  if (!connection) {
    return null;
  }

  // Check if token is expired or about to expire (within 5 minutes)
  const now = new Date();
  const expiresAt = connection.expiresAt ? new Date(connection.expiresAt) : null;
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  if (!expiresAt || expiresAt <= fiveMinutesFromNow) {
    console.log('[QuickBooks] Token expired or expiring soon, refreshing...');
    const refreshed = await refreshAccessTokenForOrganization(connection.organizationId || DEFAULT_ORGANIZATION_ID);
    if (!refreshed) {
      return null;
    }
    // Re-fetch connection after refresh
    const updatedConnection = await getActiveConnection(connection.organizationId || DEFAULT_ORGANIZATION_ID);
    return updatedConnection?.accessToken || null;
  }

  return connection.accessToken;
}

export async function getValidAccessTokenForOrganization(organizationId: string): Promise<string | null> {
  const connection = await getActiveConnection(organizationId);
  if (!connection) {
    return null;
  }

  const qbAuth = getQuickBooksAuthMetadata(connection);
  if (qbAuth?.state === 'needs_reauth') {
    return null;
  }

  const now = new Date();
  const expiresAt = connection.expiresAt ? new Date(connection.expiresAt) : null;
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  if (!expiresAt || expiresAt <= fiveMinutesFromNow) {
    if (qbLogsEnabled()) {
      console.log('[QuickBooks] Token expired or expiring soon, refreshing...', { organizationId });
    }
    const refreshed = await refreshAccessTokenForOrganization(organizationId);
    if (!refreshed) {
      return null;
    }
    const updatedConnection = await getActiveConnection(organizationId);
    return updatedConnection?.accessToken || null;
  }

  return connection.accessToken;
}

/**
 * Disconnect QuickBooks integration
 */
export async function disconnectConnection(): Promise<void> {
  const connection = await getActiveConnection(DEFAULT_ORGANIZATION_ID);
  if (!connection) {
    return;
  }

  const oauthClient = getOAuthClient();
  if (oauthClient && connection.accessToken) {
    try {
      // Revoke tokens with QuickBooks
      oauthClient.setToken({
        access_token: connection.accessToken,
        refresh_token: connection.refreshToken,
      } as any);
      await oauthClient.revoke();
    } catch (error) {
      console.error('[QuickBooks] Token revocation failed:', error);
    }
  }

  // Delete from database
  await db
    .delete(oauthConnections)
    .where(eq(oauthConnections.id, connection.id));
}

export async function disconnectConnectionForOrganization(organizationId: string): Promise<void> {
  const connection = await getActiveConnection(organizationId);
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
    .where(and(eq(oauthConnections.id, connection.id), eq(oauthConnections.organizationId, organizationId)));
}

/**
 * Queue sync jobs for push or pull operations
 */
export async function queueSyncJobs(
  direction: 'push' | 'pull',
  resources: Array<'customers' | 'invoices' | 'orders'>
): Promise<void> {
  const connection = await getActiveConnection(DEFAULT_ORGANIZATION_ID);
  if (!connection) {
    throw new Error('QuickBooks not connected');
  }

  const jobs = resources.map((resource) => ({
    provider: 'quickbooks' as const,
    direction: direction as 'push' | 'pull',
    resourceType: resource as 'customers' | 'invoices' | 'orders',
    status: 'pending' as const,
    organizationId: connection.organizationId || DEFAULT_ORGANIZATION_ID,
  }));

  await db.insert(accountingSyncJobs).values(jobs);
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

/**
 * Derive a contact person name from QuickBooks Customer fields.
 * Returns null when no person-level name can be identified.
 */
function deriveQBContactName(
  qbCustomer: any,
): { firstName: string; lastName: string } | null {
  const givenName = String(qbCustomer.GivenName || '').trim();
  const familyName = String(qbCustomer.FamilyName || '').trim();

  if (givenName || familyName) {
    // Prefer structured name fields; fill missing half with a safe default
    return {
      firstName: givenName || 'Contact',
      lastName: familyName || '',
    };
  }

  // Fall back to DisplayName only when it is not identical to the company name
  const displayName = String(qbCustomer.DisplayName || '').trim();
  const companyName = String(qbCustomer.CompanyName || '').trim();

  if (displayName && displayName.toLowerCase() !== companyName.toLowerCase()) {
    return { firstName: displayName, lastName: '' };
  }

  return null;
}

type QBContactPayload = {
  customerId: string;
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
 * Returns null when there is no useful contact-level data to store
 * (no email, phone, mobile, or person name).
 */
function mapQBCustomerToContact(
  qbCustomer: any,
  customerId: string,
): QBContactPayload | null {
  const email = String(qbCustomer.PrimaryEmailAddr?.Address || '').trim() || null;
  const phone = String(qbCustomer.PrimaryPhone?.FreeFormNumber || '').trim() || null;
  const mobile = String(qbCustomer.Mobile?.FreeFormNumber || '').trim() || null;

  const name = deriveQBContactName(qbCustomer);

  // Only create a contact if there is something useful to store
  if (!email && !phone && !mobile && !name) {
    return null;
  }

  // If we have useful data but no name, fall back to "Primary Contact"
  const { firstName, lastName } = name ?? { firstName: 'Primary Contact', lastName: '' };

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
    // Definitive match — safe to update name since we hold the source ID
    await db
      .update(customerContacts)
      .set({
        firstName,
        lastName,
        email: email ?? bySource.email,
        phone: phone ?? bySource.phone,
        mobile: mobile ?? bySource.mobile,
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
  await db.insert(customerContacts).values({
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
  });
  return 'created';
}

/**
 * Map local Customer to QuickBooks Customer format
 */
function mapLocalCustomerToQB(customer: Customer): any {
  const qbCustomer: any = {
    DisplayName: customer.companyName,
  };

  if (customer.email) {
    qbCustomer.PrimaryEmailAddr = { Address: customer.email };
  }

  if (customer.phone) {
    qbCustomer.PrimaryPhone = { FreeFormNumber: customer.phone };
  }

  if (customer.website) {
    qbCustomer.WebAddr = { URI: customer.website };
  }

  if (customer.billingAddress) {
    qbCustomer.BillAddr = parseLocalAddress(customer.billingAddress);
  }

  if (customer.shippingAddress) {
    qbCustomer.ShipAddr = parseLocalAddress(customer.shippingAddress);
  }

  if (customer.notes) {
    qbCustomer.Notes = customer.notes;
  }

  return qbCustomer;
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
 * Parse local address text to QuickBooks address format
 */
function parseLocalAddress(address: string): any {
  // Simple parsing - split by comma
  const parts = address.split(',').map(p => p.trim());
  return {
    Line1: parts[0] || '',
    City: parts.length > 2 ? parts[parts.length - 3] : '',
    CountrySubDivisionCode: parts.length > 1 ? parts[parts.length - 2] : '',
    PostalCode: parts.length > 0 ? parts[parts.length - 1] : '',
  };
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
  const orgId = organizationId || DEFAULT_ORGANIZATION_ID;
  const connection = await getActiveConnection(orgId);
  if (!connection) {
    throw new Error('QuickBooks not connected');
  }

  const accessToken = await getValidAccessTokenForOrganization(orgId);
  if (!accessToken) {
    throw new Error('Failed to get valid access token');
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

  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error: any) {
    if (isTransientNetworkError(error)) {
      try {
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

    if (isTransientQuickBooksHttpStatus(response.status)) {
      try {
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

async function ensureQBCustomerIdForLocalCustomer(organizationId: string, customer: Customer): Promise<string> {
  if ((customer as any).externalAccountingId) return String((customer as any).externalAccountingId);

  const displayName = String((customer as any).companyName || '').trim();
  if (!displayName) throw new Error('Customer has no companyName for QuickBooks sync');

  // First, try to find an existing QB Customer by DisplayName.
  const query = `SELECT Id, DisplayName FROM Customer WHERE DisplayName = '${escapeQBQueryString(displayName)}' MAXRESULTS 1`;
  const lookup = await makeQBRequest('GET', `/query?query=${encodeURIComponent(query)}`, undefined, organizationId);
  const found = lookup?.QueryResponse?.Customer?.[0];
  if (found?.Id) {
    await db
      .update(customers)
      .set({ externalAccountingId: String(found.Id), syncStatus: 'synced', syncError: null, syncedAt: new Date(), updatedAt: new Date() } as any)
      .where(and(eq(customers.id, (customer as any).id), eq(customers.organizationId, organizationId)));
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
    return String(qb.Id);
  } catch (err: any) {
    // Fallback: if already exists, re-query.
    console.error('[QuickBooks] customer ensure failed', { organizationId, customerId: (customer as any).id, message: String(err?.message || err) });
    const retry = await makeQBRequest('GET', `/query?query=${encodeURIComponent(query)}`, undefined, organizationId);
    const retryFound = retry?.QueryResponse?.Customer?.[0];
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
  return syncSingleInvoiceToQuickBooksForOrganization(DEFAULT_ORGANIZATION_ID, invoiceId);
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
      lineTotalCents: invoiceLineItems.lineTotalCents,
      totalPrice: invoiceLineItems.totalPrice,
    })
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId))
    .orderBy(invoiceLineItems.sortOrder, desc(invoiceLineItems.createdAt));

  const txnDate = (invoice.issuedAt || invoice.issueDate || new Date()) as any;

  const qbInvoiceData: any = {
    CustomerRef: { value: qbCustomerId },
    DocNumber: String(invoice.invoiceNumber),
    TxnDate: new Date(txnDate).toISOString().split('T')[0],
    DueDate: invoice.dueDate ? new Date(invoice.dueDate as any).toISOString().split('T')[0] : undefined,
    Line: (lineItems || []).map((r: any, index: number) => {
      const cents = Number(r.lineTotalCents ?? 0);
      const amount = Number.isFinite(cents) && cents > 0 ? cents / 100 : Number(r.totalPrice || 0);
      return {
        LineNum: index + 1,
        Amount: Number(amount || 0),
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          Qty: 1,
          UnitPrice: Number(amount || 0),
        },
        Description: String(r.description || ''),
      };
    }),
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
  const docNumber = String((invoice as any).invoiceNumber);
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
  if (status !== 'succeeded') throw new Error('Only succeeded payments can be synced to QuickBooks');

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

    // Fetch all customers from QuickBooks
    const query = "SELECT * FROM Customer";
    const response = await makeQBRequest('GET', `/query?query=${encodeURIComponent(query)}`, undefined, organizationId);

    const qbCustomers = response.QueryResponse?.Customer || [];
    console.log(`[QB Pull Customers] Found ${qbCustomers.length} customers in QuickBooks`);

    let customersCreated = 0;
    let customersUpdated = 0;
    let contactsCreated = 0;
    let contactsUpdated = 0;
    let skippedContacts = 0;
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
          skippedContacts++;
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
          errorCount,
          totalQuickBooksCustomers: qbCustomers.length,
        } as any,
      })
      .where(eq(accountingSyncJobs.id, jobId));

    console.log(
      `[QB Pull Customers] Completed: ${customersCreated} created, ${customersUpdated} updated, ` +
      `${contactsCreated} contacts created, ${contactsUpdated} contacts updated, ` +
      `${skippedContacts} contacts skipped, ${errorCount} errors`,
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
export async function processPushCustomers(jobId: string): Promise<void> {
  try {
    console.log(`[QB Push Customers] Starting job ${jobId}`);

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
        or(
          isNull(customers.externalAccountingId),
          eq(customers.syncStatus, 'pending')
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
            `/customer/${customer.externalAccountingId}`
          );
          qbCustomerData.Id = customer.externalAccountingId;
          qbCustomerData.SyncToken = existing.Customer.SyncToken;

          const response = await makeQBRequest('POST', '/customer', qbCustomerData);
          qbCustomer = response.Customer;
          console.log(`[QB Push Customers] Updated QB customer: ${customer.companyName}`);
        } else {
          // Create new QB customer
          const response = await makeQBRequest('POST', '/customer', qbCustomerData);
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

    const query = "SELECT * FROM Invoice";
    const response = await makeQBRequest('GET', `/query?query=${encodeURIComponent(query)}`, undefined, organizationId);

    const qbInvoices = response.QueryResponse?.Invoice || [];
    console.log(`[QB Pull Invoices] Found ${qbInvoices.length} invoices in QuickBooks`);

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
export async function processPushInvoices(jobId: string): Promise<void> {
  try {
    console.log(`[QB Push Invoices] Starting job ${jobId}`);

    await db
      .update(accountingSyncJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));

    const localInvoices = await db
      .select()
      .from(invoices)
      .where(
        or(
          isNull(invoices.externalAccountingId),
          eq(invoices.syncStatus, 'pending')
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
          .where(eq(customers.id, invoice.customerId))
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
          const existing = await makeQBRequest('GET', `/invoice/${invoice.externalAccountingId}`);
          qbInvoiceData.Id = invoice.externalAccountingId;
          qbInvoiceData.SyncToken = existing.Invoice.SyncToken;
          const response = await makeQBRequest('POST', '/invoice', qbInvoiceData);
          qbInvoice = response.Invoice;
        } else {
          // Create new
          const response = await makeQBRequest('POST', '/invoice', qbInvoiceData);
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
export async function processPullOrders(jobId: string): Promise<void> {
  try {
    console.log(`[QB Pull Orders] Starting job ${jobId}`);

    await db
      .update(accountingSyncJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));

    // QB SalesReceipt is closest to our Order concept
    const query = "SELECT * FROM SalesReceipt";
    const response = await makeQBRequest('GET', `/query?query=${encodeURIComponent(query)}`);

    const qbSalesReceipts = response.QueryResponse?.SalesReceipt || [];
    console.log(`[QB Pull Orders] Found ${qbSalesReceipts.length} sales receipts in QuickBooks`);

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
            .where(eq(customers.externalAccountingId, qbReceipt.CustomerRef.value))
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
          .where(eq(orders.externalAccountingId, qbReceipt.Id))
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
export async function processPushOrders(jobId: string): Promise<void> {
  try {
    console.log(`[QB Push Orders] Starting job ${jobId}`);

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
        const [customer] = await db
          .select()
          .from(customers)
          .where(eq(customers.id, order.customerId))
          .limit(1);

        if (!customer?.externalAccountingId) {
          throw new Error('Customer not synced to QuickBooks');
        }

        // Build QB sales receipt
        const qbReceiptData: any = {
          CustomerRef: { value: customer.externalAccountingId },
          TxnDate: new Date(order.createdAt).toISOString().split('T')[0],
          Line: [], // Would need line items
        };

        const response = await makeQBRequest('POST', '/salesreceipt', qbReceiptData);
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
  customerPoNumber: string | null;
  customerPoSource: string | null;
  referenceDebug?: QBReferenceDebug;
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
 *   A. CustomField with PO name       → source: 'custom_field'
 *   B. Explicit PO pattern in PrivateNote → source: 'private_note'
 *   C. Explicit PO pattern in CustomerMemo → source: 'customer_memo'
 *   D. Explicit PO pattern in any Line description → source: 'line_description'
 *   E. CustomField with reference name → source: 'custom_field_reference'
 *   F. CustomerMemo if concise and not generic boilerplate → source: 'customer_memo'
 *   G. PrivateNote if concise and not generic boilerplate → source: 'private_note'
 *   H. Joined meaningful line descriptions → source: 'line_description'
 *   I. Nothing reliable found → null / null
 *
 * Returns { poNumber, source } or { null, null }.
 * Never logs raw invoice payloads.
 */
export function extractQBInvoiceCustomerPo(qbInvoice: any): { poNumber: string | null; source: string | null } {
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
export async function fetchQBInvoicesForPreview(organizationId: string, includeReferenceDebug = false): Promise<QBInvoicePreviewRow[]> {
  const query = 'SELECT * FROM Invoice MAXRESULTS 1000';
  const response = await makeQBRequest('GET', `/query?query=${encodeURIComponent(query)}`, undefined, organizationId);
  const qbInvoices: any[] = response.QueryResponse?.Invoice || [];

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
    .select({ id: invoices.id, externalAccountingId: invoices.externalAccountingId })
    .from(invoices)
    .where(and(
      eq(invoices.organizationId, organizationId),
      isNotNull(invoices.externalAccountingId),
    ));

  const invoiceByQBId = new Map(localInvoices.map(i => [i.externalAccountingId!, i.id]));

  return qbInvoices.map((qbInvoice): QBInvoicePreviewRow => {
    const qbCustomerRefId: string | null = qbInvoice.CustomerRef?.value ?? null;
    const localCustomer = qbCustomerRefId ? (customerByQBId.get(qbCustomerRefId) ?? null) : null;
    const alreadyImported = invoiceByQBId.has(qbInvoice.Id);
    const classification = classifyQBInvoice(qbInvoice);
    const { poNumber: customerPoNumber, source: customerPoSource } = extractQBInvoiceCustomerPo(qbInvoice);

    let canImport = true;
    let cannotImportReason: string | undefined;
    if (!localCustomer) {
      canImport = false;
      cannotImportReason = 'No matching local customer — pull customers first';
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
      customerPoNumber,
      customerPoSource,
      ...(includeReferenceDebug ? { referenceDebug: summarizeQBInvoiceReferenceFields(qbInvoice) } : {}),
    };
  });
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
export async function importQBInvoicesByIds(
  organizationId: string,
  qbInvoiceIds: string[],
  mode: 'auto' | 'open_ar' | 'historical',
  createdByUserId: string,
): Promise<{ created: number; updated: number; skipped: number; errors: string[] }> {
  const result = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

  if (qbInvoiceIds.length === 0) return result;

  // Fetch the specified invoices from QB (QB query API supports WHERE Id IN (...))
  const idList = qbInvoiceIds.map(id => `'${String(id).replace(/'/g, '')}'`).join(', ');
  const query = `SELECT * FROM Invoice WHERE Id IN (${idList}) MAXRESULTS 200`;
  const response = await makeQBRequest('GET', `/query?query=${encodeURIComponent(query)}`, undefined, organizationId);
  const qbInvoices: any[] = response.QueryResponse?.Invoice || [];

  if (qbLogsEnabled()) {
    console.log(`[QB Import Invoices] Requested ${qbInvoiceIds.length} IDs, QB returned ${qbInvoices.length}`, { organizationId });
  }

  for (const qbInvoice of qbInvoices) {
    try {
      const classification: 'open_ar' | 'historical' = mode === 'auto' ? classifyQBInvoice(qbInvoice) : mode;
      const isHistorical = classification === 'historical';
      const balance = Number(qbInvoice.Balance ?? 0);
      const totalAmt = Number(qbInvoice.TotalAmt ?? 0);
      const taxAmt = Number(qbInvoice.TxnTaxDetail?.TotalTax ?? 0);
      const amountPaid = Math.max(0, totalAmt - balance);
      const qbCustomerRefId: string | null = qbInvoice.CustomerRef?.value ?? null;
      const lineItemsSnapshot: any[] | null = Array.isArray(qbInvoice.Line) ? qbInvoice.Line : null;
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
        result.skipped++;
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
            eq(payments.status, 'succeeded'),
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
      } else {
        const invoiceNumber = await generateNextInvoiceNumber(organizationId);

        await db.insert(invoices).values({
          organizationId,
          invoiceNumber,
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
      }
    } catch (error: any) {
      console.error(`[QB Import Invoices] Error on invoice ${qbInvoice.DocNumber ?? qbInvoice.Id}:`, {
        organizationId,
        message: error.message,
      });
      result.errors.push(`Invoice ${qbInvoice.DocNumber ?? qbInvoice.Id}: ${error.message}`);
    }
  }

  console.log(`[QB Import Invoices] Done — created: ${result.created}, updated: ${result.updated}, skipped: ${result.skipped}, errors: ${result.errors.length}`, { organizationId });
  return result;
}
