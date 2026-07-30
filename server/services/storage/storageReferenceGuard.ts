import { and, eq, inArray, ne, notInArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  assets,
  fileDerivatives,
  fileRecords,
  inboundOrderFiles,
  lineItemFiles,
  lineItemProofVersions,
  orderAttachments,
  orders,
  quoteAttachmentPages,
  quoteAttachments,
  storagePlacements,
} from "@shared/schema";
import { db } from "../../db";
import { normalizeObjectKeyForDb } from "../../lib/supabaseObjectHelpers";
import { deleteStoredObjectKeys } from "./deleteStoredObjectKeys";

type LegacyStorageProvider = "local" | "s3" | "gcs" | "supabase" | null;

export type StorageReferenceCounts = {
  lineItemFiles: number;
  orderAttachments: number;
  quoteAttachments: number;
  assets: number;
  fileDerivatives: number;
  quoteAttachmentPages: number;
  inboundOrderFiles: number;
  proofSources: number;
  sharedStoragePlacements: number;
  totalLiveReferences: number;
  failedClosed: boolean;
};

export type StorageReferenceExclusions = {
  assetIds?: string[];
};

function compactUnique(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value): value is string => value.length > 0),
    ),
  );
}

function buildStorageKeys(values: Array<string | null | undefined>): string[] {
  const keys = compactUnique(values);
  return compactUnique(keys.flatMap((key) => [key, normalizeObjectKeyForDb(key)]));
}

function oneOf(conditions: Array<SQL | undefined>): SQL | undefined {
  const filtered = conditions.filter((condition): condition is SQL => Boolean(condition));
  if (filtered.length === 0) return undefined;
  if (filtered.length === 1) return filtered[0];
  return or(...filtered);
}

async function countRows(fromQuery: any, condition: SQL | undefined): Promise<number> {
  if (!condition) return 0;
  const [{ count = 0 } = {}] = await fromQuery.where(condition);
  return Number(count);
}

async function countLineItemFiles(organizationId: string, fileRecordId: string | null, storageKeys: string[]): Promise<number> {
  const match = oneOf([
    fileRecordId ? eq(lineItemFiles.fileRecordId, fileRecordId) : undefined,
    storageKeys.length > 0 ? inArray(lineItemFiles.storagePath, storageKeys) : undefined,
    storageKeys.length > 0 ? inArray(lineItemFiles.storageKey, storageKeys) : undefined,
  ]);
  return countRows(
    db.select({ count: sql<number>`count(*)` }).from(lineItemFiles),
    and(eq(lineItemFiles.organizationId, organizationId), eq(lineItemFiles.status, "active"), match),
  );
}

async function countOrderAttachments(organizationId: string, fileRecordId: string | null, storageKeys: string[]): Promise<number> {
  const match = oneOf([
    fileRecordId ? eq(orderAttachments.fileRecordId, fileRecordId) : undefined,
    storageKeys.length > 0 ? inArray(orderAttachments.fileUrl, storageKeys) : undefined,
    storageKeys.length > 0 ? inArray(orderAttachments.relativePath, storageKeys) : undefined,
  ]);
  if (!match) return 0;
  const [{ count = 0 } = {}] = await db
    .select({ count: sql<number>`count(*)` })
    .from(orderAttachments)
    .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
    .where(and(eq(orders.organizationId, organizationId), match));
  return Number(count);
}

async function countQuoteAttachments(organizationId: string, fileRecordId: string | null, storageKeys: string[]): Promise<number> {
  const match = oneOf([
    fileRecordId ? eq(quoteAttachments.fileRecordId, fileRecordId) : undefined,
    storageKeys.length > 0 ? inArray(quoteAttachments.fileUrl, storageKeys) : undefined,
    storageKeys.length > 0 ? inArray(quoteAttachments.relativePath, storageKeys) : undefined,
  ]);
  return countRows(
    db.select({ count: sql<number>`count(*)` }).from(quoteAttachments),
    and(eq(quoteAttachments.organizationId, organizationId), match),
  );
}

async function countAssets(organizationId: string, fileRecordId: string | null, storageKeys: string[], exclusions?: StorageReferenceExclusions): Promise<number> {
  const match = oneOf([
    fileRecordId ? eq(assets.fileRecordId, fileRecordId) : undefined,
    storageKeys.length > 0 ? inArray(assets.fileKey, storageKeys) : undefined,
  ]);
  const excludedAssetIds = compactUnique(exclusions?.assetIds ?? []);
  return countRows(
    db.select({ count: sql<number>`count(*)` }).from(assets),
    and(
      eq(assets.organizationId, organizationId),
      match,
      excludedAssetIds.length > 0 ? notInArray(assets.id, excludedAssetIds) : undefined,
    ),
  );
}

