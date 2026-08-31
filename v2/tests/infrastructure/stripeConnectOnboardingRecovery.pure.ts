import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=readFileSync("v2/infrastructure/billing/stripeConnectAccounts.ts","utf8");
const create=source.indexOf("v2.core.accounts.create");
const persist=source.indexOf("INSERT INTO v2_stripe_connect_accounts");
const link=source.indexOf("v2.core.accountLinks.create");
assert.ok(create >= 0 && persist > create && link > persist,"an Accounts v2 account is durably mapped before its short-lived onboarding link is requested");
assert.match(source,/idempotencyKey:`v2:stripe-connect-account:\$\{organizationId\}`/,"account creation must recover the same provider object after a persistence interruption");
assert.match(source,/providerFailure\("account_creation"/,"account creation failure must have a safe stage-specific result");
assert.match(source,/providerFailure\("account_link"/,"account link failure must have a safe stage-specific result");
console.log("Stripe Connect onboarding recovery contracts passed.");
