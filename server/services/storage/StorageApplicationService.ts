import { db } from "../../db";
import type { FileRecord, StoragePlacement, StorageProviderConfig, StorageJob } from "@shared/schema";
import { deleteUploadSession, loadUploadSessionMeta, saveUploadSessionMeta } from "../chunkedUploads";
import { fileRecordRepository } from "../../storage/fileRecord.repo";
import { storagePlacementRepository } from "../../storage/storagePlacement.repo";
import { normalizeLocalFilesystemStorageProviderConfig, normalizeS3CompatibleStorageProviderConfig, normalizeSupabaseStorageProviderConfig } from "@shared/storageSettings";
import { storageJobRepository } from "../../storage/storageJob.repo";
import { storageProviderConfigRepository } from "../../storage/storageProviderConfig.repo";
import { storagePolicyResolver } from "./StoragePolicyResolver";
import { storageRegistry } from "./StorageRegistry";
import type { StorageResourceContext, StoredObjectDescriptor } from "./adapters/StorageProviderAdapter";
import { deleteFile } from "../../utils/fileStorage";
import { assertDurableCanonicalStorageTarget } from "../storageTarget";

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

function storageFailure(message: string, code: string, statusCode = 500): Error {
  return Object.assign(new Error(message), { code, statusCode });
}

