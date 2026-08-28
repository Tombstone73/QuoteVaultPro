import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decryptEmailCredential, encryptEmailCredential } from "../../infrastructure/communications/emailCredentialCrypto.js";

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
const vercel = source("v2/ui/vercel.json");
assert.ok(vercel.includes('"source": "/api/email/google/callback"'));
assert.ok(vercel.includes('"destination": "https://api-dev.printershero.com/api/email/google/callback"'));
assert.ok(vercel.indexOf("/api/email/google/callback") < vercel.indexOf("/:path*"));
const delivery = source("v2/infrastructure/sales/postgresQuoteDelivery.ts");
assert.match(delivery, /this\.integrations\.requireReady\(context\.organizationId\)/u);
assert.match(delivery, /const prepared = await this\.prepare\(context, input, integration\)/u);
assert.ok(delivery.indexOf("this.integrations.requireReady") < delivery.indexOf("this.prepare(context, input, integration)"));
assert.ok(!delivery.includes("FROM email_settings"));
assert.match(delivery, /providerRequiresReauth/u);
assert.match(delivery, /quoteRecipientReadiness/u);
console.log("email integration contracts passed");
