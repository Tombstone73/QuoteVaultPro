import assert from "node:assert/strict";
import {
  quickBooksInvoiceProjectionFingerprint,
  quickBooksProjectionLines,
  storedQuickBooksProjectionLines,
} from "../../infrastructure/accounting/quickBooksLiveInvoiceProjection.js";

const original = {
  displayNumber: "ORD-1013",
  currency: "USD",
  postedAt: "2026-09-01T12:00:00.000Z",
  customerId: "customer-a",
  lines: quickBooksProjectionLines([{ description: "Banner", quantity: 1, selling_unit_cents: "50000", selling_line_cents: "50000" }]),
};
const changed = { ...original, lines: quickBooksProjectionLines([{ description: "Banner", quantity: 1, selling_unit_cents: "60000", selling_line_cents: "60000" }]) };

assert.equal(quickBooksInvoiceProjectionFingerprint(original), quickBooksInvoiceProjectionFingerprint({ ...original, lines: [...original.lines] }), "the same exported facts have one stable fingerprint");
assert.notEqual(quickBooksInvoiceProjectionFingerprint(original), quickBooksInvoiceProjectionFingerprint(changed), "a live accounting revision is detectable without a local finalization transition");
assert.deepEqual(storedQuickBooksProjectionLines(original), original.lines, "the recorded provider projection can safely support a later refund workflow");
assert.deepEqual(storedQuickBooksProjectionLines({ lines: [{ description: "bad", quantity: 0, unitAmountCents: 1, lineAmountCents: 1 }] }), [], "invalid stored lines never become a provider payload");

console.log("QuickBooks live invoice projection contracts passed.");
