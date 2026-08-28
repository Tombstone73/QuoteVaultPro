import assert from "node:assert/strict";
import { businessProfileInput, businessProfileReadiness, documentsBrandingInput } from "../../src/modules/organization/businessProfile.js";

const ready = businessProfileInput({ expectedRevision: "r1", displayName: " Titan Graphics ", email: "ops@example.test", website: "https://example.test", businessAddress: { line1: "1 Main", region: "in", country: "us", postalCode: "46001" }, timeZone: "America/Indiana/Indianapolis", currency: "usd" });
assert.equal(ready.displayName, "Titan Graphics");
assert.equal(ready.businessAddress.country, "US");
assert.equal(ready.businessAddress.region, "IN");
assert.equal(ready.currency, "USD");
assert.deepEqual(businessProfileReadiness({ ...ready, pickupAddressSource: "business_address" }), { status: "ready", missing: [] });
assert.deepEqual(businessProfileReadiness({ ...ready, displayName: "", businessAddress: {}, pickupAddressSource: "business_address" }), { status: "needs_attention", missing: ["business_name", "business_address"] });
assert.throws(() => businessProfileInput({ expectedRevision: "r1", displayName: "Name", email: "invalid", businessAddress: {} }));
assert.throws(() => businessProfileInput({ expectedRevision: "r1", displayName: "Name", website: "ftp://example.test", businessAddress: {} }));
assert.throws(() => businessProfileInput({ expectedRevision: "r1", displayName: "Name", businessAddress: { country: "USA" } }));
assert.deepEqual(documentsBrandingInput({ expectedRevision: "r1", footerNote: "Thank you", remittanceAddress: { line1: "PO Box 1", country: "us" } }), { expectedRevision: "r1", footerNote: "Thank you", remittanceAddress: { line1: "PO Box 1", country: "US" } });
console.log("Business Profile validation and readiness tests passed.");