function sanitizeStorageKey(value?: string | null): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (normalized.length <= 16) return normalized;
  return `${normalized.slice(0, 8)}...${normalized.slice(-8)}`;
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

  /**
   * Validate the provider that will receive the final canonical file before a
   * chunked upload reserves temporary application disk. The returned signed
   * URL, when a cloud adapter uses one, is intentionally not consumed here.
   */
  async preflightCanonicalUpload(input: {
    organizationId: string;
    fileName?: string | null;
    fileSizeBytes: number;
  }) {
    const policy = await storagePolicyResolver.resolve(input.organizationId);
    const providerConfig = storagePolicyResolver.resolveCanonicalStorageBehavior(policy);
    const adapter = storageRegistry.getAdapter(providerConfig.providerType);
    const initiated = await adapter.initiateUpload({
      organizationId: input.organizationId,
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      providerConfig,
    });
    if (initiated.storageTarget === "local_dev") {
      assertDurableCanonicalStorageTarget("local_dev");
    }
    return initiated;
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
        }
      | {
          kind: "existing-file-record";
          fileRecordId: string;
          originalFilename?: string | null;
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
      legacyStorageProvider: "local" | "supabase" | "s3";
      legacyFileUrl: string;
      legacyRelativePath: string | null;
    }) => Promise<TLinked>;
  }): Promise<StorageWriteResult<TLinked>> {
    let stage = "resolve_policy";
    const policy = await storagePolicyResolver.resolve(input.organizationId);
    const providerConfig = storagePolicyResolver.resolveCanonicalStorageBehavior(policy);
    const adapter = storageRegistry.getAdapter(providerConfig.providerType);

    stage = "create_storage_job";
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
        stage = "put_object";
        storedObject = await adapter.putObject({
          buffer: input.source.buffer,
          originalFilename: input.source.originalFilename,
          mimeType: input.source.mimeType,
          requestedTarget: input.requestedTarget,
          providerConfig,
          resource: input.resource,
        });
      } else if (input.source.kind === "upload-session") {
        stage = "load_upload_session";
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

        stage = "finalize_upload_session";
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
      } else if (input.source.kind === "existing-file-record") {
        stage = "resolve_existing_file_record";
        const sourceFileRecord = await fileRecordRepository.getByIdForOrganization(input.organizationId, input.source.fileRecordId);
        if (!sourceFileRecord) {
          throw storageFailure("Source artwork file record was not found.", "SOURCE_ARTWORK_NOT_FOUND", 404);
        }

        const sourcePlacement = await storagePlacementRepository.getActiveCanonicalPlacementByFileRecordId(sourceFileRecord.id);
        if (!sourcePlacement?.providerConfigId || (!sourcePlacement.objectKey && !sourcePlacement.localPathRef)) {
          throw storageFailure("Source artwork is missing an active storage placement.", "SOURCE_STORAGE_PLACEMENT_MISSING", 409);
        }

        const sourceProviderConfig = await storageProviderConfigRepository.getByIdForOrganization(
          input.organizationId,
          sourcePlacement.providerConfigId,
        );
        if (!sourceProviderConfig) {
          throw storageFailure("Source artwork storage provider is unavailable.", "SOURCE_STORAGE_PLACEMENT_MISSING", 409);
        }

        const sourceAdapter = storageRegistry.getAdapter(sourceProviderConfig.providerType);
        const originalFilename = input.source.originalFilename || sourceFileRecord.originalFilename;
        const mimeType = input.source.mimeType || sourceFileRecord.mimeType || "application/octet-stream";
        const sizeBytes = Math.max(0, Number(input.source.fileSize ?? sourcePlacement.sizeBytes ?? sourceFileRecord.sizeBytes ?? 0));
        const checksum = input.source.checksum ?? sourcePlacement.checksum ?? sourceFileRecord.checksum ?? null;

        stage = "verify_source_object";
        let sourceExists = false;
        try {
          sourceExists = await sourceAdapter.objectExists({
            providerConfig: sourceProviderConfig,
            objectKey: sourcePlacement.objectKey,
            localPathRef: sourcePlacement.localPathRef,
          });
        } catch (error: any) {
          throw storageFailure(
            error?.message ? `Failed to verify source artwork: ${error.message}` : "Failed to verify source artwork.",
            "SOURCE_STORAGE_READ_FAILED",
            502,
          );
        }
        if (!sourceExists) {
          throw storageFailure("Source artwork object was not found in storage.", "SOURCE_ARTWORK_NOT_FOUND", 404);
        }

        const canCopyWithinProvider =
          sourceProviderConfig.id === providerConfig.id &&
          typeof sourceAdapter.copyObjectWithinProvider === "function";

        console.info("[StorageApplicationService.finalizeUpload] Copying stored source", {
          organizationId: input.organizationId,
          resourceType: input.resource.resourceType,
          resourceId: input.resource.resourceId,
          sourceProvider: sourceProviderConfig.providerType,
          sourcePlacementId: sourcePlacement.id,
          sourceBucket: sourcePlacement.bucket ?? null,
          sourceObjectKey: sanitizeStorageKey(sourcePlacement.objectKey),
          sourceLocalPathRef: sanitizeStorageKey(sourcePlacement.localPathRef),
          destinationProvider: providerConfig.providerType,
          destinationProviderConfigId: providerConfig.id,
        });

        if (canCopyWithinProvider) {
          try {
            stage = "copy_existing_placement";
            storedObject = await sourceAdapter.copyObjectWithinProvider!({
              providerConfig,
              sourceObjectKey: sourcePlacement.objectKey,
              sourceLocalPathRef: sourcePlacement.localPathRef,
              originalFilename,
              mimeType,
              sizeBytes,
              checksum,
              requestedTarget: input.requestedTarget,
              resource: input.resource,
            });
          } catch (error) {
            console.warn("[StorageApplicationService.finalizeUpload] Same-provider copy failed; falling back to byte copy", {
              organizationId: input.organizationId,
              sourceProvider: sourceProviderConfig.providerType,
              sourcePlacementId: sourcePlacement.id,
              destinationProvider: providerConfig.providerType,
              error: error instanceof Error ? error.message : String(error),
            });
            storedObject = null;
          }
        }

        if (!storedObject) {
          let sourceBuffer: Buffer;
          try {
            stage = "read_existing_placement";
            sourceBuffer = await sourceAdapter.readObject({
              providerConfig: sourceProviderConfig,
              objectKey: sourcePlacement.objectKey,
              localPathRef: sourcePlacement.localPathRef,
            });
          } catch (error: any) {
            throw storageFailure(
              error?.message ? `Failed to read source artwork: ${error.message}` : "Failed to read source artwork.",
              "SOURCE_STORAGE_READ_FAILED",
              502,
            );
          }

          try {
            stage = "put_object";
            storedObject = await adapter.putObject({
              buffer: sourceBuffer,
              originalFilename,
              mimeType,
              requestedTarget: input.requestedTarget,
              providerConfig,
              resource: input.resource,
            });
          } catch (error: any) {
            throw storageFailure(
              error?.message ? `Failed to write production artwork: ${error.message}` : "Failed to write production artwork.",
              "PRODUCTION_ARTWORK_WRITE_FAILED",
              502,
            );
          }
        }

        console.info("[StorageApplicationService.finalizeUpload] Stored production copy", {
          organizationId: input.organizationId,
          resourceType: input.resource.resourceType,
          resourceId: input.resource.resourceId,
          sourceProvider: sourceProviderConfig.providerType,
          sourcePlacementId: sourcePlacement.id,
          destinationProvider: providerConfig.providerType,
          destinationBucket: storedObject.bucket ?? null,
          destinationObjectKey: sanitizeStorageKey(storedObject.objectKey),
          destinationLocalPathRef: sanitizeStorageKey(storedObject.localPathRef),
        });
      } else {
        const rawKey = input.source.fileUrl.trim();
        const looksHttp = rawKey.startsWith("http://") || rawKey.startsWith("https://");
        if (looksHttp) {
          throw new Error("External URLs are not supported by canonical storage finalization");
        }

        stage = "prepare_existing_key";
        let storageTarget: StoredObjectDescriptor["storageTarget"];
        let bucket: string | null;
        let objectKey: string | null;
        let localPathRef: string | null;

        if (providerConfig.providerType === "s3") {
          const normalized = normalizeS3CompatibleStorageProviderConfig(providerConfig.configJson);
          storageTarget = "s3";
          bucket = normalized.bucketName.trim() || null;
          objectKey = rawKey;
          localPathRef = null;
        } else if (providerConfig.providerType === "supabase") {
          const normalized = normalizeSupabaseStorageProviderConfig(providerConfig.configJson);
          storageTarget = "supabase";
          bucket = normalized.bucketName.trim() || null;
          objectKey = rawKey;
          localPathRef = null;
        } else if (providerConfig.providerType === "local_filesystem") {
          normalizeLocalFilesystemStorageProviderConfig(providerConfig.configJson);
          storageTarget = "local_dev";
          bucket = null;
          objectKey = null;
          localPathRef = rawKey;
        } else {
          const looksSupabaseKey = rawKey.startsWith("uploads/") || rawKey.startsWith("titan-private/");
          storageTarget = input.requestedTarget === "supabase"
            ? "supabase"
            : input.requestedTarget === "local_dev"
              ? "local_dev"
              : looksSupabaseKey
                ? "supabase"
                : "local_dev";
          bucket = storageTarget === "supabase" ? "titan-private" : null;
          objectKey = storageTarget === "supabase" ? rawKey : null;
          localPathRef = storageTarget === "supabase" ? null : rawKey;
        }

        storedObject = {
          providerType: providerConfig.providerType,
          storageTarget,
          bucket,
          objectKey,
          localPathRef,
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

      if (storedObject.storageTarget === "local_dev") {
        assertDurableCanonicalStorageTarget("local_dev");
      }

      stage = "verify_object";
      const verification = await adapter.verifyObject({
        providerConfig,
        objectKey: storedObject.objectKey,
        localPathRef: storedObject.localPathRef,
      });
      if (!verification.exists) {
        throw storageFailure("Provider verification failed for stored production object.", "PRODUCTION_ARTWORK_VERIFY_FAILED", 502);
      }

      const persistedObject = storedObject;

  stage = "persist_canonical_records";
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
          legacyStorageProvider:
            persistedObject.storageTarget === "supabase"
              ? "supabase"
              : persistedObject.storageTarget === "s3"
                ? "s3"
                : "local",
          legacyFileUrl: persistedObject.objectKey ?? persistedObject.localPathRef ?? "",
          legacyRelativePath: persistedObject.objectKey ?? persistedObject.localPathRef ?? null,
        });

        return { fileRecord, placement, linkedRecord };
      });

      if (sourceUploadMeta) {
        stage = "mark_upload_session_linked";
        sourceUploadMeta.linkedAt = new Date().toISOString();
        await saveUploadSessionMeta(sourceUploadMeta.uploadId, sourceUploadMeta);
        const sourcePath = sourceUploadMeta.relativePath ?? null;
        const canonicalPath = persistedObject.localPathRef ?? persistedObject.objectKey ?? null;
        if (sourcePath && sourcePath !== canonicalPath) {
          await deleteFile(sourcePath).catch(() => false);
        }
        await deleteUploadSession(sourceUploadMeta.uploadId);
      }

      stage = "complete_storage_job";
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
      console.error("[StorageApplicationService.finalizeUpload] Failed", {
        organizationId: input.organizationId,
        resourceType: input.resource.resourceType,
        resourceId: input.resource.resourceId,
        sourceKind: input.source.kind,
        stage,
        storageJobId: storageJob.id,
        error: error?.message || String(error),
        code: error?.code ?? null,
      });

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
