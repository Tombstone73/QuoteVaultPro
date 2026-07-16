import { readFileSync } from "fs";
import { resolve } from "path";
import {
  assignOrderLineItemArtworkSide,
  OrderLineItemArtworkAssignmentError,
  type OrderArtworkSide,
  type OrderLineItemArtworkAssignmentStore,
} from "../services/orderLineItemArtworkAssignmentService";

type Attachment = {
  id: string;
  orderId: string;
  lineItemId: string;
  role: string;
  side: OrderArtworkSide | "na";
  description: string;
  thumbnailUrl: string;
};

function createStore(attachments: Attachment[]): OrderLineItemArtworkAssignmentStore<Attachment> {
  return {
    findOrder: async (organizationId, orderId) => organizationId === "org-1" && orderId === "order-1" ? { id: orderId } : null,
    findLineItem: async (orderId, lineItemId) => orderId === "order-1" && lineItemId === "line-1" ? { id: lineItemId } : null,
    findAttachment: async (orderId, lineItemId, fileId) => attachments.find((file) => (
      file.id === fileId && file.orderId === orderId && file.lineItemId === lineItemId
    )) ?? null,
    clearConflictingSides: async ({ orderId, lineItemId, exceptFileId, sides }) => {
      for (const file of attachments) {
        if (file.orderId === orderId && file.lineItemId === lineItemId && file.id !== exceptFileId && sides.includes(file.side as OrderArtworkSide)) {
          file.side = "na";
        }
      }
    },
    updateAttachmentMetadata: async (fileId, patch) => {
      const file = attachments.find((candidate) => candidate.id === fileId);
      if (!file) return null;
      Object.assign(file, patch);
      return { ...file };
    },
  };
}

describe("order line item artwork assignment", () => {
  it("persists separate Front and Back files without wiping unrelated metadata", async () => {
    const attachments: Attachment[] = [
      { id: "front-file", orderId: "order-1", lineItemId: "line-1", role: "artwork", side: "front", description: "Customer original", thumbnailUrl: "/front.png" },
      { id: "back-file", orderId: "order-1", lineItemId: "line-1", role: "other", side: "na", description: "Keep this description", thumbnailUrl: "/back.png" },
    ];
    const store = createStore(attachments);

    await assignOrderLineItemArtworkSide({
      organizationId: "org-1",
      orderId: "order-1",
      lineItemId: "line-1",
      fileId: "back-file",
      side: "back",
      store,
    });

    expect(attachments).toEqual([
      expect.objectContaining({ id: "front-file", side: "front" }),
      expect.objectContaining({
        id: "back-file",
        role: "artwork",
        side: "back",
        description: "Keep this description",
        thumbnailUrl: "/back.png",
      }),
    ]);
  });

  it("assigns one file to Both atomically and clears competing Front/Back assignments", async () => {
    const attachments: Attachment[] = [
      { id: "shared-file", orderId: "order-1", lineItemId: "line-1", role: "artwork", side: "front", description: "Shared", thumbnailUrl: "/shared.png" },
      { id: "back-file", orderId: "order-1", lineItemId: "line-1", role: "artwork", side: "back", description: "Back", thumbnailUrl: "/back.png" },
    ];

    await assignOrderLineItemArtworkSide({
      organizationId: "org-1",
      orderId: "order-1",
      lineItemId: "line-1",
      fileId: "shared-file",
      side: "both",
      store: createStore(attachments),
    });

    expect(attachments.find((file) => file.id === "shared-file")?.side).toBe("both");
    expect(attachments.find((file) => file.id === "back-file")?.side).toBe("na");
  });

  it("rejects a file that does not belong to the selected line item", async () => {
    const attachments: Attachment[] = [
      { id: "other-line-file", orderId: "order-1", lineItemId: "line-2", role: "artwork", side: "na", description: "Other", thumbnailUrl: "/other.png" },
    ];

    await expect(assignOrderLineItemArtworkSide({
      organizationId: "org-1",
      orderId: "order-1",
      lineItemId: "line-1",
      fileId: "other-line-file",
      side: "front",
      store: createStore(attachments),
    })).rejects.toMatchObject<Partial<OrderLineItemArtworkAssignmentError>>({
      statusCode: 404,
      code: "LINE_ITEM_ARTWORK_NOT_FOUND",
    });
  });

  it("updates the materialized order-attachment ID returned for an asset-only file", async () => {
    let updatedFileId: string | null = null;
    const materialized = {
      id: "order-attachment-1",
      orderId: "order-1",
      lineItemId: "line-1",
      role: "artwork",
      side: "na" as const,
      description: "Asset metadata",
      thumbnailUrl: "/asset.png",
    };
    const store: OrderLineItemArtworkAssignmentStore<Attachment> = {
      findOrder: async () => ({ id: "order-1" }),
      findLineItem: async () => ({ id: "line-1" }),
      findAttachment: async (_orderId, _lineItemId, fileId) => fileId === "asset-1" ? materialized : null,
      clearConflictingSides: async () => undefined,
      updateAttachmentMetadata: async (fileId, patch) => {
        updatedFileId = fileId;
        return { ...materialized, ...patch };
      },
    };

    const updated = await assignOrderLineItemArtworkSide({
      organizationId: "org-1",
      orderId: "order-1",
      lineItemId: "line-1",
      fileId: "asset-1",
      side: "front",
      store,
    });

    expect(updatedFileId).toBe("order-attachment-1");
    expect(updated.side).toBe("front");
  });

  it("registers Both support in the active migrations_v2 stream", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "server/db/migrations_v2/0118_order_attachment_both_side.sql"),
      "utf8",
    );
    const journal = readFileSync(
      resolve(process.cwd(), "server/db/migrations_v2/meta/_journal.json"),
      "utf8",
    );
    expect(migration).toMatch(/ALTER TYPE file_side ADD VALUE IF NOT EXISTS 'both'/i);
    expect(journal).toContain('"tag": "0118_order_attachment_both_side"');
  });
});
