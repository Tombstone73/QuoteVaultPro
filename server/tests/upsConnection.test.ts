import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';

const dialect = new PgDialect();
const scopedTo = (condition: any, organizationId: string) => dialect.sqlToQuery(condition).params.includes(organizationId);

let stored: Record<string, any> | null = null;
let inserted: Record<string, any> | null = null;
const dbMock = {
  select: jest.fn(() => ({ from: () => ({ where: (condition: any) => ({ limit: async () =>
    stored && scopedTo(condition, stored.organizationId) ? [stored] : [] }) }) })),
  insert: jest.fn(() => ({ values: (values: Record<string, any>) => ({ onConflictDoUpdate: async () => {
    inserted = values; stored = values;
  } }) })),
  delete: jest.fn(() => ({ where: async (condition: any) => {
    if (stored && scopedTo(condition, stored.organizationId)) stored = null;
  } })),
  update: jest.fn(() => ({ set: (values: Record<string, any>) => ({ where: () => ({ returning: async () => {
    if (stored) stored = { ...stored, ...values };
    return stored ? [{ organizationId: stored.organizationId }] : [];
  } }) }) })),
};
jest.unstable_mockModule('../db', () => ({ db: dbMock }));
const { startUpsAuthorization, validUpsAuthorizationState, completeUpsAuthorization,
  upsConnectionStatus, upsRateCredentials, disconnectUps } = await import('../services/ups/upsConnection');
const { decryptAiSecret, encryptAiSecret } = await import('../services/ai/aiSecretsEncryption');
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.UPS_CLIENT_ID = 'test-developer-app';
  process.env.UPS_CLIENT_SECRET = 'test-server-secret';
  process.env.UPS_REDIRECT_URI = 'https://api.dev.example.test/api/integrations/ups/callback';
  process.env.UPS_ENVIRONMENT = 'cie';
  process.env.AI_SETTINGS_ENCRYPTION_KEY = 'unit-test-ups-credential-key';
  delete process.env.UPS_ORGANIZATION_ID;
  delete process.env.UPS_SHIPPER_NUMBER;
  stored = null; inserted = null;
  dbMock.insert.mockClear(); dbMock.delete.mockClear(); dbMock.update.mockClear();
});
afterEach(() => { process.env = { ...originalEnv }; jest.restoreAllMocks(); });

