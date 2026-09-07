import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const portal = readFileSync("v2/ui/src/PortalApp.tsx", "utf8");
const styles = readFileSync("v2/ui/src/portal.css", "utf8");

for (const label of ["Home", "Orders", "Shop", "Quotes", "Proofs", "Invoices", "Account"])
  assert.match(portal, new RegExp(`"${label}"`, "u"));
for (const path of ["/v2/portal/orders/dashboard", "/v2/portal/catalog", "/v2/portal/orders", "/v2/portal/proofs", "/v2/portal/invoices"])
  assert.match(portal, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
assert.match(portal, /usePortalQuery/u);
assert.match(portal, /sessionScope/u);
assert.match(portal, /uploadPortalArtwork/u);
assert.match(portal, /Add source artwork/u);
assert.match(portal, /M7\.5I-C/u);
assert.doesNotMatch(portal, /supabase/iu);
assert.doesNotMatch(portal, /payInvoices|mockPrices|mockOrders|mockProofs/u);
assert.match(styles, /@media\(max-width:920px\)/u);
assert.match(styles, /portal-bottom-nav/u);

console.log("Customer portal Lovable presentation contract passed.");
