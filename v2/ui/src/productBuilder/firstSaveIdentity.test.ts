import assert from "node:assert/strict";
import { adoptFirstSaveIdentity, firstSaveRequestHistoryKey, firstSaveRequestId, firstSaveRequestIdFromHistory } from "./firstSaveIdentity";

const created = { productId: "product-1", draftVersionId: "draft-1", draftUpdatedAt: "2026-08-23T12:00:00.000Z" };

// A later section failure must reuse the logical create request, while a
// durable server replay returns the same Product/Draft identity.
const request = firstSaveRequestId(null, () => "create-request-1");
assert.equal(request, "create-request-1");
assert.equal(firstSaveRequestId(request, () => "create-request-2"), "create-request-1");
assert.deepEqual(adoptFirstSaveIdentity(created), created);
assert.equal(firstSaveRequestIdFromHistory({ [firstSaveRequestHistoryKey]: request }), request);
assert.equal(firstSaveRequestIdFromHistory({ [firstSaveRequestHistoryKey]: "" }), null);
assert.equal(firstSaveRequestIdFromHistory(null), null);

console.log("Product Builder first-Save identity tests passed.");
