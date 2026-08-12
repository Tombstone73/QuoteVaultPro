import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  fileRecords,
  lineItemArtwork,
  lineItemFiles,
} from "@shared/schema";
import { db } from "../../db";

export type ArtworkReadPurpose = "order" | "proofing" | "prepress" | "production" | "print_ticket" | "portal" | "production_run";

export type ResolvedLineItemArtwork = {
  id: string;
  relationshipId: string;
  lineItemId: string;
  orderId: string;
  fileRecordId: string;
  role: "customer_source" | "production" | "modified_production";
  status: "current" | "superseded";
  side: "front" | "back" | "both" | "unknown";
  origin: string;
  parentArtworkId: string | null;
  supersedesArtworkId: string | null;
  createdAt: Date;
  allocationQuantity: number | null;
  allocationGroupId: string | null;
  source: "canonical";
  file: {
    originalFilename: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    /** Internal consumers use this authenticated endpoint, never an object-store URL. */
    contentPath: string;
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
  /** Canonical ordinary-artwork ownership only. Empty is a normal, soft failure. */
  artwork: ResolvedLineItemArtwork[];
  /** `lineItemFiles` remains allocation/workflow projection authority only. */
  production: ResolvedProductionArtworkProjection[];
  unavailable: boolean;
};

function canonicalContentPath(fileRecordId: string): string {
  return `/api/artwork/file-records/${encodeURIComponent(fileRecordId)}/content`;
}

function toSide(value: unknown): ResolvedProductionArtworkProjection["side"] {
  return value === "front" || value === "back" || value === "both" ? value : "unknown";
}

function roleRank(purpose: ArtworkReadPurpose, role: ResolvedLineItemArtwork["role"]): number {
  if (purpose === "production" || purpose === "prepress" || purpose === "production_run") {
    return role === "modified_production" ? 0 : role === "production" ? 1 : 2;
  }
  return role === "customer_source" ? 0 : role === "modified_production" ? 1 : 2;
}

/**
 * Canonical-only ordinary artwork ownership boundary. It never reconstructs
 * ownership from legacy attachments, assets, or line-item workflow files.
 */
export class LineItemArtworkReadResolver {
  constructor(private readonly executor: any = db) {}

  async resolveForLineItem(args: { organizationId: string; lineItemId: string; purpose: ArtworkReadPurpose }, executor = this.executor) {
    const resolved = await this.resolveForLineItems({ ...args, lineItemIds: [args.lineItemId] }, executor);
    return resolved.get(args.lineItemId) ?? { artwork: [], production: [], unavailable: true };
  }

  async resolveForLineItems(args: { organizationId: string; lineItemIds: string[]; purpose: ArtworkReadPurpose }, executor = this.executor): Promise<Map<string, LineItemArtworkResolution>> {
    const lineItemIds = Array.from(new Set(args.lineItemIds.filter((id): id is string => typeof id === "string" && id.length > 0)));
    const output = new Map<string, LineItemArtworkResolution>();
    for (const lineItemId of lineItemIds) output.set(lineItemId, { artwork: [], production: [], unavailable: true });
    if (!lineItemIds.length) return output;

    const [canonicalRows, productionRows] = await Promise.all([
      executor
        .select({ relationship: lineItemArtwork, file: fileRecords })
        .from(lineItemArtwork)
        .innerJoin(fileRecords, and(eq(fileRecords.id, lineItemArtwork.fileRecordId), eq(fileRecords.organizationId, args.organizationId)))
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

    for (const row of canonicalRows) {
      const relationship = row.relationship;
      const target = output.get(relationship.lineItemId);
      if (!target) continue;
      target.unavailable = false;
      target.artwork.push({
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
        createdAt: relationship.createdAt,
        allocationQuantity: relationship.allocationQuantity,
        allocationGroupId: relationship.allocationGroupId,
        source: "canonical",
        file: {
          originalFilename: row.file.originalFilename,
          mimeType: row.file.mimeType,
          sizeBytes: row.file.sizeBytes,
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

    for (const resolution of Array.from(output.values())) {
      resolution.artwork.sort((left, right) => roleRank(args.purpose, left.role) - roleRank(args.purpose, right.role) || left.id.localeCompare(right.id));
    }
    return output;
  }
}

export const lineItemArtworkReadResolver = new LineItemArtworkReadResolver();
