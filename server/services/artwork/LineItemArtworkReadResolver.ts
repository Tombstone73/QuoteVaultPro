import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import {
  assets,
  assetLinks,
  fileRecords,
  lineItemArtwork,
  lineItemFiles,
  orderLineItems,
  orderAttachments,
  orders,
} from "@shared/schema";
import { db } from "../../db";

export type ArtworkReadPurpose = "order" | "proofing" | "prepress" | "production" | "print_ticket";
export type ArtworkResolutionSource =
  | "canonical"
  | "legacy_order_attachment"
  | "legacy_asset_link"
  | "legacy_line_item_file";

export type ResolvedLineItemArtwork = {
  id: string;
  relationshipId: string | null;
  lineItemId: string;
  orderId: string;
  fileRecordId: string | null;
  role: "customer_source" | "production" | "modified_production" | "legacy";
  status: "current" | "superseded" | "legacy";
  side: "front" | "back" | "both" | "unknown";
  origin: string;
  parentArtworkId: string | null;
  supersedesArtworkId: string | null;
  allocationQuantity: number | null;
  allocationGroupId: string | null;
  source: ArtworkResolutionSource;
  legacyState: "resolved" | "unavailable" | null;
  file: {
    originalFilename: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    /** Internal clients use this canonical authenticated endpoint, never a raw object URL. */
    contentPath: string | null;
  };
};

export type ResolvedProductionArtworkProjection = {
  id: string;
  lineItemId: string;
  fileRecordId: string | null;
  role: "original" | "final" | "reference";
  status: "active" | "retired" | "superseded";
  side: "front" | "back" | "both" | "unknown";
  productionQuantity: number | null;
  productionGroupId: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
};

export type LineItemArtworkResolution = {
  artwork: ResolvedLineItemArtwork[];
  /** `lineItemFiles` remains authoritative for active production allocation. */
  production: ResolvedProductionArtworkProjection[];
  usedFallback: boolean;
};

const telemetry = new Map<string, number>();
const telemetryLastLoggedAt = new Map<string, number>();

function recordResolution(kind: string, organizationId: string, count: number) {
  if (!count) return;
  telemetry.set(kind, (telemetry.get(kind) ?? 0) + count);
  if (process.env.ARTWORK_RESOLVER_OBSERVABILITY !== "1") return;
  const key = `${organizationId}:${kind}`;
  const now = Date.now();
  if ((telemetryLastLoggedAt.get(key) ?? 0) + 60_000 > now) return;
  telemetryLastLoggedAt.set(key, now);
  console.info("[ArtworkResolver] resolution", { organizationId, kind, count });
}

export function getArtworkResolverObservabilitySnapshot(): Record<string, number> {
  return Object.fromEntries(telemetry.entries());
}

function canonicalContentPath(fileRecordId: string | null): string | null {
  return fileRecordId ? `/api/artwork/file-records/${encodeURIComponent(fileRecordId)}/content` : null;
}

function toSide(value: unknown): ResolvedLineItemArtwork["side"] {
  return value === "front" || value === "back" || value === "both" ? value : "unknown";
}

function roleRank(purpose: ArtworkReadPurpose, role: ResolvedLineItemArtwork["role"]): number {
  if (purpose === "production" || purpose === "prepress") {
    return role === "modified_production" ? 0 : role === "production" ? 1 : role === "customer_source" ? 2 : 3;
  }
  return role === "customer_source" ? 0 : role === "modified_production" ? 1 : role === "production" ? 2 : 3;
}

/**
 * Canonical-preferred line-item artwork read boundary. Legacy tables are read
 * only for line items with no current canonical relationship; production files
 * are returned separately so they retain allocation authority during transition.
 */
export class LineItemArtworkReadResolver {
  constructor(private readonly executor: any = db) {}

  async resolveForLineItem(args: { organizationId: string; lineItemId: string; purpose: ArtworkReadPurpose }, executor = this.executor) {
    const resolved = await this.resolveForLineItems({ ...args, lineItemIds: [args.lineItemId] }, executor);
    return resolved.get(args.lineItemId) ?? { artwork: [], production: [], usedFallback: false };
  }

