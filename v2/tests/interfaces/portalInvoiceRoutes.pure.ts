import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes=readFileSync("v2/src/interfaces/http/portalInvoiceRoutes.ts","utf8");
const ui=readFileSync("v2/ui/src/PortalApp.tsx","utf8");
const auth=readFileSync("v2/infrastructure/authentication/standaloneStaffAuth.ts","utf8");

assert.match(routes,/router\.get\("\/invoices"/u);
assert.match(routes,/portalPrincipal\.principal/u);
assert.match(routes,/item\.source==="v2"/u);
assert.match(routes,/settlement\.balance/u);
assert.match(routes,/amountCents:balance\.cents/u);
assert.match(routes,/requireV2CsrfToken/u);
assert.match(routes,/document\.pdf/u);
assert.doesNotMatch(routes,/request\.query.*customer/iu);
assert.doesNotMatch(routes,/request\.body.*customer/iu);
assert.match(ui,/stripe\.confirmPayment/u);
assert.match(ui,/signed confirmation/u);
assert.match(ui,/\/portal\/invoices\//u);
assert.match(auth,/safePortalReturnTo/u);
assert.match(auth,/authenticationMethod:"portal_session"/u);
console.log("V2 portal invoice boundary contracts passed.");
