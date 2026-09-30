import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decryptEmailCredential, encryptEmailCredential } from "../../infrastructure/communications/emailCredentialCrypto.js";
import { createEmailIntegrationCallback } from "../../src/interfaces/http/emailIntegrationRoutes.js";

const root = new URL("../../..", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const prior = process.env.EMAIL_INTEGRATION_ENCRYPTION_KEY;
process.env.EMAIL_INTEGRATION_ENCRYPTION_KEY = "v2-email-integration-contract-test-key";
try {
  const credential = encryptEmailCredential("refresh-token-that-must-never-cross-http");
  assert.match(credential.encrypted, /^email:v1:/u);
  assert.ok(!credential.encrypted.includes("refresh-token-that-must-never-cross-http"));
  assert.equal(decryptEmailCredential(credential.encrypted), "refresh-token-that-must-never-cross-http");
} finally {
  if (prior === undefined) delete process.env.EMAIL_INTEGRATION_ENCRYPTION_KEY;
  else process.env.EMAIL_INTEGRATION_ENCRYPTION_KEY = prior;
}

const migration = source("server/db/migrations_v2/0233_v2_tenant_email_integration.sql");
assert.match(migration, /v2_email_integrations/u);
assert.match(migration, /communications\.configure/u);
assert.match(migration, /encrypted_refresh_token/u);
const integration = source("v2/infrastructure/communications/postgresEmailIntegration.ts");
assert.match(integration, /INSERT INTO v2_email_integrations/u);
assert.match(integration, /INSERT INTO v2_email_oauth_states/u);
assert.match(integration, /UPDATE email_settings SET refresh_token=NULL,is_active=false/u);
assert.match(integration, /state_hash!==hash\(input\.state\)/u);
assert.match(integration, /session_hash!==hash\(input\.sessionId\)/u);
assert.match(integration, /access_type:"offline",prompt:"consent"/u);
assert.match(integration, /legacyAvailable:true/u);
const routes = source("v2/src/interfaces/http/emailIntegrationRoutes.ts");
assert.match(routes, /capability:"communications\.configure"/u);
assert.match(routes, /returnToSettings/u);
assert.ok(!routes.includes("refreshToken"));
const vercel = JSON.parse(source("v2/ui/vercel.json"));
const callback = "/api/email/google/callback";
const rewrites = (vercel.routes ?? vercel.rewrites).filter((route: { src?: string; source?: string }) => route.src || route.source);
const rewrite = rewrites.find((route: { src?: string; source?: string }) => new RegExp(route.src ?? `^${route.source!.replace(":path*", "(.*)")}$`).test(callback));
assert.ok(rewrite, "Gmail callback must be routed before the SPA fallback");
const origin = "https://callback-owner.example";
const destination = callback.replace(new RegExp(rewrite.src ?? `^${rewrite.source.replace(":path*", "(.*)")}$`), rewrite.dest ?? rewrite.destination).replace("${V2_UI_API_ORIGIN}", origin);
assert.equal(destination, `${origin}${callback}`, "callback must preserve its path at the configured API owner, not serve index.html");
const state = `${Buffer.from(JSON.stringify({ organizationId: "org-a" })).toString("base64url")}.signed-state`;
const principal = { kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { membershipId: "member-a", capabilities: ["communications.configure"] } };
const finishes: unknown[] = [];
const redirects: unknown[] = [];
let authenticated = true;
const callbackOwner = createEmailIntegrationCallback({
  integrations: { finishConnect: async (input: unknown) => { finishes.push(input); } },
  identities: { authenticatedIdentity: async () => authenticated ? { sessionId: "session-a" } : null },
  principals: { principal: async (_request: unknown, organizationId: string) => { assert.equal(organizationId, "org-a"); return principal; } },
  publicWebOrigin: "https://workspace.example",
} as any);
await callbackOwner({ query: { state, code: "authorization-code" } } as any, { redirect: (status: number, location: string) => redirects.push({ status, location }) } as any);
assert.deepEqual(finishes, [{ state, code: "authorization-code", principal, sessionId: "session-a" }]);
assert.deepEqual(redirects, [{ status: 302, location: "https://workspace.example/settings?email=connected" }]);
authenticated = false;
await callbackOwner({ query: { state, code: "authorization-code" } } as any, { redirect: (status: number, location: string) => redirects.push({ status, location }) } as any);
authenticated = true;
principal.authority.capabilities = [];
await callbackOwner({ query: { state, code: "authorization-code" } } as any, { redirect: (status: number, location: string) => redirects.push({ status, location }) } as any);
assert.equal(finishes.length, 1, "an authenticated session and communications.configure are both required before binding Gmail");
assert.deepEqual(redirects.slice(1), Array.from({ length: 2 }, () => ({ status: 302, location: "https://workspace.example/settings?email=error" })));
const delivery = source("v2/infrastructure/sales/postgresQuoteDelivery.ts");
assert.match(delivery, /this\.integrations\.requireReady\(context\.organizationId\)/u);
assert.match(delivery, /const prepared = await this\.prepare\(context, input, integration\)/u);
assert.ok(delivery.indexOf("this.integrations.requireReady") < delivery.indexOf("this.prepare(context, input, integration)"));
assert.ok(!delivery.includes("FROM email_settings"));
assert.match(delivery, /providerRequiresReauth/u);
assert.match(delivery, /quoteRecipientReadiness/u);
console.log("email integration contracts passed");
