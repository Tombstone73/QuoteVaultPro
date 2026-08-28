import fs from "fs/promises";
import path from "path";
import {
  computeChecksum,
  deleteFile,
  fileExists,
  generateRelativePath,
  generateStoredFilename,
  getFileExtension,
  processUploadedFile,
} from "../../../utils/fileStorage";
import { resolveLocalStoragePath } from "../../localStoragePath";
import { SupabaseStorageService, isSupabaseConfigured } from "../../../supabaseStorage";
import { assertDurableCanonicalStorageTarget, getEffectiveMaxCloudUploadBytes, decideStorageTarget } from "../../storageTarget";
import { normalizeObjectKeyForDb } from "../../../lib/supabaseObjectHelpers";
import type { StorageProviderConfig } from "@shared/schema";
import { normalizeTitanManagedStorageConfig } from "@shared/storageSettings";
import type {
  StorageProviderAdapter,
  StoredObjectDescriptor,
  StorageResourceContext,
} from "./StorageProviderAdapter";
import { normalizeRequestedStorageTarget } from "./StorageProviderAdapter";

const TITAN_MANAGED_BUCKET = "titan-private";

function buildRelativePath(resource: StorageResourceContext, storedFilename: string): string {
  return generateRelativePath({
    organizationId: resource.organizationId,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    orderNumber: resource.orderNumber ?? undefined,
    lineItemId: resource.lineItemId ?? undefined,
    storedFilename,
  });
}

export class TitanManagedStorageAdapter implements StorageProviderAdapter {
  readonly providerType: StorageProviderConfig["providerType"] = "titan_managed";

  async validateConfig(config: StorageProviderConfig): Promise<{ valid: boolean; error: string | null; validatedAt: Date }> {
    const normalizedConfig = normalizeTitanManagedStorageConfig(config.configJson);
    if (normalizedConfig.routingMode === "supabase" && !isSupabaseConfigured()) {
      return {
        valid: false,
        error: "Supabase-backed storage is not available in the current server environment.",
        validatedAt: new Date(),
      };
    }

    const maxCloudBytes = getEffectiveMaxCloudUploadBytes(config.configJson);
    if (!Number.isFinite(maxCloudBytes) || maxCloudBytes <= 0) {
      return {
        valid: false,
        error: "Max cloud upload threshold must be greater than zero.",
        validatedAt: new Date(),
      };
    }

    return {
      valid: true,
      error: null,
      validatedAt: new Date(),
    };
  }

  async initiateUpload(input: {
    organizationId: string;
    fileName?: string | null;
    fileSizeBytes: number;
    requestedTarget?: string | null;
    providerConfig: StorageProviderConfig;
  }): Promise<{
    storageTarget: "supabase" | "local_dev";
    maxCloudBytes: number;
    method: "PUT" | "ATOMIC";
    url?: string;
    path?: string;
    token?: string;
    message?: string;
  }> {
    const maxCloudBytes = getEffectiveMaxCloudUploadBytes(input.providerConfig.configJson);
    const storageTarget = decideStorageTarget({
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      requestedTarget: input.requestedTarget,
      organizationId: input.organizationId,
      context: "StorageApplicationService.initiateUpload",
      providerConfigJson: input.providerConfig.configJson,
    });
    assertDurableCanonicalStorageTarget(storageTarget);

    if (storageTarget === "supabase" && isSupabaseConfigured()) {
      const supabase = new SupabaseStorageService();
      const signed = await supabase.getSignedUploadUrl({ folder: "uploads" });
      return {
        storageTarget,
        maxCloudBytes,
        method: "PUT",
        url: signed.url,
        path: signed.path,
        token: signed.token,
      };
    }

    return {
      storageTarget: "local_dev",
      maxCloudBytes,
      method: "ATOMIC",
      message: "File exceeds cloud upload limit; use atomic upload.",
    };
  }

