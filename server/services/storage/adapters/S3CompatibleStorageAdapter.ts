import crypto from "crypto";
import fs from "fs/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageProviderConfig } from "@shared/schema";
import { normalizeS3CompatibleStorageProviderConfig } from "@shared/storageSettings";
import {
  computeChecksum,
  generateRelativePath,
  generateStoredFilename,
  getFileExtension,
} from "../../../utils/fileStorage";
import { resolveLocalStoragePath } from "../../localStoragePath";
import type {
  StorageProviderAdapter,
  StorageResourceContext,
  StoredObjectDescriptor,
} from "./StorageProviderAdapter";

function trimSlashes(value?: string | null): string {
  return (value || "").trim().replace(/^\/+|\/+$/g, "");
}

function buildRelativePath(resource: StorageResourceContext, storedFilename: string, pathPrefix?: string | null): string {
  const base = generateRelativePath({
    organizationId: resource.organizationId,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    orderNumber: resource.orderNumber ?? undefined,
    lineItemId: resource.lineItemId ?? undefined,
    storedFilename,
  });

  const prefix = trimSlashes(pathPrefix);
  return prefix ? `${prefix}/${base}` : base;
}

function buildDirectUploadKey(organizationId: string, fileName?: string | null, pathPrefix?: string | null): string {
  const prefix = trimSlashes(pathPrefix) || "uploads";
  const rawName = (fileName || "upload.bin").trim() || "upload.bin";
  const sanitizedName = rawName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-120) || "upload.bin";
  return `${prefix}/${organizationId}/${crypto.randomUUID()}-${sanitizedName}`;
}

export class S3CompatibleStorageAdapter implements StorageProviderAdapter {
  readonly providerType: StorageProviderConfig["providerType"] = "s3";

  private createClient(config: StorageProviderConfig): { client: S3Client; normalized: ReturnType<typeof normalizeS3CompatibleStorageProviderConfig> } {
    const normalized = normalizeS3CompatibleStorageProviderConfig(config.configJson);
    if (!normalized.bucketName.trim()) {
      throw new Error("Bucket name is required.");
    }
    if (!normalized.region.trim()) {
      throw new Error("Region is required.");
    }
    if (!normalized.endpoint.trim()) {
      throw new Error("Endpoint is required.");
    }
    if (!normalized.accessKeyId.trim()) {
      throw new Error("Access key ID is required.");
    }
    if (!normalized.secretAccessKeyConfigured || !normalized.secretAccessKey) {
      throw new Error("Secret access key is required.");
    }

    return {
      normalized,
      client: new S3Client({
        region: normalized.region,
        endpoint: normalized.endpoint,
        forcePathStyle: normalized.forcePathStyle,
        credentials: {
          accessKeyId: normalized.accessKeyId,
          secretAccessKey: normalized.secretAccessKey,
        },
      }),
    };
  }

  async validateConfig(config: StorageProviderConfig): Promise<{ valid: boolean; error: string | null; validatedAt: Date }> {
    try {
      const { client, normalized } = this.createClient(config);
      await client.send(new HeadBucketCommand({ Bucket: normalized.bucketName }));
      return { valid: true, error: null, validatedAt: new Date() };
    } catch (error: any) {
      return {
        valid: false,
        error: error?.message || "Failed to validate S3-compatible provider configuration.",
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
    storageTarget: "supabase" | "local_dev" | "s3";
    maxCloudBytes: number;
    method: "PUT" | "ATOMIC";
    url?: string;
    path?: string;
    token?: string;
    message?: string;
  }> {
    const { client, normalized } = this.createClient(input.providerConfig);
    const key = buildDirectUploadKey(input.organizationId, input.fileName, normalized.pathPrefix);
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: normalized.bucketName,
        Key: key,
      }),
      { expiresIn: 900 },
    );

    return {
      storageTarget: "s3",
      maxCloudBytes: Number.MAX_SAFE_INTEGER,
      method: "PUT",
      url,
      path: key,
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
    const { client, normalized } = this.createClient(input.providerConfig);
    const storedFilename = generateStoredFilename(input.originalFilename);
    const objectKey = buildRelativePath(input.resource, storedFilename, normalized.pathPrefix);
    const checksum = computeChecksum(input.buffer);
    const extension = getFileExtension(input.originalFilename);

    await client.send(new PutObjectCommand({
      Bucket: normalized.bucketName,
      Key: objectKey,
      Body: input.buffer,
      ContentType: input.mimeType || "application/octet-stream",
    }));

    return {
      providerType: this.providerType,
      storageTarget: "s3",
      bucket: normalized.bucketName,
      objectKey,
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
    const absolutePath = resolveLocalStoragePath(input.sourceRelativePath);
    const buffer = await fs.readFile(absolutePath);
    const stored = await this.putObject({
      buffer,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType || "application/octet-stream",
      requestedTarget: input.requestedTarget,
      providerConfig: input.providerConfig,
      resource: input.resource,
    });

    return {
      ...stored,
      checksum: input.checksum ?? stored.checksum,
      sizeBytes: input.sizeBytes,
      storedFilename: input.storedFilename ?? stored.storedFilename,
      extension: input.extension ?? stored.extension,
    };
  }

  async getDownloadHandle(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<{ kind: "signed_url" | "local_path"; value: string }> {
    if (!input.objectKey) {
      throw new Error("Missing object key for S3-compatible download.");
    }
    const { client, normalized } = this.createClient(input.providerConfig);
    const signedUrl = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: normalized.bucketName,
        Key: input.objectKey,
      }),
      { expiresIn: 3600 },
    );
    return { kind: "signed_url", value: signedUrl };
  }

  async deleteObject(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<boolean> {
    if (!input.objectKey) {
      return false;
    }
    const { client, normalized } = this.createClient(input.providerConfig);
    await client.send(new DeleteObjectCommand({
      Bucket: normalized.bucketName,
      Key: input.objectKey,
    }));
    return true;
  }

  async objectExists(input: {
    providerConfig: StorageProviderConfig;
    objectKey?: string | null;
    localPathRef?: string | null;
  }): Promise<boolean> {
    if (!input.objectKey) {
      return false;
    }
    try {
      const { client, normalized } = this.createClient(input.providerConfig);
      await client.send(new HeadObjectCommand({
        Bucket: normalized.bucketName,
        Key: input.objectKey,
      }));
      return true;
    } catch (error: any) {
      const status = error?.$metadata?.httpStatusCode;
      const code = error?.name || error?.Code;
      if (status === 404 || code === "NotFound" || code === "NoSuchKey") {
        return false;
      }
      throw error;
    }
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

export const s3CompatibleStorageAdapter = new S3CompatibleStorageAdapter();