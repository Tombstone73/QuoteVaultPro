import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import {
  classifyQuickBooksCredentialError,
  decryptQuickBooksToken,
  encryptQuickBooksToken,
  encryptQuickBooksTokenIfConfigured,
  extractQuickBooksOAuthDiagnostic,
  getQuickBooksCredentialCauseText,
  isEncryptedQuickBooksToken,
  mergeQuickBooksRefreshToken,
  redactQuickBooksOAuthDiagnostic,
} from "../services/quickbooksCredentialManager";

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

  test("classifies invalid grants separately from transient refresh failures", () => {
    expect(classifyQuickBooksCredentialError(new Error("invalid_grant"))).toBe("invalid_grant");
    expect(classifyQuickBooksCredentialError({ response: { data: { error: "invalid_client" } } })).toBe("invalid_client");
    expect(classifyQuickBooksCredentialError({ status: 503, message: "Service unavailable" })).toBe("transient_api_failure");
    expect(classifyQuickBooksCredentialError(new Error("request timeout"))).toBe("network_failure");
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

  test("QuickBooks requests force refresh and replay exactly once after an API 401", () => {
    const serviceSource = readRepoFile("server/quickbooksService.ts");
    const makeRequestBody = serviceSource.slice(serviceSource.indexOf("async function makeQBRequest"), serviceSource.indexOf("async function fetchAllQuickBooksQueryPages"));

    expect(makeRequestBody).toContain("response.status === 401");
    expect(makeRequestBody).toContain("refreshQuickBooksCredentialsForRequest(orgId, true)");
    expect((makeRequestBody.match(/sendRequest\(/g) ?? []).length).toBe(2);
    expect(makeRequestBody).toContain("replayAttempted: true");
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

    expect(credentialSource).toContain("pg_try_advisory_lock");
    expect(credentialSource).toContain("quickbooks_oauth_refresh:${orgId}");
    expect(credentialSource).toContain("pg_advisory_unlock");
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
});