async function countFileDerivatives(organizationId: string, fileRecordId: string | null, sourcePlacementId: string | null, storageKeys: string[]): Promise<number> {
  const match = oneOf([
    fileRecordId ? eq(fileDerivatives.fileRecordId, fileRecordId) : undefined,
    sourcePlacementId ? eq(fileDerivatives.sourcePlacementId, sourcePlacementId) : undefined,
    storageKeys.length > 0 ? inArray(fileDerivatives.objectKey, storageKeys) : undefined,
  ]);
  if (!match) return 0;
  const [{ count = 0 } = {}] = await db
    .select({ count: sql<number>`count(*)` })
    .from(fileDerivatives)
    .innerJoin(fileRecords, eq(fileDerivatives.fileRecordId, fileRecords.id))
    .where(
      and(
        eq(fileRecords.organizationId, organizationId),
        match,
        ne(fileDerivatives.state, "deleted"),
      ),
    );
  return Number(count);
}

async function countQuoteAttachmentPages(organizationId: string, fileRecordId: string | null, storageKeys: string[]): Promise<number> {
  const match = oneOf([
    fileRecordId ? eq(quoteAttachmentPages.thumbFileRecordId, fileRecordId) : undefined,
    fileRecordId ? eq(quoteAttachmentPages.previewFileRecordId, fileRecordId) : undefined,
    storageKeys.length > 0 ? inArray(quoteAttachmentPages.thumbKey, storageKeys) : undefined,
    storageKeys.length > 0 ? inArray(quoteAttachmentPages.previewKey, storageKeys) : undefined,
  ]);
  return countRows(
    db.select({ count: sql<number>`count(*)` }).from(quoteAttachmentPages),
    and(eq(quoteAttachmentPages.organizationId, organizationId), match),
  );
}

async function countInboundOrderFiles(organizationId: string, fileRecordId: string | null): Promise<number> {
  if (!fileRecordId) return 0;
  return countRows(
    db.select({ count: sql<number>`count(*)` }).from(inboundOrderFiles),
    and(
      eq(inboundOrderFiles.organizationId, organizationId),
      eq(inboundOrderFiles.fileRecordId, fileRecordId),
      notInArray(inboundOrderFiles.status, ["quarantined", "rejected"]),
    ),
  );
}

async function countProofSources(organizationId: string, fileRecordId: string | null, storageKeys: string[]): Promise<number> {
  const attachmentMatch = oneOf([
    fileRecordId ? eq(orderAttachments.fileRecordId, fileRecordId) : undefined,
    storageKeys.length > 0 ? inArray(orderAttachments.fileUrl, storageKeys) : undefined,
    storageKeys.length > 0 ? inArray(orderAttachments.relativePath, storageKeys) : undefined,
  ]);
  if (!attachmentMatch) return 0;
  const [{ count = 0 } = {}] = await db
    .select({ count: sql<number>`count(*)` })
    .from(lineItemProofVersions)
    .innerJoin(orderAttachments, eq(lineItemProofVersions.proofFileId, orderAttachments.id))
    .where(
      and(
        eq(lineItemProofVersions.organizationId, organizationId),
        notInArray(lineItemProofVersions.status, ["cancelled", "superseded"]),
        attachmentMatch,
      ),
    );
  return Number(count);
}

async function countSharedStoragePlacements(organizationId: string, fileRecordId: string | null, sourcePlacementId: string | null, storageKeys: string[]): Promise<number> {
  const match = oneOf([
    storageKeys.length > 0 ? inArray(storagePlacements.objectKey, storageKeys) : undefined,
    storageKeys.length > 0 ? inArray(storagePlacements.localPathRef, storageKeys) : undefined,
    fileRecordId ? eq(storagePlacements.fileRecordId, fileRecordId) : undefined,
  ]);
  if (!match) return 0;
  const [{ count = 0 } = {}] = await db
    .select({ count: sql<number>`count(*)` })
    .from(storagePlacements)
    .innerJoin(fileRecords, eq(storagePlacements.fileRecordId, fileRecords.id))
    .where(
      and(
        eq(fileRecords.organizationId, organizationId),
        eq(storagePlacements.placementState, "active"),
        match,
        sourcePlacementId ? ne(storagePlacements.id, sourcePlacementId) : undefined,
        fileRecordId ? ne(storagePlacements.fileRecordId, fileRecordId) : undefined,
      ),
    );
  return Number(count);
}

