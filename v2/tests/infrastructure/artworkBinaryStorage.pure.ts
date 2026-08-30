import assert from "node:assert/strict";
import { classifyArtworkStorageFailure } from "../../infrastructure/artwork/artworkBinaryStorage.js";

assert.equal(classifyArtworkStorageFailure({ status: 401 }), "access_denied");
assert.equal(classifyArtworkStorageFailure({ status: 403 }), "access_denied");
assert.equal(classifyArtworkStorageFailure({ status: 404 }), "bucket_unavailable");
assert.equal(classifyArtworkStorageFailure({ status: 500 }), "upload_unavailable");
assert.equal(classifyArtworkStorageFailure(new Error("provider message must not escape")), "upload_unavailable");
console.log("artworkBinaryStorage.pure: PASS");
