import { db } from "../../db";
import type { FileRecord, StoragePlacement, StorageProviderConfig, StorageJob } from "@shared/schema";
import { deleteUploadSession, loadUploadSessionMeta, saveUploadSessionMeta } from "../chunkedUploads";
import { fileRecordRepository } from "../../storage/fileRecord.repo";
import { storagePlacementRepository } from "../../storage/storagePlacement.repo";
import { storageJobRepository } from "../../storage/storageJob.repo";
import { storagePolicyResolver } from "./StoragePolicyResolver";
import { storageRegistry } from "./StorageRegistry";
import type { StorageResourceContext, StoredObjectDescriptor } from "./adapters/StorageProviderAdapter";

function lifecycleStateForStorageTarget(storageTarget: StoredObjectDescriptor["storageTarget"]): FileRecord["lifecycleState"] {
  switch (storageTarget) {
    case "supabase":
    case "local_dev":
      return "stored_hot";
    default:
      return "stored_hot";
  }
}

function storageClassForTarget(): FileRecord["storageClass"] {
  return "hot";
}

export type StorageWriteResult<TLinked> = {
  fileRecord: FileRecord;
  placement: StoragePlacement;
  linkedRecord: TLinked;
  storedObject: StoredObjectDescriptor;
  storageJob: StorageJob;
};

export class StorageApplicationService {
  async initiateUpload(input: {
    organizationId: string;
    fileName?: string | null;
    fileSizeBytes: number;
    requestedTarget?: string | null;
  }) {
    const policy = await storagePolicyResolver.resolve(input.organizationId);
    const providerConfig = storagePolicyResolver.resolveIntakeStorageBehavior(policy);
    const adapter = storageRegistry.getAdapter(providerConfig.providerType);
    return adapter.initiateUpload({
      organizationId: input.organizationId,
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      requestedTarget: input.requestedTarget,
      providerConfig,
    });
  }

