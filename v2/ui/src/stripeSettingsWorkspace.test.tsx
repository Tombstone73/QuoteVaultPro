import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=readFileSync("v2/ui/src/StripeSettingsWorkspace.tsx","utf8");
assert.match(source,/not_connected: "Not connected"/);
assert.match(source,/onboarding: "Onboarding incomplete"/);
assert.match(source,/requirements_due: "Requirements due"/);
assert.match(source,/connected \? status\(connection\?\.cardPayments/);
console.log("Stripe Connect readiness presentation tests passed.");