export async function countLiveStorageReferences(args: {
  organizationId: string;
  fileRecordId?: string | null;
  sourcePlacementId?: string | null;
  keys?: Array<string | null | undefined>;
  exclusions?: StorageReferenceExclusions;
}): Promise<StorageReferenceCounts> {
  const fileRecordId = args.fileRecordId ? String(args.fileRecordId) : null;
  const sourcePlacementId = args.sourcePlacementId ? String(args.sourcePlacementId) : null;
  const storageKeys = buildStorageKeys(args.keys ?? []);

  try {
    const [
      lineItemFileCount,
      orderAttachmentCount,
      quoteAttachmentCount,
      assetCount,
      derivativeCount,
      quoteAttachmentPageCount,
      inboundOrderFileCount,
      proofSourceCount,
      sharedStoragePlacementCount,
    ] = await Promise.all([
      countLineItemFiles(args.organizationId, fileRecordId, storageKeys),
      countOrderAttachments(args.organizationId, fileRecordId, storageKeys),
      countQuoteAttachments(args.organizationId, fileRecordId, storageKeys),
      countAssets(args.organizationId, fileRecordId, storageKeys, args.exclusions),
      countFileDerivatives(args.organizationId, fileRecordId, sourcePlacementId, storageKeys),
      countQuoteAttachmentPages(args.organizationId, fileRecordId, storageKeys),
      countInboundOrderFiles(args.organizationId, fileRecordId),
      countProofSources(args.organizationId, fileRecordId, storageKeys),
      countSharedStoragePlacements(args.organizationId, fileRecordId, sourcePlacementId, storageKeys),
    ]);

    const totalLiveReferences =
      lineItemFileCount +
      orderAttachmentCount +
      quoteAttachmentCount +
      assetCount +
      derivativeCount +
      quoteAttachmentPageCount +
      inboundOrderFileCount +
      proofSourceCount +
      sharedStoragePlacementCount;

    return {
      lineItemFiles: lineItemFileCount,
      orderAttachments: orderAttachmentCount,
      quoteAttachments: quoteAttachmentCount,
      assets: assetCount,
      fileDerivatives: derivativeCount,
      quoteAttachmentPages: quoteAttachmentPageCount,
      inboundOrderFiles: inboundOrderFileCount,
      proofSources: proofSourceCount,
      sharedStoragePlacements: sharedStoragePlacementCount,
      totalLiveReferences,
      failedClosed: false,
    };
  } catch (error) {
    console.warn("[StorageReferenceGuard] Reference check failed; preserving stored object", {
      organizationId: args.organizationId,
      fileRecordId,
      sourcePlacementId,
      keyCount: storageKeys.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      lineItemFiles: 0,
      orderAttachments: 0,
      quoteAttachments: 0,
      assets: 0,
      fileDerivatives: 0,
      quoteAttachmentPages: 0,
      inboundOrderFiles: 0,
      proofSources: 0,
      sharedStoragePlacements: 0,
      totalLiveReferences: 1,
      failedClosed: true,
    };
  }
}

export async function deleteStoredObjectKeysIfUnreferenced(args: {
  organizationId: string;
  keys: Array<string | null | undefined>;
  fileRecordId?: string | null;
  sourcePlacementId?: string | null;
  legacyStorageProvider?: LegacyStorageProvider;
  exclusions?: StorageReferenceExclusions;
  logContext?: Record<string, unknown>;
}): Promise<{ deletedKeys: string[]; failedKeys: string[]; skipped: boolean; reason?: string; references: StorageReferenceCounts }> {
  const references = await countLiveStorageReferences({
    organizationId: args.organizationId,
    fileRecordId: args.fileRecordId,
    sourcePlacementId: args.sourcePlacementId,
    keys: args.keys,
    exclusions: args.exclusions,
  });

  if (references.totalLiveReferences > 0) {
    console.info("[StorageReferenceGuard] Preserving stored object with live references", {
      organizationId: args.organizationId,
      fileRecordId: args.fileRecordId ?? null,
      sourcePlacementId: args.sourcePlacementId ?? null,
      keyCount: buildStorageKeys(args.keys).length,
      references,
      ...(args.logContext ?? {}),
    });
    return {
      deletedKeys: [],
      failedKeys: [],
      skipped: true,
      reason: references.failedClosed ? "reference_check_failed" : "live_references",
      references,
    };
  }

  const result = await deleteStoredObjectKeys({
    keys: args.keys,
    fileRecordId: args.fileRecordId,
    sourcePlacementId: args.sourcePlacementId,
    legacyStorageProvider: args.legacyStorageProvider ?? null,
  });

  console.info("[StorageReferenceGuard] Deleted unreferenced stored object keys", {
    organizationId: args.organizationId,
    fileRecordId: args.fileRecordId ?? null,
    sourcePlacementId: args.sourcePlacementId ?? null,
    deletedKeyCount: result.deletedKeys.length,
    failedKeyCount: result.failedKeys.length,
    ...(args.logContext ?? {}),
  });

  return { ...result, skipped: false, references };
}
