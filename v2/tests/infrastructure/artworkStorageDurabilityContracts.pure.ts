import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("server/db/migrations_v2/0246_v2_artwork_storage_reconciliation.sql", "utf8");
const ledger = readFileSync("v2/infrastructure/artwork/artworkStorageUploadLedger.ts", "utf8");
const orderUpload = readFileSync("v2/infrastructure/artwork/artworkUploadService.ts", "utf8");
const quoteUpload = readFileSync("v2/infrastructure/artwork/quoteArtworkUploadService.ts", "utf8");

assert.match(migration, /UNIQUE \(organization_id, storage_provider, object_key\)/);
assert.match(migration, /FOREIGN KEY \(adopted_artwork_file_id, organization_id\)/);
assert.match(ledger, /updated_at < \$1/);
assert.match(ledger, /FOR UPDATE SKIP LOCKED/);
assert.match(ledger, /reconciliation_lease_expires_at/);

for (const source of [orderUpload, quoteUpload]) {
  const exists = source.indexOf("storage.exists(objectKey)");
  const reserve = source.indexOf("uploads.reserve(");
  const put = source.indexOf("storage.put(");
  assert.ok(exists >= 0 && reserve > exists && put > reserve, "intent must be reserved before private-object write");
  assert.ok(source.includes("uploads.markAdopted("), "canonical adoption must converge the durable intent");
  assert.ok(source.includes("uploads.markCleanupPending("), "normal adoption failure must remain recoverable");
}

console.log("artworkStorageDurabilityContracts.pure: PASS");
