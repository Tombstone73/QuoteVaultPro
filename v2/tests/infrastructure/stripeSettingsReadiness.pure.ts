import assert from "node:assert/strict";
import { stripeRuntimeReadiness } from "../../../server/lib/stripe.js";

const absent = stripeRuntimeReadiness({});
assert.deepEqual(absent, { mode: "unknown", status: "not_configured", secretKeyConfigured: false, publishableKeyMode: "missing", webhook: "missing", configurationOwner: "platform_managed", actionRequired: "Platform-managed Stripe test credentials are not configured for this environment." });
const incomplete = stripeRuntimeReadiness({ STRIPE_SECRET_KEY: "sk_test_example", VITE_STRIPE_PUBLISHABLE_KEY: "pk_test_example" });
assert.equal(incomplete.status, "webhook_not_ready");
assert.equal(incomplete.webhook, "missing");
const ready = stripeRuntimeReadiness({ STRIPE_SECRET_KEY: "sk_test_example", VITE_STRIPE_PUBLISHABLE_KEY: "pk_test_example", STRIPE_WEBHOOK_SECRET: "whsec_example" });
assert.equal(ready.status, "ready");
assert.equal(ready.mode, "test");
assert.equal(ready.publishableKey, "pk_test_example");
const live = stripeRuntimeReadiness({ STRIPE_SECRET_KEY: "sk_live_example", VITE_STRIPE_PUBLISHABLE_KEY: "pk_live_example", STRIPE_WEBHOOK_SECRET: "whsec_example" });
assert.equal(live.status, "action_required");
assert.equal(live.mode, "live");
assert.doesNotMatch(JSON.stringify(ready), /sk_test_|whsec_/);
console.log("Stripe V2 Settings readiness contracts passed.");
