import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("v2/ui/src/QuickBooksSettingsWorkspace.tsx"), "utf8");

assert.match(source, /QuickBooks operational health/);
assert.match(source, /Auto Sync is off\. Operators manually select eligible records/);
assert.match(source, /Eligible V2 Invoice changes, Payments, and Refunds enqueue automatically/);
assert.match(source, /Open invoices to sync/);
assert.match(source, /Open financial facts/);
assert.match(source, /Review activity/);
assert.match(source, /Open import preview/);
assert.match(source, /Select visible/);
assert.match(source, /Clear selection/);
assert.match(source, /setSelection\(new Set\(\)\)/);
assert.match(source, /setFinancialSelection\(new Set\(\)\)/);
assert.match(source, /selection\.size > 100/);
assert.match(source, /financialSelection\.size > 100/);
assert.match(source, /Reconcile & resume/);
assert.match(source, /Retry sync/);
assert.match(source, /No eligible invoices need synchronization/);
assert.match(source, /Nothing needs action/);
assert.match(source, /quickBooksCompanyConnectionCopy/);
assert.match(source, /Dismiss QuickBooks authorization notice/);
console.log("QuickBooks operations console presentation contracts passed.");