  async putObject(input: {
    buffer: Buffer;
    originalFilename: string;
    mimeType: string;
    requestedTarget?: string | null;
    providerConfig: StorageProviderConfig;
    resource: StorageResourceContext;
  }): Promise<StoredObjectDescriptor> {
    const storageTarget = decideStorageTarget({
      fileName: input.originalFilename,
      fileSizeBytes: input.buffer.length,
      requestedTarget: input.requestedTarget,
      organizationId: input.resource.organizationId,
      context: "StorageApplicationService.putObject",
      providerConfigJson: input.providerConfig.configJson,
    });
    assertDurableCanonicalStorageTarget(storageTarget);

    if (storageTarget === "supabase" && isSupabaseConfigured()) {
      const requestedTarget = normalizeRequestedStorageTarget(input.requestedTarget);
      const storedFilename = requestedTarget ? requestedTarget.split("/").pop() ?? input.originalFilename : generateStoredFilename(input.originalFilename);
      const relativePath = requestedTarget ?? buildRelativePath(input.resource, storedFilename);
      const checksum = computeChecksum(input.buffer);
      const extension = getFileExtension(input.originalFilename);
      const supabase = new SupabaseStorageService();
      const uploaded = await supabase.uploadFile(relativePath, input.buffer, input.mimeType);

      return {
        providerType: this.providerType,
        storageTarget,
        bucket: TITAN_MANAGED_BUCKET,
        objectKey: normalizeObjectKeyForDb(uploaded.path),
        localPathRef: null,
        checksum,
        sizeBytes: input.buffer.length,
        mimeType: input.mimeType,
        originalFilename: input.originalFilename,
        storedFilename,
        extension,
        persistenceConfirmed: true,
      };
    }

    const requestedTarget = normalizeRequestedStorageTarget(input.requestedTarget);
    const fileMetadata = requestedTarget
      ? (() => {
          const extension = getFileExtension(input.originalFilename);
          return {
            relativePath: requestedTarget,
            checksum: computeChecksum(input.buffer),
            sizeBytes: input.buffer.length,
            originalFilename: input.originalFilename,
            storedFilename: requestedTarget.split("/").pop() ?? input.originalFilename,
            extension,
          };
        })()
      : await processUploadedFile({
          originalFilename: input.originalFilename,
          buffer: input.buffer,
          mimeType: input.mimeType,
          organizationId: input.resource.organizationId,
          orderNumber: input.resource.orderNumber ?? undefined,
          lineItemId: input.resource.lineItemId ?? undefined,
          resourceType: input.resource.resourceType,
          resourceId: input.resource.resourceId,
        });

    if (requestedTarget) {
      const absolutePath = resolveLocalStoragePath(requestedTarget);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, input.buffer);
    }

