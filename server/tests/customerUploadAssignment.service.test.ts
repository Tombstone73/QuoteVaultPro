import { jest } from "@jest/globals";

const { db } = await import("../db");
const { CustomerUploadReviewError, assignPromotedCustomerUpload } = await import("../services/customerUploadReview.service");

function selectRows(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

function promotedArtworkAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: "attachment_1",
    orderId: "order_1",
    orderLineItemId: null,
    portalFileCategory: "customer_upload",
    customerUploadReviewStatus: "accepted",
    customerUploadPromotionType: "artwork",
    customerUploadAssignmentType: null,
    customerUploadAssignedToOrderLineItemId: null,
    originalFilename: "customer-art.pdf",
    fileName: "customer-art.pdf",
    role: "artwork",
    side: "na",
    isPrimary: false,
    ...overrides,
  };
}

describe("promoted customer upload line-item assignment service", () => {
  afterEach(() => jest.restoreAllMocks());

  test("assigns a promoted artwork reference without entering the artwork-side workflow", async () => {
    const writes: Array<{ kind: string; values: Record<string, unknown> }> = [];
    const attachment = promotedArtworkAttachment();
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

    await assignPromotedCustomerUpload({
      organizationId: "org_1",
      sourceOrderId: "order_1",
      targetOrderId: "order_1",
      targetLineItemId: "line_1",
      attachmentId: "attachment_1",
      assignmentType: "reference_for_line_item",
      assignmentNote: "Use as a customer reference only.",
      actorUserId: "staff_1",
      actorUserName: "Staff",
    });

    expect(writes[0]).toMatchObject({
      kind: "update",
      values: {
        customerUploadAssignedToOrderLineItemId: "line_1",
        customerUploadAssignmentType: "reference_for_line_item",
        customerUploadAssignedByUserId: "staff_1",
      },
    });
    for (const forbiddenField of ["orderLineItemId", "role", "side", "isPrimary", "customerUploadPromotionType"]) {
      expect(writes[0]?.values).not.toHaveProperty(forbiddenField);
    }
    expect(writes[1]).toMatchObject({
      kind: "audit",
      values: {
        actionType: "customer_upload.assigned",
        newValues: expect.objectContaining({
          actorUserId: "staff_1",
          sourceUploadId: "attachment_1",
          targetOrderId: "order_1",
          targetLineItemId: "line_1",
          assignmentType: "reference_for_line_item",
          outcome: "assigned",
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
    ["pending", promotedArtworkAttachment({ customerUploadReviewStatus: "pending_review" })],
    ["rejected", promotedArtworkAttachment({ customerUploadReviewStatus: "rejected" })],
    ["unpromoted", promotedArtworkAttachment({ customerUploadPromotionType: null })],
    ["approved-reference", promotedArtworkAttachment({ customerUploadPromotionType: "reference" })],
  ])("rejects %s customer uploads before assignment", async (_label, attachment) => {
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

    await expect(assignPromotedCustomerUpload({
      organizationId: "org_1", sourceOrderId: "order_1", targetOrderId: "order_1", targetLineItemId: "line_1",
      attachmentId: "attachment_1", assignmentType: "reference_for_line_item", actorUserId: "staff_1", actorUserName: "Staff",
    })).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 409 });
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

    await expect(assignPromotedCustomerUpload({
      organizationId: "org_1", sourceOrderId: "order_1", targetOrderId: "order_2", targetLineItemId: "line_2",
      attachmentId: "attachment_1", assignmentType: "reference_for_line_item", actorUserId: "staff_1", actorUserName: "Staff",
    })).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 404 });
    expect(tx.select).toHaveBeenCalledTimes(2);
    expect(tx.update).not.toHaveBeenCalled();
  });
});