  async finalizeUpload<TLinked>(input: {
    organizationId: string;
    createdByUserId: string | null;
    requestedTarget?: string | null;
    resource: StorageResourceContext;
    source:
      | {
          kind: "buffer";
          buffer: Buffer;
          originalFilename: string;
          mimeType: string;
        }
      | {
          kind: "upload-session";
          uploadId: string;
          expectedPurpose: "quote-attachment" | "order-attachment";
          expectedParentId: string;
        }
      | {
          kind: "existing-key";
          fileUrl: string;
          originalFilename: string;
          mimeType?: string | null;
          fileSize?: number | null;
          checksum?: string | null;
          storedFilename?: string | null;
          extension?: string | null;
        };
    persistLink: (tx: any, stored: {
      fileRecord: FileRecord;
      placement: StoragePlacement;
      storedObject: StoredObjectDescriptor;
      legacyStorageProvider: "local" | "supabase";
      legacyFileUrl: string;
      legacyRelativePath: string | null;
    }) => Promise<TLinked>;
  }): Promise<StorageWriteResult<TLinked>> {
    const policy = await storagePolicyResolver.resolve(input.organizationId);
    const providerConfig = storagePolicyResolver.resolveCanonicalStorageBehavior(policy);
    const adapter = storageRegistry.getAdapter(providerConfig.providerType);

    const storageJob = await storageJobRepository.create({
      organizationId: input.organizationId,
      jobType: "finalize_upload",
      state: "queued",
      fileRecordId: null,
      sourcePlacementId: null,
      targetProviderConfigId: providerConfig.id,
      payloadJson: {
        sourceKind: input.source.kind,
        resourceType: input.resource.resourceType,
        resourceId: input.resource.resourceId,
      },
      errorText: null,
      attempts: 0,
      scheduledAt: null,
      startedAt: null,
      finishedAt: null,
    });

    await storageJobRepository.updateState(storageJob.id, {
      state: "running",
      attempts: storageJob.attempts + 1,
      startedAt: new Date(),
    });

    let storedObject: StoredObjectDescriptor | null = null;
    let sourceUploadMeta: Awaited<ReturnType<typeof loadUploadSessionMeta>> | null = null;

    try {
      if (input.source.kind === "buffer") {
        storedObject = await adapter.putObject({
          buffer: input.source.buffer,
          originalFilename: input.source.originalFilename,
          mimeType: input.source.mimeType,
          requestedTarget: input.requestedTarget,
          providerConfig,
          resource: input.resource,
        });
      } else if (input.source.kind === "upload-session") {
        sourceUploadMeta = await loadUploadSessionMeta(input.source.uploadId);
        if (sourceUploadMeta.organizationId !== input.organizationId) {
          throw new Error("Upload session does not belong to this organization");
        }
        if (sourceUploadMeta.purpose !== input.source.expectedPurpose) {
          throw new Error("Upload session purpose mismatch");
        }
        if (sourceUploadMeta.status !== "finalized" || !sourceUploadMeta.relativePath) {
          throw new Error("Upload not finalized");
        }
        const parentId =
          sourceUploadMeta.purpose === "quote-attachment"
            ? sourceUploadMeta.quoteId
            : sourceUploadMeta.orderId;
        if (parentId && parentId !== input.source.expectedParentId) {
          throw new Error("Upload session parent mismatch");
        }

        storedObject = await adapter.finalizeUpload({
          sourceRelativePath: sourceUploadMeta.relativePath,
          originalFilename: sourceUploadMeta.originalFilename,
          mimeType: sourceUploadMeta.mimeType || "application/octet-stream",
          sizeBytes: sourceUploadMeta.sizeBytes || 0,
          checksum: sourceUploadMeta.checksum || null,
          extension: sourceUploadMeta.extension || null,
          storedFilename: sourceUploadMeta.storedFilename || null,
          requestedTarget: input.requestedTarget,
          providerConfig,
          resource: input.resource,
        });
      } else {
        const rawKey = input.source.fileUrl.trim();
        const looksHttp = rawKey.startsWith("http://") || rawKey.startsWith("https://");
        if (looksHttp) {
          throw new Error("External URLs are not supported by canonical storage finalization");
        }

        const looksSupabaseKey = rawKey.startsWith("uploads/") || rawKey.startsWith("titan-private/");
        const storageTarget = input.requestedTarget === "supabase"
          ? "supabase"
          : input.requestedTarget === "local_dev"
            ? "local_dev"
            : looksSupabaseKey
              ? "supabase"
              : "local_dev";

        storedObject = {
          providerType: providerConfig.providerType,
          storageTarget,
          bucket: storageTarget === "supabase" ? "titan-private" : null,
          objectKey: storageTarget === "supabase" ? rawKey : null,
          localPathRef: storageTarget === "supabase" ? null : rawKey,
          checksum: input.source.checksum ?? null,
          sizeBytes: Math.max(0, Number(input.source.fileSize || 0)),
          mimeType: input.source.mimeType || "application/octet-stream",
          originalFilename: input.source.originalFilename,
          storedFilename: input.source.storedFilename ?? null,
          extension: input.source.extension ?? null,
          persistenceConfirmed: true,
        };
      }

      if (!storedObject) {
        throw new Error("No stored object was produced during storage finalization");
      }

      const verification = await adapter.verifyObject({
        providerConfig,
        objectKey: storedObject.objectKey,
        localPathRef: storedObject.localPathRef,
      });
      if (!verification.exists) {
        throw new Error("Provider verification failed for stored object");
      }

      const persistedObject = storedObject;

      const finalized = await db.transaction(async (tx) => {
        const fileRecord = await fileRecordRepository.create(
          {
            organizationId: input.organizationId,
            storageClass: storageClassForTarget(),
            lifecycleState: lifecycleStateForStorageTarget(persistedObject.storageTarget),
            originalFilename: persistedObject.originalFilename,
            mimeType: persistedObject.mimeType,
            sizeBytes: persistedObject.sizeBytes,
            checksum: persistedObject.checksum,
            createdByUserId: input.createdByUserId,
          },
          tx,
        );

        const placement = await storagePlacementRepository.create(
          {
            fileRecordId: fileRecord.id,
            providerConfigId: providerConfig.id,
            placementRole: "canonical",
            placementState: "active",
            bucket: persistedObject.bucket,
            objectKey: persistedObject.objectKey,
            localPathRef: persistedObject.localPathRef,
            checksum: persistedObject.checksum,
            sizeBytes: persistedObject.sizeBytes,
            lastVerifiedAt: verification.verifiedAt,
            createdAt: new Date(),
          },
          tx,
        );

        const linkedRecord = await input.persistLink(tx, {
          fileRecord,
          placement,
          storedObject: persistedObject,
          legacyStorageProvider: persistedObject.storageTarget === "supabase" ? "supabase" : "local",
          legacyFileUrl: persistedObject.objectKey ?? persistedObject.localPathRef ?? "",
          legacyRelativePath: persistedObject.objectKey ?? persistedObject.localPathRef ?? null,
        });

        return { fileRecord, placement, linkedRecord };
      });

      if (sourceUploadMeta) {
        sourceUploadMeta.linkedAt = new Date().toISOString();
        await saveUploadSessionMeta(sourceUploadMeta.uploadId, sourceUploadMeta);
        await deleteUploadSession(sourceUploadMeta.uploadId);
      }

      const completedJob = await storageJobRepository.updateState(storageJob.id, {
        state: "succeeded",
        fileRecordId: finalized.fileRecord.id,
        finishedAt: new Date(),
        errorText: null,
      });

      return {
        fileRecord: finalized.fileRecord,
        placement: finalized.placement,
        linkedRecord: finalized.linkedRecord,
        storedObject: persistedObject,
        storageJob: completedJob,
      };
    } catch (error: any) {
      if (storedObject) {
        await adapter.deleteObject({
          providerConfig,
          objectKey: storedObject.objectKey,
          localPathRef: storedObject.localPathRef,
        }).catch(() => false);
      }

      const failedState = input.source.kind === "upload-session" ? "retryable_failed" : "failed";
      const failedJob = await storageJobRepository.updateState(storageJob.id, {
        state: failedState,
        errorText: error?.message || "Storage finalization failed",
        finishedAt: new Date(),
      });

      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        storageJobId: failedJob.id,
      });
    }
  }
}

export const storageApplicationService = new StorageApplicationService();