    return {
      providerType: this.providerType,
      storageTarget: "local_dev",
      bucket: null,
      objectKey: null,
      localPathRef: fileMetadata.relativePath,
      checksum: fileMetadata.checksum,
      sizeBytes: fileMetadata.sizeBytes,
      mimeType: input.mimeType,
      originalFilename: fileMetadata.originalFilename,
      storedFilename: fileMetadata.storedFilename,
      extension: fileMetadata.extension,
      persistenceConfirmed: true,
    };
  }

  async readObject(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<Buffer> {
    if (input.objectKey) {
      const supabase = new SupabaseStorageService();
      return supabase.downloadFile(input.objectKey);
    }
    if (!input.localPathRef) {
      throw new Error("Missing local path reference");
    }
    return fs.readFile(resolveLocalStoragePath(input.localPathRef));
  }

  async copyObjectWithinProvider(input: {
    providerConfig: StorageProviderConfig;
    sourceObjectKey?: string | null;
    sourceLocalPathRef?: string | null;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    checksum?: string | null;
    requestedTarget?: string | null;
    resource: StorageResourceContext;
  }): Promise<StoredObjectDescriptor> {
    if (input.sourceObjectKey && isSupabaseConfigured()) {
      const requestedTarget = normalizeRequestedStorageTarget(input.requestedTarget);
      const storedFilename = requestedTarget ? requestedTarget.split("/").pop() ?? input.originalFilename : generateStoredFilename(input.originalFilename);
      const relativePath = requestedTarget ?? buildRelativePath(input.resource, storedFilename);
      const supabase = new SupabaseStorageService();
      const copied = await supabase.copyFile(input.sourceObjectKey, relativePath);
      if (!copied) {
        throw new Error("Failed to copy Titan-managed Supabase object.");
      }
      return {
        providerType: this.providerType,
        storageTarget: "supabase",
        bucket: TITAN_MANAGED_BUCKET,
        objectKey: normalizeObjectKeyForDb(relativePath),
        localPathRef: null,
        checksum: input.checksum ?? null,
        sizeBytes: Math.max(0, Number(input.sizeBytes || 0)),
        mimeType: input.mimeType || "application/octet-stream",
        originalFilename: input.originalFilename,
        storedFilename,
        extension: getFileExtension(input.originalFilename),
        persistenceConfirmed: true,
      };
    }

    if (!input.sourceLocalPathRef) {
      throw new Error("Missing local path reference for Titan-managed copy.");
    }
    const requestedTarget = normalizeRequestedStorageTarget(input.requestedTarget);
    const storedFilename = requestedTarget ? requestedTarget.split("/").pop() ?? input.originalFilename : generateStoredFilename(input.originalFilename);
    const relativePath = requestedTarget ?? buildRelativePath(input.resource, storedFilename);
    const sourceAbsolutePath = resolveLocalStoragePath(input.sourceLocalPathRef);
    const destinationAbsolutePath = resolveLocalStoragePath(relativePath);
    await fs.mkdir(path.dirname(destinationAbsolutePath), { recursive: true });
    await fs.copyFile(sourceAbsolutePath, destinationAbsolutePath);

    return {
      providerType: this.providerType,
      storageTarget: "local_dev",
      bucket: null,
      objectKey: null,
      localPathRef: relativePath,
      checksum: input.checksum ?? null,
      sizeBytes: Math.max(0, Number(input.sizeBytes || 0)),
      mimeType: input.mimeType || "application/octet-stream",
      originalFilename: input.originalFilename,
      storedFilename,
      extension: getFileExtension(input.originalFilename),
      persistenceConfirmed: true,
    };
  }

  async finalizeUpload(input: {
    sourceRelativePath: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    checksum?: string | null;
    extension?: string | null;
    storedFilename?: string | null;
    requestedTarget?: string | null;
    providerConfig: StorageProviderConfig;
    resource: StorageResourceContext;
  }): Promise<StoredObjectDescriptor> {
    const storageTarget = decideStorageTarget({
      fileName: input.originalFilename,
      fileSizeBytes: input.sizeBytes,
      requestedTarget: input.requestedTarget,
      organizationId: input.resource.organizationId,
      context: "StorageApplicationService.finalizeUpload",
      providerConfigJson: input.providerConfig.configJson,
    });
    assertDurableCanonicalStorageTarget(storageTarget);

    if (storageTarget === "supabase" && isSupabaseConfigured()) {
      const absolutePath = resolveLocalStoragePath(input.sourceRelativePath);
      const buffer = await fs.readFile(absolutePath);
      const checksum = input.checksum ?? computeChecksum(buffer);
      const extension = input.extension ?? getFileExtension(input.originalFilename);
      const storedFilename = input.storedFilename ?? generateStoredFilename(input.originalFilename);
      const relativePath = buildRelativePath(input.resource, storedFilename);
      const supabase = new SupabaseStorageService();
      const uploaded = await supabase.uploadFile(relativePath, buffer, input.mimeType || "application/octet-stream");

      return {
        providerType: this.providerType,
        storageTarget,
        bucket: TITAN_MANAGED_BUCKET,
        objectKey: normalizeObjectKeyForDb(uploaded.path),
        localPathRef: null,
        checksum,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
        originalFilename: input.originalFilename,
        storedFilename,
        extension,
        persistenceConfirmed: true,
      };
    }

    const exists = await fileExists(input.sourceRelativePath);
    if (!exists) {
      throw new Error("Temporary upload file not found");
    }

    return {
      providerType: this.providerType,
      storageTarget: "local_dev",
      bucket: null,
      objectKey: null,
      localPathRef: input.sourceRelativePath,
      checksum: input.checksum ?? null,
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      originalFilename: input.originalFilename,
      storedFilename: input.storedFilename ?? null,
      extension: input.extension ?? getFileExtension(input.originalFilename),
      persistenceConfirmed: true,
    };
  }

  async getDownloadHandle(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<{ kind: "signed_url" | "local_path"; value: string }> {
    if (input.objectKey) {
      const supabase = new SupabaseStorageService();
      const signedUrl = await supabase.getSignedDownloadUrl(input.objectKey);
      return { kind: "signed_url", value: signedUrl };
    }

    if (!input.localPathRef) {
      throw new Error("Missing local path reference");
    }

    return { kind: "local_path", value: resolveLocalStoragePath(input.localPathRef) };
  }

  async deleteObject(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<boolean> {
    if (input.objectKey) {
      const supabase = new SupabaseStorageService();
      return supabase.deleteFile(input.objectKey);
    }

    if (!input.localPathRef) {
      return false;
    }

    return deleteFile(input.localPathRef);
  }

  async objectExists(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<boolean> {
    if (input.objectKey) {
      const supabase = new SupabaseStorageService();
      return supabase.fileExists(input.objectKey);
    }

    if (!input.localPathRef) {
      return false;
    }

    return fileExists(input.localPathRef);
  }

  async verifyObject(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<{ exists: boolean; verifiedAt: Date }> {
    return {
      exists: await this.objectExists(input),
      verifiedAt: new Date(),
    };
  }
}

export const titanManagedStorageAdapter = new TitanManagedStorageAdapter();
