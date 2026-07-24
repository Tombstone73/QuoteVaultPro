import { jest } from "@jest/globals";

const { db } = await import("../db");
const { CustomerUploadReviewError, promoteCustomerUpload, reviewCustomerUpload } = await import("../services/customerUploadReview.service");

function selectRows(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

function customerUpload(status: "pending_review" | "accepted" | "rejected" = "pending_review", promotion: "reference" | "artwork" | null = null) {
  return {
    id: "attachment_1",
    orderId: "order_1",
    portalFileCategory: "customer_upload",
    customerUploadReviewStatus: status,
    customerUploadPromotionType: promotion,
    originalFilename: "customer-art.pdf",
    fileName: "customer-art.pdf",
    role: "reference",
    isPrimary: false,
  };
}

describe("customer upload staff review and promotion service", () => {
  afterEach(() => jest.restoreAllMocks());

  test("accepts an order upload without promoting or changing workflow", async () => {
    const writes: Array<{ kind: string; values: Record<string, unknown> }> = [];
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1" }]))
        .mockReturnValueOnce(selectRows([customerUpload()])),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          writes.push({ kind: "update", values });
          return { where: () => ({ returning: async () => [{ ...customerUpload(), ...values }]) };
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
      status: "accepted", actorUserId: "staff_1", actorUserName: "Staff", reviewNote: "Looks good.",
    });

    expect(writes[0]).toMatchObject({ kind: "update", values: { customerUploadReviewStatus: "accepted" } });
    expect(writes[0]?.values).not.toHaveProperty("role");
    expect(writes[0]?.values).not.toHaveProperty("isPrimary");
    expect(writes[1]).toMatchObject({ kind: "audit", values: { actionType: "customer_upload.reviewed", newValues: expect.objectContaining({ promotion: null, finalArtwork: false, workflowStateChanged: false }) } });
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

  test("promotes an accepted order upload as non-primary artwork reference with a complete audit record", async () => {
    const writes: Array<{ kind: string; values: Record<string, unknown> }> = [];
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1" }]))
        .mockReturnValueOnce(selectRows([customerUpload("accepted")])),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          writes.push({ kind: "update", values });
          return { where: () => ({ returning: async () => [{ ...customerUpload("accepted"), ...values }]) };
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

    await promoteCustomerUpload({
      organizationId: "org_1", entityType: "order", entityId: "order_1", attachmentId: "attachment_1",
      promotion: "artwork", actorUserId: "staff_1", actorUserName: "Staff",
    });

    expect(writes[0]).toMatchObject({ kind: "update", values: { customerUploadPromotionType: "artwork", role: "artwork", isPrimary: false } });
    expect(writes[0]?.values).not.toHaveProperty("orderLineItemId");
    expect(writes[0]?.values).not.toHaveProperty("customerUploadReviewStatus");
    expect(writes[1]).toMatchObject({
      kind: "audit",
      values: {
        actionType: "customer_upload.promoted",
        newValues: expect.objectContaining({
          actorUserId: "staff_1", sourceUploadId: "attachment_1", targetEntityType: "order", targetEntityId: "order_1",
          promotionType: "artwork", outcome: "promoted", finalArtwork: false, workflowStateChanged: false,
          prepressChanged: false, proofChanged: false, productionChanged: false, billingChanged: false, paymentChanged: false,
        }),
      },
    });
  });

  test.each(["pending_review", "rejected"] as const)("rejects %s uploads before promotion", async (status) => {
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1" }]))
        .mockReturnValueOnce(selectRows([customerUpload(status)])),
      update: jest.fn(), insert: jest.fn(),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await expect(promoteCustomerUpload({
      organizationId: "org_1", entityType: "order", entityId: "order_1", attachmentId: "attachment_1",
      promotion: "reference", actorUserId: "staff_1", actorUserName: "Staff",
    })).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 409 });
    expect(tx.update).not.toHaveBeenCalled();
  });

  test("promotes an accepted quote upload only as an approved reference", async () => {
    const writes: Array<{ kind: string; values: Record<string, unknown> }> = [];
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "quote_1" }]))
        .mockReturnValueOnce(selectRows([{ ...customerUpload("accepted"), quoteId: "quote_1" }])),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          writes.push({ kind: "update", values });
          return { where: () => ({ returning: async () => [{ ...customerUpload("accepted"), quoteId: "quote_1", ...values }]) };
        },
      }),
      insert: () => ({ values: (values: Record<string, unknown>) => { writes.push({ kind: "audit", values }); return values; } }),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await promoteCustomerUpload({
      organizationId: "org_1", entityType: "quote", entityId: "quote_1", attachmentId: "attachment_1",
      promotion: "reference", actorUserId: "staff_1", actorUserName: "Staff",
    });

    expect(writes[0]).toMatchObject({ kind: "update", values: { customerUploadPromotionType: "reference" } });
    expect(writes[0]?.values).not.toHaveProperty("role");
    expect(writes[1]).toMatchObject({ kind: "audit", values: { actionType: "customer_upload.promoted", newValues: expect.objectContaining({ targetEntityType: "quote", promotionType: "reference", finalArtwork: false }) } });
  });

  test("does not allow quote uploads to be promoted as artwork", async () => {
    await expect(promoteCustomerUpload({
      organizationId: "org_1", entityType: "quote", entityId: "quote_1", attachmentId: "attachment_1",
      promotion: "artwork", actorUserId: "staff_1", actorUserName: "Staff",
    })).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 400 });
  });
});
