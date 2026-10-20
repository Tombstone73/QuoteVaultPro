import { selectCurrentOrderPreviewAttachments } from "../services/orders/orderListArtworkProjection";

const attachment = (
  id: string,
  fileRecordId: string,
  orderLineItemId: string | null,
  linkedLineStatus: string | null,
  linkedLineItemId: string | null = orderLineItemId,
) => ({ id, orderId: "order-a", fileRecordId, orderLineItemId, linkedLineItemId, linkedLineStatus });

describe("current Order list artwork", () => {
  it("omits both files on a canceled line while retaining the active banner", () => {
    const rows = [
      attachment("old-1", "file-1", "removed-line", "canceled"),
      attachment("old-2", "file-2", "removed-line", "canceled"),
      attachment("banner", "file-3", "active-line", "in_production"),
    ];

    expect(selectCurrentOrderPreviewAttachments(rows).map((row) => row.id)).toEqual(["banner"]);
  });

  it("keeps a shared file through its active association and keeps Order-level files", () => {
    const rows = [
      attachment("removed-copy", "shared", "removed-line", "canceled"),
      attachment("active-copy", "shared", "active-line", "new"),
      attachment("duplicate-copy", "shared", "active-line", "new"),
      attachment("order-file", "order-only", null, null, null),
      attachment("orphan-link", "orphan", "missing-line", null, null),
    ];

    expect(selectCurrentOrderPreviewAttachments(rows).map((row) => row.id)).toEqual(["active-copy", "order-file"]);
  });
});