describe('tenant UPS OAuth connection', () => {
  test('requires developer-app configuration and a tenant account number', async () => {
    delete process.env.UPS_CLIENT_ID;
    expect(() => startUpsAuthorization('org-a', 'admin-a', 'ABC123')).toThrow();
    expect((await upsConnectionStatus('org-a')).configured).toBe(false);
    process.env.UPS_CLIENT_ID = 'test-developer-app';
    expect(() => startUpsAuthorization('org-a', 'admin-a', 'bad')).toThrow();
    process.env.UPS_REDIRECT_URI = 'https://shop.example.test/settings/shipping';
    expect((await upsConnectionStatus('org-a')).configured).toBe(false);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  test('binds a PKCE authorization to one tenant and administrator, and does not store the raw account in session', () => {
    const { url, pending } = startUpsAuthorization('org-a', 'admin-a', 'ABC123');
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('wwwcie.ups.com');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('code_challenge')).toBeTruthy();
    expect(JSON.stringify(pending)).not.toContain('ABC123');
    expect(validUpsAuthorizationState(pending, pending.state, 'org-a', 'admin-a')).toBe(true);
    expect(validUpsAuthorizationState(pending, pending.state, 'org-b', 'admin-a')).toBe(false);
    expect(validUpsAuthorizationState(pending, pending.state, 'org-a', 'admin-b')).toBe(false);
    expect(validUpsAuthorizationState({ ...pending, expiresAt: 0 }, pending.state, 'org-a', 'admin-a')).toBe(false);
    expect(validUpsAuthorizationState(pending, 'wrong', 'org-a', 'admin-a')).toBe(false);
  });

  test('exchanges the authorization code, encrypts account and tokens, and redacts status', async () => {
    const { pending } = startUpsAuthorization('org-a', 'admin-a', 'ABC123');
    const provider = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600 }) } as Response);
    const result = await completeUpsAuthorization(pending, 'one-use-code');
    const [url, init] = provider.mock.calls[0];
    expect(url).toContain('/security/v1/oauth/token');
    expect(new URLSearchParams(String(init?.body)).get('code_verifier')).toBe(pending.codeVerifier);
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(inserted?.organizationId).toBe('org-a');
    expect(JSON.stringify(inserted)).not.toMatch(/ABC123|private-access|private-refresh/);
    expect(decryptAiSecret(String(inserted?.encryptedAccountNumber))).toBe('ABC123');
    expect(result).toMatchObject({ configured: true, connected: true, verified: false, accountLast4: 'C123' });
    expect(JSON.stringify(result)).not.toMatch(/private-access|private-refresh|ABC123/);
  });

  test('reconnecting replaces only this tenant account and clears prior rating verification', async () => {
    stored = { organizationId: 'org-a', encryptedAccountNumber: encryptAiSecret('OLD123').encrypted,
      encryptedAccessToken: encryptAiSecret('old-access').encrypted,
      encryptedRefreshToken: encryptAiSecret('old-refresh').encrypted,
      accessExpiresAt: new Date(Date.now() + 3600_000), refreshExpiresAt: null,
      mode: 'test', status: 'connected', verifiedAt: new Date(), connectedAt: new Date(), updatedAt: new Date() };
    const { pending } = startUpsAuthorization('org-a', 'admin-a', 'NEW456');
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }) } as Response);
    await completeUpsAuthorization(pending, 'replacement-code');
    expect(decryptAiSecret(String(stored?.encryptedAccountNumber))).toBe('NEW456');
    expect(stored?.verifiedAt).toBeNull();
    expect((await upsConnectionStatus('org-a')).verified).toBe(false);
    expect((await upsConnectionStatus('org-b')).connected).toBe(false);
  });

  test('uses only the saved tenant token and account, and disconnect removes credentials', async () => {
    stored = { organizationId: 'org-a', encryptedAccountNumber: encryptAiSecret('ABC123').encrypted,
      encryptedAccessToken: encryptAiSecret('tenant-access').encrypted,
      encryptedRefreshToken: encryptAiSecret('tenant-refresh').encrypted,
      accessExpiresAt: new Date(Date.now() + 3600_000), refreshExpiresAt: null, mode: 'test', status: 'connected',
      verifiedAt: null, connectedAt: new Date(), updatedAt: new Date() };
    const credentials = await upsRateCredentials('org-a');
    expect(credentials).toMatchObject({ token: 'tenant-access', accountNumber: 'ABC123' });
    await expect(upsRateCredentials('org-b')).rejects.toMatchObject({ code: 'UPS_NOT_CONNECTED' });
    expect((await upsConnectionStatus('org-b')).accountLast4).toBeNull();
    expect(await disconnectUps('org-a')).toMatchObject({ connected: false, accountLast4: null });
    expect(dbMock.delete).toHaveBeenCalledTimes(1);
  });

  test('refreshes an expired token with the saved refresh token, without client-credentials fallback', async () => {
    stored = { organizationId: 'org-a', encryptedAccountNumber: encryptAiSecret('ABC123').encrypted,
      encryptedAccessToken: encryptAiSecret('old-access').encrypted,
      encryptedRefreshToken: encryptAiSecret('old-refresh').encrypted,
      accessExpiresAt: new Date(0), refreshExpiresAt: null, mode: 'test', status: 'connected',
      verifiedAt: null, connectedAt: new Date(), updatedAt: new Date() };
    const provider = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600 }) } as Response);
    expect((await upsRateCredentials('org-a')).token).toBe('fresh-access');
    const [, init] = provider.mock.calls[0];
    expect(new URLSearchParams(String(init?.body)).get('grant_type')).toBe('refresh_token');
    expect(new URLSearchParams(String(init?.body)).get('refresh_token')).toBe('old-refresh');
    expect(decryptAiSecret(String(stored?.encryptedRefreshToken))).toBe('fresh-refresh');
  });

  test('expired merchant authorization requires reconnect and does not call UPS', async () => {
    stored = { organizationId: 'org-a', encryptedAccountNumber: encryptAiSecret('ABC123').encrypted,
      encryptedAccessToken: encryptAiSecret('old-access').encrypted,
      encryptedRefreshToken: encryptAiSecret('old-refresh').encrypted,
      accessExpiresAt: new Date(0), refreshExpiresAt: new Date(0), mode: 'test', status: 'connected',
      verifiedAt: null, connectedAt: new Date(), updatedAt: new Date() };
    expect(await upsConnectionStatus('org-a')).toMatchObject({ connected: false, accountLast4: 'C123' });
    const provider = jest.spyOn(globalThis, 'fetch');
    await expect(upsRateCredentials('org-a')).rejects.toMatchObject({ code: 'UPS_RECONNECT_REQUIRED' });
    expect(provider).not.toHaveBeenCalled();
  });
});
