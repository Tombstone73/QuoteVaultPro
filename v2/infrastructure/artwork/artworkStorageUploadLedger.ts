import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type ArtworkStorageUploadState = "pending_write" | "stored" | "adopted" | "cleanup_pending" | "reconciling" | "cleaned" | "retained";

export type ArtworkStorageUploadIntent = Readonly<{
  id: string;
  organizationId: string;
  storageProvider: string;
  objectKey: string;
  requestIdentity: string;
  expectedChecksumSha256: string;
  expectedContentType: string;
  expectedByteSize: number;
  state: ArtworkStorageUploadState;
  objectCreatedByIntent: boolean;
  cleanupAttempts: number;
  reconciliationLeaseToken?: string;
}>;

type IntentRow = Readonly<{
  id: string; organization_id: string; storage_provider: string; object_key: string; request_identity: string;
  expected_checksum_sha256: string; expected_content_type: string; expected_byte_size: string; state: ArtworkStorageUploadState;
  object_created_by_intent: boolean; cleanup_attempts: number; reconciliation_lease_token: string | null; reconciliation_lease_expires_at: Date | null;
}>;

const intent = (row: IntentRow): ArtworkStorageUploadIntent => ({
  id: row.id, organizationId: row.organization_id, storageProvider: row.storage_provider, objectKey: row.object_key,
  requestIdentity: row.request_identity, expectedChecksumSha256: row.expected_checksum_sha256,
  expectedContentType: row.expected_content_type, expectedByteSize: Number(row.expected_byte_size), state: row.state,
  objectCreatedByIntent: row.object_created_by_intent, cleanupAttempts: row.cleanup_attempts,
  ...(row.reconciliation_lease_token ? { reconciliationLeaseToken: row.reconciliation_lease_token } : {}),
});

export interface ArtworkStorageUploadLedger {
  reserve(input: Readonly<{ organizationId: string; storageProvider: string; objectKey: string; requestIdentity: string; expectedChecksumSha256: string; expectedContentType: string; expectedByteSize: number; objectExpectedToBeCreated: boolean }>): Promise<ArtworkStorageUploadIntent>;
  markStored(input: Readonly<{ organizationId: string; intentId: string; objectCreatedByIntent: boolean }>): Promise<void>;
  markAdopted(input: Readonly<{ organizationId: string; intentId: string; artworkFileId: string }>): Promise<void>;
  markCleanupPending(input: Readonly<{ organizationId: string; intentId: string; errorCode: string }>): Promise<void>;
  markCleaned(input: Readonly<{ organizationId: string; intentId: string; leaseToken?: string }>): Promise<void>;
  markRetained(input: Readonly<{ organizationId: string; intentId: string; leaseToken: string }>): Promise<void>;
  listStale(input: Readonly<{ olderThan: Date; limit: number }>): Promise<readonly ArtworkStorageUploadIntent[]>;
  claimStale(input: Readonly<{ olderThan: Date; limit: number; leaseMs: number }>): Promise<readonly ArtworkStorageUploadIntent[]>;
  findCanonicalArtworkFileId(input: Readonly<{ organizationId: string; storageProvider: string; objectKey: string }>): Promise<string | null>;
  recordCleanupFailure(input: Readonly<{ organizationId: string; intentId: string; leaseToken: string; errorCode: string }>): Promise<void>;
}

/** Durable server-only ledger for the interval between private-object write and Artwork DB adoption. */
export class PostgresArtworkStorageUploadLedger implements ArtworkStorageUploadLedger {
  constructor(private readonly pool: Pool) {}

