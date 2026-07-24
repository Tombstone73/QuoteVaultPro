import { jest } from "@jest/globals";

const { db } = await import("../db");
const { CustomerUploadReviewError, reviewCustomerUpload } = await import("../services/customerUploadReview.service");

function selectRows(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

function pendingOrderAttachment() {
  return {
    id: "attachment_1",
    orderId: "order_1",
    portalFileCategory: "customer_upload",
    customerUploadReviewStatus: "pending_review",
    originalFilename: "customer-art.pdf",
    fileName: "customer-art.pdf",
    role: "reference",
    isPrimary: false,
  };
}

describe("customer upload staff review service", () => {
  afterEach(() => jest.restoreAllMocks());

  test("accepts an order upload as non-primary artwork without changing workflow", async () => {
    const writes: Array<{ kind: string; values: Record<string, unknown> }> = [];
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1" }]))
        .mockReturnValueOnce(selectRows([pendingOrderAttachment()])),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          writes.push({ kind: "update", values });
          return { where: () => ({ returning: async () => [{ ...pendingOrderAttachment(), ...values }]) };
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

    await reviewCustomerUpload({
      organizationId: "org_1", entityType: "order", entityId: "order_1", attachmentId: "attachment_1",
      status: "accepted", promotion: "artwork", actorUserId: "staff_1", actorUserName: "Staff", reviewNote: "Looks good.",
    });

    expect(writes[0]).toMatchObject({ kind: "update", values: { customerUploadReviewStatus: "accepted", role: "artwork", isPrimary: false } });
    expect(writes[1]).toMatchObject({ kind: "audit", values: { actionType: "customer_upload.reviewed", newValues: expect.objectContaining({ finalArtwork: false, workflowStateChanged: false }) } });
  });

  test("rejects cross-organization entity access before it can read or update an attachment", async () => {
    const tx = { select: jest.fn().mockReturnValueOnce(selectRows([])), update: jest.fn(), insert: jest.fn() };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await expect(reviewCustomerUpload({
      organizationId: "other_org", entityType: "order", entityId: "order_1", attachmentId: "attachment_1",
      status: "rejected", actorUserId: "staff_1", actorUserName: "Staff",
    })).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 404 });
    expect(tx.update).not.toHaveBeenCalled();
  });

  test("does not allow quote uploads to be promoted as artwork", async () => {
    await expect(reviewCustomerUpload({
      organizationId: "org_1", entityType: "quote", entityId: "quote_1", attachmentId: "attachment_1",
      status: "accepted", promotion: "artwork", actorUserId: "staff_1", actorUserName: "Staff",
    })).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 400 });
  });
});
