import assert from "node:assert/strict";
import { quickBooksIntegrationCallbackNotice } from "./quickBooksIntegrationCallbackNotice";

assert.equal(quickBooksIntegrationCallbackNotice("?quickbooks=connected"), "QuickBooks authorization completed. Accounting readiness has been refreshed.");
assert.equal(quickBooksIntegrationCallbackNotice("?quickbooks=error"), "QuickBooks connection could not be completed. Review Accounting readiness and reconnect if required.");
assert.equal(quickBooksIntegrationCallbackNotice("?quickbooks=https://untrusted.example"), undefined);
assert.equal(quickBooksIntegrationCallbackNotice(""), undefined);
console.log("QuickBooks integration callback notice passed");
