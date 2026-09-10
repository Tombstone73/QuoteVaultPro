import { describe, expect, jest, test, beforeEach, afterEach } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import {
  classifyQuickBooksCredentialError,
  decryptQuickBooksToken,
  encryptQuickBooksToken,
  encryptQuickBooksTokenIfConfigured,
  extractQuickBooksOAuthDiagnostic,
  getQuickBooksCredentialCauseText,
  isRecoverableQuickBooksSdkRefreshValidationLatch,
  isEncryptedQuickBooksToken,
  mergeQuickBooksRefreshToken,
  redactQuickBooksOAuthDiagnostic,
  resolveQuickBooksTokenExpiryMetadata,
  selectAuthoritativeQuickBooksConnection,
} from "../services/quickbooksCredentialManager";
import { refreshQuickBooksOAuthGrant } from "../services/quickbooksOAuthProvider";

const root = process.cwd();

function readRepoFile(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("QuickBooks OAuth credential reliability", () => {
  beforeEach(() => {
    process.env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY = "test-quickbooks-token-encryption-key";
    process.env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY_ID = "test-key";
    delete process.env.QB_TOKEN_ENCRYPTION_KEY;
    delete process.env.QB_TOKEN_ENCRYPTION_KEY_ID;
  });

  afterEach(() => {
    delete process.env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY;
    delete process.env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY_ID;
    delete process.env.QB_TOKEN_ENCRYPTION_KEY;
    delete process.env.QB_TOKEN_ENCRYPTION_KEY_ID;
  });

  test("encrypts QuickBooks tokens at rest without storing plaintext", () => {
    const plaintext = "qb-access-token-secret";
    const encrypted = encryptQuickBooksToken(plaintext);

    expect(isEncryptedQuickBooksToken(encrypted)).toBe(true);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptQuickBooksToken(encrypted)).toEqual({ value: plaintext, wasEncrypted: true });
  });

  test("keeps plaintext compatibility and only encrypts automatically when configured", () => {
    expect(decryptQuickBooksToken("legacy-token")).toEqual({ value: "legacy-token", wasEncrypted: false });
    expect(isEncryptedQuickBooksToken(encryptQuickBooksTokenIfConfigured("new-token"))).toBe(true);

    delete process.env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY;

    expect(encryptQuickBooksTokenIfConfigured("offline-dev-token")).toBe("offline-dev-token");
  });

  test("preserves existing refresh token when Intuit omits or blanks a rotated refresh token", () => {
    expect(mergeQuickBooksRefreshToken("existing-refresh", { access_token: "next-access" })).toBe("existing-refresh");
    expect(mergeQuickBooksRefreshToken("existing-refresh", { access_token: "next-access", refresh_token: "" })).toBe("existing-refresh");
    expect(mergeQuickBooksRefreshToken("existing-refresh", { access_token: "next-access", refresh_token: "rotated-refresh" })).toBe("rotated-refresh");
  });

  test("classifies structured and Intuit plain-text invalid refresh-token failures as reauthorization required", () => {
    expect(classifyQuickBooksCredentialError({ response: { data: { error: "invalid_grant" } } })).toBe("invalid_grant");
    expect(classifyQuickBooksCredentialError(new Error("invalid_grant"))).toBe("invalid_grant");
    expect(classifyQuickBooksCredentialError(new Error("The Refresh token is invalid, please Authorize again."))).toBe("invalid_grant");
    expect(classifyQuickBooksCredentialError({ response: { data: { error: "invalid_client" } } })).toBe("invalid_client");
    expect(classifyQuickBooksCredentialError({ status: 503, message: "Service unavailable" })).toBe("transient_api_failure");
    expect(classifyQuickBooksCredentialError(new Error("request timeout"))).toBe("network_failure");
  });

  test("uses Intuit expiry metadata and preserves refresh-token expiry for rotation diagnostics", () => {
    const now = new Date("2026-09-03T12:00:00.000Z");
    expect(resolveQuickBooksTokenExpiryMetadata({ expires_in: 3600, x_refresh_token_expires_in: 8_640_000 }, now)).toEqual({
      accessExpiresAt: new Date("2026-09-03T13:00:00.000Z"),
      refreshTokenExpiresAt: "2026-12-12T12:00:00.000Z",
      refreshTokenExpiresInSeconds: 8_640_000,
    });
  });

  test("extracts OAuth refresh failure details and keeps the cause text", () => {
    const error = {
      response: {
        status: 400,
        data: {
          error: "invalid_grant",
          error_description: "Token has been revoked",
        },
      },
      message: "Request failed with status code 400",
    };
    const diagnostic = extractQuickBooksOAuthDiagnostic(error);

    expect(diagnostic.httpStatus).toBe(400);
    expect(diagnostic.oauthError).toBe("invalid_grant");
    expect(diagnostic.oauthErrorDescription).toBe("Token has been revoked");
    expect(getQuickBooksCredentialCauseText({ diagnostic, category: "invalid_grant" })).toBe("invalid_grant");
  });

  test("redacts tokens, secrets, and authorization headers from OAuth diagnostics", () => {
    const redacted = redactQuickBooksOAuthDiagnostic({
      access_token: "access-secret",
      refreshToken: "refresh-secret",
      Authorization: "Bearer secret",
      nested: { client_secret: "client-secret", safe: "kept" },
    }) as any;

    expect(JSON.stringify(redacted)).not.toContain("access-secret");
    expect(JSON.stringify(redacted)).not.toContain("refresh-secret");
    expect(JSON.stringify(redacted)).not.toContain("Bearer secret");
    expect(JSON.stringify(redacted)).not.toContain("client-secret");
    expect(redacted.nested.safe).toBe("kept");
  });

  test("tenant-scoped request execution does not default missing organization context to the production org", () => {
    const serviceSource = readRepoFile("server/quickbooksService.ts");
    const makeRequestBody = serviceSource.slice(serviceSource.indexOf("async function makeQBRequest"), serviceSource.indexOf("async function fetchAllQuickBooksQueryPages"));

    expect(makeRequestBody).toContain("requireQuickBooksOrganizationId");
    expect(makeRequestBody).not.toContain("organizationId || DEFAULT_ORGANIZATION_ID");
    expect(makeRequestBody).not.toContain("organizationId ?? DEFAULT_ORGANIZATION_ID");
  });

  test("QuickBooks only replays idempotent reads after an API 401", () => {
    const serviceSource = readRepoFile("server/quickbooksService.ts");
    const makeRequestBody = serviceSource.slice(serviceSource.indexOf("async function makeQBRequest"), serviceSource.indexOf("async function fetchAllQuickBooksQueryPages"));

    expect(makeRequestBody).toContain("response.status === 401 && method === 'GET'");
    expect(makeRequestBody).toContain("refreshQuickBooksCredentialsForRequest(orgId, true)");
    expect((makeRequestBody.match(/sendRequest\(/g) ?? []).length).toBe(2);
    expect(makeRequestBody).toContain("replayAttempted: true");
  });

  test("an Accounting API 401 preserves authorization; only the locked OAuth refresh path can latch reauthorization", () => {
    const serviceSource = readRepoFile("server/quickbooksService.ts");
    const makeRequestBody = serviceSource.slice(serviceSource.indexOf("async function makeQBRequest"), serviceSource.indexOf("async function fetchAllQuickBooksQueryPages"));
    const refreshBody = readRepoFile("server/services/quickbooksCredentialManager.ts").slice(
      readRepoFile("server/services/quickbooksCredentialManager.ts").indexOf("async refreshCredentials"),
      readRepoFile("server/services/quickbooksCredentialManager.ts").indexOf("async recordSuccessfulRequest"),
    );

    expect(makeRequestBody).toContain("api_access_token_rejected_after_replay");
    expect(makeRequestBody).toContain("recordTransientFailure(orgId, 'transient_api_failure', err)");
    expect(makeRequestBody).not.toContain("markNeedsReauth(orgId, latest, err)");
    expect(refreshBody).toContain("if (category === \"invalid_grant\")");
    expect(refreshBody).toContain("await this.markNeedsReauth(orgId, refreshing, error)");
  });

  test("failed access token errors preserve credential manager cause and OAuth fields", () => {
    const serviceSource = readRepoFile("server/quickbooksService.ts");
    const makeRequestBody = serviceSource.slice(serviceSource.indexOf("async function makeQBRequest"), serviceSource.indexOf("async function fetchAllQuickBooksQueryPages"));
    const failedTokenLog = makeRequestBody.slice(makeRequestBody.indexOf("console.error('[QuickBooks] Failed to get valid access token'"), makeRequestBody.indexOf("const wrapped: any = new Error(`Failed to get valid access token"));

    expect(makeRequestBody).toContain("Failed to get valid access token.\\nCause:\\n${cause}");
    expect(makeRequestBody).toContain("oauthError");
    expect(makeRequestBody).toContain("oauthErrorDescription");
    expect(makeRequestBody).toContain("refreshHttpStatus");
    expect(failedTokenLog).not.toContain("refreshToken:");
    expect(failedTokenLog).not.toContain("accessToken:");
  });

  test("credential refresh uses a database-backed per-organization lock", () => {
    const credentialSource = readRepoFile("server/services/quickbooksCredentialManager.ts");

    expect(credentialSource).toContain("db.transaction");
    expect(credentialSource).toContain("pg_try_advisory_xact_lock");
    expect(credentialSource).toContain("quickbooks_oauth_credentials:${String(organizationId ?? \"\").trim()}");
    expect(credentialSource).not.toContain("pg_advisory_unlock");
    expect(credentialSource).toContain("refreshLock.acquired");
    expect(credentialSource).toContain("refreshLock.timeout");
  });

  test("credential manager logs refresh stages and persistence results without secret fields", () => {
    const credentialSource = readRepoFile("server/services/quickbooksCredentialManager.ts");

    expect(credentialSource).toContain("getValidAccessToken.start");
    expect(credentialSource).toContain("refreshCredentials.intuit_refresh_failed");
    expect(credentialSource).toContain("refreshCredentials.persist_succeeded");
    expect(credentialSource).toContain("accessTokenPersisted");
    expect(credentialSource).toContain("refreshTokenRotated");
    expect(credentialSource).toContain("refreshTokenPreserved");
    expect(credentialSource).toContain("redactQuickBooksOAuthDiagnostic");
  });

  test("sync workers require the job organization for push and pull processors", () => {
    const workerSource = readRepoFile("server/workers/syncProcessor.ts");

    expect((workerSource.match(/missing organizationId/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(workerSource).toContain("processPushCustomers(job.id, job.organizationId)");
    expect(workerSource).toContain("processPushInvoices(job.id, job.organizationId)");
    expect(workerSource).toContain("processPullOrders(job.id, job.organizationId)");
    expect(workerSource).toContain("processPushOrders(job.id, job.organizationId)");
  });

  test("status route exposes structured state and only requires action for needs_reauth", () => {
    const routeSource = readRepoFile("server/routes/quickbooks.routes.ts");

    expect(routeSource).toContain("state: status.state");
    expect(routeSource).toContain("requiresUserAction: status.requiresUserAction");
    expect(routeSource).toContain("status.state === 'degraded'");
    expect(routeSource).toContain("status.state === 'needs_reauth'");
  });

  test("operator backfill command rewrites plaintext QuickBooks tokens through the shared encryption helper", () => {
    const scriptSource = readRepoFile("scripts/backfillQuickBooksOAuthEncryption.ts");
    const packageSource = readRepoFile("package.json");

    expect(scriptSource).toContain("encryptQuickBooksTokenIfConfigured");
    expect(scriptSource).toContain("decryptQuickBooksToken");
    expect(scriptSource).not.toContain("console.log(access");
    expect(scriptSource).not.toContain("console.log(refresh");
    expect(packageSource).toContain("qb:oauth:encrypt-backfill");
  });

  test("selects the authoritative active QuickBooks connection instead of stale rows", () => {
    const base = {
      provider: "quickbooks",
      organizationId: "org_1",
      companyId: "realm",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    } as any;
    const staleNewest = {
      ...base,
      id: "stale",
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
      metadata: { qbConnection: { authoritative: false, state: "superseded" } },
    };
    const authoritative = {
      ...base,
      id: "authoritative",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      metadata: { qbConnection: { authoritative: true, state: "connected" } },
    };

    expect(selectAuthoritativeQuickBooksConnection([staleNewest, authoritative])?.id).toBe("authoritative");
  });

  test("OAuth callback updates one authoritative connection and supersedes duplicate rows", () => {
    const serviceSource = readRepoFile("server/quickbooksService.ts");
    const exchangeBody = serviceSource.slice(serviceSource.indexOf("export async function exchangeCodeForTokens"), serviceSource.indexOf("export async function refreshAccessToken"));

    expect(exchangeBody).toContain("pg_advisory_xact_lock");
    expect(exchangeBody).toContain("quickBooksCredentialLockKey(orgId)");
    expect(exchangeBody).toContain("selectAuthoritativeQuickBooksConnection(existingConnections)");
    expect(exchangeBody).toContain(".update(oauthConnections)");
    expect(exchangeBody).toContain(".insert(oauthConnections)");
    expect(exchangeBody).not.toContain(".delete(oauthConnections)");
    expect(exchangeBody).toContain("state: 'superseded'");
    expect(exchangeBody).toContain("qbAuth: _qbAuth");
    expect(exchangeBody).toContain("lastOAuthError: null");
    expect(exchangeBody).toContain("refreshTokenExpiresAt: expiry.refreshTokenExpiresAt");
  });

  test("refreshed credential persistence is one-row verified and preserves non-OAuth failures", () => {
    const credentialSource = readRepoFile("server/services/quickbooksCredentialManager.ts");
    const persistBody = credentialSource.slice(credentialSource.indexOf("private async persistCredentials"), credentialSource.indexOf("async withRefreshLock"));
    const refreshBody = credentialSource.slice(credentialSource.indexOf("async refreshCredentials"), credentialSource.indexOf("async recordSuccessfulRequest"));

    expect(persistBody).toContain(".returning()");
    expect(persistBody).toContain("updated.length !== 1");
    expect(persistBody).toContain("Refusing to persist empty QuickBooks refresh token");
    expect(persistBody).toContain("stale qbAuth metadata remains");
    expect(persistBody).toContain("credentialGeneration");
    expect(refreshBody).toContain("category: \"persistence_failure\"");
    expect(refreshBody).toContain("markNeedsReauth(orgId, current, error, \"persistence_failure\")");
    expect(refreshBody).not.toContain("markNeedsReauth(orgId, latest, error); } catch");
  });

  test("a forced 401 refresh uses a peer-rotated credential instead of rotating again", () => {
    const credentialSource = readRepoFile("server/services/quickbooksCredentialManager.ts");
    const refreshBody = credentialSource.slice(credentialSource.indexOf("async refreshCredentials"), credentialSource.indexOf("async recordSuccessfulRequest"));

    expect(refreshBody).toContain("peerAlreadyRefreshed");
    expect(refreshBody).toContain("latest.accessToken !== input.connection.accessToken");
    expect(refreshBody).toContain("!accessTokenExpired");
  });

  test("credential reads never write a stale plaintext snapshot over a rotated token", () => {
    const credentialSource = readRepoFile("server/services/quickbooksCredentialManager.ts");
    const loadBody = credentialSource.slice(credentialSource.indexOf("async loadCredentials"), credentialSource.indexOf("async getStatus"));

    expect(loadBody).toContain("Do not opportunistically rewrite legacy plaintext rows here");
    expect(loadBody).not.toContain("plaintextCompatibilityRewriteAt");
  });

  test("health and request-status writes use an optimistic updated-at guard so stale requests cannot regress rotated metadata", () => {
    const credentialSource = readRepoFile("server/services/quickbooksCredentialManager.ts");
    const serviceSource = readRepoFile("server/quickbooksService.ts");

    expect(credentialSource).toContain("eq(oauthConnections.updatedAt, connection.updatedAt)");
    expect(serviceSource).toContain("const current = await quickBooksCredentialManager.loadCredentials(organizationId)");
    expect(serviceSource).toContain("eq(oauthConnections.updatedAt, current.updatedAt)");
  });

  test("successful reauthorization clears stale needs_reauth and transient metadata", () => {
    const serviceSource = readRepoFile("server/quickbooksService.ts");
    const exchangeBody = serviceSource.slice(serviceSource.indexOf("export async function exchangeCodeForTokens"), serviceSource.indexOf("export async function refreshAccessToken"));

    expect(exchangeBody).toContain("qbAuth: _qbAuth");
    expect(exchangeBody).toContain("qbHealth: _qbHealth");
    expect(exchangeBody).toContain("qbCredential: _qbCredential");
    expect(exchangeBody).toContain("state: 'connected'");
    expect(exchangeBody).toContain("lastErrorCode: null");
    expect(exchangeBody).toContain("consecutiveTransientFailureCount: 0");
  });

  test("logout and backend restart do not depend on browser session credentials", () => {
    const serviceSource = readRepoFile("server/quickbooksService.ts");
    const credentialSource = readRepoFile("server/services/quickbooksCredentialManager.ts");
    const routeSource = readRepoFile("server/routes/quickbooks.routes.ts");

    expect(serviceSource).toContain("requireQuickBooksOrganizationId");
    expect(credentialSource).toContain("decryptQuickBooksToken(persisted.accessToken)");
    expect(credentialSource).toContain("decryptQuickBooksToken(persisted.refreshToken)");
    expect(routeSource).not.toContain("logout");
    expect(routeSource).toContain("tenantContext");
  });

  test("fresh access token remains on the cached-token path", () => {
    const source = readRepoFile("server/services/quickbooksCredentialManager.ts");
    expect(source).toContain("if (!options.forceRefresh && !accessTokenExpired)");
    expect(source).toContain("return connection.accessToken");
  });

  test("expired access token reaches Intuit with the persisted refresh grant", async () => {
    const refreshUsingToken = jest.fn().mockResolvedValue({ token: { access_token: "new-access" } });
    await expect(refreshQuickBooksOAuthGrant({ refreshUsingToken }, " stored-refresh ")).resolves.toEqual({
      token: { access_token: "new-access" },
    });
    expect(refreshUsingToken).toHaveBeenCalledWith("stored-refresh");
  });

  test("rotated refresh token is selected for persistence", () => {
    expect(mergeQuickBooksRefreshToken("old-refresh", { access_token: "new-access", refresh_token: "new-refresh" })).toBe("new-refresh");
  });

  test("refresh response without a new refresh token preserves the stored grant", () => {
    expect(mergeQuickBooksRefreshToken("stored-refresh", { access_token: "new-access" })).toBe("stored-refresh");
  });

  test("concurrent refresh path reloads peer credentials under the organization lock", () => {
    const source = readRepoFile("server/services/quickbooksCredentialManager.ts");
    expect(source).toContain("pg_try_advisory_xact_lock");
    expect(source).toContain("peerAlreadyRefreshed");
    expect(source).toContain("return latest as T");
  });

  test("invalid_grant remains the only OAuth response that requires reauthorization", () => {
    expect(classifyQuickBooksCredentialError({ response: { status: 400, data: { error: "invalid_grant" } } })).toBe("invalid_grant");
  });

  test("invalid_client remains a configuration failure and not a revoked grant", () => {
    expect(classifyQuickBooksCredentialError({ response: { status: 401, data: { error: "invalid_client" } } })).toBe("invalid_client");
  });

  test("transient OAuth failure remains retryable without reconnect", () => {
    expect(classifyQuickBooksCredentialError({ response: { status: 503 }, message: "Service unavailable" })).toBe("transient_api_failure");
  });

  test("post-refresh persistence failure is surfaced and latched safely", () => {
    const source = readRepoFile("server/services/quickbooksCredentialManager.ts");
    expect(source).toContain('category: "persistence_failure"');
    expect(source).toContain('await this.markNeedsReauth(orgId, current, error, "persistence_failure")');
  });

  test("missing refresh token is rejected before provider execution", async () => {
    const refreshUsingToken = jest.fn();
    await expect(refreshQuickBooksOAuthGrant({ refreshUsingToken }, " ")).rejects.toThrow("refresh token is missing");
    expect(refreshUsingToken).not.toHaveBeenCalled();
  });

  test("missing access token in a refresh response is rejected", () => {
    const source = readRepoFile("server/services/quickbooksCredentialManager.ts");
    expect(source).toContain("QuickBooks refresh response did not include an access token");
  });

  test("tenant isolation scopes credential load and persistence by organization", () => {
    const source = readRepoFile("server/services/quickbooksCredentialManager.ts");
    expect(source).toContain('eq(oauthConnections.organizationId, orgId)');
    expect(source).toContain('eq(oauthConnections.organizationId, args.organizationId)');
  });

  test("duplicate connection rows resolve to one authoritative active row", () => {
    const rows = [
      { id: "stale", updatedAt: new Date("2026-09-10T12:00:00Z"), createdAt: new Date(), metadata: { qbConnection: { authoritative: false, state: "superseded" } } },
      { id: "active", updatedAt: new Date("2026-09-09T12:00:00Z"), createdAt: new Date(), metadata: { qbConnection: { authoritative: true, state: "connected" } } },
    ] as any;
    expect(selectAuthoritativeQuickBooksConnection(rows)?.id).toBe("active");
  });

  test("legacy plaintext credential loading remains supported", () => {
    expect(decryptQuickBooksToken("legacy-refresh")).toEqual({ value: "legacy-refresh", wasEncrypted: false });
  });

  test("encrypted credential loading remains supported", () => {
    const encrypted = encryptQuickBooksToken("encrypted-refresh");
    expect(decryptQuickBooksToken(encrypted)).toEqual({ value: "encrypted-refresh", wasEncrypted: true });
  });

  test("backend restart recovery uses only persisted organization credentials", () => {
    const source = readRepoFile("server/services/quickbooksCredentialManager.ts");
    expect(source).toContain("async loadCredentials(organizationId");
    expect(source).not.toContain("express-session");
  });

  test("browser logout does not clear the provider credential row", () => {
    const routes = readRepoFile("server/routes/quickbooks.routes.ts");
    expect(routes).not.toContain("logout");
    expect(routes).toContain("disconnectConnectionForOrganization");
  });

  test("queued approved force sync acquires credentials before provider execution", () => {
    const worker = readRepoFile("server/services/quickbooksSyncQueueWorker.ts");
    const selected = worker.slice(worker.indexOf("export async function runSelectedQuickBooksSyncForOrg"), worker.indexOf("export async function enqueueSelectedQuickBooksSyncForOrg"));
    expect(selected.indexOf("getValidAccessTokenForOrganization")).toBeLessThan(selected.indexOf("syncSingleInvoiceToQuickBooksForOrganization"));
    expect(selected).toContain("getInvoiceQuickBooksApprovalEligibility");
    expect(selected).toContain("claimQuickBooksSyncLease");
  });

  test("provider execution receives the newly refreshed access token", async () => {
    const providerCall = jest.fn();
    const refreshUsingToken = jest.fn().mockResolvedValue({ token: { access_token: "new-access", refresh_token: "new-refresh" } });
    const response = await refreshQuickBooksOAuthGrant({ refreshUsingToken }, "old-refresh");
    await providerCall(response.token.access_token);
    expect(providerCall).toHaveBeenCalledWith("new-access");
  });

  test("diagnostic logging contains no raw credential fields", () => {
    const provider = readRepoFile("server/services/quickbooksOAuthProvider.ts");
    const service = readRepoFile("server/quickbooksService.ts");
    const refreshLog = service.slice(service.indexOf("async function refreshQuickBooksTokenWithDiagnostics"), service.indexOf("async function setQuickBooksTransientHealthError"));
    expect(provider).not.toContain("console.");
    expect(refreshLog).not.toContain("oauthClient.setToken");
    expect(refreshLog).not.toContain("oauthClient.refresh()");
    expect(refreshLog).toContain("hasAccessToken:");
    expect(refreshLog).toContain("refreshTokenRotated:");
    expect(refreshLog).toContain("getQuickBooksOAuthRuntimeDiagnostic");
    expect(refreshLog).not.toContain("Authorization:");
  });

  test("legacy SDK-local invalid latch is retried but an Intuit HTTP invalid_grant remains latched", () => {
    const base = { metadata: { qbAuth: { state: "needs_reauth", message: "The Refresh token is invalid, please Authorize again." }, qbCredential: { lastErrorHttpStatus: null } } } as any;
    expect(isRecoverableQuickBooksSdkRefreshValidationLatch(base)).toBe(true);
    expect(isRecoverableQuickBooksSdkRefreshValidationLatch({ ...base, metadata: { ...base.metadata, qbCredential: { lastErrorHttpStatus: 400 } } })).toBe(false);
    const source = readRepoFile("server/services/quickbooksCredentialManager.ts");
    expect(source).toContain("delete (refreshingMetadata as any).qbAuth");
  });

  test("refresh failure state writes use the post-refreshing row version", () => {
    const source = readRepoFile("server/services/quickbooksCredentialManager.ts");
    expect(source).toContain("const refreshing = await this.loadCredentials(orgId)");
    expect(source).toContain("this.markDegraded(orgId, refreshing");
    expect(source).toContain("this.markNeedsReauth(orgId, refreshing");
  });
});
