import { jest } from "@jest/globals";

const { db } = await import("../db");
const { CustomerUploadReviewError, selectAssignedCustomerUploadForArtwork } = await import("../services/customerUploadReview.service");

function selectRows(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

function assignedArtworkReference(overrides: Record<string, unknown> = {}) {
  return {
    id: "attachment_1",
    orderId: "order_1",
    orderLineItemId: null,
    portalFileCategory: "customer_upload",
    customerUploadReviewStatus: "accepted",
    customerUploadPromotionType: "artwork",
    customerUploadAssignmentType: "reference_for_line_item",
    customerUploadAssignedToOrderLineItemId: "line_1",
    customerUploadArtworkSelectionType: null,
    originalFilename: "customer-art.pdf",
    fileName: "customer-art.pdf",
    role: "artwork",
    side: "na",
    isPrimary: false,
    ...overrides,
  };
}

const input = {
  organizationId: "org_1",
  sourceOrderId: "order_1",
  targetOrderId: "order_1",
  targetLineItemId: "line_1",
  attachmentId: "attachment_1",
  artworkSelectionType: "artwork_side_intake" as const,
  artworkSelectionNote: "Make this available to the line-item artwork controls.",
  actorUserId: "staff_1",
  actorUserName: "Staff",
};

describe("assigned customer upload artwork-side selection service", () => {
  afterEach(() => jest.restoreAllMocks());

  test("makes an assigned artwork reference available to existing line-item artwork controls without selecting side or final art", async () => {
    const writes: Array<{ kind: string; values: Record<string, unknown> }> = [];
    const attachment = assignedArtworkReference();
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "line_1" }]))
        .mockReturnValueOnce(selectRows([attachment])),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          writes.push({ kind: "update", values });
          return { where: () => ({ returning: async () => [{ ...attachment, ...values }]) };
        },
      }),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          writes.push({ kind: "audit", values });
          return values;
        },
      }),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await selectAssignedCustomerUploadForArtwork(input);

    expect(writes[0]).toMatchObject({
      kind: "update",
      values: {
        orderLineItemId: "line_1",
        customerUploadArtworkSelectionType: "artwork_side_intake",
        customerUploadArtworkSelectedByUserId: "staff_1",
      },
    });
    for (const forbiddenField of ["role", "side", "isPrimary", "customerUploadPromotionType", "customerUploadReviewStatus"]) {
      expect(writes[0]?.values).not.toHaveProperty(forbiddenField);
    }
    expect(writes[1]).toMatchObject({
      kind: "audit",
      values: {
        actionType: "customer_upload.artwork_side_selected",
        newValues: expect.objectContaining({
          actorUserId: "staff_1",
          sourceAttachmentId: "attachment_1",
          targetOrderId: "order_1",
          targetLineItemId: "line_1",
          artworkSideAction: "artwork_side_intake",
          outcome: "selected_for_artwork_side_intake",
          finalArtwork: false,
          primaryArtworkChanged: false,
          workflowStateChanged: false,
          prepressChanged: false,
          proofChanged: false,
          productionChanged: false,
          billingChanged: false,
          paymentChanged: false,
          epsChanged: false,
        }),
      },
    });
  });

  test.each([
    ["pending", assignedArtworkReference({ customerUploadReviewStatus: "pending_review" })],
    ["rejected", assignedArtworkReference({ customerUploadReviewStatus: "rejected" })],
    ["accepted-only", assignedArtworkReference({ customerUploadPromotionType: null })],
    ["approved-reference", assignedArtworkReference({ customerUploadPromotionType: "reference" })],
    ["unassigned", assignedArtworkReference({ customerUploadAssignmentType: null, customerUploadAssignedToOrderLineItemId: null })],
    ["already-selected", assignedArtworkReference({ customerUploadArtworkSelectionType: "artwork_side_intake" })],
    ["wrong assigned line item", assignedArtworkReference({ customerUploadAssignedToOrderLineItemId: "line_2" })],
    ["not neutral side", assignedArtworkReference({ side: "front" })],
    ["primary artwork", assignedArtworkReference({ isPrimary: true })],
  ])("rejects %s customer uploads before artwork-side selection", async (_label, attachment) => {
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "line_1" }]))
        .mockReturnValueOnce(selectRows([attachment])),
      update: jest.fn(),
      insert: jest.fn(),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await expect(selectAssignedCustomerUploadForArtwork(input)).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 409 });
    expect(tx.update).not.toHaveBeenCalled();
  });

  test("rejects a target order outside the source upload customer scope before reading the line item or attachment", async () => {
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_2", customerId: "customer_2" }])),
      update: jest.fn(),
      insert: jest.fn(),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await expect(selectAssignedCustomerUploadForArtwork({ ...input, targetOrderId: "order_2", targetLineItemId: "line_2" })).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 404 });
    expect(tx.select).toHaveBeenCalledTimes(2);
    expect(tx.update).not.toHaveBeenCalled();
  });
});
