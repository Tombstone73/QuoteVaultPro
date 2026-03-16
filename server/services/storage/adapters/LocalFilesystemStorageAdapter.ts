import fs from "fs/promises";
import path from "path";
import type { StorageProviderConfig } from "@shared/schema";
import { normalizeLocalFilesystemStorageProviderConfig } from "@shared/storageSettings";
import {
  computeChecksum,
  deleteFile,
  ensureDirectory,
  fileExists,
  generateRelativePath,
  generateStoredFilename,
  getFileExtension,
  saveFile,
} from "../../../utils/fileStorage";
import { resolveLocalStoragePath } from "../../localStoragePath";
import type {
  StorageProviderAdapter,
  StorageResourceContext,
  StoredObjectDescriptor,
} from "./StorageProviderAdapter";

function buildRelativePath(resource: StorageResourceContext, storedFilename: string, subfolderPrefix?: string | null): string {
  const base = generateRelativePath({
    organizationId: resource.organizationId,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    orderNumber: resource.orderNumber ?? undefined,
    lineItemId: resource.lineItemId ?? undefined,
    storedFilename,
  });

  const prefix = (subfolderPrefix || "").trim().replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/${base}` : base;
}

function validateSubfolderPrefix(value?: string | null): string | null {
  const normalized = (value || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return null;
  if (normalized.split("/").some((segment) => segment === "..")) {
    throw new Error("Subfolder prefix cannot contain path traversal segments.");
  }
  return normalized;
}

export class LocalFilesystemStorageAdapter implements StorageProviderAdapter {
  readonly providerType: StorageProviderConfig["providerType"] = "local_filesystem";

  async validateConfig(config: StorageProviderConfig): Promise<{ valid: boolean; error: string | null; validatedAt: Date }> {
    try {
      const normalized = normalizeLocalFilesystemStorageProviderConfig(config.configJson);
      const subfolderPrefix = validateSubfolderPrefix(normalized.subfolderPrefix);
      if (subfolderPrefix) {
        const absoluteFolder = resolveLocalStoragePath(path.join(subfolderPrefix, ".storage-check"));
        await ensureDirectory(path.dirname(absoluteFolder));
      }
      return { valid: true, error: null, validatedAt: new Date() };
    } catch (error: any) {
      return {
        valid: false,
        error: error?.message || "Failed to validate local filesystem provider configuration.",
        validatedAt: new Date(),
      };
    }
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
    return {
      storageTarget: "local_dev",
      maxCloudBytes: Number.MAX_SAFE_INTEGER,
      method: "ATOMIC",
      message: "Local filesystem providers use server-side atomic upload handling.",
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
    const normalized = normalizeLocalFilesystemStorageProviderConfig(input.providerConfig.configJson);
    const subfolderPrefix = validateSubfolderPrefix(normalized.subfolderPrefix);
    const storedFilename = generateStoredFilename(input.originalFilename);
    const relativePath = buildRelativePath(input.resource, storedFilename, subfolderPrefix);
    const checksum = computeChecksum(input.buffer);
    const extension = getFileExtension(input.originalFilename);
    await saveFile(relativePath, input.buffer);

    return {
      providerType: this.providerType,
      storageTarget: "local_dev",
      bucket: null,
      objectKey: null,
      localPathRef: relativePath,
      checksum,
      sizeBytes: input.buffer.length,
      mimeType: input.mimeType,
      originalFilename: input.originalFilename,
      storedFilename,
      extension,
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
    const normalized = normalizeLocalFilesystemStorageProviderConfig(input.providerConfig.configJson);
    const subfolderPrefix = validateSubfolderPrefix(normalized.subfolderPrefix);
    const sourceAbsolutePath = resolveLocalStoragePath(input.sourceRelativePath);
    const buffer = await fs.readFile(sourceAbsolutePath);
    const storedFilename = input.storedFilename ?? generateStoredFilename(input.originalFilename);
    const relativePath = buildRelativePath(input.resource, storedFilename, subfolderPrefix);
    await saveFile(relativePath, buffer);

    return {
      providerType: this.providerType,
      storageTarget: "local_dev",
      bucket: null,
      objectKey: null,
      localPathRef: relativePath,
      checksum: input.checksum ?? computeChecksum(buffer),
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      originalFilename: input.originalFilename,
      storedFilename,
      extension: input.extension ?? getFileExtension(input.originalFilename),
      persistenceConfirmed: true,
    };
  }

  async getDownloadHandle(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<{ kind: "signed_url" | "local_path"; value: string }> {
    if (!input.localPathRef) {
      throw new Error("Missing local path reference.");
    }
    return { kind: "local_path", value: resolveLocalStoragePath(input.localPathRef) };
  }

  async deleteObject(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<boolean> {
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

export const localFilesystemStorageAdapter = new LocalFilesystemStorageAdapter();
