import assert from "node:assert/strict";
import { findHistoricalQuickBooksNumberConflicts, resolveHistoricalQuickBooksInvoiceNumber } from "../../../shared/quickBooksHistoricalNumbering.js";

const historical = resolveHistoricalQuickBooksInvoiceNumber("QB-1978");
assert.ok("value" in historical);
if ("value" in historical) {
  assert.equal(historical.value.displayNumber, "QB-1978");
  assert.equal(historical.value.numberCore, null);
  assert.equal(historical.value.invoiceNumber, 0);
  assert.deepEqual(findHistoricalQuickBooksNumberConflicts(historical.value, [{ entity: "invoice", id: "prior", qbDocNumber: "qb-1978" }]), [{ kind: "duplicate_quickbooks_doc_number", entity: "invoice", id: "prior" }]);
}
assert.deepEqual(resolveHistoricalQuickBooksInvoiceNumber(""), { error: "QuickBooks historical invoice is missing DocNumber." });
console.log("QuickBooks historical number preservation contracts passed.");
