import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripeAccountV2Readiness, stripeIdentityCountry } from "../../infrastructure/billing/stripeConnectAccounts.js";

const source=readFileSync("v2/infrastructure/billing/stripeConnectAccounts.ts","utf8");
const create=source.indexOf("v2.core.accounts.create");
const persist=source.indexOf("INSERT INTO v2_stripe_connect_accounts");
const link=source.indexOf("v2.core.accountLinks.create");
assert.ok(create >= 0 && persist > create && link > persist,"an Accounts v2 account is durably mapped before its short-lived onboarding link is requested");
assert.match(source,/idempotencyKey:`v2:stripe-connect-account:\$\{organizationId\}`/,"account creation must recover the same provider object after a persistence interruption");
assert.match(source,/providerFailure\("account_creation"/,"account creation failure must have a safe stage-specific result");
assert.match(source,/providerFailure\("account_link"/,"account link failure must have a safe stage-specific result");
assert.equal(stripeIdentityCountry("United States"),"US","the canonical U.S. business profile must satisfy Stripe Accounts v2 identity.country");
assert.equal(stripeIdentityCountry("ca"),"CA","canonical ISO country codes are preserved");
assert.equal(stripeIdentityCountry("not-a-country"),null,"invalid country text is rejected before a provider call");
const titanGraphicsActive={
  configuration:{merchant:{capabilities:{
    card_payments:{status:"active"},
    stripe_balance:{payouts:{status:"active"}},
  }}},
  requirements:{currently_due:[],past_due:[],pending_verification:[]},
};
assert.deepEqual(stripeAccountV2Readiness(titanGraphicsActive),{cardPayments:"active",payouts:"active",requirementsDue:0,state:"ready"},"an active Accounts v2 merchant with no requirements is ready");
assert.deepEqual(stripeAccountV2Readiness({...titanGraphicsActive,requirements:{currently_due:["identity.business_details"],past_due:[],pending_verification:[]}}),{cardPayments:"active",payouts:"active",requirementsDue:1,state:"requirements_due"},"current or past-due Account requirements block readiness");
assert.deepEqual(stripeAccountV2Readiness({...titanGraphicsActive,requirements:{currently_due:[],past_due:[],pending_verification:["identity"]}}),{cardPayments:"active",payouts:"active",requirementsDue:1,state:"onboarding"},"pending verification remains visible without falsely claiming readiness");
assert.deepEqual(stripeAccountV2Readiness({...titanGraphicsActive,requirements:{currently_due:[],past_due:[],pending:["identity"]}}),{cardPayments:"active",payouts:"active",requirementsDue:1,state:"onboarding"},"provider pending requirements remain visible without falsely claiming readiness");
assert.deepEqual(stripeAccountV2Readiness({}),{cardPayments:"unknown",payouts:"unknown",requirementsDue:0,state:"onboarding"},"absent optional include-dependent fields never become active by accident");
assert.match(source,/retrieve\(row\.stripe_account_id,\{ include:\["configuration\.merchant","requirements"\] \}\)/,"Accounts v2 readiness retrieves its include-dependent merchant configuration and requirements");
assert.match(source,/root\.requirements/,"Accounts v2 requirements are read from the Account response rather than merchant configuration");
assert.match(source,/state='error'/,"a failed live provider refresh is projected as provider unavailable rather than stale onboarding");
console.log("Stripe Connect onboarding recovery contracts passed.");
