import type { StorageProviderConfig } from "@shared/schema";

export type TitanManagedStorageTarget = "supabase" | "local_dev" | "s3";
export type StorageResourceType = "quote" | "order" | "customer" | "job" | "organization" | "inbound_order";

export type StorageResourceContext = {
  organizationId: string;
  resourceType: StorageResourceType;
  resourceId: string;
  orderNumber?: string | null;
  lineItemId?: string | null;
};

export type StoredObjectDescriptor = {
  providerType: StorageProviderConfig["providerType"];
  storageTarget: TitanManagedStorageTarget;
  bucket: string | null;
  objectKey: string | null;
  localPathRef: string | null;
  checksum: string | null;
  sizeBytes: number;
  mimeType: string;
  originalFilename: string;
  storedFilename: string | null;
  extension: string | null;
  persistenceConfirmed: boolean;
};

export interface StorageProviderAdapter {
  readonly providerType: StorageProviderConfig["providerType"];

  validateConfig(config: StorageProviderConfig): Promise<{
    valid: boolean;
    error: string | null;
    validatedAt: Date;
  }>;

  initiateUpload(input: {
    organizationId: string;
    fileName?: string | null;
    fileSizeBytes: number;
    requestedTarget?: string | null;
    providerConfig: StorageProviderConfig;
  }): Promise<{
    storageTarget: TitanManagedStorageTarget;
    maxCloudBytes: number;
    maxUploadBytes?: number | null;
    method: "PUT" | "ATOMIC";
    url?: string;
    path?: string;
    token?: string;
    message?: string;
  }>;

  finalizeUpload(input: {
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
  }): Promise<StoredObjectDescriptor>;

  putObject(input: {
    buffer: Buffer;
    originalFilename: string;
    mimeType: string;
    requestedTarget?: string | null;
    providerConfig: StorageProviderConfig;
    resource: StorageResourceContext;
  }): Promise<StoredObjectDescriptor>;

  readObject(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<Buffer>;

  copyObjectWithinProvider?(input: {
    providerConfig: StorageProviderConfig;
    sourceObjectKey?: string | null;
    sourceLocalPathRef?: string | null;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    checksum?: string | null;
    requestedTarget?: string | null;
    resource: StorageResourceContext;
  }): Promise<StoredObjectDescriptor>;

  getDownloadHandle(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<{ kind: "signed_url" | "local_path"; value: string }>;

  deleteObject(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<boolean>;

  objectExists(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<boolean>;

  verifyObject(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<{
    exists: boolean;
    verifiedAt: Date;
  }>;
}

export function normalizeRequestedStorageTarget(value?: string | null): string | null {
  const normalized = (value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return null;
  if (normalized.split("/").some((segment) => segment === "..")) {
    throw new Error("Requested storage target cannot contain path traversal segments.");
  }
  return normalized;
}
