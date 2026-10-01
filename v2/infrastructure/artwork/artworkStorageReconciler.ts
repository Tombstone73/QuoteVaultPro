import type { ArtworkBinaryStorage } from "./artworkBinaryStorage.js";
import type { ArtworkStorageUploadIntent, ArtworkStorageUploadLedger } from "./artworkStorageUploadLedger.js";
import type { WorkspaceArtworkStorageLiveness } from "../../src/modules/artwork/workspaceArtwork.js";

export type ArtworkStorageReconciliationSummary = Readonly<{
  inspected: number; adopted: number; deleted: number; retained: number; missing: number; deleteFailed: number;
}>;

/** Cleanup-only recovery. It never creates Artwork metadata or lists arbitrary bucket objects. */
export class ArtworkStorageReconciler {
  constructor(private readonly ledger: ArtworkStorageUploadLedger, private readonly storage: ArtworkBinaryStorage, private readonly workspaceClaims?: WorkspaceArtworkStorageLiveness) {}

  async inspect(input: Readonly<{ olderThan: Date; limit: number }>): Promise<readonly ArtworkStorageUploadIntent[]> {
    return this.ledger.listStale(input);
  }

  async reconcile(input: Readonly<{ olderThan: Date; limit: number; leaseMs: number }>): Promise<ArtworkStorageReconciliationSummary> {
    const candidates = await this.ledger.claimStale(input);
    const summary = { inspected: candidates.length, adopted: 0, deleted: 0, retained: 0, missing: 0, deleteFailed: 0 };
    for (const candidate of candidates) {
      const leaseToken = candidate.reconciliationLeaseToken;
      if (!leaseToken) throw new Error("Claimed Artwork storage intent is missing its reconciliation lease.");
      const fileId = await this.ledger.findCanonicalArtworkFileId({ organizationId: candidate.organizationId, storageProvider: candidate.storageProvider, objectKey: candidate.objectKey });
      if (fileId) {
        await this.ledger.markAdopted({ organizationId: candidate.organizationId, intentId: candidate.id, artworkFileId: fileId });
        summary.adopted += 1;
        continue;
      }
      // TEMP claims are relational ownership, not canonical Artwork files. Their
      // lifecycle has its own serialized cleanup; never mark a fictitious file adopted.
      if (await this.workspaceClaims?.ownsStorageIntent({ organizationId: candidate.organizationId, intentId: candidate.id, storageProvider: candidate.storageProvider, objectKey: candidate.objectKey })
        || candidate.requestIdentity.startsWith("workspace-artwork:")
        || candidate.objectKey.startsWith(`v2-artwork/${candidate.organizationId}/workspaces/`)) {
        await this.ledger.recordCleanupFailure({ organizationId: candidate.organizationId, intentId: candidate.id, leaseToken, errorCode: "workspace_cleanup_required" });
        summary.retained += 1;
        continue;
      }
      if (!candidate.objectCreatedByIntent) {
        await this.ledger.markRetained({ organizationId: candidate.organizationId, intentId: candidate.id, leaseToken });
        summary.retained += 1;
        continue;
      }
      if (!await this.storage.exists(candidate.objectKey)) {
        await this.ledger.markCleaned({ organizationId: candidate.organizationId, intentId: candidate.id, leaseToken });
        summary.missing += 1;
        continue;
      }
      try {
        await this.storage.remove(candidate.objectKey);
        await this.ledger.markCleaned({ organizationId: candidate.organizationId, intentId: candidate.id, leaseToken });
        summary.deleted += 1;
      } catch {
        await this.ledger.recordCleanupFailure({ organizationId: candidate.organizationId, intentId: candidate.id, leaseToken, errorCode: "object_delete_failed" });
        summary.deleteFailed += 1;
      }
    }
    return summary;
  }
}
