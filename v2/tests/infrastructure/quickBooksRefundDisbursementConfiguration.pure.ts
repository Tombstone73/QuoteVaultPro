import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const provider = readFileSync(resolve("server/quickbooksService.ts"), "utf8");
const routes = readFileSync(resolve("v2/src/interfaces/http/quickBooksIntegrationRoutes.ts"), "utf8");
const readiness = readFileSync(resolve("v2/infrastructure/accounting/quickBooksIntegrationReadiness.ts"), "utf8");

// Selection is attached to the authoritative tenant connection and carries
// the connected realm; a realm change deliberately drops old metadata.
assert.match(provider, /configuredRefundDisbursementAccount/);
assert.match(provider, /value\.realmId.*connection\.companyId/);
assert.match(provider, /realmChanged/);
assert.match(provider, /!realmChanged.*qbRefundDisbursement/);
assert.match(provider, /eq\(oauthConnections\.organizationId, organizationId\)/);
assert.match(provider, /eq\(oauthConnections\.companyId, connection\.companyId\)/);

// The server—not React—queries and verifies active Bank accounts in the
// connected company before persisting the selection.
assert.match(provider, /Active = true AND AccountType = 'Bank'/);
assert.match(provider, /value\?\.Active !== true/);
assert.match(provider, /selected refund account is not an active Bank account/i);
assert.match(provider, /quickbooks_refund_disbursement_account_configured/);
assert.match(routes, /staffActorId\(principal\)/);
assert.match(readiness, /setRefundDisbursementAccount/);
assert.doesNotMatch(provider, /QUICKBOOKS_REFUND_BANK_ACCOUNT_ID/);

console.log("QuickBooks tenant refund-disbursement configuration contracts passed.");