  async resolveForLineItems(args: { organizationId: string; lineItemIds: string[]; purpose: ArtworkReadPurpose }, executor = this.executor): Promise<Map<string, LineItemArtworkResolution>> {
    const lineItemIds = Array.from(new Set(args.lineItemIds.filter((id): id is string => typeof id === "string" && id.length > 0)));
    const output = new Map<string, LineItemArtworkResolution>();
    for (const lineItemId of lineItemIds) output.set(lineItemId, { artwork: [], production: [], usedFallback: false });
    if (!lineItemIds.length) return output;

    const [canonicalRows, productionRows] = await Promise.all([
      executor
        .select({ relationship: lineItemArtwork, file: fileRecords })
        .from(lineItemArtwork)
        .leftJoin(fileRecords, and(eq(fileRecords.id, lineItemArtwork.fileRecordId), eq(fileRecords.organizationId, args.organizationId)))
        .where(and(
          eq(lineItemArtwork.organizationId, args.organizationId),
          eq(lineItemArtwork.status, "current"),
          inArray(lineItemArtwork.lineItemId, lineItemIds),
        ))
        .orderBy(asc(lineItemArtwork.lineItemId), asc(lineItemArtwork.createdAt), asc(lineItemArtwork.id)),
      executor
        .select({
          id: lineItemFiles.id, lineItemId: lineItemFiles.lineItemId, fileRecordId: lineItemFiles.fileRecordId,
          role: lineItemFiles.role, status: lineItemFiles.status, sourceArtworkSide: lineItemFiles.sourceArtworkSide,
          productionQuantity: lineItemFiles.productionQuantity, productionGroupId: lineItemFiles.productionGroupId,
          originalFilename: lineItemFiles.originalFilename, mimeType: lineItemFiles.mimeType, sizeBytes: lineItemFiles.sizeBytes,
        })
        .from(lineItemFiles)
        .where(and(eq(lineItemFiles.organizationId, args.organizationId), inArray(lineItemFiles.lineItemId, lineItemIds), eq(lineItemFiles.status, "active")))
        .orderBy(asc(lineItemFiles.lineItemId), desc(lineItemFiles.createdAt), desc(lineItemFiles.id)),
    ]);

    const canonicalLineItemIds = new Set<string>();
    for (const row of canonicalRows) {
      const relationship = row.relationship;
      canonicalLineItemIds.add(relationship.lineItemId);
      output.get(relationship.lineItemId)?.artwork.push({
        id: relationship.id,
        relationshipId: relationship.id,
        lineItemId: relationship.lineItemId,
        orderId: relationship.orderId,
        fileRecordId: relationship.fileRecordId,
        role: relationship.role,
        status: relationship.status,
        side: relationship.side,
        origin: relationship.origin,
        parentArtworkId: relationship.parentArtworkId,
        supersedesArtworkId: relationship.supersedesArtworkId,
        allocationQuantity: relationship.allocationQuantity,
        allocationGroupId: relationship.allocationGroupId,
        source: "canonical",
        legacyState: null,
        file: {
          originalFilename: row.file?.originalFilename ?? null,
          mimeType: row.file?.mimeType ?? null,
          sizeBytes: row.file?.sizeBytes ?? null,
          contentPath: canonicalContentPath(relationship.fileRecordId),
        },
      });
    }

    for (const row of productionRows) {
      const target = output.get(row.lineItemId);
      if (!target) continue;
      target.production.push({
        id: row.id, lineItemId: row.lineItemId, fileRecordId: row.fileRecordId ?? null,
        role: row.role, status: row.status, side: toSide(row.sourceArtworkSide),
        productionQuantity: row.productionQuantity ?? null, productionGroupId: row.productionGroupId ?? null,
        originalFilename: row.originalFilename ?? null, mimeType: row.mimeType ?? null, sizeBytes: row.sizeBytes ?? null,
      });
    }

    const fallbackLineItemIds = lineItemIds.filter((id) => !canonicalLineItemIds.has(id));
    if (fallbackLineItemIds.length) await this.addLegacyFallbacks(args, fallbackLineItemIds, output, executor);

    for (const resolution of Array.from(output.values())) {
      resolution.artwork.sort((left, right) => roleRank(args.purpose, left.role) - roleRank(args.purpose, right.role) || left.id.localeCompare(right.id));
    }
    recordResolution("canonical", args.organizationId, canonicalRows.length);
    recordResolution("legacy_fallback", args.organizationId, fallbackLineItemIds.filter((id) => output.get(id)?.usedFallback).length);
    recordResolution("unavailable_legacy", args.organizationId, fallbackLineItemIds.filter((id) => !output.get(id)?.usedFallback).length);
    return output;
  }

