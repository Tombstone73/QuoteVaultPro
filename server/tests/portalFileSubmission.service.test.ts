import { jest } from "@jest/globals";

const finalizeUpload = jest.fn<(...args: any[]) => Promise<any>>();

jest.unstable_mockModule("../services/storage/StorageApplicationService", () => ({
  storageApplicationService: { finalizeUpload },
}));

const { submitPortalOrderFile } = await import("../services/portal.service");
const { db } = await import("../db");
const dbSelect = jest.spyOn(db, "select");

function selectRows(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

function portalRequest() {
  return {
    user: { id: "portal_user_1", firstName: "Avery", lastName: "Customer" },
    organizationId: "org_1",
    portalCustomerId: "customer_1",
    portalCustomer: {
      id: "customer_1",
      organizationId: "org_1",
      companyName: "Acme Print",
      email: "customer@example.com",
    },
    body: {
      fileName: "../artwork.pdf",
      mimeType: "application/pdf",
      dataBase64: Buffer.from("customer artwork").toString("base64"),
      note: "Use this revision.",
    },
    ip: "127.0.0.1",
    get: jest.fn(() => "portal-test-agent"),
  } as any;
}

describe("portal file submission service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("writes an authorized order submission as a review-needed reference through canonical storage", async () => {
    dbSelect.mockReturnValueOnce(selectRows([{ id: "order_1" }]));
    const writes: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const tx = {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          writes.push({ table, values });
          return {
            returning: async () => [{ id: "attachment_1", ...values }],
          };
        },
      }),
    };
    finalizeUpload.mockImplementation(async (input) => ({
      linkedRecord: await input.persistLink(tx, {
        fileRecord: { id: "file_record_1" },
        storedObject: {
          originalFilename: "artwork.pdf",
          storedFilename: "safe-artwork.pdf",
          mimeType: "application/pdf",
          sizeBytes: 16,
          checksum: "checksum",
          extension: "pdf",
          bucket: "titan-private",
        },
      }),
    }));

    const result = await submitPortalOrderFile(portalRequest(), "order_1");

    expect(result).toMatchObject({
      id: "attachment_1",
      entityType: "order",
      entityId: "order_1",
      displayName: "artwork.pdf",
      statusLabel: "Submitted for review",
    });
    expect(finalizeUpload).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      createdByUserId: "portal_user_1",
      resource: expect.objectContaining({ resourceType: "order", resourceId: "order_1" }),
    }));
    expect(writes[0]?.values).toMatchObject({
      orderId: "order_1",
      uploadedByUserId: "portal_user_1",
      role: "reference",
      side: "na",
      isPrimary: false,
      customerVisible: true,
      portalFileCategory: "customer_upload",
      customerUploadReviewStatus: "pending_review",
    });
    expect(writes[1]?.values).toMatchObject({
      actionType: "portal_customer_file_submitted",
      entityType: "order_attachment",
      newValues: expect.objectContaining({
        relatedEntityType: "order",
        relatedEntityId: "order_1",
        reviewStatus: "pending_review",
        finalArtwork: false,
      }),
    });
  });

  test("does not write storage when the order is outside the portal customer scope", async () => {
    dbSelect.mockReturnValueOnce(selectRows([]));

    await expect(submitPortalOrderFile(portalRequest(), "other_customer_order")).resolves.toBeNull();
    expect(finalizeUpload).not.toHaveBeenCalled();
  });
});
