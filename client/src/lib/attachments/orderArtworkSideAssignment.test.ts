import { describe, expect, it, jest } from "@jest/globals";
import { assignOrderLineItemArtworkSide } from "./orderArtworkSideAssignment";
import { normalizeOrderFileRows } from "./orderFileRows";

describe("assignOrderLineItemArtworkSide", () => {
  it("sends one line-item-scoped artwork-side mutation with the stable side value", async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { id: "file-1", side: "both" } }),
    })) as unknown as typeof fetch;

    await assignOrderLineItemArtworkSide({
      orderId: "order/1",
      lineItemId: "line 1",
      fileId: "file-1",
      side: "both",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/orders/order%2F1/line-items/line%201/files/file-1/artwork-side",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify({ side: "both" }),
      }),
    );
  });

  it("surfaces the backend assignment error without changing local query data", async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      json: async () => ({ error: "Artwork file is not attached to this line item" }),
    })) as unknown as typeof fetch;

    await expect(assignOrderLineItemArtworkSide({
      orderId: "order-1",
      lineItemId: "line-1",
      fileId: "wrong-file",
      side: "front",
      fetchImpl,
    })).rejects.toThrow("Artwork file is not attached to this line item");
  });

  it("preserves the persisted side when an asset and its materialized attachment are refetched", () => {
    const normalized = normalizeOrderFileRows(
      [{
        id: "order-attachment-1",
        fileRecordId: "record-1",
        fileName: "customer-art.pdf",
        createdAt: "2026-07-16T12:00:00.000Z",
        side: "both",
      }],
      [{
        id: "asset-1",
        fileRecordId: "record-1",
        fileName: "customer-art.pdf",
        createdAt: "2026-07-16T11:00:00.000Z",
        thumbnailUrl: "/asset-thumb.png",
      }],
    );

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toEqual(expect.objectContaining({
      id: "order-attachment-1",
      source: "attachment",
      side: "both",
      thumbnailUrl: "/asset-thumb.png",
    }));
  });
});
