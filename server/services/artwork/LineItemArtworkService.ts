import type { InsertLineItemArtwork, LineItemArtwork } from "@shared/schema";
import { lineItemArtworkRepository, type LineItemArtworkRepository, type TenantLineItem } from "../../storage/lineItemArtwork.repo";

export class LineItemArtworkError extends Error {
  constructor(public readonly statusCode: 404 | 409 | 422, message: string) {
    super(message);
    this.name = "LineItemArtworkError";
  }
}

type ArtworkStore = Pick<
  LineItemArtworkRepository,
  "transaction" | "getLineItemForOrganization" | "hasFileRecordForOrganization" | "getByIdForOrganization" | "listByLineItem" | "create" | "markSuperseded"
>;

export type AttachLineItemArtworkInput = {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  fileRecordId: string;
  role: LineItemArtwork["role"];
  side?: LineItemArtwork["side"];
  allocationQuantity?: number | null;
  allocationGroupId?: string | null;
  origin: LineItemArtwork["origin"];
  parentArtworkId?: string | null;
  supersedesArtworkId?: string | null;
  actorUserId?: string | null;
};

export class LineItemArtworkService {
  constructor(private readonly store: ArtworkStore = lineItemArtworkRepository) {}

  async getLineItemArtwork(organizationId: string, lineItemId: string): Promise<LineItemArtwork[]> {
    return this.store.listByLineItem(organizationId, lineItemId);
  }

  async getCurrentArtwork(args: {
    organizationId: string;
    lineItemId: string;
    role?: LineItemArtwork["role"];
    side?: LineItemArtwork["side"];
  }): Promise<LineItemArtwork[]> {
    const relationships = await this.store.listByLineItem(args.organizationId, args.lineItemId, { currentOnly: true });
    return relationships.filter((relationship) =>
      (!args.role || relationship.role === args.role) &&
      (!args.side || relationship.side === args.side),
    );
  }

  async attachArtwork(input: AttachLineItemArtworkInput): Promise<LineItemArtwork> {
    return this.store.transaction(async (tx, repository) => this.attachArtworkInTransaction(repository, tx, input));
  }

  async createModifiedArtworkVersion(input: Omit<AttachLineItemArtworkInput, "role" | "origin"> & {
    parentArtworkId: string;
  }): Promise<LineItemArtwork> {
    return this.store.transaction(async (tx, repository) => {
      const created = await this.attachArtworkInTransaction(repository, tx, {
        ...input,
        role: "modified_production",
        origin: "modified_copy",
      });
      if (input.supersedesArtworkId) {
        await this.supersedeArtworkInTransaction(repository, tx, {
          organizationId: input.organizationId,
          artworkId: input.supersedesArtworkId,
          replacementArtworkId: created.id,
          actorUserId: input.actorUserId ?? null,
        });
      }
      return created;
    });
  }

  async supersedeArtwork(args: {
    organizationId: string;
    artworkId: string;
    replacementArtworkId: string;
    actorUserId?: string | null;
  }): Promise<LineItemArtwork> {
    return this.store.transaction(async (tx, repository) => this.supersedeArtworkInTransaction(repository, tx, args));
  }

  private async attachArtworkInTransaction(repository: ArtworkStore, tx: any, input: AttachLineItemArtworkInput): Promise<LineItemArtwork> {
    if (!["customer_source", "production", "modified_production"].includes(input.role)) {
      throw new LineItemArtworkError(422, "Generated workflow artifacts are not line-item artwork.");
    }
    const lineItem = await repository.getLineItemForOrganization(input.organizationId, input.lineItemId, tx);
    this.assertLineItemMatchesOrder(lineItem, input.orderId);
    if (!await repository.hasFileRecordForOrganization(input.organizationId, input.fileRecordId, tx)) {
      throw new LineItemArtworkError(404, "Artwork file record is not available to this organization.");
    }

    const parent = input.parentArtworkId
      ? await this.getArtworkForSameLine(repository, tx, input.organizationId, input.lineItemId, input.parentArtworkId)
      : null;
    const superseded = input.supersedesArtworkId
      ? await this.getArtworkForSameLine(repository, tx, input.organizationId, input.lineItemId, input.supersedesArtworkId)
      : null;

    if (input.role === "modified_production") {
      if (!parent) throw new LineItemArtworkError(422, "Modified artwork must identify its parent artwork relationship.");
      if (parent.fileRecordId === input.fileRecordId) {
        throw new LineItemArtworkError(422, "Modified artwork must reference a new physical file record.");
      }
    }
    if (superseded && superseded.status !== "current") {
      throw new LineItemArtworkError(409, "Only current artwork can be superseded.");
    }

    return repository.create({
      organizationId: input.organizationId,
      orderId: input.orderId,
      lineItemId: input.lineItemId,
      fileRecordId: input.fileRecordId,
      role: input.role,
      status: "current",
      side: input.side ?? "unknown",
      allocationQuantity: input.allocationQuantity ?? null,
      allocationGroupId: input.allocationGroupId ?? null,
      origin: input.origin,
      parentArtworkId: input.parentArtworkId ?? null,
      supersedesArtworkId: input.supersedesArtworkId ?? null,
      createdByUserId: input.actorUserId ?? null,
    } satisfies InsertLineItemArtwork, tx);
  }

  private async supersedeArtworkInTransaction(repository: ArtworkStore, tx: any, args: {
    organizationId: string;
    artworkId: string;
    replacementArtworkId: string;
    actorUserId?: string | null;
  }): Promise<LineItemArtwork> {
    const existing = await repository.getByIdForOrganization(args.organizationId, args.artworkId, tx);
    const replacement = await repository.getByIdForOrganization(args.organizationId, args.replacementArtworkId, tx);
    if (!existing || !replacement || existing.lineItemId !== replacement.lineItemId || existing.orderId !== replacement.orderId) {
      throw new LineItemArtworkError(404, "Artwork relationship is not available for this line item.");
    }
    if (existing.status !== "current" || replacement.status !== "current") {
      throw new LineItemArtworkError(409, "Only current artwork relationships can participate in supersession.");
    }
    const superseded = await repository.markSuperseded(args.organizationId, existing.id, args.actorUserId ?? null, tx);
    if (!superseded) throw new LineItemArtworkError(409, "Artwork was already superseded.");
    return superseded;
  }

  private assertLineItemMatchesOrder(lineItem: TenantLineItem | null, orderId: string): asserts lineItem is TenantLineItem {
    if (!lineItem || lineItem.orderId !== orderId) {
      throw new LineItemArtworkError(404, "Order line item is not available to this organization.");
    }
  }

  private async getArtworkForSameLine(repository: ArtworkStore, tx: any, organizationId: string, lineItemId: string, artworkId: string): Promise<LineItemArtwork> {
    const artwork = await repository.getByIdForOrganization(organizationId, artworkId, tx);
    if (!artwork || artwork.lineItemId !== lineItemId) {
      throw new LineItemArtworkError(404, "Parent artwork relationship is not available for this line item.");
    }
    return artwork;
  }
}

export const lineItemArtworkService = new LineItemArtworkService();
