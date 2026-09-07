import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const portal = readFileSync("v2/ui/src/PortalApp.tsx", "utf8");

assert.match(portal, /Review one payment/u);
assert.match(portal, /One payment total/u);
assert.match(portal, /Pay selected invoices/u);
assert.match(portal, /allocations:\s*\[\{ invoiceId, amountCents \}\]/u);
assert.match(portal, /\/v2\/portal\/payments\/stripe\/payment-intents/u);
assert.match(portal, /setPayment\(await request\("\/v2\/portal\/payments\/stripe\/payment-intents"/u);
assert.match(portal, /businessRequestId: id\(\), allocations/u);
assert.match(portal, /disabled=\{busy \|\| invalid \|\| currencies\.size > 1\}/u);
assert.match(portal, /inputCents/u);
assert.doesNotMatch(portal, /Promise\.all\([^)]*payment-intents/su);

console.log("Portal aggregate-payment review contract passed.");
