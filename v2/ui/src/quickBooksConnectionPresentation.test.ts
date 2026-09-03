import assert from "node:assert/strict";
import { quickBooksCompanyConnectionCopy } from "./quickBooksConnectionPresentation";

assert.equal(quickBooksCompanyConnectionCopy({ connected: false, companyAssociated: false, connectedCompanyName: null }), "No QuickBooks company connected.");
assert.equal(quickBooksCompanyConnectionCopy({ connected: true, companyAssociated: true, connectedCompanyName: "Sandbox Print Shop" }), "Connected to Sandbox Print Shop.");
assert.equal(quickBooksCompanyConnectionCopy({ connected: true, companyAssociated: true, connectedCompanyName: null }), "QuickBooks company connected · company name unavailable.");
assert.equal(quickBooksCompanyConnectionCopy({ connected: false, companyAssociated: true, connectedCompanyName: null }), "QuickBooks company connected · company name unavailable.");

console.log("QuickBooks connection presentation contracts passed.");
