import fs from "fs/promises";
import type { StorageProviderConfig } from "@shared/schema";
import { normalizeSupabaseStorageProviderConfig } from "@shared/storageSettings";
import {
  computeChecksum,
  fileExists,
  generateRelativePath,
  generateStoredFilename,
  getFileExtension,
  processUploadedFile,
} from "../../../utils/fileStorage";
import { resolveLocalStoragePath } from "../../localStoragePath";
import { normalizeObjectKeyForDb } from "../../../lib/supabaseObjectHelpers";
import { SupabaseStorageService, isSupabaseConfigured } from "../../../supabaseStorage";
import type {
  StorageProviderAdapter,
  StorageResourceContext,
  StoredObjectDescriptor,
} from "./StorageProviderAdapter";

function buildRelativePath(resource: StorageResourceContext, storedFilename: string, pathPrefix?: string | null): string {
  const base = generateRelativePath({
    organizationId: resource.organizationId,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    orderNumber: resource.orderNumber ?? undefined,
    lineItemId: resource.lineItemId ?? undefined,
    storedFilename,
  });

  const prefix = (pathPrefix || "").trim().replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/${base}` : base;
}

export class SupabaseStorageAdapter implements StorageProviderAdapter {
  readonly providerType: StorageProviderConfig["providerType"] = "supabase";

  async validateConfig(config: StorageProviderConfig): Promise<{ valid: boolean; error: string | null; validatedAt: Date }> {
    const normalized = normalizeSupabaseStorageProviderConfig(config.configJson);
    if (!normalized.bucketName.trim()) {
      return { valid: false, error: "Bucket name is required.", validatedAt: new Date() };
    }
    if (!isSupabaseConfigured()) {
      return {
        valid: false,
        error: "Supabase server credentials are not configured in the current environment.",
        validatedAt: new Date(),
      };
    }

    try {
      const service = new SupabaseStorageService(normalized.bucketName.trim());
      await service.listFiles(normalized.pathPrefix || "");
      return { valid: true, error: null, validatedAt: new Date() };
    } catch (error: any) {
      return {
        valid: false,
        error: error?.message || "Failed to validate Supabase provider configuration.",
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
    const normalized = normalizeSupabaseStorageProviderConfig(input.providerConfig.configJson);
    const service = new SupabaseStorageService(normalized.bucketName.trim());
    const signed = await service.getSignedUploadUrl({ folder: normalized.pathPrefix || "uploads" });
    return {
      storageTarget: "supabase",
      maxCloudBytes: Number.MAX_SAFE_INTEGER,
      method: "PUT",
      url: signed.url,
      path: signed.path,
      token: signed.token,
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
    const normalized = normalizeSupabaseStorageProviderConfig(input.providerConfig.configJson);
    const service = new SupabaseStorageService(normalized.bucketName.trim());
    const storedFilename = generateStoredFilename(input.originalFilename);
    const relativePath = buildRelativePath(input.resource, storedFilename, normalized.pathPrefix);
    const checksum = computeChecksum(input.buffer);
    const extension = getFileExtension(input.originalFilename);
    const uploaded = await service.uploadFile(relativePath, input.buffer, input.mimeType || "application/octet-stream");

    return {
      providerType: this.providerType,
      storageTarget: "supabase",
      bucket: normalized.bucketName.trim(),
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
    const normalized = normalizeSupabaseStorageProviderConfig(input.providerConfig.configJson);
    const absolutePath = resolveLocalStoragePath(input.sourceRelativePath);
    const buffer = await fs.readFile(absolutePath);
    const service = new SupabaseStorageService(normalized.bucketName.trim());
    const storedFilename = input.storedFilename ?? generateStoredFilename(input.originalFilename);
    const relativePath = buildRelativePath(input.resource, storedFilename, normalized.pathPrefix);
    const uploaded = await service.uploadFile(relativePath, buffer, input.mimeType || "application/octet-stream");

    return {
      providerType: this.providerType,
      storageTarget: "supabase",
      bucket: normalized.bucketName.trim(),
      objectKey: normalizeObjectKeyForDb(uploaded.path),
      localPathRef: null,
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
    const normalized = normalizeSupabaseStorageProviderConfig(input.providerConfig.configJson);
    if (!input.objectKey) {
      throw new Error("Missing object key for Supabase download.");
    }
    const service = new SupabaseStorageService(normalized.bucketName.trim());
    const signedUrl = await service.getSignedDownloadUrl(input.objectKey, 3600);
    return { kind: "signed_url", value: signedUrl };
  }

  async deleteObject(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<boolean> {
    const normalized = normalizeSupabaseStorageProviderConfig(input.providerConfig.configJson);
    if (input.objectKey) {
      const service = new SupabaseStorageService(normalized.bucketName.trim());
      return service.deleteFile(input.objectKey);
    }
    return false;
  }

  async objectExists(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<boolean> {
    const normalized = normalizeSupabaseStorageProviderConfig(input.providerConfig.configJson);
    if (input.objectKey) {
      const service = new SupabaseStorageService(normalized.bucketName.trim());
      return service.fileExists(input.objectKey);
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

export const supabaseStorageAdapter = new SupabaseStorageAdapter();