  async reserve(input: Parameters<ArtworkStorageUploadLedger["reserve"]>[0]): Promise<ArtworkStorageUploadIntent> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<IntentRow>(`INSERT INTO v2_artwork_storage_upload_intents(id,organization_id,storage_provider,object_key,request_identity,expected_checksum_sha256,expected_content_type,expected_byte_size,object_created_by_intent)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(organization_id,storage_provider,object_key) DO NOTHING RETURNING *`, [randomUUID(), input.organizationId, input.storageProvider, input.objectKey, input.requestIdentity, input.expectedChecksumSha256, input.expectedContentType, input.expectedByteSize, input.objectExpectedToBeCreated]);
      let row = inserted.rows[0] ?? (await client.query<IntentRow>("SELECT * FROM v2_artwork_storage_upload_intents WHERE organization_id=$1 AND storage_provider=$2 AND object_key=$3 FOR UPDATE", [input.organizationId, input.storageProvider, input.objectKey])).rows[0];
      if (!row) throw new Error("Artwork storage intent could not be recovered.");
      if (row.expected_checksum_sha256 !== input.expectedChecksumSha256 || row.expected_byte_size !== String(input.expectedByteSize)) throw new Error("Artwork storage object identity conflicts with its existing intent.");
      if (row.state === "reconciling" && row.reconciliation_lease_expires_at && row.reconciliation_lease_expires_at > new Date()) throw new Error("Artwork storage recovery is in progress; retry shortly.");
      if (!inserted.rows[0] && row.state !== "adopted") {
        row = (await client.query<IntentRow>("UPDATE v2_artwork_storage_upload_intents SET state='pending_write',request_identity=$3,reconciliation_lease_token=NULL,reconciliation_lease_expires_at=NULL,last_error_code=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *", [input.organizationId, row.id, input.requestIdentity])).rows[0]!;
      }
      await client.query("COMMIT");
      return intent(row);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async markStored(input: Parameters<ArtworkStorageUploadLedger["markStored"]>[0]): Promise<void> {
    await this.pool.query(`UPDATE v2_artwork_storage_upload_intents SET state=CASE WHEN state='adopted' THEN state ELSE 'stored' END,object_created_by_intent=object_created_by_intent OR $3,stored_at=COALESCE(stored_at,now()),updated_at=now(),last_error_code=NULL WHERE organization_id=$1 AND id=$2`, [input.organizationId, input.intentId, input.objectCreatedByIntent]);
  }
  async markAdopted(input: Parameters<ArtworkStorageUploadLedger["markAdopted"]>[0]): Promise<void> {
    await this.pool.query("UPDATE v2_artwork_storage_upload_intents SET state='adopted',adopted_artwork_file_id=$3,adopted_at=COALESCE(adopted_at,now()),reconciliation_lease_token=NULL,reconciliation_lease_expires_at=NULL,last_error_code=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2", [input.organizationId, input.intentId, input.artworkFileId]);
  }
  async markCleanupPending(input: Parameters<ArtworkStorageUploadLedger["markCleanupPending"]>[0]): Promise<void> {
    await this.pool.query("UPDATE v2_artwork_storage_upload_intents SET state='cleanup_pending',cleanup_attempts=cleanup_attempts+1,last_error_code=$3,reconciliation_lease_token=NULL,reconciliation_lease_expires_at=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 AND state<>'adopted'", [input.organizationId, input.intentId, input.errorCode]);
  }
  async markCleaned(input: Parameters<ArtworkStorageUploadLedger["markCleaned"]>[0]): Promise<void> {
    const guarded = input.leaseToken ? " AND reconciliation_lease_token=$3" : "";
    const args = input.leaseToken ? [input.organizationId, input.intentId, input.leaseToken] : [input.organizationId, input.intentId];
    await this.pool.query(`UPDATE v2_artwork_storage_upload_intents SET state='cleaned',cleaned_at=COALESCE(cleaned_at,now()),reconciliation_lease_token=NULL,reconciliation_lease_expires_at=NULL,last_error_code=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 AND state<>'adopted'${guarded}`, args);
  }
  async markRetained(input: Parameters<ArtworkStorageUploadLedger["markRetained"]>[0]): Promise<void> {
    await this.pool.query("UPDATE v2_artwork_storage_upload_intents SET state='retained',reconciliation_lease_token=NULL,reconciliation_lease_expires_at=NULL,last_error_code='preexisting_object_not_owned',updated_at=now() WHERE organization_id=$1 AND id=$2 AND reconciliation_lease_token=$3 AND state='reconciling'", [input.organizationId, input.intentId, input.leaseToken]);
  }
  async listStale(input: Parameters<ArtworkStorageUploadLedger["listStale"]>[0]): Promise<readonly ArtworkStorageUploadIntent[]> {
    const result = await this.pool.query<IntentRow>("SELECT * FROM v2_artwork_storage_upload_intents WHERE state IN ('pending_write','stored','cleanup_pending','reconciling') AND updated_at < $1 ORDER BY updated_at,id LIMIT $2", [input.olderThan, input.limit]);
    return result.rows.map(intent);
  }

  async claimStale(input: Parameters<ArtworkStorageUploadLedger["claimStale"]>[0]): Promise<readonly ArtworkStorageUploadIntent[]> {
    const token = randomUUID();
    const result = await this.pool.query<IntentRow>(`WITH candidate AS (
      SELECT id FROM v2_artwork_storage_upload_intents
      WHERE state IN ('pending_write','stored','cleanup_pending','reconciling')
        AND updated_at < $1
        AND (reconciliation_lease_expires_at IS NULL OR reconciliation_lease_expires_at < now())
      ORDER BY updated_at,id FOR UPDATE SKIP LOCKED LIMIT $2
    ) UPDATE v2_artwork_storage_upload_intents intent
      SET state='reconciling',reconciliation_lease_token=$3,reconciliation_lease_expires_at=now()+($4::bigint * interval '1 millisecond'),updated_at=now()
      FROM candidate WHERE intent.id=candidate.id RETURNING intent.*`, [input.olderThan, input.limit, token, input.leaseMs]);
    return result.rows.map((row) => ({ ...intent(row), state: "reconciling" as const }));
  }

  async findCanonicalArtworkFileId(input: Parameters<ArtworkStorageUploadLedger["findCanonicalArtworkFileId"]>[0]): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>("SELECT id FROM v2_artwork_files WHERE organization_id=$1 AND storage_provider=$2 AND object_key=$3 ORDER BY created_at,id LIMIT 1", [input.organizationId, input.storageProvider, input.objectKey]);
    return result.rows[0]?.id ?? null;
  }
  async recordCleanupFailure(input: Parameters<ArtworkStorageUploadLedger["recordCleanupFailure"]>[0]): Promise<void> {
    await this.pool.query("UPDATE v2_artwork_storage_upload_intents SET state='cleanup_pending',cleanup_attempts=cleanup_attempts+1,last_error_code=$4,reconciliation_lease_token=NULL,reconciliation_lease_expires_at=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 AND reconciliation_lease_token=$3 AND state='reconciling'", [input.organizationId, input.intentId, input.leaseToken, input.errorCode]);
  }
}
