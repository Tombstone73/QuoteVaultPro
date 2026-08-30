import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const service=readFileSync(resolve("server/quickbooksService.ts"),"utf8");
const route=readFileSync(resolve("v2/src/interfaces/http/quickBooksIntegrationRoutes.ts"),"utf8");
const ui=readFileSync(resolve("v2/ui/src/QuickBooksSettingsWorkspace.tsx"),"utf8");

assert.match(service,/getQuickBooksConnectionReadinessForOrganization/);
assert.match(service,/configured === "sandbox"/);
assert.match(service,/configured === "production"/);
assert.match(service,/connected_unknown/);
assert.match(service,/QUICKBOOKS_AUTOMATION_OWNER/);
assert.doesNotMatch(route,/CLIENT_SECRET|refresh_token|access_token/iu);
assert.match(route,/organization\.configure/);
assert.match(route,/\/connect/);
assert.match(route,/\/disconnect/);
assert.match(route,/createQuickBooksIntegrationCallback/);
assert.match(route,/callbackUrl/);
assert.match(ui,/Connect QuickBooks/);
assert.match(ui,/Reconnect QuickBooks/);
assert.match(ui,/Connection mode/);
console.log("QuickBooks readiness and OAuth settings contracts passed.");