  private async addLegacyFallbacks(args: { organizationId: string; purpose: ArtworkReadPurpose }, lineItemIds: string[], output: Map<string, LineItemArtworkResolution>, executor: any) {
    const [attachmentRows, assetRows, fileRows] = await Promise.all([
      executor.select({ attachment: orderAttachments, orderId: orders.id })
        .from(orderAttachments).innerJoin(orders, eq(orders.id, orderAttachments.orderId))
        .where(and(eq(orders.organizationId, args.organizationId), inArray(orderAttachments.orderLineItemId, lineItemIds), ne(orderAttachments.role, "proof")))
        .orderBy(desc(orderAttachments.isPrimary), desc(orderAttachments.createdAt), desc(orderAttachments.id)),
      executor.select({ link: assetLinks, asset: assets, orderId: orders.id })
        .from(assetLinks).innerJoin(assets, eq(assets.id, assetLinks.assetId))
        .innerJoin(orderLineItems, eq(orderLineItems.id, assetLinks.parentId)).innerJoin(orders, eq(orders.id, orderLineItems.orderId))
        .where(and(eq(assetLinks.organizationId, args.organizationId), eq(assets.organizationId, args.organizationId), eq(orders.organizationId, args.organizationId), eq(assetLinks.parentType, "order_line_item"), inArray(assetLinks.parentId, lineItemIds), ne(assetLinks.role, "proof")))
        .orderBy(desc(assetLinks.createdAt), desc(assetLinks.id)),
      executor.select().from(lineItemFiles)
        .where(and(eq(lineItemFiles.organizationId, args.organizationId), inArray(lineItemFiles.lineItemId, lineItemIds), eq(lineItemFiles.status, "active")))
        .orderBy(desc(lineItemFiles.createdAt), desc(lineItemFiles.id)),
    ]);

    for (const row of attachmentRows) {
      const attachment = row.attachment;
      if (!attachment.orderLineItemId) continue;
      this.addFallback(output, attachment.orderLineItemId, {
        id: `attachment:${attachment.id}`, relationshipId: null, lineItemId: attachment.orderLineItemId, orderId: attachment.orderId,
        fileRecordId: attachment.fileRecordId ?? null, role: "legacy", status: "legacy", side: toSide(attachment.side), origin: "legacy_order_attachment",
        parentArtworkId: null, supersedesArtworkId: null, allocationQuantity: attachment.productionQuantity ?? null, allocationGroupId: attachment.productionGroupId ?? null,
        source: "legacy_order_attachment", legacyState: attachment.fileRecordId ? "resolved" : "unavailable",
        file: { originalFilename: attachment.originalFilename ?? attachment.fileName, mimeType: attachment.mimeType ?? null, sizeBytes: attachment.sizeBytes ?? attachment.fileSize ?? null, contentPath: canonicalContentPath(attachment.fileRecordId ?? null) },
      });
    }
    for (const row of assetRows) {
      const link = row.link; const asset = row.asset;
      this.addFallback(output, link.parentId, {
        id: `asset:${asset.id}`, relationshipId: null, lineItemId: link.parentId, orderId: row.orderId,
        fileRecordId: asset.fileRecordId ?? null, role: "legacy", status: "legacy", side: "unknown", origin: "legacy_asset_link",
        parentArtworkId: null, supersedesArtworkId: null, allocationQuantity: null, allocationGroupId: null,
        source: "legacy_asset_link", legacyState: asset.fileRecordId ? "resolved" : "unavailable",
        file: { originalFilename: asset.fileName, mimeType: asset.mimeType ?? null, sizeBytes: asset.sizeBytes ?? null, contentPath: canonicalContentPath(asset.fileRecordId ?? null) },
      });
    }
    for (const file of fileRows) {
      this.addFallback(output, file.lineItemId, {
        id: `line-item-file:${file.id}`, relationshipId: null, lineItemId: file.lineItemId, orderId: file.orderId,
        fileRecordId: file.fileRecordId ?? null, role: "legacy", status: "legacy", side: toSide(file.sourceArtworkSide), origin: "legacy_line_item_file",
        parentArtworkId: null, supersedesArtworkId: null, allocationQuantity: file.productionQuantity ?? null, allocationGroupId: file.productionGroupId ?? null,
        source: "legacy_line_item_file", legacyState: file.fileRecordId ? "resolved" : "unavailable",
        file: { originalFilename: file.originalFilename ?? null, mimeType: file.mimeType ?? null, sizeBytes: file.sizeBytes ?? null, contentPath: canonicalContentPath(file.fileRecordId ?? null) },
      });
    }
  }

  private addFallback(output: Map<string, LineItemArtworkResolution>, lineItemId: string, record: ResolvedLineItemArtwork) {
    const target = output.get(lineItemId);
    if (!target) return;
    const identity = record.fileRecordId ?? record.id;
    if (target.artwork.some((existing) => (existing.fileRecordId ?? existing.id) === identity)) return;
    target.artwork.push(record);
    target.usedFallback = true;
  }
}

export const lineItemArtworkReadResolver = new LineItemArtworkReadResolver();
